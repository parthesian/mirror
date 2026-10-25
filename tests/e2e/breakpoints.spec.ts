import { expect, test } from '@playwright/test';

test('a 769px desktop keeps tiles at least 150px', async ({ page }) => {
    await page.setViewportSize({ width: 769, height: 900 });
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const width = (await page.evaluate(
        `document.querySelector('.gallery-item').getBoundingClientRect().width`,
    )) as number;
    expect(width).toBeGreaterThanOrEqual(150);
});

test('a short landscape uses the compact gallery', async ({ page }) => {
    await page.addInitScript('localStorage.clear()');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const state = (await page.evaluate(`(() => {
        const main = document.querySelector('.main-content');
        const timeline = document.querySelector('.timeline-sidebar');
        return {
            masonry: document.body.classList.contains('layout-masonry'),
            pad: main ? getComputedStyle(main).paddingLeft : '',
            timeline: timeline ? getComputedStyle(timeline).display : ''
        };
    })()`)) as { masonry: boolean; pad: string; timeline: string };
    expect(state.masonry).toBe(true);
    expect(state.pad).toBe('16px');
    expect(state.timeline).toBe('none');
});

test('a 667px landscape uses the compact gallery', async ({ page }) => {
    await page.addInitScript('localStorage.clear()');
    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const state = (await page.evaluate(`(() => ({
        masonry: document.body.classList.contains('layout-masonry'),
        pad: getComputedStyle(document.querySelector('.main-content')).paddingLeft,
        timeline: getComputedStyle(document.querySelector('.timeline-sidebar')).display
    }))()`)) as { masonry: boolean; pad: string; timeline: string };
    expect(state.masonry).toBe(true);
    expect(state.pad).toBe('16px');
    expect(state.timeline).toBe('none');
});

test('a square desktop offers only the column counts that fit', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.click('#cm-hub');
    await page.locator('[data-section="layout"]').click();
    await expect(page.locator('#cm-leaf .cm-node').first()).toBeVisible();
    const labels = (await page.evaluate(`
        [...document.querySelectorAll('#cm-leaf .cm-node')]
            .map((node) => node.textContent.trim())
            .filter(Boolean)
            .sort()
    `)) as string[];
    expect(labels).toEqual(['2', '3']);
});
