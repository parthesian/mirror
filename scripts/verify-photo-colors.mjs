import { createRequire } from 'node:module';
import { emitSharedBrowser } from './emit-shared-browser.mjs';

const require = createRequire(import.meta.url);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

await emitSharedBrowser();
require('../js/generated/photo-colors.js');
const PhotoColors = globalThis.PhotoColors;
assert(PhotoColors?.classifyPixel, 'generated bundle sets PhotoColors');

const samples = [
    { rgb: [8, 8, 8], id: 'black' },
    { rgb: [250, 250, 250], id: 'white' },
    { rgb: [140, 140, 140], id: 'gray' },
    { rgb: [110, 70, 36], id: 'brown' },
    { rgb: [200, 32, 32], id: 'red' },
    { rgb: [230, 120, 30], id: 'orange' },
    { rgb: [230, 200, 40], id: 'yellow' },
    { rgb: [40, 150, 60], id: 'green' },
    { rgb: [30, 160, 155], id: 'teal' },
    { rgb: [40, 90, 190], id: 'blue' },
    { rgb: [120, 50, 180], id: 'purple' },
    { rgb: [220, 80, 140], id: 'pink' },
];

for (const sample of samples) {
    assert(
        PhotoColors.classifyPixel(...sample.rgb) === sample.id,
        `bundle classify ${sample.rgb} -> ${sample.id}`,
    );
}

assert(
    PhotoColors.serializeColors(['Blue', 'green', 'blue', 'navy']) === '["blue","green"]',
    'bundle serialize keeps unique known colors',
);

console.log('photo color bundle checks passed');
