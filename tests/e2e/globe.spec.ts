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
