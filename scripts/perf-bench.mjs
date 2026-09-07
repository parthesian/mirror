/**
 * Repeatable CPU/size baselines for the gallery hot paths.
 * Run: node scripts/perf-bench.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadBrowserModule(relPath) {
    const context = { window: {}, console, module: { exports: {} } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, relPath), 'utf8'), context);
    return context.window;
}

function time(label, fn, iterations = 1) {
    const start = performance.now();
    let result;
    for (let i = 0; i < iterations; i++) {
        result = fn();
    }
    const ms = performance.now() - start;
    return { label, ms, iterations, perCallMs: ms / iterations, result };
}

function print(row) {
    const per = row.perCallMs.toFixed(row.perCallMs >= 1 ? 2 : 4);
    console.log(`${row.label.padEnd(56)} ${per.padStart(10)} ms  (${row.iterations}×)`);
}

const jsDir = path.join(root, 'js');
const jsFiles = fs.readdirSync(jsDir).filter((name) => name.endsWith('.js')).sort();
const sizes = jsFiles.map((name) => {
    const bytes = fs.statSync(path.join(jsDir, name)).size;
    return { name, bytes };
});
const cssBytes = fs.statSync(path.join(root, 'styles.css')).size;
const htmlBytes = fs.statSync(path.join(root, 'index.html')).size;
const publicJs = jsFiles.filter((name) => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    return html.includes(`js/${name}`);
});
const publicBytes = publicJs.reduce((sum, name) => {
    return sum + fs.statSync(path.join(jsDir, name)).size;
}, 0);

console.log('=== Bundle composition (uncompressed source) ===');
console.log(`index.html                                        ${String(htmlBytes).padStart(8)} B`);
console.log(`styles.css                                        ${String(cssBytes).padStart(8)} B`);
console.log(`public gallery JS (${publicJs.length} files)                      ${String(publicBytes).padStart(8)} B`);
for (const row of sizes.sort((a, b) => b.bytes - a.bytes)) {
    const onPage = publicJs.includes(row.name) ? 'gallery' : 'admin/other';
    console.log(`  ${row.name.padEnd(28)} ${String(row.bytes).padStart(8)} B  ${onPage}`);
}

const unusedOnGallery = ['customCalendar.js', 'adminUpload.js'];
console.log('\n=== Critical-path unused scripts ===');
for (const name of unusedOnGallery) {
    const included = publicJs.includes(name);
    const bytes = fs.statSync(path.join(jsDir, name)).size;
    console.log(`  ${name}: ${included ? 'LOADED on index.html' : 'not on index.html'} (${bytes} B)`);
}

const { GalleryLayout } = loadBrowserModule('js/galleryLayout.js');
const { LocationModel } = loadBrowserModule('js/locationModel.js');

function fakeImages(n) {
    return Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        aspectRatio: 0.6 + ((i * 17) % 140) / 100,
        thumbnailUrl: `/t/${i}.jpg`
    }));
}

const metrics = { columns: 4, gap: 20, columnWidth: 280 };
const counts = [24, 120, 480, 1200];

console.log('\n=== Masonry layout + viewport range ===');
for (const n of counts) {
    const images = fakeImages(n);
    const layoutRow = time(`masonry(${n})`, () => GalleryLayout.masonry(images, metrics), 40);
    print(layoutRow);
    const layout = GalleryLayout.masonry(images, metrics);
    const rangeRow = time(
        `rangeForViewport masonry n=${n} window=2000px`,
        () => GalleryLayout.rangeForViewport(layout, n, 2400, 4400),
        400
    );
    print(rangeRow);
}

const grid = GalleryLayout.grid(1200, { ...metrics, rowHeight: 210, rowSpan: 230, rows: 300, totalHeight: 68980 });
print(time('rangeForViewport grid n=1200', () => GalleryLayout.rangeForViewport(grid, 1200, 2400, 4400), 400));

console.log('\n=== Filter option rebuild (geo locations) ===');
const locations = Array.from({ length: 800 }, (_, i) => ({
    country: ['USA', 'Japan', 'France', 'India', 'Canada'][i % 5],
    state: `State-${i % 40}`,
    location: `Place-${i % 180}`,
    takenAt: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`
}));

function buildFilterOptions(list, field) {
    const buckets = new Map();
    for (const loc of list) {
        const raw = String(loc[field] || '').trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (!buckets.has(key)) buckets.set(key, { value: raw, count: 0 });
        buckets.get(key).count += 1;
    }
    return [...buckets.values()].sort((a, b) => a.value.localeCompare(b.value));
}

print(time('build country options n=800', () => buildFilterOptions(locations, 'country'), 200));
print(time('build place options n=800', () => buildFilterOptions(locations, 'location'), 200));
print(time('LocationModel.groupTrips n=800', () => LocationModel.groupTrips(locations), 80));

console.log('\n=== Linear aspect adopt (current gallery path) ===');
const images = fakeImages(1200);
print(time('scan 1200 images for one thumbnailUrl', () => {
    const url = images[900].thumbnailUrl;
    let found = 0;
    for (const image of images) {
        if (image.thumbnailUrl === url) found += 1;
    }
    return found;
}, 2000));

console.log('\n=== Memory-shape estimates ===');
const mountedForever = 1200;
const detachedNodeBytes = 2500;
const decodedThumbBytes = 640 * 480 * 4;
console.log(`  detached mountedItems if never evicted @ ${mountedForever} tiles: ~${((mountedForever * detachedNodeBytes) / 1024).toFixed(0)} KB DOM + ~${((mountedForever * decodedThumbBytes) / (1024 * 1024)).toFixed(0)} MB decoded if unique bitmaps`);
console.log('  preloader Image() + detached <img> can retain two decoded copies of the same thumb');
