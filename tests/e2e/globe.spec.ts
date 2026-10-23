import { expect, test } from '@playwright/test';

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
