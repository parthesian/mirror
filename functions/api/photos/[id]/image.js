import { errorResponse } from '../../../_lib/http.js';

export async function onRequestGet(context) {
    try {
        const { params, env, request } = context;
        const cache = caches.default;

        const cacheKey = new Request(request.url, request);
        const cached = await cache.match(cacheKey);
        if (cached) {
            return cached;
        }

        const result = await env.PHOTO_DB.prepare(
            'SELECT storage_key FROM photos WHERE id = ? LIMIT 1'
        ).bind(params.id).first();

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

        const response = new Response(object.body, { headers });
        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
    } catch (error) {
        console.error('Failed to read image asset:', error);
        return errorResponse('Failed to retrieve image asset.', 500, error.message);
    }
}
