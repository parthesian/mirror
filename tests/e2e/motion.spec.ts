import { expect, test } from '@playwright/test';

test('a reduced-motion swipe does not leave the photo offset', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: 'reduce',
        hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#modal.active')).toBeVisible();
    await page.waitForFunction(
        `document.getElementById('modal-image') && document.getElementById('modal-image').naturalWidth > 0`,
    );
    const result = (await page.evaluate(`(async () => {
        function fire(type, x, y) {
            const target = document.getElementById('modal-image');
            const touch = new Touch({
                identifier: 1,
                target,
                clientX: x,
                clientY: y,
                pageX: x,
                pageY: y
            });
            const ended = type === 'touchend' || type === 'touchcancel';
            target.dispatchEvent(new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: ended ? [] : [touch],
                targetTouches: ended ? [] : [touch],
                changedTouches: [touch]
            }));
        }
        const image = document.getElementById('modal-image');
        const rect = image.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        fire('touchstart', x, y);
        fire('touchmove', x - 254, y);
        const dragged = image.style.transform;
        fire('touchend', x - 254, y);
        fire('touchstart', x, y);
        fire('touchmove', x - 90, y);
        fire('touchcancel', x - 90, y);
        return { dragged, transform: getComputedStyle(image).transform };
    })()`)) as { dragged: string; transform: string };
    expect(result.dragged).toBe('translateX(-254px)');
    expect(result.transform).toBe('none');
    await context.close();
});

test('a short drag clears the inline transform once it settles', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: 'no-preference',
        hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#modal.active')).toBeVisible();
    await page.waitForFunction(
        `document.getElementById('modal-image') && document.getElementById('modal-image').naturalWidth > 0`,
    );
    const during = (await page.evaluate(`(async () => {
        function fire(type, x, y) {
            const target = document.getElementById('modal-image');
            const touch = new Touch({
                identifier: 1,
                target,
                clientX: x,
                clientY: y,
                pageX: x,
                pageY: y
            });
            const ended = type === 'touchend';
            target.dispatchEvent(new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: ended ? [] : [touch],
                targetTouches: ended ? [] : [touch],
                changedTouches: [touch]
            }));
        }
        const image = document.getElementById('modal-image');
        const rect = image.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        fire('touchstart', x, y);
        fire('touchmove', x - 30, y);
        const dragged = image.style.transform;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        fire('touchend', x - 30, y);
        return {
            dragged,
            target: image.style.transform,
            inline: image.style.transition
        };
    })()`)) as { dragged: string; target: string; inline: string };
    expect(during.dragged).toBe('translateX(-30px)');
    expect(during.target).toBe('none');
    expect(during.inline.startsWith('transform')).toBe(true);
    await page.waitForTimeout(320);
    const after = (await page.evaluate(`(() => {
        const image = document.getElementById('modal-image');
        return {
            inline: image.style.transition,
            transform: getComputedStyle(image).transform,
            property: getComputedStyle(image).transitionProperty
        };
    })()`)) as { inline: string; transform: string; property: string };
    expect(after.inline).toBe('');
    expect(after.transform).toBe('none');
    expect(after.property).not.toBe('transform');
    await context.close();
});

test('a short desktop photo fits the modal content box', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 844, height: 390 },
        reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#modal.active')).toBeVisible();
    await page.waitForFunction(
        `document.getElementById('modal-image') && document.getElementById('modal-image').naturalWidth > 0`,
    );
    await page.waitForTimeout(200);
    const fit = (await page.evaluate(`(() => {
        const content = document.querySelector('.modal-content');
        const image = document.getElementById('modal-image');
        const style = getComputedStyle(content);
        const padTop = parseFloat(style.paddingTop) || 0;
        const padBottom = parseFloat(style.paddingBottom) || 0;
        const box = content.getBoundingClientRect();
        const photo = image.getBoundingClientRect();
        return {
            overflow: Math.round(photo.bottom - (box.bottom - padBottom)),
            topGap: Math.round(photo.top - (box.top + padTop))
        };
    })()`)) as { overflow: number; topGap: number };
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.topGap).toBeGreaterThanOrEqual(0);
    await context.close();
});

test('reduced motion keeps shuffled tiles from gliding or fading', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const motion = (await page.evaluate(`(async () => {
        const nodes = Array.from(document.querySelectorAll('.gallery-item')).slice(0, 8);
        const tops = nodes.map(() => []);
        const sample = () => {
            nodes.forEach((node, index) => {
                tops[index].push(Math.round(node.getBoundingClientRect().top));
            });
        };
        sample();
        const timer = setInterval(sample, 16);
        await window.viewMode.setMode('random', { forceRefresh: true });
        await new Promise((resolve) => setTimeout(resolve, 400));
        clearInterval(timer);
        sample();
        const image = document.querySelector('.gallery-item.instant .gallery-item-image');
        const unique = tops.map((list) => new Set(list).size);
        return {
            maxUnique: Math.max(...unique, 0),
            transition: image ? getComputedStyle(image).transition : ''
        };
    })()`)) as { maxUnique: number; transition: string };
    expect(motion.maxUnique).toBeLessThanOrEqual(3);
    expect(motion.transition).toBe('none');
    await context.close();
});

test('changing photos keeps the globe round and does not ghost the photo', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    const firstId = (await page.evaluate(`window.app.imageService.images[0].id`)) as string;
    await page.evaluate(`window.app.modal.open(${JSON.stringify(firstId)})`);
    await page.waitForFunction(
        `document.getElementById('modal-image') && document.getElementById('modal-image').naturalWidth > 0 && document.querySelector('#modal-globe canvas')`,
    );
    const wide = (await page.evaluate(`(() => {
        const globe = document.getElementById('modal-globe').getBoundingClientRect();
        const info = document.querySelector('.modal-info').clientWidth;
        const copy = document.querySelector('.modal-copy').getBoundingClientRect().height;
        return {
            w: Math.round(globe.width),
            h: Math.round(globe.height),
            expected: Math.round(Math.min(copy, info * 0.3))
        };
    })()`)) as { w: number; h: number; expected: number };
    expect(Math.abs(wide.w - wide.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(wide.w - wide.expected)).toBeLessThanOrEqual(1);

    const changed = (await page.evaluate(`(async () => {
        await window.app.modal.showNextImage();
        const image = document.getElementById('modal-image');
        const globe = document.getElementById('modal-globe').getBoundingClientRect();
        const canvas = document.querySelector('#modal-globe canvas').getBoundingClientRect();
        const info = document.querySelector('.modal-info').clientWidth;
        const copy = document.querySelector('.modal-copy').getBoundingClientRect().height;
        const sizing = image.getAnimations().some((entry) => entry.transitionProperty === 'width' || entry.transitionProperty === 'height');
        return {
            ghosts: document.querySelectorAll('.modal-photo-ghost').length,
            sizing,
            w: Math.round(globe.width),
            h: Math.round(globe.height),
            canvasW: Math.round(canvas.width),
            canvasH: Math.round(canvas.height),
            expected: Math.round(Math.min(copy, info * 0.3))
        };
    })()`)) as {
        ghosts: number;
        sizing: boolean;
        w: number;
        h: number;
        canvasW: number;
        canvasH: number;
        expected: number;
    };
    expect(changed.ghosts).toBe(0);
    expect(changed.sizing).toBe(false);
    expect(Math.abs(changed.w - changed.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(changed.canvasW - changed.canvasH)).toBeLessThanOrEqual(1);
    expect(Math.abs(changed.w - changed.expected)).toBeLessThanOrEqual(1);
    await context.close();
});

test('a pinch scales the photo and a swipe does not change it', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('/?mock=1');
    await expect(page.locator('.gallery-item').first()).toBeVisible();
    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#modal.active')).toBeVisible();
    await page.waitForFunction(`(() => {
        const image = document.getElementById('modal-image');
        const box = image && image.getBoundingClientRect();
        return Boolean(image && image.naturalWidth > 1 && box.width > 40 && box.height > 40);
    })()`);

    const pinched = (await page.evaluate(`(() => {
        const image = document.getElementById('modal-image');
        const rect = image.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        function fire(type, points) {
            const ended = type === 'touchend' || type === 'touchcancel';
            const list = points.map((point) => new Touch({
                identifier: point.id,
                target: image,
                clientX: point.x,
                clientY: point.y,
                pageX: point.x,
                pageY: point.y
            }));
            image.dispatchEvent(new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: ended ? [] : list,
                targetTouches: ended ? [] : list,
                changedTouches: list
            }));
        }
        fire('touchstart', [{ id: 1, x, y }]);
        fire('touchend', [{ id: 1, x, y }]);
        fire('touchstart', [{ id: 2, x, y }]);
        fire('touchend', [{ id: 2, x, y }]);
        const tapped = image.style.transform;
        const id = window.modal.currentImageId;
        fire('touchstart', [{ id: 3, x, y }]);
        fire('touchmove', [{ id: 3, x: x - 180, y }]);
        fire('touchend', [{ id: 3, x: x - 180, y }]);
        const afterSwipe = image.style.transform;
        const still = window.modal.currentImageId;
        fire('touchstart', [{ id: 4, x: x - 40, y }, { id: 5, x: x + 40, y }]);
        fire('touchmove', [{ id: 4, x: x - 80, y }, { id: 5, x: x + 80, y }]);
        const pinched = image.style.transform;
        return { tapped, afterSwipe, pinched, id, still };
    })()`)) as { tapped: string; afterSwipe: string; pinched: string; id: string; still: string };
    expect(pinched.tapped).toContain('scale(2.5)');
    expect(pinched.afterSwipe).toContain('scale(2.5)');
    expect(pinched.pinched).toContain('scale(4)');
    expect(pinched.still).toBe(pinched.id);
    await context.close();
});
