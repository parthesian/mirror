import { errorResponse, handleOptions, json } from '../../../_lib/http.js';
import { mapPhotoRecord } from '../../../_lib/photos.js';

async function getPhotoMetadata(context) {
    const { env, params } = context;
    const photoId = params.id;

    const result = await env.PHOTO_DB.prepare(`
        SELECT id, storage_key, location, description, taken_at, uploaded_at, width, height,
               latitude, longitude, country, camera
        FROM photos
        WHERE id = ?
        LIMIT 1
    `).bind(photoId).first();

    if (!result) {
        return errorResponse('Photo not found.', 404);
    }

    return json(mapPhotoRecord(result), {
        headers: {
            'Cache-Control': 'public, s-maxage=3600, max-age=300',
            'Vary': 'Accept-Encoding'
        }
    });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET':
                return await getPhotoMetadata(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to load photo metadata:', error);
        return errorResponse('Failed to load photo metadata.', 500, error.message);
    }
}
