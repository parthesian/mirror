export const COLOR_IDS = [
    'black',
    'gray',
    'white',
    'brown',
    'red',
    'orange',
    'yellow',
    'green',
    'teal',
    'blue',
    'purple',
    'pink',
] as const;

export type ColorId = (typeof COLOR_IDS)[number];

const COLOR_META: Record<ColorId, { label: string; swatch: string }> = {
    black: { label: 'Black', swatch: '#1a1a1a' },
    gray: { label: 'Gray', swatch: '#8a8a8a' },
    white: { label: 'White', swatch: '#f2f2f2' },
    brown: { label: 'Brown', swatch: '#8b5a2b' },
    red: { label: 'Red', swatch: '#c43c3c' },
    orange: { label: 'Orange', swatch: '#e07a2f' },
    yellow: { label: 'Yellow', swatch: '#d4b430' },
    green: { label: 'Green', swatch: '#3d8b4a' },
    teal: { label: 'Teal', swatch: '#2a9d8f' },
    blue: { label: 'Blue', swatch: '#3a6ea5' },
    purple: { label: 'Purple', swatch: '#6b4c9a' },
    pink: { label: 'Pink', swatch: '#d46a8a' },
};

export const COLOR_PALETTE = COLOR_IDS.map((id) => ({
    id,
    label: COLOR_META[id].label,
    swatch: COLOR_META[id].swatch,
}));

const COLOR_INDEX = new Map<string, number>(COLOR_IDS.map((id, index) => [id, index]));
const COLOR_ID_SET = new Set<string>(COLOR_IDS);

export const DEFAULT_MAX_COLORS = 5;
export const DEFAULT_MIN_SHARE = 0.06;

export function isKnownColor(value: string): value is ColorId {
    return COLOR_ID_SET.has(value);
}

export function getColorMeta(id: string): { id: ColorId; label: string; swatch: string } | null {
    if (!isKnownColor(id)) {
        return null;
    }
    const meta = COLOR_META[id];
    return { id, label: meta.label, swatch: meta.swatch };
}

export function normalizeColor(value: unknown): ColorId | '' {
    const id = String(value ?? '')
        .trim()
        .toLowerCase();
    return isKnownColor(id) ? id : '';
}

export function normalizeColorList(values: unknown): ColorId[] {
    const seen = new Set<ColorId>();
    const next: ColorId[] = [];
    const list = Array.isArray(values) ? values : [];
    for (const value of list) {
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

export function parseColors(raw: unknown): ColorId[] {
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
        const parsed: unknown = JSON.parse(trimmed);
        return Array.isArray(parsed) ? normalizeColorList(parsed) : [];
    } catch {
        return [];
    }
}

export function serializeColors(colors: unknown): string {
    const normalized = normalizeColorList(colors);
    return normalized.length ? JSON.stringify(normalized) : '[]';
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

function darkWarmHueReadsAsBrown(hue: number, saturation: number, lightness: number): boolean {
    return hue >= 15 && hue < 55 && lightness < 0.42 && saturation < 0.82;
}

export function classifyPixel(r: number, g: number, b: number): ColorId {
    const { h, s, l } = rgbToHsl(r, g, b);

    if (l <= 0.1) {
        return 'black';
    }
    if (l >= 0.93) {
        return 'white';
    }
    if (s <= 0.1) {
        if (l <= 0.18) {
            return 'black';
        }
        if (l >= 0.86) {
            return 'white';
        }
        return 'gray';
    }

    if (darkWarmHueReadsAsBrown(h, s, l)) {
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

export function extractColorsFromRgba(
    data: ArrayLike<number>,
    options: { maxColors?: number; minShare?: number } = {},
): ColorId[] {
    const maxColors = Number.isFinite(options.maxColors) ? options.maxColors : DEFAULT_MAX_COLORS;
    const minShare = Number.isFinite(options.minShare) ? options.minShare : DEFAULT_MIN_SHARE;
    const counts = new Map<ColorId, number>();
    let sampled = 0;

    for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] ?? 255;
        if (alpha < 16) {
            continue;
        }
        const id = classifyPixel(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0);
        counts.set(id, (counts.get(id) ?? 0) + 1);
        sampled += 1;
    }

    if (!sampled || maxColors === undefined || minShare === undefined) {
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

    const selected: ColorId[] = [];
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

export function mapColorFacets(
    rows: ReadonlyArray<{ color?: unknown; value?: unknown; count?: unknown }> = [],
): Array<{
    value: ColorId;
    label: string;
    swatch: string;
    count: number;
}> {
    const counts = new Map<ColorId, number>();
    for (const row of rows) {
        const id = normalizeColor(row.color ?? row.value);
        if (!id) {
            continue;
        }
        counts.set(id, Number(row.count) || 0);
    }

    return COLOR_PALETTE.map((color) => ({
        value: color.id,
        label: color.label,
        swatch: color.swatch,
        count: counts.get(color.id) ?? 0,
    })).filter((color) => color.count > 0);
}
