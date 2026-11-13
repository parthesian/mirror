import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

type Vec3 = [number, number, number];
type Place = { key: string; count: number; point: Vec3; screen: { x: number; y: number } };
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
        cluster(visible: Place[], diameterPx: (place: Place) => number): Place[][];
        markerSize(altitude: number): number;
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
    const place = (key: string, x: number, count = 1): Place => ({
        key,
        count,
        point: [0, 0, 1],
        screen: { x, y: 100 },
    });

    it('holds the old marker size at the fit view and a constant pixel size closer in', () => {
        expect(globe.GlobeMarkerLayer.markerSize(2.09)).toBeCloseTo(0.06);
        expect(globe.GlobeMarkerLayer.markerSize(0.8) / 0.8).toBeCloseTo(
            globe.GlobeMarkerLayer.markerSize(0.01) / 0.01,
        );
    });

    it('merges overlapping markers and leaves separate ones alone', () => {
        const groups = globe.GlobeMarkerLayer.cluster(
            [place('rome', 100, 3), place('florence', 110), place('nuuk', 400)],
            () => 24,
        );
        expect(groups.map((members) => members.map((m) => m.key))).toEqual([
            ['rome', 'florence'],
            ['nuuk'],
        ]);
    });

    it('lets a larger place claim its neighbours first', () => {
        const groups = globe.GlobeMarkerLayer.cluster(
            [place('a', 100), place('b', 118, 5), place('c', 136)],
            () => 24,
        );
        expect(groups[0]?.map((m) => m.key)).toEqual(['b', 'a', 'c']);
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
