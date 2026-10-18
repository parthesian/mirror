import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/d1';

type BoundStatement = {
    bind(...params: unknown[]): BoundStatement;
    all(): Promise<{ results: Array<Record<string, unknown>>; success: true }>;
    run(): Promise<{ success: true; meta: { changes: number } }>;
    raw(): Promise<unknown[][]>;
};

function createShim(sqlite: DatabaseSync) {
    return {
        prepare(sql: string): BoundStatement {
            const stmt = sqlite.prepare(sql);
            let params: unknown[] = [];
            const api: BoundStatement = {
                bind(...next: unknown[]) {
                    params = next;
                    return api;
                },
                async all() {
                    const results = params.length === 0 ? stmt.all() : stmt.all(...params);
                    return { results, success: true as const };
                },
                async run() {
                    const info = params.length === 0 ? stmt.run() : stmt.run(...params);
                    return { success: true as const, meta: { changes: Number(info.changes) } };
                },
                async raw() {
                    const results = params.length === 0 ? stmt.all() : stmt.all(...params);
                    return results.map((row) => Object.values(row));
                },
            };
            return api;
        },
        async exec(sql: string) {
            sqlite.exec(sql);
        },
    };
}

export function openTestDb() {
    const sqlite = new DatabaseSync(':memory:');
    const migrationsDir = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../migrations',
    );
    const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
    for (const file of files) {
        sqlite.exec(readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    const d1 = createShim(sqlite) as unknown as D1Database;
    return { sqlite, d1, db: drizzle(d1) };
}
