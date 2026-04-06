import { errorResponse, handleOptions, json } from '../_lib/http.js';
import { decodeCursor, encodeCursor, mapPhotoRecord, parseLimit } from '../_lib/photos.js';

async function listPhotos(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    if (url.searchParams.get('cursor') && !cursor) {
        return errorResponse('Invalid cursor supplied.', 400);
    }

    let statement = env.PHOTO_DB.prepare(`
        SELECT id, storage_key, location, description, taken_at, uploaded_at, width, height, latitude, longitude, country
        FROM photos
    `);

    if (cursor) {
        statement = env.PHOTO_DB.prepare(`
            SELECT id, storage_key, location, description, taken_at, uploaded_at, width, height, latitude, longitude, country
            FROM photos
            WHERE taken_at < ?
               OR (taken_at = ? AND uploaded_at < ?)
               OR (taken_at = ? AND uploaded_at = ? AND id < ?)
            ORDER BY taken_at DESC, uploaded_at DESC, id DESC
            LIMIT ?
        `).bind(
            cursor.takenAt,
            cursor.takenAt, cursor.uploadedAt,
            cursor.takenAt, cursor.uploadedAt, cursor.id,
            limit + 1
        );
    } else {
        statement = env.PHOTO_DB.prepare(`
            SELECT id, storage_key, location, description, taken_at, uploaded_at, width, height, latitude, longitude, country
            FROM photos
            ORDER BY taken_at DESC, uploaded_at DESC, id DESC
            LIMIT ?
        `).bind(limit + 1);
    }

    const results = await statement.all();
    const rows = Array.isArray(results.results) ? results.results : [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const photos = pageRows.map(mapPhotoRecord);
    const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null;

    return json({
        photos,
        hasMore,
        nextCursor
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
