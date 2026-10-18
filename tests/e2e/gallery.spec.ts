import { expect, test } from '@playwright/test';

test('mock gallery mounts tiles from the classic scripts', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('h1')).toHaveText('Parth Nain');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const color = await page.evaluate('window.PhotoColors.classifyPixel(40, 90, 190)');
    expect(color).toBe('blue');
});
