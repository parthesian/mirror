import { createRemoteJWKSet, jwtVerify } from 'jose';
import { errorResponse } from './http.js';

const jwksCache = new Map();

function parseAllowlist(rawValue = '') {
    return rawValue
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
}

function getAuthenticatedEmailHeader(request) {
    return (
        request.headers.get('cf-access-authenticated-user-email') ||
        request.headers.get('Cf-Access-Authenticated-User-Email') ||
        ''
    ).trim().toLowerCase();
}

function getAccessJwt(request) {
    return (
        request.headers.get('cf-access-jwt-assertion') ||
        request.headers.get('Cf-Access-Jwt-Assertion') ||
        ''
    ).trim();
}

function parseJwtPayload(token) {
    const segments = token.split('.');
    if (segments.length !== 3) {
        return null;
    }

    try {
        const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

function getJwksForIssuer(issuer) {
    if (!jwksCache.has(issuer)) {
        jwksCache.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
    }

    return jwksCache.get(issuer);
}

async function getAuthenticatedEmail(request, env) {
    const accessJwt = getAccessJwt(request);

    if (accessJwt) {
        const unverifiedPayload = parseJwtPayload(accessJwt);
        const issuer = unverifiedPayload?.iss;

        if (issuer) {
            const verifyOptions = {
                issuer
            };

            if (env.ACCESS_AUD) {
                verifyOptions.audience = env.ACCESS_AUD;
            }

            try {
                const { payload } = await jwtVerify(accessJwt, getJwksForIssuer(issuer), verifyOptions);
                return (payload.email || payload.sub || '').toString().trim().toLowerCase();
            } catch (error) {
                console.warn('Cloudflare Access JWT verification failed:', error.message);
            }
        }
    }

    return getAuthenticatedEmailHeader(request);
}

export async function requireAdmin(request, env) {
    const authenticatedEmail = await getAuthenticatedEmail(request, env);
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
