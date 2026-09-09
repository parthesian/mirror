import { requireAdmin } from '../../_lib/access.js';
import { errorResponse, handleOptions, json } from '../../_lib/http.js';
import { parseColors, serializeColors } from '../../_lib/colors.js';
import {
    decodeCursor,
    encodeCursor,
    getExtensionFromType,
    mapPhotoRecord,
    parseLimit,
    PHOTO_DETAIL_COLUMNS
} from '../../_lib/photos.js';

async function listPhotos(context) {
    const { request, env } = context;
    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
        return auth.response;
    }

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const rawCursor = url.searchParams.get('cursor');
    const cursor = decodeCursor(rawCursor);

    if (rawCursor && !cursor) {
        return errorResponse('Invalid cursor supplied.', 400);
    }

    const bindings = [];
    let whereClause = '';
    if (cursor) {
        whereClause = `
            WHERE (
                taken_at < ?
                OR (taken_at = ? AND uploaded_at < ?)
                OR (taken_at = ? AND uploaded_at = ? AND id < ?)
            )
        `;
        bindings.push(
            cursor.takenAt,
            cursor.takenAt, cursor.uploadedAt,
            cursor.takenAt, cursor.uploadedAt, cursor.id
        );
    }

    const results = await env.PHOTO_DB.prepare(`
        SELECT ${PHOTO_DETAIL_COLUMNS}
        FROM photos
        ${whereClause}
        ORDER BY taken_at DESC, uploaded_at DESC, id DESC
        LIMIT ?
    `).bind(...bindings, limit + 1).all();

    const rows = Array.isArray(results.results) ? results.results : [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return json({
        photos: pageRows.map(mapPhotoRecord),
        hasMore,
        nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null
    }, {
        headers: {
            'Cache-Control': 'no-store'
        }
    });
}

async function createPhoto(context) {
    const { request, env } = context;
    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
        return auth.response;
    }

    const formData = await request.formData();
    const photo = formData.get('photo');
    const location = (formData.get('location') || '').toString().trim();
    const description = (formData.get('description') || '').toString().trim();
    const takenAt = (formData.get('takenAt') || '').toString().trim();
    const width = Number.parseInt((formData.get('width') || '').toString().trim(), 10);
    const height = Number.parseInt((formData.get('height') || '').toString().trim(), 10);
    const latitude = Number.parseFloat((formData.get('latitude') || '').toString().trim());
    const longitude = Number.parseFloat((formData.get('longitude') || '').toString().trim());
    const country = (formData.get('country') || '').toString().trim();
    const state = (formData.get('state') || '').toString().trim();
    const camera = (formData.get('camera') || '').toString().trim();
    const colors = serializeColors(parseColors((formData.get('colors') || '').toString()));

    if (!(photo instanceof File)) {
        return errorResponse('A photo file is required.', 400);
    }

    if (!location) {
        return errorResponse('Location is required.', 400);
    }

    const photoId = crypto.randomUUID();
    const contentType = photo.type || 'image/jpeg';
    const extension = getExtensionFromType(contentType);
    const storageKey = `photos/${photoId}.${extension}`;
    const uploadedAt = new Date().toISOString();
    const normalizedTakenAt = takenAt || uploadedAt;

    await env.PHOTO_BUCKET.put(storageKey, await photo.arrayBuffer(), {
        httpMetadata: {
            contentType
        }
    });

    const normalizedLatitude = Number.isFinite(latitude) ? latitude : null;
    const normalizedLongitude = Number.isFinite(longitude) ? longitude : null;

    await env.PHOTO_DB.prepare(`
        INSERT INTO photos (
            id,
            storage_key,
            location,
            description,
            taken_at,
            uploaded_at,
            width,
            height,
            latitude,
            longitude,
            country,
            state,
            camera,
            colors
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        photoId,
        storageKey,
        location,
        description,
        normalizedTakenAt,
        uploadedAt,
        Number.isFinite(width) ? width : null,
        Number.isFinite(height) ? height : null,
        normalizedLatitude,
        normalizedLongitude,
        country,
        state,
        camera,
        colors
    ).run();

    return json({
        success: true,
        photoId,
        message: 'Photo uploaded successfully.',
        photo: mapPhotoRecord({
            id: photoId,
            storage_key: storageKey,
            location,
            description,
            taken_at: normalizedTakenAt,
            uploaded_at: uploadedAt,
            width: Number.isFinite(width) ? width : null,
            height: Number.isFinite(height) ? height : null,
            latitude: normalizedLatitude,
            longitude: normalizedLongitude,
            country,
            state,
            camera,
            colors
        })
    }, { status: 201 });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET':
                return await listPhotos(context);
            case 'POST':
                return await createPhoto(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to manage photos:', error);
        return errorResponse('Failed to manage photos.', 500, error.message);
    }
}
