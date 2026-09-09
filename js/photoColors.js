/**
 * Named photo colors for upload-time extraction and the gallery filter.
 *
 * Keep this vocabulary in sync with functions/_lib/colors.js.
 */
(function attachPhotoColors(root) {
    const COLOR_PALETTE = [
        { id: 'black', label: 'Black', swatch: '#1a1a1a' },
        { id: 'gray', label: 'Gray', swatch: '#8a8a8a' },
        { id: 'white', label: 'White', swatch: '#f2f2f2' },
        { id: 'brown', label: 'Brown', swatch: '#8b5a2b' },
        { id: 'red', label: 'Red', swatch: '#c43c3c' },
        { id: 'orange', label: 'Orange', swatch: '#e07a2f' },
        { id: 'yellow', label: 'Yellow', swatch: '#d4b430' },
        { id: 'green', label: 'Green', swatch: '#3d8b4a' },
        { id: 'teal', label: 'Teal', swatch: '#2a9d8f' },
        { id: 'blue', label: 'Blue', swatch: '#3a6ea5' },
        { id: 'purple', label: 'Purple', swatch: '#6b4c9a' },
        { id: 'pink', label: 'Pink', swatch: '#d46a8a' }
    ];

    const COLOR_INDEX = new Map(COLOR_PALETTE.map((color, index) => [color.id, index]));
    const COLOR_BY_ID = new Map(COLOR_PALETTE.map((color) => [color.id, color]));
    const DEFAULT_MAX_COLORS = 5;
    const DEFAULT_MIN_SHARE = 0.06;
    const SAMPLE_EDGE = 80;

    function getColorMeta(id) {
        return COLOR_BY_ID.get(id) || null;
    }

    function normalizeColor(value) {
        const id = String(value || '').trim().toLowerCase();
        return COLOR_INDEX.has(id) ? id : '';
    }

    function parseColors(raw) {
        if (Array.isArray(raw)) {
            return normalizeColorList(raw);
        }
        if (typeof raw !== 'string') {
            return [];
        }
        const trimmed = raw.trim();
        if (!trimmed || trimmed === '[]') {
            return [];
        }
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? normalizeColorList(parsed) : [];
        } catch {
            return [];
        }
    }

    function serializeColors(colors) {
        const normalized = normalizeColorList(colors);
        return normalized.length ? JSON.stringify(normalized) : '[]';
    }

    function normalizeColorList(values) {
        const seen = new Set();
        const next = [];
        for (const value of Array.isArray(values) ? values : []) {
            const id = normalizeColor(value);
            if (!id || seen.has(id)) {
                continue;
            }
            seen.add(id);
            next.push(id);
            if (next.length >= DEFAULT_MAX_COLORS) {
                break;
            }
        }
        return next;
    }

    function rgbToHsl(r, g, b) {
        const red = r / 255;
        const green = g / 255;
        const blue = b / 255;
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const delta = max - min;
        const lightness = (max + min) / 2;

        if (delta === 0) {
            return { h: 0, s: 0, l: lightness };
        }

        const saturation = delta / (1 - Math.abs(2 * lightness - 1));
        let hue = 0;
        if (max === red) {
            hue = ((green - blue) / delta) % 6;
        } else if (max === green) {
            hue = (blue - red) / delta + 2;
        } else {
            hue = (red - green) / delta + 4;
        }

        hue *= 60;
        if (hue < 0) {
            hue += 360;
        }

        return { h: hue, s: saturation, l: lightness };
    }

    function classifyPixel(r, g, b) {
        const { h, s, l } = rgbToHsl(r, g, b);

        if (l <= 0.10) {
            return 'black';
        }
        if (l >= 0.93) {
            return 'white';
        }
        if (s <= 0.10) {
            if (l <= 0.18) {
                return 'black';
            }
            if (l >= 0.86) {
                return 'white';
            }
            return 'gray';
        }

        if (h >= 15 && h < 55 && l < 0.42 && s < 0.82) {
            return 'brown';
        }

        if (h < 15 || h >= 345) {
            return 'red';
        }
        if (h < 40) {
            return 'orange';
        }
        if (h < 70) {
            return 'yellow';
        }
        if (h < 165) {
            return 'green';
        }
        if (h < 195) {
            return 'teal';
        }
        if (h < 255) {
            return 'blue';
        }
        if (h < 300) {
            return 'purple';
        }
        return 'pink';
    }

    function extractColorsFromRgba(data, options = {}) {
        const maxColors = Number.isFinite(options.maxColors) ? options.maxColors : DEFAULT_MAX_COLORS;
        const minShare = Number.isFinite(options.minShare) ? options.minShare : DEFAULT_MIN_SHARE;
        const counts = new Map();
        let sampled = 0;

        for (let index = 0; index < data.length; index += 4) {
            if ((data[index + 3] ?? 255) < 16) {
                continue;
            }
            const id = classifyPixel(data[index], data[index + 1], data[index + 2]);
            counts.set(id, (counts.get(id) || 0) + 1);
            sampled += 1;
        }

        if (!sampled) {
            return [];
        }

        const ranked = [...counts.entries()]
            .sort((left, right) => {
                const byCount = right[1] - left[1];
                if (byCount !== 0) {
                    return byCount;
                }
                return (COLOR_INDEX.get(left[0]) ?? 99) - (COLOR_INDEX.get(right[0]) ?? 99);
            })
            .map(([id, count]) => ({ id, share: count / sampled }));

        const selected = [];
        for (const item of ranked) {
            if (selected.length >= maxColors) {
                break;
            }
            if (selected.length === 0 || item.share >= minShare) {
                selected.push(item.id);
            }
        }
        return selected;
    }

    function extractFromImage(image, options = {}) {
        if (!image) {
            return [];
        }

        const sourceWidth = image.naturalWidth || image.width || 0;
        const sourceHeight = image.naturalHeight || image.height || 0;
        if (!sourceWidth || !sourceHeight) {
            return [];
        }

        const maxEdge = Number(options.sampleEdge) || SAMPLE_EDGE;
        const ratio = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * ratio));
        const height = Math.max(1, Math.round(sourceHeight * ratio));
        const canvas = (options.document || (typeof document !== 'undefined' ? document : null))
            ?.createElement('canvas');

        if (!canvas) {
            throw new Error('Canvas is not available for color extraction.');
        }

        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
            throw new Error('Canvas is not available for color extraction.');
        }

        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        return extractColorsFromRgba(pixels, options);
    }

    const PhotoColors = {
        COLOR_PALETTE,
        DEFAULT_MAX_COLORS,
        DEFAULT_MIN_SHARE,
        getColorMeta,
        normalizeColor,
        parseColors,
        serializeColors,
        normalizeColorList,
        rgbToHsl,
        classifyPixel,
        extractColorsFromRgba,
        extractFromImage
    };

    if (root) {
        root.PhotoColors = PhotoColors;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhotoColors;
    }
})(typeof window !== 'undefined' ? window : globalThis);
