const DEFAULT_HEADERS = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        status: init.status || 200,
        headers: {
            ...DEFAULT_HEADERS,
            ...(init.headers || {})
        }
    });
}

export function errorResponse(message, status = 500, details = null) {
    const payload = { error: message };

    if (details) {
        payload.details = details;
    }

    return json(payload, { status });
}

export function handleOptions() {
    return new Response(null, {
        status: 204,
        headers: DEFAULT_HEADERS
    });
}
