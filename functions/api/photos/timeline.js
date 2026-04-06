import { errorResponse, handleOptions, json } from '../../_lib/http.js';

async function getTimeline(context) {
    const { env } = context;

    const statement = env.PHOTO_DB.prepare(`
        SELECT
            CAST(strftime('%Y', taken_at) AS INTEGER) AS year,
            CAST(strftime('%m', taken_at) AS INTEGER) AS month,
            COUNT(*) AS count
        FROM photos
        GROUP BY strftime('%Y', taken_at), strftime('%m', taken_at)
        ORDER BY year DESC, month DESC
    `);

    const results = await statement.all();
    const groups = Array.isArray(results.results) ? results.results : [];

    return json({ groups });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET':
                return await getTimeline(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to get timeline:', error);
        return errorResponse('Failed to retrieve timeline data.', 500, error.message);
    }
}
