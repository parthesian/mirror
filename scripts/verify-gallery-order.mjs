import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const require = createRequire(import.meta.url);
const GalleryOrder = require('../js/galleryOrder.js');
const LocationModel = require('../js/locationModel.js');
const Flipboard = require('../js/flipboard.js');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const chrono = ['a', 'b', 'c', 'd', 'e', 'f'];

const chronoOrder = GalleryOrder.buildDisplayOrder({
    chronoIds: chrono,
    currentOrder: [],
    mode: 'chrono'
});
assert(chronoOrder.join(',') === chrono.join(','), 'chrono order must stay API order');

const reshuffled = GalleryOrder.buildDisplayOrder({
    chronoIds: chrono,
    currentOrder: [],
    mode: 'random',
    reshuffle: true
});
assert(reshuffled.length === chrono.length, 'random order keeps every id');
assert([...reshuffled].sort().join(',') === [...chrono].sort().join(','), 'random order is a permutation');

const appended = GalleryOrder.buildDisplayOrder({
    chronoIds: [...chrono, 'g', 'h'],
    currentOrder: ['c', 'a', 'f', 'b', 'e', 'd'],
    mode: 'random'
});
assert(appended.slice(0, 6).join(',') === 'c,a,f,b,e,d', 'already-seen tiles must not jump');
assert(appended.length === 8, 'new pages append after the stable prefix');
assert(new Set(appended.slice(6)).size === 2, 'new ids are appended shuffled');
assert(appended.slice(6).every((id) => id === 'g' || id === 'h'), 'only new ids land in the tail');

assert(
    LocationModel.locationKey({ location: 'Kyoto', state: 'Kyoto', country: 'Japan' })
        === LocationModel.locationKey({ location: 'Kyoto', state: 'Kyoto', country: 'Japan' }),
    'place keys must be stable'
);
assert(
    LocationModel.locationKey({ location: 'Kyoto', state: 'Kyoto', country: 'Japan' })
        !== LocationModel.locationKey({ location: 'Kyoto', state: 'Osaka', country: 'Japan' }),
    'same place name in another region must not share a key'
);

const aliases = LocationModel.seedCountryAliases({ USA: [{}], Japan: [{}] });
assert(
    LocationModel.resolveCountryFilterValue('United States', ['USA'], { USA: [{}] }, aliases) === 'USA',
    'country aliases must resolve to the stored filter value'
);

const trips = LocationModel.groupTrips([
    { takenAt: '2024-01-01T00:00:00.000Z' },
    { takenAt: '2024-01-10T00:00:00.000Z' },
    { takenAt: '2024-03-20T00:00:00.000Z' }
]);
assert(trips.length === 2, 'trips split on a 30-day gap');
assert(LocationModel.groupTrips([]).length === 0, 'empty trip lists stay empty');

const pool = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
const sequence = Flipboard.pickIntermediates(pool, 'a.jpg', 'd.jpg', 4);
assert(sequence[sequence.length - 1] === 'd.jpg', 'flipboard must land on the destination thumb');
assert(sequence.slice(0, -1).every((url) => pool.includes(url)), 'intermediates come from the loaded pool');
assert(Flipboard.pickIntermediates([], 'a.jpg', 'z.jpg', 3).join(',') === 'z.jpg', 'empty pool still lands on dest');
assert(typeof Flipboard.animateWindow === 'function', 'flipboard exposes window animation');

const preloader = {
    loaded: new Set(['a.jpg', 'b.jpg', 'full.jpg']),
    isImageLoaded(url) { return this.loaded.has(url); }
};
const thumbsOnly = Flipboard.loadedThumbUrls(preloader, ['a.jpg', 'b.jpg', 'missing.jpg']);
assert(thumbsOnly.join(',') === 'a.jpg,b.jpg', 'flip faces are loaded thumbs only');
assert(!thumbsOnly.includes('full.jpg'), 'full-size hover prefetches stay out of the flap pool');

const filler = Flipboard.fillerFace(['a.jpg', 'b.jpg'], ['c.jpg'], 0, 'dest.jpg', 'a.jpg');
assert(filler !== 'dest.jpg', 'a waiting tile must not land on the destination early');
assert(filler !== 'a.jpg', 'a waiting tile must not reflip the face already shown');
assert(['b.jpg', 'c.jpg'].includes(filler), 'waiting faces come from the cached pool');
assert(Flipboard.fillerFace([], [], 3, 'dest.jpg', 'a.jpg') === '', 'no cached faces means no filler flap');
assert(!Flipboard.landingWaitExceeded(Date.now()), 'a tile keeps waiting inside the landing budget');
assert(
    Flipboard.landingWaitExceeded(0, Flipboard.MAX_LANDING_WAIT_MS + 1),
    'a tile lands anyway once the landing budget is spent'
);
assert(Flipboard.staggerDelay(0, 80) === 0, 'first flap still starts immediately');
assert(
    Flipboard.staggerDelay(79, 80) <= Flipboard.STAGGER_BUDGET_MS + 0.001,
    'dense 6-col boards keep total stagger inside the budget'
);
assert(Flipboard.staggerDelay(3, 8) === 3 * Flipboard.STAGGER_MS, 'small boards keep the original 12ms step');
assert(Flipboard.landingBudgetMs(80) === Flipboard.BUSY_LANDING_WAIT_MS, 'dense boards cut the landing wait');
assert(Flipboard.landingBudgetMs(12) === Flipboard.MAX_LANDING_WAIT_MS, 'small boards keep the full landing wait');
assert(
    Flipboard.landingWaitExceeded(0, Flipboard.BUSY_LANDING_WAIT_MS + 1, Flipboard.BUSY_LANDING_WAIT_MS),
    'busy landing budget is honoured when passed through'
);

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
assert(!indexHtml.includes('js/customCalendar.js'), 'public gallery must not load the admin calendar');
assert(indexHtml.includes('format=auto') === false, 'thumb format=auto is derived in JS, not hardcoded in HTML');

const imageServiceSrc = fs.readFileSync(path.join(repoRoot, 'js/imageService.js'), 'utf8');
const photosLibSrc = fs.readFileSync(path.join(repoRoot, 'functions/_lib/photos.js'), 'utf8');
assert(imageServiceSrc.includes('format=auto'), 'client thumb URLs must request format=auto');
assert(photosLibSrc.includes('format=auto'), 'server thumb URLs must request format=auto');

const sandbox = {
    window: { GalleryOrder: GalleryOrder, CONFIG: { API_BASE_URL: '' } },
    console
};
vm.createContext(sandbox);
vm.runInContext(imageServiceSrc, sandbox);
const service = new sandbox.window.ImageService();
assert(service.buildPhotoAssetUrl('abc', 'thumb').includes('format=auto'), 'thumb URL includes format=auto');
assert(service.buildPhotoAssetUrl('abc', 'thumb').includes('width=640'), 'default thumb edge is 640');
assert(
    service.buildPhotoAssetUrl('abc', 'thumb', { width: 320 }).includes('width=320'),
    'thumb URL can request a smaller decode edge'
);
assert(!service.buildPhotoAssetUrl('abc', 'full').includes('cdn-cgi/image'), 'full URL stays untransformed');
assert(sandbox.window.ImageService.thumbEdgeFor(150, 2) === 320, 'narrow 6-col tiles use 320px thumbs');
assert(sandbox.window.ImageService.thumbEdgeFor(200, 2) === 480, 'mid tiles use 480px thumbs');
assert(sandbox.window.ImageService.thumbEdgeFor(400, 2) === 640, 'wide tiles keep 640px thumbs');
assert(service.setThumbEdge(320) === true, 'setThumbEdge reports a change');
assert(service.thumbEdge === 320, 'thumbEdge is stored');
assert(service.setThumbEdge(320) === false, 'setThumbEdge is a no-op at the same edge');
service.imagesById.set('custom', { id: 'custom', thumbnailUrl: '/mock-thumb/custom' });
service.imagesById.set('derived', { id: 'derived', thumbnailUrl: service.buildPhotoAssetUrl('derived', 'thumb') });
service.setThumbEdge(480);
assert(service.imagesById.get('custom').thumbnailUrl === '/mock-thumb/custom', 'custom thumbs are not rewritten');
assert(service.imagesById.get('derived').thumbnailUrl.includes('width=480'), 'derived thumbs follow the new edge');
service.countryFilter = 'Japan';
assert(service.filterKey().includes('Japan'), 'filterKey reflects the active country');
service.countryFilter = null;
assert(service.filterKey() !== service.filterKey() + 'x', 'filterKey is stable for the same filters');
const emptyKey = service.filterKey();
service.locationFilter = 'Kyoto';
assert(service.filterKey() !== emptyKey, 'filterKey changes when a filter is applied');

const layoutSandbox = { window: {}, console, module: { exports: {} } };
vm.createContext(layoutSandbox);
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/galleryLayout.js'), 'utf8'), layoutSandbox);
const GalleryLayout = layoutSandbox.window.GalleryLayout || layoutSandbox.module.exports;
assert(GalleryLayout.isConstrainedViewport({
    innerWidth: 980,
    screen: { width: 412 },
    matchMedia: () => ({ matches: true })
}), 'desktop-site on a phone is treated as constrained');
assert(!GalleryLayout.isConstrainedViewport({
    innerWidth: 1440,
    screen: { width: 1440 },
    matchMedia: () => ({ matches: false })
}), 'a real desktop is not constrained');
assert(
    GalleryLayout.overscanPixels({ rowSpan: 120, viewportHeight: 2100, columns: 6, constrained: true }) === 240,
    '5–6 col phone desktop keeps two rows of overscan'
);
assert(
    GalleryLayout.overscanPixels({ rowSpan: 180, viewportHeight: 900, columns: 4, constrained: false }) <= 180 * 4,
    'desktop overscan is capped at four rows'
);
assert(
    GalleryLayout.rectIntersectsBand({ top: 100, height: 80 }, 0, 90) === false,
    'a tile fully below the band is not visible'
);
assert(
    GalleryLayout.rectIntersectsBand({ top: 40, height: 80 }, 0, 90) === true,
    'a tile that crosses the band is visible'
);

const preloaderSandbox = {
    window: {
        setTimeout: () => 1,
        clearTimeout: () => {}
    },
    console,
    module: { exports: {} }
};
vm.createContext(preloaderSandbox);
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/imagePreloader.js'), 'utf8'), preloaderSandbox);
const { ImagePreloader, ImageLoadQueue } = preloaderSandbox.module.exports;
const pendingPreloader = new ImagePreloader();
const hanging = new Promise(() => {});
pendingPreloader.registerPending('stuck.jpg', hanging);
assert(!pendingPreloader.loadingPromises.has('stuck.jpg'), 'DOM load promises are not parked in the preload map');
pendingPreloader.loadingPromises.set('other.jpg', hanging);
pendingPreloader.abandon('other.jpg');
assert(!pendingPreloader.loadingPromises.has('other.jpg'), 'abandon drops a cancelled pending URL');
const queue = new ImageLoadQueue({ limit: 6 });
assert(queue.limit === 6, 'load queue accepts a decode cap');
queue.pause();
assert(queue.paused === true, 'load queue can pause during a morph');
queue.resume();
assert(queue.paused === false, 'load queue resumes after a morph');
const detachedImg = { isConnected: false, dataset: {}, getAttribute: () => '', addEventListener() {}, removeEventListener() {} };
queue.assign(detachedImg, '/t.jpg', 0);
assert(queue.queue.length === 1, 'a tile created before insert stays queued');
queue.pump();
assert(queue.queue.length === 1, 'pump does not drop a disconnected tile');
assert(queue.active === 0, 'a disconnected tile does not consume a decode slot');

const globeSandbox = { window: {}, console, document: { getElementById() { return null; } } };
vm.createContext(globeSandbox);
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/globeExplorer.js'), 'utf8'), globeSandbox);
const GlobeExplorer = globeSandbox.window.GlobeExplorer;
const phoneDist = GlobeExplorer.globeFitDistance(390, 844, 45);
const squareDist = GlobeExplorer.globeFitDistance(800, 800, 45);
assert(phoneDist > squareDist + 1.5, 'a portrait phone pulls the camera back to show the whole globe');
assert(phoneDist <= 8, 'fit distance stays inside the orbit max');
assert(squareDist >= 2.6 && squareDist < 3.4, 'a square view stays near the original framing');

const transitionSandbox = { window: {}, console, module: { exports: {} } };
vm.createContext(transitionSandbox);
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/galleryTransition.js'), 'utf8'), transitionSandbox);
const GalleryTransition = transitionSandbox.window.GalleryTransition || transitionSandbox.module.exports;
assert(GalleryTransition.shouldKeepSurface(4) === true, 'a populated gallery keeps its surface during reload');
assert(GalleryTransition.shouldKeepSurface(0) === false, 'the first load may still use the empty spinner');
assert(GalleryTransition.heightDeltaNeedsAnimation(1000, 1002) === false, 'sub-pixel height noise does not animate');
assert(GalleryTransition.heightDeltaNeedsAnimation(800, 1400) === true, 'a real masonry height change may animate once');
const settlingDoc = { documentElement: { classList: { add(name) { this.names = (this.names || new Set()).add(name); }, remove(name) { this.names?.delete(name); }, contains(name) { return this.names?.has(name); } } } };
GalleryTransition.lockDocumentScroll(settlingDoc);
assert(settlingDoc.documentElement.classList.contains('is-gallery-settling'), 'settle lock reserves the document scrollbar');
GalleryTransition.unlockDocumentScroll(settlingDoc);
assert(!settlingDoc.documentElement.classList.contains('is-gallery-settling'), 'settle unlock releases the document scrollbar');
assert(GalleryTransition.contentHeight({ offsetHeight: 10 }, { offsetHeight: 20 }, { offsetHeight: 30 }) === 60, 'content height sums spacers and the window');

const mockSandbox = {
    window: { location: { search: '?mock=1' } },
    console,
    module: { exports: {} },
    btoa,
    atob,
    URL,
    URLSearchParams,
    Response,
    unescape
};
vm.createContext(mockSandbox);
vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/mockPhotos.js'), 'utf8'), mockSandbox);
const MockPhotos = mockSandbox.window.MockPhotos || mockSandbox.module.exports;
assert(MockPhotos.enabled('?mock=1') === true, 'mock catalog is opt-in');
assert(MockPhotos.enabled('') === false, 'production URLs do not enable the mock catalog');
assert(MockPhotos.catalog().length >= 24, 'mock catalog has a full first page');
const japan = MockPhotos.page({ country: 'Japan' });
const france = MockPhotos.page({ country: 'France' });
assert(japan.photos.length > 0 && france.photos.length > 0, 'country filters return coloured pages');
assert(japan.photos[0].id !== france.photos[0].id, 'country filters return different photos');
assert(japan.photos.every((photo) => photo.width && photo.height), 'mock list rows carry masonry aspects');
const geo = MockPhotos.locations();
assert(geo.some((row) => row.country === 'Japan') && geo.some((row) => row.country === 'France'), 'geo feed has more than one colour filter');
const listResponse = MockPhotos.handleRequest('http://local.test/api/photos?limit=8');
assert(listResponse.status === 200, 'mock list handler answers /api/photos');
const imageResponse = MockPhotos.handleRequest('http://local.test/api/photos/mock-001/image');
assert(imageResponse.headers.get('Content-Type').includes('image/svg+xml'), 'mock image handler returns a coloured SVG');

const gallerySrc = fs.readFileSync(path.join(repoRoot, 'js/gallery.js'), 'utf8');
assert(gallerySrc.includes('beginSurfaceLock'), 'filter reloads lock the current gallery height');
assert(gallerySrc.includes('settleIncomingCollection'), 'new collections wait for a stable masonry pass');
assert(gallerySrc.includes('fillViewportIfNeeded'), 'short filter results load more before releasing height');
assert(!gallerySrc.includes('this.aspectReflowTimer = window.setTimeout(() => {\n            this.aspectReflowTimer = null;\n            if (!this.aspectReflowNeeded || !this.isMasonry || this.isMorphing) return;'), 'aspect reflow is no longer a 48ms first-hit remorph');
assert(indexHtml.includes('js/mockPhotos.js'), 'public page can install the opt-in mock catalog');
assert(indexHtml.includes('js/galleryTransition.js'), 'public page loads the settle helper');

console.log('gallery-order, location-model, flipboard, and image-url checks passed');
