import { requireAdmin } from '../../_lib/access.js';
import { errorResponse, handleOptions, json } from '../../_lib/http.js';
import { getExtensionFromType, mapPhotoRecord } from '../../_lib/photos.js';

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
            camera
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        camera
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
            camera
        })
    }, { status: 201 });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'POST':
                return await createPhoto(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to upload photo:', error);
        return errorResponse('Failed to upload photo.', 500, error.message);
    }
}
