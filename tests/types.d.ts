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
        angleTo(v: Vector3): number;
        applyQuaternion(q: Quaternion): this;
        applyMatrix4(m: Matrix4): this;
        project(camera: PerspectiveCamera): this;
        toArray(): number[];
    }

    export class Quaternion {}

    export class Matrix4 {}

    export class PerspectiveCamera {
        constructor(fov: number, aspect: number, near: number, far: number);
        position: Vector3;
        up: Vector3;
        lookAt(x: number, y: number, z: number): void;
        updateMatrixWorld(force?: boolean): void;
    }

    export class Group {
        rotation: { x: number; y: number; z: number };
        quaternion: Quaternion;
        matrixWorld: Matrix4;
        updateMatrixWorld(force?: boolean): void;
        worldToLocal(v: Vector3): Vector3;
    }

    export class BufferAttribute {
        count: number;
        getX(index: number): number;
        getY(index: number): number;
        getZ(index: number): number;
    }

    export class SphereGeometry {
        constructor(radius?: number, widthSegments?: number, heightSegments?: number);
        getAttribute(name: string): BufferAttribute;
        dispose(): void;
    }

    export class Raycaster {
        ray: { origin: Vector3; direction: Vector3 };
        setFromCamera(ndc: { x: number; y: number }, camera: PerspectiveCamera): void;
    }

    export const MathUtils: {
        degToRad(degrees: number): number;
    };

    export const NormalBlending: number;

    export const AdditiveBlending: number;

    export class LineSegments {
        geometry: { dispose(): void };
        material:
            | {
                  blending: number;
                  opacity: number;
                  depthWrite: boolean;
                  transparent: boolean;
                  type: string;
                  dispose(): void;
              }
            | Array<{ dispose(): void }>;
    }

    export class Mesh {
        geometry: { dispose(): void };
        material:
            | {
                  blending: number;
                  depthTest: boolean;
                  depthWrite: boolean;
                  transparent: boolean;
                  type: string;
                  dispose(): void;
              }
            | Array<{ dispose(): void }>;
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
        enableZoom: boolean;
        enablePan: boolean;
        minDistance: number;
        maxDistance: number;
        minPolarAngle: number;
        maxPolarAngle: number;
        minAzimuthAngle: number;
        maxAzimuthAngle: number;
        target: Vector3;
        saveState(): void;
        update(): boolean;
        reset(): void;
        dispose(): void;
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
