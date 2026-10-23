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

declare module 'three' {
    export class Vector3 {
        constructor(x?: number, y?: number, z?: number);
        x: number;
        y: number;
        z: number;
        set(x: number, y: number, z: number): this;
        setLength(length: number): this;
        multiplyScalar(scalar: number): this;
        length(): number;
        clone(): Vector3;
        normalize(): this;
        dot(v: Vector3): number;
        applyQuaternion(q: Quaternion): this;
        toArray(): number[];
    }

    export class Quaternion {}

    export class PerspectiveCamera {
        constructor(fov: number, aspect: number, near: number, far: number);
        position: Vector3;
        up: Vector3;
        lookAt(x: number, y: number, z: number): void;
    }

    export class Group {
        rotation: { x: number; y: number; z: number };
        quaternion: Quaternion;
    }
}

declare module 'three/examples/jsm/controls/OrbitControls.js' {
    import type { PerspectiveCamera } from 'three';

    export class OrbitControls {
        constructor(camera: PerspectiveCamera, element: unknown);
        enableDamping: boolean;
        dampingFactor: number;
        autoRotate: boolean;
        autoRotateSpeed: number;
        minPolarAngle: number;
        maxPolarAngle: number;
        minAzimuthAngle: number;
        maxAzimuthAngle: number;
        target: Vector3;
        saveState(): void;
        update(): boolean;
        reset(): void;
        getAzimuthalAngle(): number;
        getPolarAngle(): number;
    }
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
