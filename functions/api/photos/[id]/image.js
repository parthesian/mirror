import { errorResponse } from '../../../_lib/http.js';

async function serveFromR2(env, photoId) {
    const result = await env.PHOTO_DB.prepare(
        'SELECT storage_key FROM photos WHERE id = ? LIMIT 1'
    ).bind(photoId).first();

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
    return new Response(object.body, { headers });
}

export async function onRequestGet(context) {
    try {
        const { params, env, request } = context;

        // Image Resizing subrequest -- serve the raw original so it can be transformed.
        const via = request.headers.get('via') || '';
        if (via.includes('image-resizing')) {
            return serveFromR2(env, params.id);
        }

        const cache = caches.default;
        const cacheKey = new Request(request.url, request);
        const cached = await cache.match(cacheKey);
        if (cached) {
            return cached;
        }

        const url = new URL(request.url);
        const variant = url.searchParams.get('variant') === 'thumb' ? 'thumb' : 'full';

        let response;

        if (variant === 'thumb') {
            response = await fetch(request.url, {
                cf: {
                    image: {
                        width: 640,
                        height: 640,
                        fit: 'inside',
                        quality: 82
                    }
                }
            });

            // Ensure our cache headers are on the transformed response.
            response = new Response(response.body, {
                status: response.status,
                headers: {
                    'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
                    'Cache-Control': 'public, max-age=31536000, immutable'
                }
            });
        } else {
            response = await serveFromR2(env, params.id);
        }

        if (response.ok) {
            context.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
    } catch (error) {
        console.error('Failed to read image asset:', error);
        return errorResponse('Failed to retrieve image asset.', 500, error.message);
    }
}
