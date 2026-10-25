import { expect, type Page, test } from '@playwright/test';

test('explorer globe loads the earth texture from the site root', async ({ page }) => {
    const textureStatuses: number[] = [];
    const boundaryStatuses: number[] = [];
    page.on('response', (response) => {
        const url = response.url();
        if (url.includes('earth_atmos_2048.jpg')) {
            textureStatuses.push(response.status());
        }
        if (url.includes('/data/ne_110m_admin_0_countries.geojson')) {
            boundaryStatuses.push(response.status());
        }
    });

    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();

    await page.evaluate(`window.app.globeExplorer.open()`);
    await expect(page.locator('#globe-explorer-scene canvas')).toBeVisible();

    const texture = (await page.evaluate(`(() => {
        const image = window.app.globeExplorer.threeState && window.app.globeExplorer.threeState.tex
            ? window.app.globeExplorer.threeState.tex.image
            : null;
        return {
            complete: Boolean(image && image.complete && image.naturalWidth > 0),
            width: image ? image.naturalWidth : 0,
            src: image ? (image.currentSrc || image.src || '') : ''
        };
    })()`)) as { complete: boolean; width: number; src: string };

    expect(textureStatuses).toContain(200);
    expect(textureStatuses.some((status) => status >= 400)).toBe(false);
    expect(texture).toEqual({
        complete: true,
        width: 2048,
        src: expect.stringContaining('/earth_atmos_2048.jpg'),
    });
    expect(String(texture.src)).not.toContain('/public/earth_atmos_2048.jpg');
    expect(boundaryStatuses).toContain(200);
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

test('clicking a photo globe and spinning keeps the polar axis upright', async ({ page }) => {
    await page.goto('/?mock=1');
    await page.locator('.gallery-item').first().click();

    const modalGlobe = page.locator('#modal-globe');
    await expect(modalGlobe).toBeVisible();
    await modalGlobe.click();

    const canvas = page.locator('#globe-explorer-scene canvas');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 140, cy, { steps: 10 });
    await page.mouse.up();

    const afterDrag = (await page.evaluate(`(() => {
        const THREE = window.THREE;
        const s = window.app.globeExplorer.threeState;
        const worldPole = new THREE.Vector3(0, 1, 0).applyQuaternion(s.group.quaternion);
        const theta = s.controls.getAzimuthalAngle();
        const cameraRight = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
        return {
            rotX: s.group.rotation.x,
            poleX: worldPole.x,
            poleY: worldPole.y,
            poleZ: worldPole.z,
            screenPoleSkew: worldPole.dot(cameraRight),
            azimuth: theta
        };
    })()`)) as {
        rotX: number;
        poleX: number;
        poleY: number;
        poleZ: number;
        screenPoleSkew: number;
        azimuth: number;
    };

    expect(afterDrag.rotX).toBe(0);
    expect(afterDrag.poleX).toBeCloseTo(0, 6);
    expect(afterDrag.poleY).toBeCloseTo(1, 6);
    expect(afterDrag.poleZ).toBeCloseTo(0, 6);
    expect(afterDrag.screenPoleSkew).toBeCloseTo(0, 6);
    expect(Math.abs(afterDrag.azimuth)).toBeGreaterThan(0.05);
});

function trackLineRequests(page: Page) {
    const urls: string[] = [];
    const statuses: number[] = [];
    page.on('response', (response) => {
        const url = response.url();
        if (url.includes('/data/globe-lines-')) {
            urls.push(url);
            statuses.push(response.status());
        }
    });
    return { urls, statuses };
}

async function openExplorer(page: Page) {
    await page.evaluate(`window.app.globeExplorer.open()`);
    await expect(page.locator('#globe-explorer-scene canvas')).toBeVisible();
}

async function wheelNotches(page: Page, count: number, deltaY: number) {
    await page.evaluate(
        `(() => {
            const canvas = document.querySelector('#globe-explorer-scene canvas');
            const rect = canvas.getBoundingClientRect();
            for (let i = 0; i < ${count}; i += 1) {
                canvas.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: ${deltaY},
                    deltaMode: 0,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2,
                    bubbles: true,
                    cancelable: true
                }));
            }
        })()`,
    );
}

async function watchCamera(page: Page) {
    await page.evaluate(`(() => {
        const sample = { minD: Infinity, nearOk: true, running: true };
        window.__globeZoomSample = sample;
        const tick = () => {
            const camera = window.app.globeExplorer.threeState
                && window.app.globeExplorer.threeState.camera;
            if (camera) {
                const d = camera.position.length();
                if (d < sample.minD) sample.minD = d;
                if (!(camera.near < d - 1)) sample.nearOk = false;
            }
            if (sample.running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    })()`);
}

async function readCameraWatch(page: Page) {
    return (await page.evaluate(`(() => {
        const sample = window.__globeZoomSample || { minD: Infinity, nearOk: false };
        sample.running = false;
        return { minD: sample.minD, nearOk: sample.nearOk };
    })()`)) as { minD: number; nearOk: boolean };
}

test('gallery idle does not request globe line files', async ({ page }) => {
    const lines = trackLineRequests(page);
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.waitForTimeout(5000);
    expect(lines.urls).toEqual([]);
});

test('opening the explorer at the fit distance does not request globe lines', async ({ page }) => {
    const textureStatuses: number[] = [];
    const boundaryStatuses: number[] = [];
    const lines = trackLineRequests(page);
    page.on('response', (response) => {
        const url = response.url();
        if (url.includes('earth_atmos_2048.jpg')) textureStatuses.push(response.status());
        if (url.includes('/data/ne_110m_admin_0_countries.geojson')) {
            boundaryStatuses.push(response.status());
        }
    });

    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await openExplorer(page);
    await page.waitForTimeout(2000);

    const texture = (await page.evaluate(`(() => {
        const image = window.app.globeExplorer.threeState
            && window.app.globeExplorer.threeState.tex
            ? window.app.globeExplorer.threeState.tex.image
            : null;
        const geo = window.app.globeExplorer.threeState.geo.parameters;
        return {
            complete: Boolean(image && image.complete && image.naturalWidth > 0),
            width: image ? image.naturalWidth : 0,
            src: image ? (image.currentSrc || image.src || '') : '',
            segments: [geo.widthSegments, geo.heightSegments]
        };
    })()`)) as { complete: boolean; width: number; src: string; segments: number[] };

    expect(lines.urls).toEqual([]);
    expect(textureStatuses).toContain(200);
    expect(boundaryStatuses).toContain(200);
    expect(texture.complete).toBe(true);
    expect(texture.width).toBe(2048);
    expect(texture.src).toContain('/earth_atmos_2048.jpg');
    expect(texture.segments).toEqual([192, 96]);
});

test('three zoom-in notches fetch the regional lines once', async ({ page }) => {
    const lines = trackLineRequests(page);
    await page.goto('/?mock=1');
    await openExplorer(page);
    await watchCamera(page);
    await wheelNotches(page, 3, -100);
    await expect
        .poll(() => lines.urls.filter((url) => url.includes('globe-lines-50m')).length)
        .toBe(1);
    expect(
        lines.statuses.filter((_, index) => lines.urls[index]?.includes('globe-lines-50m')),
    ).toEqual([200]);
    expect(lines.urls.some((url) => url.includes('globe-lines-10m'))).toBe(false);

    await wheelNotches(page, 3, 100);
    await page.waitForTimeout(400);
    await wheelNotches(page, 3, -100);
    await page.waitForTimeout(800);
    expect(lines.urls.filter((url) => url.includes('globe-lines-50m'))).toHaveLength(1);
    expect(lines.urls.some((url) => url.includes('globe-lines-10m'))).toBe(false);

    const watch = await readCameraWatch(page);
    expect(watch.minD).toBeGreaterThanOrEqual(1.3 - 1e-4);
    expect(watch.nearOk).toBe(true);
});

test('zooming to local detail fetches the 10m file once across reopen', async ({ page }) => {
    const lines = trackLineRequests(page);
    await page.goto('/?mock=1');
    await openExplorer(page);
    await watchCamera(page);
    await wheelNotches(page, 8, -100);
    await expect
        .poll(async () => {
            return page.evaluate(`window.app.globeExplorer.threeState.camera.position.length()`);
        })
        .toBeLessThan(1.51);
    expect(lines.urls.filter((url) => url.includes('globe-lines-10m'))).toHaveLength(1);
    expect(
        lines.statuses.filter((_, index) => lines.urls[index]?.includes('globe-lines-10m')),
    ).toEqual([200]);

    await page.evaluate(`window.app.globeExplorer.close()`);
    await expect(page.locator('#globe-explorer-overlay')).toHaveClass(/hidden/);
    await openExplorer(page);
    await wheelNotches(page, 8, -100);
    await expect
        .poll(async () => {
            return page.evaluate(`window.app.globeExplorer.threeState.camera.position.length()`);
        })
        .toBeLessThan(1.51);
    await page.waitForTimeout(500);
    expect(lines.urls.filter((url) => url.includes('globe-lines-10m'))).toHaveLength(1);

    const watch = await readCameraWatch(page);
    expect(watch.minD).toBeGreaterThanOrEqual(1.3 - 1e-4);
    expect(watch.nearOk).toBe(true);
});

test('wheel zoom then drag keeps the polar axis upright', async ({ page }) => {
    await page.goto('/?mock=1');
    await openExplorer(page);
    await wheelNotches(page, 3, -100);
    await page.waitForTimeout(400);

    const canvas = page.locator('#globe-explorer-scene canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 140, cy, { steps: 10 });
    await page.mouse.up();

    const afterDrag = (await page.evaluate(`(() => {
        const THREE = window.THREE;
        const s = window.app.globeExplorer.threeState;
        const worldPole = new THREE.Vector3(0, 1, 0).applyQuaternion(s.group.quaternion);
        const theta = s.controls.getAzimuthalAngle();
        const cameraRight = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
        return {
            rotX: s.group.rotation.x,
            poleX: worldPole.x,
            poleY: worldPole.y,
            poleZ: worldPole.z,
            screenPoleSkew: worldPole.dot(cameraRight)
        };
    })()`)) as {
        rotX: number;
        poleX: number;
        poleY: number;
        poleZ: number;
        screenPoleSkew: number;
    };
    expect(afterDrag.rotX).toBe(0);
    expect(afterDrag.poleX).toBeCloseTo(0, 6);
    expect(afterDrag.poleY).toBeCloseTo(1, 6);
    expect(afterDrag.poleZ).toBeCloseTo(0, 6);
    expect(afterDrag.screenPoleSkew).toBeCloseTo(0, 6);
});

test('the photo modal globe does not request globe lines', async ({ page }) => {
    const lines = trackLineRequests(page);
    await page.goto('/?mock=1');
    await page.locator('.gallery-item').first().click();
    const globe = page.locator('#modal-globe');
    await expect(globe).toBeVisible();
    await expect(globe.locator('canvas')).toBeVisible();
    await page.waitForTimeout(500);

    const segments = (await page.evaluate(`(() => {
        const el = document.getElementById('modal-globe');
        const inst = window.app.globeService.instances.get(el);
        const expected = window.threeLoader.sphereSegments('modal');
        return {
            width: inst.geometry.parameters.widthSegments,
            height: inst.geometry.parameters.heightSegments,
            expected
        };
    })()`)) as { width: number; height: number; expected: number };
    expect(segments.width).toBe(segments.expected);
    expect(segments.height).toBe(segments.expected);
    expect(lines.urls).toEqual([]);
});
