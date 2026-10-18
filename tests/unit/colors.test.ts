import { describe, expect, it } from 'vitest';
import {
    classifyPixel,
    extractColorsFromRgba,
    parseColors,
    serializeColors,
} from '../../shared/colors.js';

function fillRgba(width: number, height: number, rgb: [number, number, number]): Uint8Array {
    const data = new Uint8Array(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
        data[index] = rgb[0];
        data[index + 1] = rgb[1];
        data[index + 2] = rgb[2];
        data[index + 3] = 255;
    }
    return data;
}

function paintShare(
    width: number,
    height: number,
    parts: Array<{ share: number; rgb: [number, number, number] }>,
): Uint8Array {
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
    const first = parts[0];
    if (!first) {
        return data;
    }
    while (cursor < data.length) {
        data[cursor] = first.rgb[0];
        data[cursor + 1] = first.rgb[1];
        data[cursor + 2] = first.rgb[2];
        data[cursor + 3] = 255;
        cursor += 4;
    }
    return data;
}

describe('photo colors', () => {
    it('classifies the twelve palette samples', () => {
        const samples: Array<{ rgb: [number, number, number]; id: string }> = [
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
            expect(classifyPixel(...sample.rgb)).toBe(sample.id);
        }
    });

    it('keeps a dominant color and drops a tiny accent', () => {
        expect(extractColorsFromRgba(fillRgba(16, 16, [40, 90, 190])).join(',')).toBe('blue');
        const skyAndGrass = extractColorsFromRgba(
            paintShare(20, 20, [
                { share: 0.7, rgb: [70, 130, 210] },
                { share: 0.3, rgb: [50, 140, 55] },
            ]),
        );
        expect(skyAndGrass[0]).toBe('blue');
        expect(skyAndGrass).toContain('green');
        const tinyAccent = extractColorsFromRgba(
            paintShare(20, 20, [
                { share: 0.96, rgb: [40, 90, 190] },
                { share: 0.04, rgb: [220, 40, 40] },
            ]),
        );
        expect(tinyAccent.join(',')).toBe('blue');
    });

    it('round-trips stored color lists', () => {
        expect(serializeColors(['Blue', 'green', 'blue', 'navy'])).toBe('["blue","green"]');
        expect(parseColors('["teal","pink"]').join(',')).toBe('teal,pink');
        expect(parseColors('')).toEqual([]);
    });
});
