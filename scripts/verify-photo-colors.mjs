import { createRequire } from 'node:module';
import { COLOR_IDS, classifyPixel, extractColorsFromRgba, parseColors, serializeColors } from '../functions/_lib/colors.js';

const require = createRequire(import.meta.url);
const PhotoColors = require('../js/photoColors.js');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function fillRgba(width, height, rgb) {
    const data = new Uint8Array(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
        data[index] = rgb[0];
        data[index + 1] = rgb[1];
        data[index + 2] = rgb[2];
        data[index + 3] = 255;
    }
    return data;
}

function paintShare(width, height, parts) {
    const data = new Uint8Array(width * height * 4);
    const total = parts.reduce((sum, part) => sum + part.share, 0);
    let cursor = 0;
    for (const part of parts) {
        const count = Math.round((part.share / total) * width * height);
        for (let index = 0; index < count && cursor < data.length; index += 1) {
            data[cursor] = part.rgb[0];
            data[cursor + 1] = part.rgb[1];
            data[cursor + 2] = part.rgb[2];
            data[cursor + 3] = 255;
            cursor += 4;
        }
    }
    while (cursor < data.length) {
        data[cursor] = parts[0].rgb[0];
        data[cursor + 1] = parts[0].rgb[1];
        data[cursor + 2] = parts[0].rgb[2];
        data[cursor + 3] = 255;
        cursor += 4;
    }
    return data;
}

assert(PhotoColors.COLOR_PALETTE.map((color) => color.id).join(',') === COLOR_IDS.join(','), 'browser and worker palettes must match');

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
    { rgb: [220, 80, 140], id: 'pink' }
];

for (const sample of samples) {
    assert(PhotoColors.classifyPixel(...sample.rgb) === sample.id, `browser classify ${sample.rgb} -> ${sample.id}`);
    assert(classifyPixel(...sample.rgb) === sample.id, `worker classify ${sample.rgb} -> ${sample.id}`);
}

const blueOnly = extractColorsFromRgba(fillRgba(16, 16, [40, 90, 190]));
assert(blueOnly.join(',') === 'blue', `solid blue should be [blue], got ${blueOnly}`);
assert(
    PhotoColors.extractColorsFromRgba(fillRgba(16, 16, [40, 90, 190])).join(',') === 'blue',
    'browser extractor should match worker extractor'
);

const skyAndGrass = extractColorsFromRgba(paintShare(20, 20, [
    { share: 0.7, rgb: [70, 130, 210] },
    { share: 0.3, rgb: [50, 140, 55] }
]));
assert(skyAndGrass[0] === 'blue', `dominant sky should be blue, got ${skyAndGrass}`);
assert(skyAndGrass.includes('green'), `grass should remain as a secondary color, got ${skyAndGrass}`);

const tinyAccent = extractColorsFromRgba(paintShare(20, 20, [
    { share: 0.96, rgb: [40, 90, 190] },
    { share: 0.04, rgb: [220, 40, 40] }
]));
assert(tinyAccent.join(',') === 'blue', `a 4% accent should be dropped, got ${tinyAccent}`);

assert(serializeColors(['Blue', 'green', 'blue', 'navy']) === '["blue","green"]', 'serialize should keep unique known colors in order');
assert(parseColors('["teal","pink"]').join(',') === 'teal,pink', 'parse should keep stored order');
assert(parseColors('').length === 0, 'empty string means not yet computed / no colors');

console.log('photo color checks passed');
