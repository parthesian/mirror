import { expect, test } from '@playwright/test';

test('pinching a photo does not dismiss it or arm globe zoom', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#modal.active')).toBeVisible();
    await page.waitForFunction(`(() => {
        const image = document.getElementById('modal-image');
        const box = image && image.getBoundingClientRect();
        return Boolean(image && image.naturalWidth > 1 && box.width > 40 && box.height > 40);
    })()`);
    expect(await page.evaluate('window.app.globeExplorer._zoomInputBound === true')).toBe(false);

    const pinched = (await page.evaluate(`(() => {
        const image = document.getElementById('modal-image');
        const rect = image.getBoundingClientRect();
        image.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -480,
            ctrlKey: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true
        }));
        return {
            transform: image.style.transform,
            zoomBound: window.app.globeExplorer._zoomInputBound === true
        };
    })()`)) as { transform: string; zoomBound: boolean };
    expect(pinched.transform).toContain('scale(4)');
    expect(pinched.zoomBound).toBe(false);
    await expect(page.locator('#modal.active')).toBeVisible();

    await page.evaluate('window.app.globeExplorer.open()');
    await expect(page.locator('#globe-explorer-scene canvas')).toBeVisible();
    await expect
        .poll(() => page.evaluate('window.app.globeExplorer._zoomInputBound === true'))
        .toBe(true);

    const zoomed = (await page.evaluate(`(() => {
        const explorer = window.app.globeExplorer;
        const beforeDistance = explorer.threeState.camera.position.length();
        const canvas = document.querySelector('#globe-explorer-scene canvas');
        canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -100,
            bubbles: true,
            cancelable: true
        }));
        return {
            beforeDistance,
            goal: explorer.threeState.zoom.hGoal,
            open: explorer.isOpen
        };
    })()`)) as { beforeDistance: number; goal: number; open: boolean };
    expect(zoomed.open).toBe(true);
    expect(zoomed.goal).toBeLessThan(zoomed.beforeDistance - 1);

    await page.evaluate('window.app.globeExplorer.close()');
    await expect
        .poll(() => page.evaluate('window.app.globeExplorer._zoomInputBound === true'))
        .toBe(false);
});

test('photo zoom stays on the image', async ({ page }) => {
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#modal.active')).toBeVisible();
    await page.waitForFunction(`(() => {
        const image = document.getElementById('modal-image');
        const box = image && image.getBoundingClientRect();
        return Boolean(image && image.naturalWidth > 1 && box.width > 40 && box.height > 40);
    })()`);

    const scrolled = (await page.evaluate(`(() => {
        const image = document.getElementById('modal-image');
        const rect = image.getBoundingClientRect();
        const event = new WheelEvent('wheel', {
            deltaY: -8.5,
            deltaMode: 0,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true
        });
        image.dispatchEvent(event);
        return { transform: image.style.transform, defaultPrevented: event.defaultPrevented };
    })()`)) as { transform: string; defaultPrevented: boolean };
    expect(scrolled.transform).toBe('');
    expect(scrolled.defaultPrevented).toBe(false);
    await expect(page.locator('#modal.active')).toBeVisible();

    const notch = (await page.evaluate(`(() => {
        const image = document.getElementById('modal-image');
        const rect = image.getBoundingClientRect();
        image.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -100,
            deltaMode: 0,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true
        }));
        return image.style.transform;
    })()`)) as string;
    expect(notch).toContain('scale(1.25)');

    const box = await page.locator('#modal-image').boundingBox();
    if (!box) throw new Error('photo has no box');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 36, centerY + 12);
    await page.mouse.up();
    const panned = (await page.evaluate(`(() => {
        const transform = document.getElementById('modal-image').style.transform;
        const match = /translate\\(([-0-9.]+)px/.exec(transform);
        return { transform, x: match ? Number(match[1]) : 0 };
    })()`)) as { transform: string; x: number };
    expect(panned.transform).toContain('scale(1.25)');
    expect(panned.x).toBeGreaterThan(10);

    await page.keyboard.press('0');
    await expect
        .poll(() => page.evaluate(`document.getElementById('modal-image').style.transform`))
        .toBe('none');

    await page.locator('#modal-image').dblclick();
    await expect
        .poll(() => page.evaluate(`document.getElementById('modal-image').style.transform`))
        .toContain('scale(2.5)');
    await page.locator('#modal-image').dblclick();
    await expect
        .poll(() => page.evaluate(`document.getElementById('modal-image').style.transform`))
        .toBe('none');

    const before = (await page.evaluate('window.modal.currentImageId')) as string;
    await page.keyboard.press('=');
    await expect
        .poll(() => page.evaluate(`document.getElementById('modal-image').style.transform`))
        .toContain('scale(1.25)');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate('window.modal.currentImageId')).not.toBe(before);
    await expect
        .poll(() => page.evaluate(`document.getElementById('modal-image').style.transform`))
        .toBe('none');
    expect(await page.evaluate('window.app.globeExplorer._zoomInputBound === true')).toBe(false);
});

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

test('the control menu filters the gallery by camera', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();

    await page.locator('#cm-hub').click();
    await page.locator('#cm-sectors .cm-node', { hasText: 'FILTER' }).click();
    await page.locator('#cm-options .cm-node', { hasText: 'CAMERA' }).click();

    const leaf = page.locator('#cm-leaf .cm-node');
    await expect(leaf.filter({ hasText: 'ROLLEICORD' })).toBeVisible();
    await expect(leaf.filter({ hasText: 'IPHONE 15 PRO' })).toBeVisible();
    await expect(leaf.filter({ hasText: 'CANON EOS R5' })).toBeVisible();

    const boxes = (await page.evaluate(`(() => {
        return [...document.querySelectorAll('#cm-options .cm-node')].map((node) => {
            const rect = node.getBoundingClientRect();
            return {
                text: (node.textContent || '').trim(),
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom
            };
        });
    })()`)) as Array<{ text: string; top: number; left: number; right: number; bottom: number }>;
    expect(boxes).toHaveLength(6);
    expect(boxes.map((box) => box.text)).toEqual(
        expect.arrayContaining(['COUNTRY', 'REGION', 'PLACE', 'COLOR', 'CAMERA', 'CLEAR']),
    );
    for (const box of boxes) {
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(1280);
        expect(box.bottom).toBeLessThanOrEqual(900);
    }

    await leaf.filter({ hasText: 'ROLLEICORD' }).click();
    await expect.poll(() => page.evaluate('window.imageService.cameraFilter')).toBe('Rolleicord');
    await expect
        .poll(() =>
            page.evaluate(`(() => {
        const ids = window.imageService.chronoIds || [];
        return [...new Set(ids.map((id) => window.MockPhotos.byId(id).camera))];
    })()`),
        )
        .toEqual(['Rolleicord']);
    await expect(page.locator('#control-menu')).toHaveClass(/has-filter/);
    await expect(leaf.filter({ hasText: 'IPHONE 15 PRO' })).toBeVisible();
    await expect(leaf.filter({ hasText: 'CANON EOS R5' })).toBeVisible();

    await page.locator('#cm-options .cm-node', { hasText: 'CLEAR' }).click();
    await expect.poll(() => page.evaluate('window.imageService.cameraFilter')).toBe(null);
    await expect
        .poll(() =>
            page.evaluate(`(() => {
        const ids = window.imageService.chronoIds || [];
        return new Set(ids.map((id) => window.MockPhotos.byId(id).camera)).size;
    })()`),
        )
        .toBeGreaterThan(1);
});
