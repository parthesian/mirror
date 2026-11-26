// node design/photo-frame/capture.mjs [outDir] [option...]
// Needs a static server at the repo root: python3 -m http.server 4321
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.FRAME_BASE || 'http://localhost:4321/design/photo-frame/index.html';
const outDir = process.argv[2] || 'frame-shots';
const only = process.argv.slice(3);
const OPTIONS = ['edge', 'instant', 'placard', 'strip', 'postmark'];
const MOBILE_PHOTOS = {
    'film': 'ny-120',
    'digital': 'istanbul-digital',
    'film-35-portrait': 'ny-35-portrait',
    'film-35-landscape': 'ny-35-landscape',
    'digital-portrait': 'istanbul-digital-portrait',
};
const DESKTOP_PHOTOS = {
    'film': 'ny-120',
    'digital': 'istanbul-digital',
    'film-35-portrait': 'ny-35-portrait',
};

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

async function shoot(contextOptions, device, photos) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    for (const option of OPTIONS.filter((o) => !only.length || only.includes(o))) {
        for (const [label, photo] of Object.entries(photos)) {
            await page.goto(`${BASE}?o=${option}&p=${photo}`);
            await page.waitForSelector('body[data-ready="true"]');
            const file = path.join(outDir, `${option}-${device}-${label}.png`);
            await page.screenshot({ path: file, fullPage: true });
            console.log(file);
        }
    }
    await context.close();
}

await shoot(
    { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    'mobile',
    MOBILE_PHOTOS,
);
await shoot({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, 'desktop', DESKTOP_PHOTOS);

const overview = await browser.newContext({ viewport: { width: 2142, height: 1040 }, deviceScaleFactor: 1.5 });
const overviewPage = await overview.newPage();
for (const option of OPTIONS.filter((o) => !only.length || only.includes(o))) {
    await overviewPage.goto(BASE.replace('index.html', `overview.html?o=${option}`));
    await overviewPage.waitForSelector('body[data-ready="true"]');
    const file = path.join(outDir, `${option}-overview-mobile-aspects.png`);
    await overviewPage.screenshot({ path: file, fullPage: true });
    console.log(file);
}
await overview.close();
await browser.close();
