import { drizzle } from 'drizzle-orm/d1';
import type { Bindings } from './env.js';

export function createDb(env: Pick<Bindings, 'PHOTO_DB'>) {
    return drizzle(env.PHOTO_DB);
}

export type PhotoDb = ReturnType<typeof createDb>;
