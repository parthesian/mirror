import { expect, test } from '@playwright/test';

test('mock gallery mounts tiles from the classic scripts', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('h1')).toHaveText('Parth Nain');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const color = await page.evaluate('window.PhotoColors.classifyPixel(40, 90, 190)');
    expect(color).toBe('blue');
});

test('a tap does not leave the mobile click box', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const highlight = (await page.evaluate(`(() => {
        const tile = getComputedStyle(document.querySelector('.gallery-item')).webkitTapHighlightColor;
        const hub = getComputedStyle(document.getElementById('cm-hub')).webkitTapHighlightColor;
        return { tile, hub };
    })()`)) as { tile: string; hub: string };
    expect(highlight.tile).toBe('rgba(0, 0, 0, 0)');
    expect(highlight.hub).toBe('rgba(0, 0, 0, 0)');

    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#modal.active')).toBeVisible();
    const afterOpen = (await page.evaluate(
        `getComputedStyle(document.getElementById('modal-globe')).webkitTapHighlightColor`,
    )) as string;
    expect(afterOpen).toBe('rgba(0, 0, 0, 0)');

    await page.keyboard.press('Escape');
    await page.locator('#cm-hub').click();
    await expect(page.locator('#cm-hub')).toHaveAttribute('aria-expanded', 'true');
    const pointerOutline = (await page.evaluate(
        `getComputedStyle(document.getElementById('cm-hub')).outlineStyle`,
    )) as string;
    expect(pointerOutline).toBe('none');
});
