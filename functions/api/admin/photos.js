import { requireAdmin } from '../../_lib/access.js';
import { errorResponse, handleOptions, json } from '../../_lib/http.js';
import { getExtensionFromType, mapPhotoRecord } from '../../_lib/photos.js';

async function createPhoto(context) {
    const { request, env } = context;
    const auth = requireAdmin(request, env);

    if (!auth.ok) {
        return auth.response;
    }

    const formData = await request.formData();
    const photo = formData.get('photo');
    const location = (formData.get('location') || '').toString().trim();
    const description = (formData.get('description') || '').toString().trim();
    const takenAt = (formData.get('takenAt') || '').toString().trim();

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

    await env.PHOTO_DB.prepare(`
        INSERT INTO photos (
            id,
            storage_key,
            location,
            description,
            taken_at,
            uploaded_at,
            width,
            height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        photoId,
        storageKey,
        location,
        description,
        normalizedTakenAt,
        uploadedAt,
        null,
        null
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
            width: null,
            height: null
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
