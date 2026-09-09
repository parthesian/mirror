import { errorResponse, handleOptions, json } from '../_lib/http.js';
import {
    buildPhotoFilterClause,
    collectPhotoFilters,
    decodeCursor,
    encodeCursor,
    mapPhotoListRecord,
    parseLimit
} from '../_lib/photos.js';

async function listPhotos(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const filters = collectPhotoFilters(url.searchParams);

    if (url.searchParams.get('cursor') && !cursor) {
        return errorResponse('Invalid cursor supplied.', 400);
    }

    const cols = 'id, taken_at, uploaded_at, width, height';
    const { clauses, bindings } = buildPhotoFilterClause(filters);

    if (cursor) {
        clauses.push('(taken_at < ? OR (taken_at = ? AND uploaded_at < ?) OR (taken_at = ? AND uploaded_at = ? AND id < ?))');
        bindings.push(
            cursor.takenAt,
            cursor.takenAt, cursor.uploadedAt,
            cursor.takenAt, cursor.uploadedAt, cursor.id
        );
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const statement = env.PHOTO_DB.prepare(`
        SELECT ${cols} FROM photos
        ${whereClause}
        ORDER BY taken_at DESC, uploaded_at DESC, id DESC
        LIMIT ?
    `).bind(...bindings, limit + 1);

    const results = await statement.all();
    const rows = Array.isArray(results.results) ? results.results : [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const photos = pageRows.map(mapPhotoListRecord);
    const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null;

    return json({
        photos,
        hasMore,
        nextCursor
    }, {
        headers: {
            'Cache-Control': 'public, s-maxage=60, max-age=10',
            'Vary': 'Accept-Encoding'
        }
    });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET':
                return await listPhotos(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to list photos:', error);
        return errorResponse('Failed to retrieve photos.', 500, error.message);
    }
}
