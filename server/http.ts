import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './env.js';

export type AppContext = Context<AppEnv>;

export function fail(c: AppContext, error: string, status: ContentfulStatusCode, details?: string) {
    const body: { error: string; details?: string } = { error };
    if (details) {
        body.details = details;
    }
    return c.json(body, status);
}

export async function guard(c: AppContext, message: string, fn: () => Promise<Response>) {
    try {
        return await fn();
    } catch (error) {
        console.error(message, error);
        const details = error instanceof Error ? error.message : 'Unknown error';
        return fail(c, message, 500, details);
    }
}
