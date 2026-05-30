import { errorResponse, handleOptions, json } from '../../_lib/http.js';
import { hashString, mapPhotoListRecord, utcDateKey } from '../../_lib/photos.js';

async function getDailyPhoto(context) {
    const { env } = context;

    const countResult = await env.PHOTO_DB.prepare('SELECT COUNT(*) AS total FROM photos').first();
    const total = Number(countResult?.total) || 0;

    if (total === 0) {
        return errorResponse('No photos available.', 404);
    }

    const dateKey = utcDateKey();
    const offset = hashString(dateKey) % total;

    const row = await env.PHOTO_DB.prepare(`
        SELECT id, taken_at, uploaded_at
        FROM photos
        ORDER BY id ASC
        LIMIT 1 OFFSET ?
    `).bind(offset).first();

    if (!row) {
        return errorResponse('No photos available.', 404);
    }

    return json({
        date: dateKey,
        photo: mapPhotoListRecord(row)
    }, {
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
                return await getDailyPhoto(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to load daily photo:', error);
        return errorResponse('Failed to load daily photo.', 500, error.message);
    }
}
