import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

type TileId = { row: number; col: number };

type GlobeDetailApi = {
    tileIndex(lat: number, lon: number): TileId;
    tilesForView(view: {
        lat: number;
        lon: number;
        d: number;
        aspect: number;
        fovDeg?: number;
    }): TileId[];
    shouldFetchTexture(d: number, hGoal: number, saveData: boolean): boolean;
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

const detail = loadClassic<GlobeDetailApi>('js/globeDetail.js', 'GlobeDetail');

function tileText(tiles: TileId[]): string {
    return tiles
        .map((tile) => {
            const row = String(tile.row).padStart(2, '0');
            const col = String(tile.col).padStart(2, '0');
            return `r${row}c${col}`;
        })
        .join(' ');
}

const indexSamples: Array<[number, number, number, number]> = [
    [90, 0, 0, 12],
    [90, 179, 0, 23],
    [89.9, -180, 0, 0],
    [-90, 10, 11, 12],
    [-90, 180, 11, 0],
    [0, 180, 6, 0],
    [0, -180, 6, 0],
    [0, -165, 6, 1],
    [0, -165.0001, 6, 0],
    [75, 0, 1, 12],
    [62, 179.9, 1, 23],
];

const fetchSamples: Array<[number, number, boolean, boolean]> = [
    [2.6, 1.6, false, false],
    [3.09, 2.09, false, false],
    [8, 7, false, false],
    [2.6, 0.3, false, true],
    [1.9, 0.9, false, false],
    [1.9, 0.7, false, true],
    [1.4, 0.4, true, false],
    [1.4, 0.4, false, true],
];

describe('tileIndex', () => {
    it('matches the normative edge samples', () => {
        for (const [lat, lon, row, col] of indexSamples) {
            expect(detail.tileIndex(lat, lon), `${lat},${lon}`).toEqual({ row, col });
        }
    });
});

describe('shouldFetchTexture', () => {
    it('matches the ahead-of-camera predicate', () => {
        for (const [d, hGoal, saveData, result] of fetchSamples) {
            expect(detail.shouldFetchTexture(d, hGoal, saveData), `${d},${hGoal},${saveData}`).toBe(
                result,
            );
        }
    });
});

describe('tilesForView', () => {
    const wide = 16 / 9;

    function view(lat: number, lon: number, aspect: number): string {
        return tileText(
            detail.tilesForView({
                lat,
                lon,
                d: 1.3,
                aspect,
                fovDeg: 45,
            }),
        );
    }

    it('orders the equatorial cap without dropping any', () => {
        expect(view(0, 0, wide)).toBe(
            [
                'r05c11 r05c12 r06c11 r06c12 r04c11 r04c12 r05c10 r05c13',
                'r06c10 r06c13 r07c11 r07c12 r04c10 r04c13 r07c10 r07c13',
            ].join(' '),
        );
    });

    it('keeps both antimeridian columns and drops column 12', () => {
        expect(view(0, 179.5, 1)).toBe(
            [
                'r05c23 r06c23 r05c00 r06c00 r05c22 r06c22 r04c23 r07c23',
                'r04c00 r07c00 r05c01 r06c01 r04c22 r07c22 r04c01 r07c01',
            ].join(' '),
        );
        expect(view(0, -179.5, 1)).toBe(
            [
                'r05c00 r06c00 r05c23 r06c23 r05c01 r06c01 r04c00 r07c00',
                'r04c23 r07c23 r05c22 r06c22 r04c01 r07c01 r04c22 r07c22',
            ].join(' '),
        );
    });

    it('caps the north-pole date line at the 16 nearest columns', () => {
        expect(view(89, 179.5, 1)).toBe(
            [
                'r00c23 r00c00 r00c22 r00c01 r00c21 r00c02 r00c20 r00c03',
                'r00c19 r00c04 r00c18 r00c05 r00c17 r00c06 r00c16 r00c07',
            ].join(' '),
        );
    });

    it('caps the north pole around the prime meridian', () => {
        expect(view(89, 0, 1)).toBe(
            [
                'r00c11 r00c12 r00c10 r00c13 r00c09 r00c14 r00c08 r00c15',
                'r00c07 r00c16 r00c06 r00c17 r00c05 r00c18 r00c04 r00c19',
            ].join(' '),
        );
    });

    it('caps the south pole around longitude 40', () => {
        expect(view(-89, 40, 1)).toBe(
            [
                'r11c14 r11c15 r11c13 r11c16 r11c12 r11c17 r11c11 r11c18',
                'r11c10 r11c19 r11c09 r11c20 r11c08 r11c21 r11c07 r11c22',
            ].join(' '),
        );
    });

    it('returns the same date-line list for longitude 180 and -180', () => {
        const expected = [
            'r01c00 r01c23 r02c00 r02c23 r01c01 r01c22 r02c01 r02c22',
            'r01c02 r01c21 r00c00 r00c23 r00c01 r00c22 r02c02 r02c21',
        ].join(' ');
        expect(view(62, 180, wide)).toBe(expected);
        expect(view(62, -180, wide)).toBe(expected);
    });
});

describe('committed globe tiles', () => {
    const tileDir = join(repoRoot, 'public/data/globe-tiles/v1');

    it('ships the manifest and 288 capped JPEGs', () => {
        const manifest = JSON.parse(readFileSync(join(tileDir, 'manifest.json'), 'utf8')) as {
            version: number;
            source: string;
            sourceVersion: string;
            width: number;
            height: number;
            tileSize: number;
            cols: number;
            rows: number;
            tileDeg: number;
            jpegQuality: number;
            maxTileBytes: number;
        };
        expect(manifest).toEqual({
            version: 1,
            source: 'NE1_50M_SR',
            sourceVersion: '3.2.0',
            width: 10800,
            height: 5400,
            tileSize: 450,
            cols: 24,
            rows: 12,
            tileDeg: 15,
            jpegQuality: 80,
            maxTileBytes: 80000,
        });
        const names = readdirSync(tileDir)
            .filter((name) => name.endsWith('.jpg'))
            .sort();
        expect(names).toHaveLength(288);
        expect(names.includes('r00-c00.jpg')).toBe(true);
        expect(names.includes('r11-c23.jpg')).toBe(true);
        const readBytes = readFileSync as unknown as (file: string) => Uint8Array;
        let total = 0;
        for (const name of names) {
            expect(name).toMatch(/^r\d{2}-c\d{2}\.jpg$/);
            const size = readBytes(join(tileDir, name)).byteLength;
            expect(size).toBeGreaterThan(0);
            expect(size).toBeLessThanOrEqual(80000);
            total += size;
        }
        expect(total).toBeLessThanOrEqual(20000000);
    });
});
