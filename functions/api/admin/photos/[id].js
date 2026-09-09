import { requireAdmin } from '../../../_lib/access.js';
import { errorResponse, handleOptions, json } from '../../../_lib/http.js';
import { parseColors, serializeColors } from '../../../_lib/colors.js';
import { buildThumbnailStorageKey, mapPhotoRecord, PHOTO_DETAIL_COLUMNS } from '../../../_lib/photos.js';

const TEXT_FIELDS = {
    location: 'location',
    description: 'description',
    country: 'country',
    state: 'state',
    camera: 'camera'
};

function normalizeTakenAt(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const trimmed = value.trim();
    const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const normalized = dateOnlyMatch ? `${trimmed}T12:00:00.000Z` : trimmed;
    const timestamp = Date.parse(normalized);

    if (!Number.isFinite(timestamp)) {
        return null;
    }

    const isoTimestamp = new Date(timestamp).toISOString();
    if (dateOnlyMatch && isoTimestamp.slice(0, 10) !== trimmed) {
        return null;
    }

    return isoTimestamp;
}

function normalizeCoordinate(value, minimum, maximum) {
    if (value === null || value === '') {
        return { valid: true, value: null };
    }

    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
        return { valid: false, value: null };
    }

    return { valid: true, value: parsed };
}

async function updatePhoto(context) {
    const { request, env, params } = context;
    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
        return auth.response;
    }

    let payload;
    try {
        payload = await request.json();
    } catch {
        return errorResponse('A valid JSON body is required.', 400);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return errorResponse('A valid metadata object is required.', 400);
    }

    const assignments = [];
    const bindings = [];

    for (const [apiField, column] of Object.entries(TEXT_FIELDS)) {
        if (payload[apiField] === undefined) {
            continue;
        }

        if (typeof payload[apiField] !== 'string') {
            return errorResponse(`${apiField} must be a string.`, 400);
        }

        const value = payload[apiField].trim();
        if (apiField === 'location' && !value) {
            return errorResponse('Location is required.', 400);
        }

        assignments.push(`${column} = ?`);
        bindings.push(value);
    }

    if (payload.takenAt !== undefined) {
        const takenAt = normalizeTakenAt(payload.takenAt);
        if (!takenAt) {
            return errorResponse('A valid date is required.', 400);
        }
        assignments.push('taken_at = ?');
        bindings.push(takenAt);
    }

    if (payload.latitude !== undefined) {
        const latitude = normalizeCoordinate(payload.latitude, -90, 90);
        if (!latitude.valid) {
            return errorResponse('Latitude must be between -90 and 90.', 400);
        }
        assignments.push('latitude = ?');
        bindings.push(latitude.value);
    }

    if (payload.longitude !== undefined) {
        const longitude = normalizeCoordinate(payload.longitude, -180, 180);
        if (!longitude.valid) {
            return errorResponse('Longitude must be between -180 and 180.', 400);
        }
        assignments.push('longitude = ?');
        bindings.push(longitude.value);
    }

    if (payload.colors !== undefined) {
        const colors = serializeColors(parseColors(payload.colors));
        assignments.push('colors = ?');
        bindings.push(colors);
    }

    if (!assignments.length) {
        return errorResponse('No editable metadata fields were supplied.', 400);
    }

    const existing = await env.PHOTO_DB.prepare(`
        SELECT id FROM photos WHERE id = ? LIMIT 1
    `).bind(params.id).first();

    if (!existing) {
        return errorResponse('Photo not found.', 404);
    }

    await env.PHOTO_DB.prepare(`
        UPDATE photos
        SET ${assignments.join(', ')}
        WHERE id = ?
    `).bind(...bindings, params.id).run();

    const updated = await env.PHOTO_DB.prepare(`
        SELECT ${PHOTO_DETAIL_COLUMNS}
        FROM photos
        WHERE id = ?
        LIMIT 1
    `).bind(params.id).first();

    return json({
        success: true,
        message: 'Photo metadata saved.',
        photo: mapPhotoRecord(updated)
    }, {
        headers: {
            'Cache-Control': 'no-store'
        }
    });
}

async function deleteStoredObjects(env, storageKey) {
    const keys = [storageKey];
    const thumbnailKey = buildThumbnailStorageKey(storageKey);
    if (thumbnailKey && thumbnailKey !== storageKey) {
        keys.push(thumbnailKey);
    }

    await Promise.all(keys.map(async (key) => {
        try {
            await env.PHOTO_BUCKET.delete(key);
        } catch (error) {
            console.error(`Failed to delete stored photo object ${key}:`, error);
        }
    }));
}

async function deletePhoto(context) {
    const { request, env, params } = context;
    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
        return auth.response;
    }

    const existing = await env.PHOTO_DB.prepare(`
        SELECT id, storage_key FROM photos WHERE id = ? LIMIT 1
    `).bind(params.id).first();

    if (!existing) {
        return errorResponse('Photo not found.', 404);
    }

    await env.PHOTO_DB.prepare(`
        DELETE FROM photos WHERE id = ?
    `).bind(params.id).run();

    await deleteStoredObjects(env, existing.storage_key);

    return json({
        success: true,
        message: 'Photo and metadata deleted.',
        photoId: params.id
    }, {
        headers: {
            'Cache-Control': 'no-store'
        }
    });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'PATCH':
                return await updatePhoto(context);
            case 'DELETE':
                return await deletePhoto(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        const action = context.request.method === 'DELETE' ? 'delete photo' : 'update photo metadata';
        console.error(`Failed to ${action}:`, error);
        return errorResponse(`Failed to ${action}.`, 500, error.message);
    }
}
