import { mapColorFacets } from '../../_lib/colors.js';
import { errorResponse, handleOptions, json } from '../../_lib/http.js';

async function listPhotoColors(context) {
    const { env } = context;
    const results = await env.PHOTO_DB.prepare(`
        SELECT LOWER(TRIM(json_each.value)) AS color, COUNT(*) AS count
        FROM photos, json_each(
            CASE
                WHEN photos.colors IS NULL OR TRIM(photos.colors) = '' THEN '[]'
                ELSE photos.colors
            END
        )
        WHERE TRIM(json_each.value) != ''
        GROUP BY LOWER(TRIM(json_each.value))
    `).all();

    const rows = Array.isArray(results.results) ? results.results : [];

    return json({ colors: mapColorFacets(rows) }, {
        headers: {
            'Cache-Control': 'public, s-maxage=120, max-age=30',
            'Vary': 'Accept-Encoding'
        }
    });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET':
                return await listPhotoColors(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to list photo colors:', error);
        return errorResponse('Failed to retrieve photo colors.', 500, error.message);
    }
}
