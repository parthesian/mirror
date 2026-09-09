import { mapColorFacets } from '../../_lib/colors.js';
import { errorResponse, handleOptions, json } from '../../_lib/http.js';
import { buildPhotoFilterClause, collectPhotoFilters } from '../../_lib/photos.js';

async function listPhotoColors(context) {
    const { env, request } = context;
    const url = new URL(request.url);
    const filters = collectPhotoFilters(url.searchParams);
    // Facet counts should follow place/date filters, not the selected color.
    filters.color = '';
    const { clauses, bindings } = buildPhotoFilterClause(filters);
    clauses.push("TRIM(json_each.value) != ''");

    const results = await env.PHOTO_DB.prepare(`
        SELECT LOWER(TRIM(json_each.value)) AS color, COUNT(*) AS count
        FROM photos, json_each(
            CASE
                WHEN photos.colors IS NULL OR TRIM(photos.colors) = '' THEN '[]'
                ELSE photos.colors
            END
        )
        WHERE ${clauses.join(' AND ')}
        GROUP BY LOWER(TRIM(json_each.value))
    `).bind(...bindings).all();

    const rows = Array.isArray(results.results) ? results.results : [];

    return json({ colors: mapColorFacets(rows) }, {
        headers: {
            'Cache-Control': 'public, s-maxage=60, max-age=15',
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
