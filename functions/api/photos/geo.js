import { errorResponse, handleOptions, json } from '../../_lib/http.js';

async function getGeoLocations(context) {
    const { env } = context;

    const statement = env.PHOTO_DB.prepare(`
        SELECT id, latitude, longitude, country, state, location, taken_at, uploaded_at
        FROM photos
        WHERE latitude IS NOT NULL
          AND longitude IS NOT NULL
        ORDER BY taken_at ASC, uploaded_at ASC, id ASC
    `);

    const results = await statement.all();
    const rows = Array.isArray(results.results) ? results.results : [];

    const locations = rows.map(r => ({
        id: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        country: r.country || '',
        state: r.state || '',
        location: r.location || '',
        takenAt: r.taken_at
    }));

    return json({ locations }, {
        headers: {
            'Cache-Control': 'public, s-maxage=600, max-age=120',
            'Vary': 'Accept-Encoding'
        }
    });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET':
                return await getGeoLocations(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to get geo locations:', error);
        return errorResponse('Failed to retrieve geo data.', 500, error.message);
    }
}
