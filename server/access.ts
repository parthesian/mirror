import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import type { Bindings } from './env.js';
import { type AppContext, fail } from './http.js';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type AdminAuth = { ok: true; email: string } | { ok: false; response: Response };

function parseAllowlist(rawValue = ''): string[] {
    return rawValue
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getAuthenticatedEmailHeader(request: Request): string {
    return (
        request.headers.get('cf-access-authenticated-user-email') ||
        request.headers.get('Cf-Access-Authenticated-User-Email') ||
        ''
    )
        .trim()
        .toLowerCase();
}

function getAccessJwt(request: Request): string {
    return (
        request.headers.get('cf-access-jwt-assertion') ||
        request.headers.get('Cf-Access-Jwt-Assertion') ||
        ''
    ).trim();
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
    const segments = token.split('.');
    const body = segments[1];
    if (segments.length !== 3 || !body) {
        return null;
    }

    try {
        const normalized = body.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const parsed: unknown = JSON.parse(atob(padded));
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function getJwksForIssuer(issuer: string) {
    const cached = jwksCache.get(issuer);
    if (cached) {
        return cached;
    }
    const next = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, next);
    return next;
}

function emailFromPayload(payload: JWTPayload | Record<string, unknown>): string {
    const email = payload.email ?? payload.sub;
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

async function getAuthenticatedEmail(request: Request, env: Bindings): Promise<string> {
    const accessJwt = getAccessJwt(request);
    if (accessJwt) {
        const unverifiedPayload = parseJwtPayload(accessJwt);
        const issuer = unverifiedPayload?.iss;
        if (typeof issuer === 'string' && issuer) {
            const verifyOptions: { issuer: string; audience?: string } = { issuer };
            if (env.ACCESS_AUD) {
                verifyOptions.audience = env.ACCESS_AUD;
            }
            try {
                const { payload } = await jwtVerify(
                    accessJwt,
                    getJwksForIssuer(issuer),
                    verifyOptions,
                );
                return emailFromPayload(payload);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'JWT verification failed';
                console.warn('Cloudflare Access JWT verification failed:', message);
            }
        }
    }

    return getAuthenticatedEmailHeader(request);
}

export async function requireAdmin(c: AppContext): Promise<AdminAuth> {
    const authenticatedEmail = await getAuthenticatedEmail(c.req.raw, c.env);
    const allowedEmails = parseAllowlist(c.env.ADMIN_EMAIL_ALLOWLIST);

    if (!authenticatedEmail) {
        return { ok: false, response: fail(c, 'Admin authentication required.', 401) };
    }

    if (allowedEmails.length > 0 && !allowedEmails.includes(authenticatedEmail)) {
        return {
            ok: false,
            response: fail(c, 'Authenticated user is not allowed to upload photos.', 403),
        };
    }

    return { ok: true, email: authenticatedEmail };
}
