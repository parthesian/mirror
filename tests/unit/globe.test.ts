import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

type Vec3 = [number, number, number];
type Place = { key: string; lng: number; lat: number; count: number };
type Level = { clusters: { keys: string[] }[]; of: Int32Array; keys: string[] };
type MarkState = { dir: Vec3; kind: number; alpha: number };
type Mark = { keys: string[]; start: MarkState; end: MarkState };
type Moves = { marks: Mark[]; markOf: Int32Array };
type StyleLayer = { id: string; type: string; source?: string; minzoom?: number };
type Style = { sources: Record<string, { type: string; tiles?: string[] }>; layers: StyleLayer[] };
type Feature = { name: string; adm0a3: string };
type Lines = {
    features: { properties: { kind: string }; geometry: { coordinates: number[][][] } }[];
};

interface GlobeWindow {
    GlobeGl: {
        sphere(lng: number, lat: number, radius?: number): Vec3;
        lngLat(x: number, y: number, z: number): { lng: number; lat: number };
        invert(m: number[]): number[];
        occluded(camera: { position: Vec3 }, point: Vec3): boolean;
        surfaceLift(altitude: number): number;
        liftHeight(height: number, lift: number, altitude: number): number;
        SURFACE: { full: number; ground: number };
    };
    GlobeMap: {
        MAPLIBRE_VERSION: string;
        fitDistance(width: number, height: number, fov?: number): number;
        zoomForDistance(distance: number, height: number, lat: number): number;
        zoomForKmPerPx(kmPerPx: number, lat: number): number;
    };
    GlobeStyle: {
        build(options: { dpr: number; saveData: boolean; countries: object }): Style;
        soften(zoom: number): number;
        BANDS: { imagery: { in: number[] }; tiles: number };
    };
    GlobeMarkerLayer: {
        markerSize(altitude: number): number;
        clusterLevels(places: Place[]): Map<number, Level>;
        levelFor(altitude: number, current: number | null): number;
        retarget(previous: Moves | null, level: Level, t: number): Moves;
        drawnAt(mark: Mark, t: number): MarkState;
    };
    GlobeRouteLayer: {
        pulseFrame(elapsed: number, scale: number): { angle: number; opacity: number }[] | null;
    };
    globeRoutes: {
        arcSegments(locations: object[], key: (loc: { location: string }) => string): Float32Array;
    };
    countryBoundaries: {
        ensureLoaded(): Promise<unknown>;
        findCountry(lon: number, lat: number): Feature | null;
        countryFeatureKey(feature: Feature | null): string;
        outline(feature: Feature | null): { features: { geometry: { type: string } }[] };
        lines: Lines;
    };
}

function loadGlobe(): GlobeWindow {
    const window = {} as GlobeWindow;
    const fetch = async (url: string) => ({
        ok: true,
        json: async () => JSON.parse(readFileSync(join(repoRoot, 'public', url), 'utf8')),
    });
    for (const file of [
        'locationModel.js',
        'globeGl.js',
        'globeRoutes.js',
        'countryBoundaries.js',
        'globeStyle.js',
        'globeRouteLayer.js',
        'globeMarkerLayer.js',
        'globeMap.js',
    ]) {
        new Function('window', 'fetch', 'module', readFileSync(join(repoRoot, 'js', file), 'utf8'))(
            window,
            fetch,
            undefined,
        );
    }
    return window;
}

const globe = loadGlobe();
const R_KM = 6371.0088;

describe('globe geometry', () => {
    it('round-trips longitude and latitude through the sphere', () => {
        for (const [lng, lat] of [
            [0, 0],
            [12.5, 42.5],
            [-51, 69.2],
            [179.5, -85],
        ] as const) {
            const back = globe.GlobeGl.lngLat(...globe.GlobeGl.sphere(lng, lat));
            expect(back.lng).toBeCloseTo(lng, 9);
            expect(back.lat).toBeCloseTo(lat, 9);
        }
    });

    it('inverts a matrix', () => {
        const m = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1];
        const inv = globe.GlobeGl.invert(m);
        const product = Array.from({ length: 16 }, (_, i) => {
            const row = i % 4;
            const col = Math.floor(i / 4);
            return [0, 1, 2, 3].reduce(
                (sum, k) => sum + (m[k * 4 + row] ?? 0) * (inv[col * 4 + k] ?? 0),
                0,
            );
        });
        expect(product.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        ]);
    });

    it('hides points on the far side of the globe', () => {
        const camera = { position: [0, 0, 3] as Vec3 };
        expect(globe.GlobeGl.occluded(camera, [0, 0, 1.0025])).toBe(false);
        expect(globe.GlobeGl.occluded(camera, [0, 0, -1.0025])).toBe(true);
        expect(globe.GlobeGl.occluded(camera, globe.GlobeGl.sphere(60, 0, 1.0025))).toBe(false);
    });
});

describe('globe camera', () => {
    it('frames a portrait phone farther back than a square view', () => {
        const phone = globe.GlobeMap.fitDistance(390, 844);
        const square = globe.GlobeMap.fitDistance(800, 800);
        expect(phone).toBeGreaterThan(square + 1.5);
        expect(phone).toBeLessThanOrEqual(8);
        expect(square).toBeGreaterThanOrEqual(2.6);
    });

    it('matches the old 45° camera: distance and ground scale agree on one zoom', () => {
        const height = 800;
        const focal = height / 2 / Math.tan((22.5 * Math.PI) / 180);
        for (const [distance, lat] of [
            [3.09, 0],
            [1.5, 42.5],
            [1.05, 69.2],
        ] as const) {
            const kmPerPx = ((distance - 1) * R_KM) / focal;
            expect(globe.GlobeMap.zoomForDistance(distance, height, lat)).toBeCloseTo(
                globe.GlobeMap.zoomForKmPerPx(kmPerPx, lat),
                3,
            );
        }
    });

    it('loads the MapLibre build that is installed', () => {
        const installed = JSON.parse(
            readFileSync(join(repoRoot, 'node_modules/maplibre-gl/package.json'), 'utf8'),
        );
        expect(globe.GlobeMap.MAPLIBRE_VERSION).toBe(installed.version);
    });
});

describe('globe style', () => {
    const countries = { type: 'FeatureCollection', features: [] };

    it('fetches no tile below the imagery band', () => {
        const style = globe.GlobeStyle.build({ dpr: 2, saveData: false, countries });
        const tiled = style.layers.filter(
            (layer) => layer.source && style.sources[layer.source]?.tiles,
        );
        expect(tiled.length).toBeGreaterThan(5);
        for (const layer of tiled) {
            expect(layer.minzoom, layer.id).toBeGreaterThanOrEqual(
                globe.GlobeStyle.BANDS.imagery.in[0] ?? 0,
            );
        }
    });

    it('drops every tiled source when the browser asks to save data', () => {
        const style = globe.GlobeStyle.build({ dpr: 1, saveData: true, countries });
        expect(Object.values(style.sources).some((source) => source.tiles)).toBe(false);
        expect(style.layers.every((layer) => !layer.source || style.sources[layer.source])).toBe(
            true,
        );
        expect(style.layers.map((layer) => layer.id)).toContain('countries-coast');
    });

    it('keeps layer ids unique and their sources defined', () => {
        const style = globe.GlobeStyle.build({ dpr: 1, saveData: false, countries });
        const ids = style.layers.map((layer) => layer.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(style.layers.every((layer) => !layer.source || style.sources[layer.source])).toBe(
            true,
        );
    });

    it('softens the photo only once the tiles carry the detail', () => {
        expect(globe.GlobeStyle.soften(2)).toBe(0);
        expect(globe.GlobeStyle.soften(globe.GlobeStyle.BANDS.tiles)).toBe(0);
        expect(globe.GlobeStyle.soften(12)).toBeCloseTo(0.35);
    });
});

describe('globe markers and pulses', () => {
    const { GlobeGl, GlobeMarkerLayer } = globe;
    const place = (key: string, lng: number, lat: number, count = 1): Place => ({
        key,
        lng,
        lat,
        count,
    });
    const places = [
        place('rome', 12.5, 41.9, 3),
        place('florence', 11.25, 43.77),
        place('tivoli', 12.8, 41.96),
        place('nuuk', -51.7, 64.18),
    ];
    const levels = GlobeMarkerLayer.clusterLevels(places);
    const groupsAt = (altitude: number) =>
        levels.get(GlobeMarkerLayer.levelFor(altitude, null))?.clusters.map((c) => c.keys);

    it('holds the old marker size at the fit view and a constant pixel size closer in', () => {
        expect(GlobeMarkerLayer.markerSize(2.09)).toBeCloseTo(0.06);
        expect(GlobeMarkerLayer.markerSize(0.8) / 0.8).toBeCloseTo(
            GlobeMarkerLayer.markerSize(0.01) / 0.01,
        );
    });

    it('keeps full height in the far view and eases onto the surface close in', () => {
        expect(GlobeGl.surfaceLift(2.09)).toBe(1);
        expect(GlobeGl.surfaceLift(GlobeGl.SURFACE.full)).toBe(1);
        expect(GlobeGl.surfaceLift(GlobeGl.SURFACE.ground)).toBe(0);
        const sweep = Array.from({ length: 60 }, (_, i) => GlobeGl.surfaceLift(0.3 * 0.95 ** i));
        expect(sweep.every((lift, i) => i === 0 || lift <= (sweep[i - 1] ?? 1))).toBe(true);
        const steps = sweep.slice(1).map((lift, i) => (sweep[i] ?? 0) - lift);
        expect(Math.max(...steps)).toBeLessThan(0.08);
    });

    it('never lifts anything to the camera and leaves far-view arcs alone', () => {
        expect(GlobeGl.liftHeight(0.3025, 1, 1.6)).toBe(0.3025);
        for (const altitude of [0.0008, 0.005, 0.02, 0.05, 0.2, 0.5, 1.6]) {
            const lift = GlobeGl.surfaceLift(altitude);
            for (const height of [0, 0.0025, 0.01, 0.1, 0.3025]) {
                const lifted = GlobeGl.liftHeight(height, lift, altitude);
                expect(lifted).toBeGreaterThanOrEqual(0);
                expect(lifted).toBeLessThanOrEqual(altitude / 2);
            }
        }
        expect(GlobeGl.liftHeight(0.0025, GlobeGl.surfaceLift(0.01), 0.01)).toBe(0);
    });

    it('merges nearby places far out and splits them closer in', () => {
        expect(groupsAt(2.09)).toEqual([['rome', 'tivoli', 'florence'], ['nuuk']]);
        expect(groupsAt(0.2)).toEqual([['rome', 'tivoli'], ['florence'], ['nuuk']]);
        expect(groupsAt(0.002)).toEqual([['rome'], ['florence'], ['nuuk'], ['tivoli']]);
    });

    it('only merges whole clusters as the camera pulls back', () => {
        const sorted = [...levels.keys()].sort((a, b) => a - b);
        for (const [coarse, fine] of sorted
            .slice(0, -1)
            .map((level, i) => [level, sorted[i + 1]])) {
            const outer = levels.get(coarse as number) as Level;
            const inner = levels.get(fine as number) as Level;
            for (const cluster of inner.clusters) {
                const parents = new Set(
                    cluster.keys.map((key) => outer.of[outer.keys.indexOf(key)]),
                );
                expect(parents.size).toBe(1);
            }
        }
    });

    it('holds a level until the camera is clearly past its edge', () => {
        const level = GlobeMarkerLayer.levelFor(0.1, null);
        const edge = 2 ** -((level + 1) * 0.25);
        expect(GlobeMarkerLayer.levelFor(edge * 0.97, level)).toBe(level);
        expect(GlobeMarkerLayer.levelFor(edge * 0.97, null)).toBe(level + 1);
        expect(GlobeMarkerLayer.levelFor(edge * 0.93, level)).toBe(level + 1);
    });

    it('slides marks between clusters and fades the extras', () => {
        const far = levels.get(GlobeMarkerLayer.levelFor(2.09, null)) as Level;
        const near = levels.get(GlobeMarkerLayer.levelFor(0.002, null)) as Level;
        const visible = (moves: Moves, t: number) =>
            moves.marks.filter((mark) => GlobeMarkerLayer.drawnAt(mark, t).alpha > 0).length;
        const still = GlobeMarkerLayer.retarget(null, far, 0);
        const split = GlobeMarkerLayer.retarget(still, near, 1);
        expect(split.marks.map((mark) => mark.keys)).toEqual([
            ['rome'],
            ['florence'],
            ['tivoli'],
            ['nuuk'],
        ]);
        expect([visible(split, 0), visible(split, 1)]).toEqual([2, 4]);
        const merge = GlobeMarkerLayer.retarget(GlobeMarkerLayer.retarget(null, near, 0), far, 1);
        expect([visible(merge, 0), visible(merge, 1)]).toEqual([4, 2]);
        expect(GlobeMarkerLayer.drawnAt(merge.marks[2] as Mark, 1).dir).toEqual(
            GlobeMarkerLayer.drawnAt(merge.marks[0] as Mark, 1).dir,
        );
    });

    it('starts a new move from wherever an interrupted one left the marks', () => {
        const far = levels.get(GlobeMarkerLayer.levelFor(2.09, null)) as Level;
        const near = levels.get(GlobeMarkerLayer.levelFor(0.002, null)) as Level;
        const split = GlobeMarkerLayer.retarget(GlobeMarkerLayer.retarget(null, far, 0), near, 1);
        const back = GlobeMarkerLayer.retarget(split, far, 0.4);
        split.marks.forEach((mark, index) => {
            const now = GlobeMarkerLayer.drawnAt(mark, 0.4);
            const next = GlobeMarkerLayer.drawnAt(back.marks[index] as Mark, 0);
            for (const [axis, v] of next.dir.entries()) {
                expect(v).toBeCloseTo(now.dir[axis] ?? 0, 12);
            }
            expect(next.alpha).toBeCloseTo(now.alpha, 12);
        });
    });

    it('runs the click pulse for three staggered rings, then stops', () => {
        expect(globe.GlobeRouteLayer.pulseFrame(0, 1)).toEqual([]);
        const mid = globe.GlobeRouteLayer.pulseFrame(300, 1) ?? [];
        expect(mid.length).toBe(3);
        expect(mid[0]?.angle).toBeGreaterThan(mid[2]?.angle ?? 0);
        expect(globe.GlobeRouteLayer.pulseFrame(2000, 1)).toBeNull();
    });
});

describe('globe routes', () => {
    const stop = (location: string, latitude: number, longitude: number) => ({
        location,
        latitude,
        longitude,
    });

    it('draws each undirected route once and skips repeats and hops under a degree', () => {
        const key = (loc: { location: string }) => loc.location;
        const one = globe.globeRoutes.arcSegments(
            [stop('rome', 41.9, 12.5), stop('paris', 48.86, 2.35)],
            key,
        );
        const repeated = globe.globeRoutes.arcSegments(
            [
                stop('rome', 41.9, 12.5),
                stop('rome', 41.9, 12.5),
                stop('paris', 48.86, 2.35),
                stop('rome', 41.9, 12.5),
                stop('ostia', 41.73, 12.29),
                stop('bad', Number.NaN, 0),
            ],
            key,
        );
        expect(one.length).toBeGreaterThan(0);
        expect(one.length % 6).toBe(0);
        expect(repeated).toEqual(one);
    });

    it('keeps every route point above the ground', () => {
        const segments = globe.globeRoutes.arcSegments(
            [stop('nyc', 40.7, -74), stop('tokyo', 35.7, 139.7)],
            (loc) => loc.location,
        );
        for (let i = 0; i < segments.length; i += 3) {
            expect(
                Math.hypot(segments[i] ?? 0, segments[i + 1] ?? 0, segments[i + 2] ?? 0),
            ).toBeGreaterThan(1.0024);
        }
    });
});

describe('country boundaries', () => {
    const boundaries = globe.countryBoundaries;
    beforeAll(() => boundaries.ensureLoaded());

    it('finds the country under a point, across the antimeridian, and nothing at sea', () => {
        expect(boundaries.findCountry(12.5, 42.5)?.name).toBe('Italy');
        expect(boundaries.findCountry(-42, 72)?.name).toBe('Greenland');
        expect(boundaries.findCountry(2.35, 48.86)?.adm0a3).toBe('FRA');
        expect(boundaries.findCountry(178, 65)?.name).toBe('Russia');
        expect(boundaries.findCountry(-182, 65)?.name).toBe('Russia');
        expect(boundaries.findCountry(-28, 37.5)).toBeNull();
    });

    it('splits coast from shared borders', () => {
        const kinds = Object.fromEntries(
            boundaries.lines.features.map((feature) => [
                feature.properties.kind,
                feature.geometry.coordinates.length,
            ]),
        );
        expect(kinds.coast).toBeGreaterThan(100);
        expect(kinds.border).toBeGreaterThan(100);
    });

    it('outlines one country for the hover ink', () => {
        const italy = boundaries.findCountry(12.5, 42.5);
        expect(boundaries.countryFeatureKey(italy)).toBe('ITA');
        expect(boundaries.outline(italy).features[0]?.geometry.type).toBe('MultiLineString');
        expect(boundaries.outline(null).features).toEqual([]);
    });
});
