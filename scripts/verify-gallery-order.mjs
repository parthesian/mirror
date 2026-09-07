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
assert(!service.buildPhotoAssetUrl('abc', 'full').includes('cdn-cgi/image'), 'full URL stays untransformed');
service.countryFilter = 'Japan';
assert(service.filterKey().includes('Japan'), 'filterKey reflects the active country');
service.countryFilter = null;
assert(service.filterKey() !== service.filterKey() + 'x', 'filterKey is stable for the same filters');
const emptyKey = service.filterKey();
service.locationFilter = 'Kyoto';
assert(service.filterKey() !== emptyKey, 'filterKey changes when a filter is applied');

console.log('gallery-order, location-model, flipboard, and image-url checks passed');
