import { expect, type Page, test } from '@playwright/test';

type Point = { x: number; y: number };
type Rect = { left: number; top: number; width: number; height: number };
interface PageMap {
    loaded(): boolean;
    getZoom(): number;
    getCenter(): { lng: number; lat: number };
    getBearing(): number;
    getPitch(): number;
    jumpTo(options: { center?: [number, number]; zoom?: number }): void;
    getStyle(): { sources: Record<string, unknown> };
    getContainer(): { getBoundingClientRect(): Rect };
    project(lngLat: [number, number]): Point;
}
interface PageGlobe {
    map: PageMap;
    spinning: boolean;
    setSpin(enabled: boolean): void;
    focus(lng: number, lat: number): void;
    markerHits(x: number, y: number, radius: number): { keys: string[] }[];
    markers: { clusters: { level: number; groups: string[][] } };
}
interface PageWindow {
    app: {
        globeExplorer: {
            open(focus?: { latitude: number; longitude: number } | null): Promise<void>;
            close(): Promise<void>;
            isOpen: boolean;
            hasPlaceFilterData: boolean;
            globeMap: PageGlobe;
            locationGroupByKey: Map<string, { sample: { latitude: unknown; longitude: unknown } }>;
            sceneContainer: { getBoundingClientRect(): Rect };
        };
        imageService: { getImageById(id: string): { latitude: unknown; longitude: unknown } };
        globeService: {
            instances: Map<
                unknown,
                { geometry: { parameters: { widthSegments: number; heightSegments: number } } }
            >;
        };
    };
    modal: { currentImageId: string };
    threeLoader: { sphereSegments(): number };
    GlobeMap: {
        fitDistance(width: number, height: number): number;
        zoomForDistance(distance: number, height: number, lat: number): number;
    };
}
declare const window: PageWindow;
declare const document: {
    getElementById(id: string): { classList: { contains(name: string): boolean } };
};
declare const navigator: object;

const TILE_HOSTS = /tiles\.versatiles\.org|gibs\.earthdata\.nasa\.gov/;

function trackRequests(page: Page) {
    const urls: string[] = [];
    page.on('request', (request) => {
        urls.push(request.url());
    });
    return urls;
}

/** Tiles come from third parties; the suite never waits on them. */
async function blockTiles(page: Page) {
    await page.route(TILE_HOSTS, (route) => route.abort());
}

async function openExplorer(page: Page, focus?: { latitude: number; longitude: number }) {
    await page.evaluate((location) => window.app.globeExplorer.open(location), focus ?? null);
}

test.beforeEach(async ({ page }) => {
    await blockTiles(page);
});

test('the gallery never loads MapLibre before the explorer opens', async ({ page }) => {
    const urls = trackRequests(page);
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page
        .locator('#control-menu .cm-hub, #control-menu [aria-label="Open control menu"]')
        .first()
        .click();
    await page.waitForFunction(() => window.app.globeExplorer.hasPlaceFilterData);

    expect(await page.evaluate(() => 'maplibregl' in window)).toBe(false);
    expect(urls.filter((url) => url.includes('/vendor/maplibre-gl'))).toEqual([]);
});

test('the far view loads the photo and the countries file, and no tiles', async ({ page }) => {
    const statuses = new Map<string, number>();
    page.on('response', (response) => {
        statuses.set(new URL(response.url()).pathname, response.status());
    });
    const urls = trackRequests(page);
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await openExplorer(page);
    await page.waitForTimeout(300);

    expect(statuses.get('/earth_atmos_2048.jpg')).toBe(200);
    expect(statuses.get('/data/globe-countries-50m.v1.json')).toBe(200);
    expect(statuses.get('/vendor/maplibre-gl-5.24.1/maplibre-gl.js')).toBe(200);
    expect(urls.filter((url) => TILE_HOSTS.test(url))).toEqual([]);
    expect(await page.evaluate(() => window.app.globeExplorer.globeMap.spinning)).toBe(true);
});

test('focusing a photo centres it at any latitude, at the fit zoom, and stops the spin', async ({
    page,
}) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await openExplorer(page, { latitude: 72, longitude: -42 });

    const view = await page.evaluate(() => {
        const explorer = window.app.globeExplorer;
        const center = explorer.globeMap.map.getCenter();
        const { width, height } = explorer.sceneContainer.getBoundingClientRect();
        const fit = window.GlobeMap.zoomForDistance(
            window.GlobeMap.fitDistance(width, height),
            height,
            center.lat,
        );
        return {
            ...center,
            zoom: explorer.globeMap.map.getZoom(),
            fit,
            spinning: explorer.globeMap.spinning,
        };
    });
    expect(view.lat).toBeCloseTo(72, 3);
    expect(view.lng).toBeCloseTo(-42, 3);
    expect(view.zoom).toBeCloseTo(view.fit, 3);
    expect(view.spinning).toBe(false);

    await page.evaluate(() => window.app.globeExplorer.close());
    await expect.poll(() => page.evaluate(() => window.app.globeExplorer.isOpen)).toBe(false);
    await openExplorer(page, { latitude: -10, longitude: 20 });
    expect(
        await page.evaluate(() => window.app.globeExplorer.globeMap.map.getCenter().lat),
    ).toBeCloseTo(-10, 3);
});

test('clicking the photo globe opens the explorer on that photo', async ({ page }) => {
    await page.goto('/?mock=1');
    await page.locator('.gallery-item').first().click();
    const modalGlobe = page.locator('#modal-globe');
    await expect(modalGlobe).toBeVisible();
    await expect(modalGlobe.locator('canvas')).toBeVisible();
    const photo = await page.evaluate(() => {
        const image = window.app.imageService.getImageById(window.modal.currentImageId);
        return { lat: Number(image.latitude), lng: Number(image.longitude) };
    });
    await modalGlobe.click();
    await page.waitForFunction(
        () => window.app.globeExplorer.isOpen && Boolean(window.app.globeExplorer.globeMap),
    );

    const center = await page.evaluate(() => window.app.globeExplorer.globeMap.map.getCenter());
    expect(center.lat).toBeCloseTo(photo.lat, 3);
    expect(center.lng).toBeCloseTo(photo.lng, 3);
});

test('a drag turns the globe north-up and stops the idle spin', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await openExplorer(page);
    const box = await page.locator('#globe-explorer-scene canvas').boundingBox();
    if (!box) throw new Error('globe canvas has no box');
    const before = await page.evaluate(() => window.app.globeExplorer.globeMap.map.getCenter().lng);

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 160, cy + 60, { steps: 12 });
    await page.mouse.up();

    const after = await page.evaluate(() => {
        const globe = window.app.globeExplorer.globeMap;
        return {
            lng: globe.map.getCenter().lng,
            bearing: globe.map.getBearing(),
            pitch: globe.map.getPitch(),
            spinning: globe.spinning,
            paused: document.getElementById('globe-rotate-toggle').classList.contains('paused'),
        };
    });
    expect(Math.abs(after.lng - before)).toBeGreaterThan(5);
    expect(after.bearing).toBe(0);
    expect(after.pitch).toBe(0);
    expect(after.spinning).toBe(false);
    expect(after.paused).toBe(true);
});

test('panning at a fixed zoom never regroups the markers', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await openExplorer(page);
    await page.evaluate(() => {
        const globe = window.app.globeExplorer.globeMap;
        globe.setSpin(false);
        globe.map.jumpTo({ center: [0, 40], zoom: 1.6 });
    });
    await page.waitForTimeout(300);
    const read = () =>
        page.evaluate(() => {
            const globe = window.app.globeExplorer.globeMap;
            return {
                clusters: globe.markers.clusters,
                drawn: globe.markerHits(0, 0, 1e9).map((hit) => [...hit.keys].sort().join('\n')),
            };
        });
    const before = await read();
    expect(before.clusters.groups.some((keys) => keys.length > 1)).toBe(true);
    const groupOf = new Map(
        before.clusters.groups.flatMap((keys) =>
            keys.map((key) => [key, [...keys].sort().join('\n')]),
        ),
    );

    for (const [dx, dy] of [
        [260, 0],
        [0, 180],
    ] as const) {
        await page.mouse.move(640, 360);
        await page.mouse.down();
        await page.mouse.move(640 + dx, 360 + dy, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(200);
        const after = await read();
        expect(after.clusters).toEqual(before.clusters);
        for (const mark of after.drawn) {
            expect(groupOf.get(mark.split('\n')[0] ?? '')).toBe(mark);
        }
    }
});

test('wheel zoom moves in steps and the camera can reach street level', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await openExplorer(page);
    const box = await page.locator('#globe-explorer-scene canvas').boundingBox();
    if (!box) throw new Error('globe canvas has no box');
    const fit = await page.evaluate(() => window.app.globeExplorer.globeMap.map.getZoom());

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    await expect
        .poll(() => page.evaluate(() => window.app.globeExplorer.globeMap.map.getZoom()))
        .toBeGreaterThan(fit + 0.2);
    const oneNotch = await page.evaluate(() => window.app.globeExplorer.globeMap.map.getZoom());
    expect(oneNotch - fit).toBeLessThan(1.5);

    const close = await page.evaluate(() => {
        const map = window.app.globeExplorer.globeMap.map;
        map.jumpTo({ center: [12.48, 41.9], zoom: 12 });
        return map.getZoom();
    });
    expect(close).toBeCloseTo(12, 3);
});

test('tapping a photo place offers that place', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const target = await page.evaluate(async () => {
        const explorer = window.app.globeExplorer;
        await explorer.open();
        const [group] = explorer.locationGroupByKey.values();
        const lat = Number(group?.sample.latitude);
        const lng = Number(group?.sample.longitude);
        explorer.globeMap.setSpin(false);
        explorer.globeMap.focus(lng, lat);
        explorer.globeMap.map.jumpTo({ zoom: 6 });
        return { lng, lat };
    });
    await page.waitForTimeout(200);
    const point = await page.evaluate(({ lng, lat }) => {
        const map = window.app.globeExplorer.globeMap.map;
        const rect = map.getContainer().getBoundingClientRect();
        const projected = map.project([lng, lat]);
        return { x: rect.left + projected.x, y: rect.top + projected.y };
    }, target);

    await page.mouse.click(point.x, point.y);
    await expect(
        page
            .locator('#globe-pick-confirm:not([hidden]), #globe-intersect-picker:not(.hidden)')
            .first(),
    ).toBeVisible();
});

test('save-data keeps the explorer on the photo and country lines', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', {
            configurable: true,
            value: { saveData: true },
        });
    });
    const urls = trackRequests(page);
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await openExplorer(page);
    const result = await page.evaluate(() => {
        const map = window.app.globeExplorer.globeMap.map;
        map.jumpTo({ zoom: 12 });
        return { sources: Object.keys(map.getStyle().sources), zoom: map.getZoom() };
    });
    await page.waitForTimeout(300);
    expect(result.sources).not.toContain('basemap');
    expect(result.sources).not.toContain('imagery');
    expect(result.zoom).toBeLessThanOrEqual(7);
    expect(urls.filter((url) => TILE_HOSTS.test(url))).toEqual([]);
});

test('phone photo view shows the location globe', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?mock=1');
    await page.locator('.gallery-item').first().click();

    const globe = page.locator('#modal-globe');
    await expect(globe).toBeVisible();
    await expect(globe.locator('canvas')).toBeVisible();

    const sized = await globe.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height, hidden: node.classList.contains('hidden') };
    });
    expect(sized.hidden).toBe(false);
    expect(sized.width).toBeGreaterThan(40);
    expect(sized.height).toBeGreaterThan(40);
});

test('the photo modal globe stays on Three.js and never loads MapLibre', async ({ page }) => {
    const urls = trackRequests(page);
    await page.goto('/?mock=1');
    await page.locator('.gallery-item').first().click();
    const globe = page.locator('#modal-globe');
    await expect(globe.locator('canvas')).toBeVisible();
    await page.waitForTimeout(500);

    const segments = await page.evaluate(() => {
        const inst = window.app.globeService.instances.get(document.getElementById('modal-globe'));
        return {
            width: inst?.geometry.parameters.widthSegments,
            height: inst?.geometry.parameters.heightSegments,
            expected: window.threeLoader.sphereSegments(),
        };
    });
    expect(segments.width).toBe(segments.expected);
    expect(segments.height).toBe(segments.expected);
    expect(urls.filter((url) => url.includes('/vendor/maplibre-gl'))).toEqual([]);
});
