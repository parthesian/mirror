import { errorResponse } from '../../../_lib/http.js';

export async function onRequestGet(context) {
    try {
        const { params, env } = context;
        const photoId = params.id;

        const result = await env.PHOTO_DB.prepare(`
            SELECT storage_key
            FROM photos
            WHERE id = ?
            LIMIT 1
        `).bind(photoId).first();

        if (!result) {
            return errorResponse('Photo not found.', 404);
        }

        const object = await env.PHOTO_BUCKET.get(result.storage_key);
        if (!object) {
            return errorResponse('Photo asset not found.', 404);
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');

        return new Response(object.body, {
            headers
        });
    } catch (error) {
        console.error('Failed to read image asset:', error);
        return errorResponse('Failed to retrieve image asset.', 500, error.message);
    }
}
