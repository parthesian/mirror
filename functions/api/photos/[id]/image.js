import { errorResponse } from '../../../_lib/http.js';
import { buildThumbnailStorageKey } from '../../../_lib/photos.js';

export async function onRequestGet(context) {
    try {
        const { params, env, request } = context;
        const photoId = params.id;
        const url = new URL(request.url);
        const variant = url.searchParams.get('variant') === 'thumb' ? 'thumb' : 'full';

        const result = await env.PHOTO_DB.prepare(`
            SELECT storage_key
            FROM photos
            WHERE id = ?
            LIMIT 1
        `).bind(photoId).first();

        if (!result) {
            return errorResponse('Photo not found.', 404);
        }

        const preferredStorageKey = variant === 'thumb'
            ? buildThumbnailStorageKey(result.storage_key)
            : result.storage_key;
        const object = await env.PHOTO_BUCKET.get(preferredStorageKey)
            || (variant === 'thumb' ? await env.PHOTO_BUCKET.get(result.storage_key) : null);
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
