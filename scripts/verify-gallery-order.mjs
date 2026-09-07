import { createRequire } from 'module';

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

console.log('gallery-order, location-model, and flipboard checks passed');
