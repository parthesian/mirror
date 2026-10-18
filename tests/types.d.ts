interface ImportMeta {
    url: string;
}

declare module 'node:fs' {
    export function readFileSync(path: string, encoding: 'utf8'): string;
    export function readdirSync(path: string): string[];
}

declare module 'node:path' {
    export function join(...parts: string[]): string;
    export function dirname(path: string): string;
}

declare module 'node:url' {
    export function fileURLToPath(url: string | URL): string;
}

declare module 'node:sqlite' {
    export class DatabaseSync {
        constructor(path: string);
        exec(sql: string): void;
        prepare(sql: string): StatementSync;
    }

    export class StatementSync {
        all(...params: unknown[]): Array<Record<string, unknown>>;
        get(...params: unknown[]): Record<string, unknown> | undefined;
        run(...params: unknown[]): { changes: number | bigint };
    }
}

declare module 'jpeg-js' {
    export function decode(
        buffer: Uint8Array,
        options?: { useTArray?: boolean; maxMemoryUsageInMB?: number },
    ): { data: Uint8Array; width: number; height: number };
    export function encode(
        image: { data: Uint8Array; width: number; height: number },
        quality?: number,
    ): { data: Uint8Array };
}
