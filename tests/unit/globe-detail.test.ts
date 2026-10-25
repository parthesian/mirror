import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
    AdditiveBlending,
    Group,
    LineSegments,
    PerspectiveCamera,
    Raycaster,
    SphereGeometry,
    Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

type LonLat = { lon: number; lat: number };
type RawSegment = { lon1: number; lat1: number; lon2: number; lat2: number };
type LevelName = 'world' | 'regional' | 'local';

type GlobeDetailApi = {
    CONFIG: { H_MIN: number; TAU_NOTCH_MS: number };
    latLonToXYZ(lat: number, lon: number, radius?: number): { x: number; y: number; z: number };
    stepLevel(level: LevelName, d: number): LevelName;
    shouldFetch(kind: string, d: number, hGoal: number): boolean;
    splitSegment(lon1: number, lat1: number, lon2: number, lat2: number): RawSegment[];
    densifyPoints(points: LonLat[], maxDeg: number): LonLat[];
    worldEdgeStats(input: unknown): { coast: number; border: number; maxAbsDeltaLon: number };
    normalizeWheel(event: {
        deltaY?: number;
        deltaMode?: number;
        ctrlKey?: boolean;
        canvasHeight?: number;
    }): { px: number; pinch: boolean; notch: boolean; k: number; tau: number };
    nextAltitudeGoal(hGoal: number, px: number, k: number, hMin: number, hMax: number): number;
    stepAltitude(
        h: number,
        hGoal: number,
        dt: number,
        tau: number,
    ): { h: number; settled: boolean };
    anchorWeight(
        px: number,
        py: number,
        pz: number,
        camX: number,
        camY: number,
        camZ: number,
        fit: number,
    ): number;
    adjustSpherical(input: {
        x: number;
        y: number;
        z: number;
        px: number;
        py: number;
        pz: number;
        qx: number;
        qy: number;
        qz: number;
        w: number;
        phiMin: number;
        phiMax: number;
    }): { x: number; y: number; z: number; theta: number; phi: number };
    rayUnitSphere(
        ox: number,
        oy: number,
        oz: number,
        dx: number,
        dy: number,
        dz: number,
    ): { x: number; y: number; z: number; t: number } | null;
};

type RoutePoint = { x: number; y: number; z: number };
type RouteLocation = {
    latitude: number;
    longitude: number;
    country?: string;
    state?: string;
    location?: string;
};

type GlobeRoutesCtor = new () => {
    latLonToVec3(
        lat: number,
        lon: number,
        radius: number,
        three: {
            MathUtils: { degToRad(degrees: number): number };
            Vector3: typeof Vector3;
        },
    ): Vector3;
    sampleArc(start: RoutePoint, end: RoutePoint): RoutePoint[];
    buildArcs(
        three: typeof THREE,
        group: Group,
        locations: RouteLocation[],
        locationKeyFor: (loc: RouteLocation) => string,
    ): LineSegments | null;
};

function loadClassic<T>(relativePath: string, exportName: string): T {
    const source = readFileSync(join(repoRoot, relativePath), 'utf8');
    const windowStub: Record<string, unknown> = {};
    const runner = new Function(
        'window',
        `${source}\nreturn window[${JSON.stringify(exportName)}];`,
    ) as (windowStub: Record<string, unknown>) => T;
    return runner(windowStub);
}

function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function installDomStub(): void {
    Object.assign(globalThis, {
        document: {
            addEventListener(): void {},
            removeEventListener(): void {},
        },
    });
}

function globeFitDistance(width: number, height: number, fovDeg = 45): number {
    const aspect = Math.max(1, width) / Math.max(1, height);
    const halfFov = (fovDeg * Math.PI) / 360;
    const halfMin = Math.min(1, aspect) * Math.tan(halfFov);
    return Math.min(8, Math.max(2.6, 1.28 / Math.max(halfMin, 0.001)));
}

function assertStepsAtMost(points: LonLat[], maxDeg: number): void {
    for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (!a || !b) {
            return;
        }
        expect(Math.abs(b.lon - a.lon)).toBeLessThanOrEqual(maxDeg + 1e-9);
        expect(Math.abs(b.lat - a.lat)).toBeLessThanOrEqual(maxDeg + 1e-9);
    }
}

describe('globe detail', () => {
    const GlobeDetail = loadClassic<GlobeDetailApi>('js/globeDetail.js', 'GlobeDetail');
    const GlobeRoutes = loadClassic<GlobeRoutesCtor>('js/globeRoutes.js', 'GlobeRoutes');
    const routes = new GlobeRoutes();
    const threeStub = {
        MathUtils: { degToRad: (degrees: number) => (degrees * Math.PI) / 180 },
        Vector3,
    };

    it('matches GlobeRoutes.latLonToVec3 within 1e-12', () => {
        const random = mulberry32(20261025);
        const samples: Array<[number, number]> = [
            [90, 0],
            [-90, 0],
            [0, 180],
            [0, -180],
            [90, 180],
            [-90, -180],
            [45, 180],
            [-45, -180],
        ];
        while (samples.length < 200) {
            const lat = random() * 180 - 90;
            const lon = random() * 360 - 180;
            samples.push([lat, lon]);
        }
        for (const sample of samples) {
            const lat = sample[0];
            const lon = sample[1];
            expect(lat).toBeDefined();
            expect(lon).toBeDefined();
            if (lat === undefined || lon === undefined) {
                return;
            }
            const xyz = GlobeDetail.latLonToXYZ(lat, lon, 1);
            const routed = routes.latLonToVec3(lat, lon, 1, threeStub);
            expect(xyz.x).toBeCloseTo(routed.x, 12);
            expect(xyz.y).toBeCloseTo(routed.y, 12);
            expect(xyz.z).toBeCloseTo(routed.z, 12);
        }
    });

    it('lands on the SphereGeometry vertex selected by the same UV', () => {
        const geometry = new SphereGeometry(1, 192, 96);
        const position = geometry.getAttribute('position');
        const uv = geometry.getAttribute('uv');
        const halfFacet = (Math.hypot(360 / 192, 180 / 96) / 2) * (Math.PI / 180);
        const random = mulberry32(96);
        for (let n = 0; n < 50; n += 1) {
            const lat = random() * 160 - 80;
            const lon = random() * 360 - 180;
            const targetU = (lon + 180) / 360;
            const targetV = (lat + 90) / 180;
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < uv.count; i += 1) {
                const du = uv.getX(i) - targetU;
                const dv = uv.getY(i) - targetV;
                const dist = du * du + dv * dv;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = i;
                }
            }
            const vertex = new Vector3(
                position.getX(best),
                position.getY(best),
                position.getZ(best),
            );
            const xyz = GlobeDetail.latLonToXYZ(lat, lon, 1);
            const direction = new Vector3(xyz.x, xyz.y, xyz.z).normalize();
            const angle = direction.angleTo(vertex.normalize());
            expect(angle).toBeLessThanOrEqual(halfFacet + 1e-6);
        }
        geometry.dispose();
    });

    it('keeps the level inside a ±0.03 oscillation and changes once on a crossing', () => {
        const bands: Array<[LevelName, number]> = [
            ['world', 2.05],
            ['regional', 2.05],
            ['regional', 1.55],
            ['local', 1.55],
        ];
        for (const band of bands) {
            const start = band[0];
            const center = band[1];
            let level = start;
            for (let i = 0; i < 12; i += 1) {
                const d = center + (i % 2 === 0 ? 0.03 : -0.03);
                level = GlobeDetail.stepLevel(level, d);
                expect(level).toBe(start);
            }
        }

        const crossings: Array<{
            start: LevelName;
            samples: number[];
            expected: LevelName;
        }> = [
            { start: 'world', samples: [2.02, 2.011, 2.009, 2], expected: 'regional' },
            { start: 'regional', samples: [1.52, 1.511, 1.509, 1.4], expected: 'local' },
            { start: 'local', samples: [1.58, 1.589, 1.591, 1.7], expected: 'regional' },
            { start: 'regional', samples: [2.08, 2.089, 2.091, 2.4], expected: 'world' },
        ];
        for (const crossing of crossings) {
            let level = crossing.start;
            let changes = 0;
            for (const d of crossing.samples) {
                const next = GlobeDetail.stepLevel(level, d);
                if (next !== level) {
                    changes += 1;
                    level = next;
                }
            }
            expect(changes).toBe(1);
            expect(level).toBe(crossing.expected);
        }
    });

    it('does not prefetch line files at the fit distance', () => {
        const distances = [2.35, 2.6, 3.09, 4, 8];
        for (const d of distances) {
            expect(GlobeDetail.shouldFetch('50m', d, Math.max(1.35, d - 1))).toBe(false);
            expect(GlobeDetail.shouldFetch('50m', d, 2.6 - 1)).toBe(false);
            expect(GlobeDetail.shouldFetch('10m', d, 2.6 - 1)).toBe(false);
        }
        expect(GlobeDetail.shouldFetch('50m', 2.6, 1.6)).toBe(false);
        expect(GlobeDetail.shouldFetch('50m', 3, 1.2)).toBe(true);
        expect(GlobeDetail.shouldFetch('10m', 2.6, 1.6)).toBe(false);
        expect(GlobeDetail.shouldFetch('10m', 3, 0.7)).toBe(true);
    });

    it('splits the antimeridian and densifies to 0.5°', () => {
        const parts = GlobeDetail.splitSegment(179.5, 10, -179.5, 12);
        expect(parts).toHaveLength(2);
        const head = parts[0];
        const tail = parts[1];
        expect(head).toBeDefined();
        expect(tail).toBeDefined();
        if (!head || !tail) {
            return;
        }
        expect(head.lon1).toBeCloseTo(179.5, 6);
        expect(head.lon2).toBeCloseTo(180, 6);
        expect(head.lat2).toBeCloseTo(11, 6);
        expect(tail.lon1).toBeCloseTo(-180, 6);
        expect(tail.lat1).toBeCloseTo(11, 6);
        expect(tail.lon2).toBeCloseTo(-179.5, 6);
        expect(GlobeDetail.splitSegment(180, 10, 180, 12)).toEqual([]);
        expect(GlobeDetail.splitSegment(-180, 4, -180, 8)).toEqual([]);
        expect(GlobeDetail.splitSegment(-179.999, 4, -180, 8)).toEqual([]);

        const dense = GlobeDetail.densifyPoints(
            [
                { lon: head.lon1, lat: head.lat1 },
                { lon: head.lon2, lat: head.lat2 },
                { lon: 0, lat: 0 },
                { lon: 2.4, lat: -1.2 },
            ],
            0.5,
        );
        assertStepsAtMost(dense, 0.5);
        const long = GlobeDetail.densifyPoints(
            [
                { lon: -20, lat: 10 },
                { lon: 7.5, lat: -4 },
            ],
            0.5,
        );
        assertStepsAtMost(long, 0.5);
        expect(long.length).toBeGreaterThan(2);
    });

    it('derives world coast and border counts from the committed 110m file', () => {
        const raw = readFileSync(
            join(repoRoot, 'public/data/ne_110m_admin_0_countries.geojson'),
            'utf8',
        );
        const stats = GlobeDetail.worldEdgeStats(JSON.parse(raw));
        expect(stats.coast).toBeGreaterThanOrEqual(5020 * 0.99);
        expect(stats.coast).toBeLessThanOrEqual(5020 * 1.01);
        expect(stats.border).toBeGreaterThanOrEqual(2663 * 0.99);
        expect(stats.border).toBeLessThanOrEqual(2663 * 1.01);
        expect(stats.maxAbsDeltaLon).toBeLessThanOrEqual(0.5 + 1e-9);
    });

    it('normalizes wheel notches, line mode, clamp, and pinch scale', () => {
        const h = 2;
        const out = GlobeDetail.normalizeWheel({
            deltaY: 100,
            deltaMode: 0,
            ctrlKey: false,
            canvasHeight: 900,
        });
        expect(out.notch).toBe(true);
        expect(out.k).toBeCloseTo(0.0023, 6);
        expect(out.tau).toBe(GlobeDetail.CONFIG.TAU_NOTCH_MS);
        const zoomedOut = GlobeDetail.nextAltitudeGoal(h, out.px, out.k, 0.3, 8);
        expect(zoomedOut / h).toBeCloseTo(1.259, 3);
        expect(zoomedOut / h).toBeCloseTo(Math.exp(0.23), 6);

        const inward = GlobeDetail.normalizeWheel({
            deltaY: -100,
            deltaMode: 0,
            ctrlKey: false,
            canvasHeight: 900,
        });
        const zoomedIn = GlobeDetail.nextAltitudeGoal(h, inward.px, inward.k, 0.3, 8);
        expect(h / zoomedIn).toBeCloseTo(1.259, 3);

        const lines = GlobeDetail.normalizeWheel({
            deltaY: 3,
            deltaMode: 1,
            ctrlKey: false,
            canvasHeight: 900,
        });
        expect(lines.px).toBe(48);
        expect(lines.notch).toBe(true);

        const high = GlobeDetail.normalizeWheel({
            deltaY: 5000,
            deltaMode: 0,
            ctrlKey: false,
            canvasHeight: 900,
        });
        const low = GlobeDetail.normalizeWheel({
            deltaY: -9000,
            deltaMode: 0,
            ctrlKey: false,
            canvasHeight: 900,
        });
        expect(high.px).toBe(240);
        expect(low.px).toBe(-240);

        const pinch = GlobeDetail.normalizeWheel({
            deltaY: 100,
            deltaMode: 0,
            ctrlKey: true,
            canvasHeight: 900,
        });
        expect(pinch.pinch).toBe(true);
        expect(pinch.notch).toBe(false);
        expect(pinch.k).toBeCloseTo(0.01, 6);
        const pinched = GlobeDetail.nextAltitudeGoal(h, pinch.px, pinch.k, 0.3, 20);
        expect(pinched / h).toBeCloseTo(Math.exp(1), 6);
    });

    it('keeps a 30° off-center anchor under the pointer while north stays up', () => {
        installDomStub();
        const width = 900;
        const height = 900;
        const fov = 45;
        const fit = globeFitDistance(width, height, fov);
        const camera = new PerspectiveCamera(fov, width / height, 0.1, 100);
        camera.position.set(0, 0, fit);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();

        const group = new Group();
        group.rotation.x = 0;
        group.rotation.y = -Math.PI / 2;
        group.updateMatrixWorld(true);

        const element = {
            style: {},
            addEventListener(): void {},
            removeEventListener(): void {},
        };
        const controls = new OrbitControls(camera, element);
        controls.enableZoom = false;
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.16;
        controls.autoRotate = false;
        controls.minDistance = 1.3;
        controls.maxDistance = 8;
        controls.minPolarAngle = Math.PI / 2 - (62 * Math.PI) / 180;
        controls.maxPolarAngle = Math.PI / 2 + (62 * Math.PI) / 180;
        controls.target.set(0, 0, 0);
        controls.update();

        const worldPoint = new Vector3(Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6));
        const projected = worldPoint.clone().project(camera);
        const pointerNdc = { x: projected.x, y: projected.y };
        const localAnchor = worldPoint.clone();
        group.worldToLocal(localAnchor);
        localAnchor.normalize();

        const norm = GlobeDetail.normalizeWheel({
            deltaY: -100,
            deltaMode: 0,
            ctrlKey: false,
            canvasHeight: height,
        });
        let altitude = fit - 1;
        const hGoal = GlobeDetail.nextAltitudeGoal(altitude, norm.px, norm.k, 0.3, 7);
        const raycaster = new Raycaster();
        const dt = 1000 / 60;
        const frames = Math.round(600 / dt);
        for (let frame = 0; frame < frames; frame += 1) {
            const stepped = GlobeDetail.stepAltitude(altitude, hGoal, dt, norm.tau);
            altitude = stepped.h;
            camera.position.setLength(1 + altitude);
            camera.lookAt(0, 0, 0);
            camera.updateMatrixWorld();
            if (!stepped.settled) {
                group.updateMatrixWorld(true);
                const worldAnchor = localAnchor.clone().applyMatrix4(group.matrixWorld).normalize();
                raycaster.setFromCamera(pointerNdc, camera);
                const ray = raycaster.ray;
                const hit = GlobeDetail.rayUnitSphere(
                    ray.origin.x,
                    ray.origin.y,
                    ray.origin.z,
                    ray.direction.x,
                    ray.direction.y,
                    ray.direction.z,
                );
                expect(hit).not.toBeNull();
                if (!hit) {
                    return;
                }
                const weight = GlobeDetail.anchorWeight(
                    worldAnchor.x,
                    worldAnchor.y,
                    worldAnchor.z,
                    camera.position.x,
                    camera.position.y,
                    camera.position.z,
                    fit,
                );
                const next = GlobeDetail.adjustSpherical({
                    x: camera.position.x,
                    y: camera.position.y,
                    z: camera.position.z,
                    px: worldAnchor.x,
                    py: worldAnchor.y,
                    pz: worldAnchor.z,
                    qx: hit.x,
                    qy: hit.y,
                    qz: hit.z,
                    w: weight,
                    phiMin: controls.minPolarAngle,
                    phiMax: controls.maxPolarAngle,
                });
                camera.position.set(next.x, next.y, next.z);
                camera.lookAt(0, 0, 0);
                camera.updateMatrixWorld();
            }
            controls.autoRotate = false;
            controls.update();
        }

        const worldAnchor = localAnchor.clone().applyMatrix4(group.matrixWorld).normalize();
        const end = worldAnchor.clone().project(camera);
        const dx = ((end.x - pointerNdc.x) * width) / 2;
        const dy = ((end.y - pointerNdc.y) * height) / 2;
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(0.5);
        expect(group.rotation.x).toBe(0);
        const worldPole = new Vector3(0, 1, 0).applyQuaternion(group.quaternion);
        expect(worldPole.x).toBeCloseTo(0, 6);
        expect(worldPole.y).toBeCloseTo(1, 6);
        expect(worldPole.z).toBeCloseTo(0, 6);
        const polar = controls.getPolarAngle();
        expect(polar).toBeGreaterThanOrEqual(controls.minPolarAngle - 1e-6);
        expect(polar).toBeLessThanOrEqual(controls.maxPolarAngle + 1e-6);
        controls.dispose();
    });

    it('keeps travel paths above the globe, including long routes north from India', () => {
        const routes = new GlobeRoutes();
        const place = (latitude: number, longitude: number, location: string): RouteLocation => ({
            latitude,
            longitude,
            country: 'India',
            state: location,
            location,
        });
        const hops: Array<[RouteLocation, RouteLocation]> = [
            [place(28.6139, 77.209, 'Delhi'), place(34.1526, 77.5771, 'Leh')],
            [place(28.6139, 77.209, 'Delhi'), place(78.2232, 15.6467, 'Longyearbyen')],
            [place(13.0827, 80.2707, 'Chennai'), place(64.8378, -147.7164, 'Fairbanks')],
            [place(20, 78, 'India'), place(-20, -102, 'Antipode')],
        ];

        const closestRadius = (a: RoutePoint, b: RoutePoint): number => {
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const abz = b.z - a.z;
            const ab2 = abx * abx + aby * aby + abz * abz;
            const t =
                ab2 === 0
                    ? 0
                    : Math.max(0, Math.min(1, -(a.x * abx + a.y * aby + a.z * abz) / ab2));
            return Math.hypot(a.x + abx * t, a.y + aby * t, a.z + abz * t);
        };

        for (const hop of hops) {
            const from = hop[0];
            const to = hop[1];
            expect(from).toBeDefined();
            expect(to).toBeDefined();
            if (!from || !to) {
                return;
            }
            const start = routes.latLonToVec3(from.latitude, from.longitude, 1, THREE);
            const end = routes.latLonToVec3(to.latitude, to.longitude, 1, THREE);
            const points = routes.sampleArc(start, end);
            expect(points.length).toBeGreaterThan(8);
            let lowest = Infinity;
            for (let i = 0; i < points.length; i += 1) {
                const point = points[i];
                expect(point).toBeDefined();
                if (!point) {
                    return;
                }
                const radius = Math.hypot(point.x, point.y, point.z);
                expect(radius).toBeGreaterThanOrEqual(1.0025 - 1e-6);
                if (i > 0) {
                    const previous = points[i - 1];
                    expect(previous).toBeDefined();
                    if (!previous) {
                        return;
                    }
                    lowest = Math.min(lowest, closestRadius(previous, point));
                }
            }
            expect(lowest).toBeGreaterThanOrEqual(1.002);
        }

        const group = new Group();
        const mesh = routes.buildArcs(
            THREE,
            group,
            [hops[2]?.[0], hops[2]?.[1]].filter((loc) => loc != null),
            (loc) => `${loc.country}|${loc.location}`,
        );
        expect(mesh).toBeInstanceOf(LineSegments);
        if (!(mesh instanceof LineSegments)) {
            return;
        }
        expect(mesh.material).toMatchObject({
            blending: AdditiveBlending,
            opacity: 0.12,
            depthWrite: false,
            transparent: true,
            type: 'LineBasicMaterial',
        });
        mesh.geometry.dispose();
        if (!Array.isArray(mesh.material)) {
            mesh.material.dispose();
        }
    });

    it('reaches 95% of a notch at 330 ms without passing the goal', () => {
        const dt = 1000 / 60;
        for (const deltaY of [100, -100]) {
            const start = 2;
            const norm = GlobeDetail.normalizeWheel({
                deltaY,
                deltaMode: 0,
                ctrlKey: false,
                canvasHeight: 900,
            });
            const hGoal = GlobeDetail.nextAltitudeGoal(start, norm.px, norm.k, 0.3, 8);
            let altitude = start;
            let reachedAt = -1;
            for (let frame = 1; frame <= 80; frame += 1) {
                const previous = altitude;
                const stepped = GlobeDetail.stepAltitude(altitude, hGoal, dt, norm.tau);
                altitude = stepped.h;
                if (deltaY > 0) {
                    expect(altitude).toBeGreaterThanOrEqual(previous - 1e-12);
                    expect(altitude).toBeLessThanOrEqual(hGoal + 1e-9);
                } else {
                    expect(altitude).toBeLessThanOrEqual(previous + 1e-12);
                    expect(altitude).toBeGreaterThanOrEqual(hGoal - 1e-9);
                }
                const progress = Math.abs(Math.log(altitude / start) / Math.log(hGoal / start));
                if (reachedAt < 0 && progress >= 0.95) {
                    reachedAt = frame * dt;
                }
            }
            expect(reachedAt).toBeGreaterThan(0);
            expect(Math.abs(reachedAt - 330)).toBeLessThanOrEqual(dt + 1e-6);
        }
    });
});
