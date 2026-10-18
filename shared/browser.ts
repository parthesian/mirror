import {
    COLOR_PALETTE,
    classifyPixel,
    DEFAULT_MAX_COLORS,
    DEFAULT_MIN_SHARE,
    extractColorsFromRgba,
    getColorMeta,
    normalizeColor,
    normalizeColorList,
    parseColors,
    rgbToHsl,
    serializeColors,
} from './colors.js';

const SAMPLE_EDGE = 80;

type SampleSource = {
    naturalWidth?: number;
    width?: number;
    naturalHeight?: number;
    height?: number;
};

type CanvasContext = {
    drawImage(image: SampleSource, dx: number, dy: number, dw: number, dh: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): { data: ArrayLike<number> };
};

type CanvasLike = {
    width: number;
    height: number;
    getContext(kind: '2d', options?: { willReadFrequently?: boolean }): CanvasContext | null;
};

type DocumentLike = {
    createElement(tag: string): CanvasLike;
};

type SampleOptions = {
    sampleEdge?: number;
    maxColors?: number;
    minShare?: number;
    document?: DocumentLike;
};

function isDocumentLike(value: unknown): value is DocumentLike {
    if (typeof value !== 'object' || value === null || !('createElement' in value)) {
        return false;
    }
    return typeof value.createElement === 'function';
}

function readDocument(options: SampleOptions): DocumentLike | null {
    if (options.document) {
        return options.document;
    }
    if (!('document' in globalThis)) {
        return null;
    }
    return isDocumentLike(globalThis.document) ? globalThis.document : null;
}

export function extractFromImage(
    image: SampleSource | null | undefined,
    options: SampleOptions = {},
): string[] {
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
    const canvas = readDocument(options)?.createElement('canvas');
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

export const PhotoColors = {
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
    extractFromImage,
};

Object.assign(globalThis, { PhotoColors });
