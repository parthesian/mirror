import { errorResponse } from './http.js';

function parseAllowlist(rawValue = '') {
    return rawValue
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
}

export function getAuthenticatedEmail(request) {
    return (
        request.headers.get('cf-access-authenticated-user-email') ||
        request.headers.get('Cf-Access-Authenticated-User-Email') ||
        ''
    ).trim().toLowerCase();
}

export function requireAdmin(request, env) {
    const authenticatedEmail = getAuthenticatedEmail(request);
    const allowedEmails = parseAllowlist(env.ADMIN_EMAIL_ALLOWLIST);

    if (!authenticatedEmail) {
        return {
            ok: false,
            response: errorResponse('Admin authentication required.', 401)
        };
    }

    if (allowedEmails.length > 0 && !allowedEmails.includes(authenticatedEmail)) {
        return {
            ok: false,
            response: errorResponse('Authenticated user is not allowed to upload photos.', 403)
        };
    }

    return {
        ok: true,
        email: authenticatedEmail
    };
}
