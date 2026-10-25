import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import photoZoomSource from '../../js/photoZoom.js?raw';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface PhotoZoomState {
    scale: number;
    x: number;
    y: number;
}

interface PhotoZoomModule {
    fit: () => PhotoZoomState;
    isZoomed: (state: PhotoZoomState) => boolean;
    zoomAt: (
        state: PhotoZoomState,
        nextScale: number,
        focalX: number,
        focalY: number,
        viewW: number,
        viewH: number,
    ) => PhotoZoomState;
    toggle: (
        state: PhotoZoomState,
        focalX: number,
        focalY: number,
        viewW: number,
        viewH: number,
    ) => PhotoZoomState;
    pan: (
        state: PhotoZoomState,
        dx: number,
        dy: number,
        viewW: number,
        viewH: number,
    ) => PhotoZoomState;
    pinch: (
        start: PhotoZoomState,
        span0: number,
        span1: number,
        midDx: number,
        midDy: number,
        focalX: number,
        focalY: number,
        viewW: number,
        viewH: number,
    ) => PhotoZoomState;
    wheelKind: (
        event?: {
            deltaY?: number;
            deltaMode?: number;
            ctrlKey?: boolean;
            metaKey?: boolean;
        } | null,
    ) => 'pinch' | 'notch' | 'scroll';
    wheelScale: (scale: number, deltaY: number, kind: 'pinch' | 'notch' | 'scroll') => number;
    clampPan: (
        x: number,
        y: number,
        scale: number,
        viewW: number,
        viewH: number,
    ) => { x: number; y: number };
    layoutBox: (
        visual: { left: number; top: number; width: number; height: number },
        state: PhotoZoomState,
    ) => { width: number; height: number; cx: number; cy: number };
    focal: (
        clientX: number,
        clientY: number,
        layout: { cx: number; cy: number },
    ) => { x: number; y: number };
    transform: (state: PhotoZoomState) => string;
}

function loadPhotoZoom(): PhotoZoomModule {
    const module = { exports: {} as PhotoZoomModule };
    const runner = new Function(
        'module',
        'exports',
        'window',
        `${photoZoomSource}\nreturn module.exports;`,
    );
    return runner(module, module.exports, {}) as PhotoZoomModule;
}

const PhotoZoom = loadPhotoZoom();

function screenAt(state: PhotoZoomState, x: number, y: number) {
    return {
        x: x * state.scale + state.x,
        y: y * state.scale + state.y,
    };
}

describe('photo zoom math', () => {
    it('keeps the focal point still and stops at the scale limits', () => {
        const fitted = PhotoZoom.fit();
        const zoomed = PhotoZoom.zoomAt(fitted, 2, 30, -12, 400, 300);
        expect(screenAt(zoomed, 30, -12)).toEqual(screenAt(fitted, 30, -12));

        const closer = PhotoZoom.zoomAt(zoomed, 4, 30, -12, 400, 300);
        expect(screenAt(closer, 30, -12)).toEqual({ x: 30, y: -12 });
        expect(PhotoZoom.zoomAt(fitted, 9, 0, 0, 400, 300).scale).toBe(4);
        expect(PhotoZoom.zoomAt(fitted, 0.1, 0, 0, 400, 300)).toEqual(fitted);
        expect(PhotoZoom.isZoomed(fitted)).toBe(false);
        expect(PhotoZoom.isZoomed(zoomed)).toBe(true);
    });

    it('clamps a pan to the magnified edges', () => {
        expect(PhotoZoom.pan({ scale: 3, x: 0, y: 0 }, 500, -500, 200, 100)).toEqual({
            scale: 3,
            x: 200,
            y: -100,
        });
        expect(PhotoZoom.clampPan(5, 5, 1, 200, 100)).toEqual({ x: 0, y: 0 });
    });

    it('toggles between fit and the double-tap scale', () => {
        const fitted = PhotoZoom.fit();
        const tapped = PhotoZoom.toggle(fitted, 10, 10, 200, 100);
        expect(tapped.scale).toBe(2.5);
        expect(PhotoZoom.toggle(tapped, 10, 10, 200, 100)).toEqual(fitted);
    });

    it('scales a pinch from its start and follows the midpoint', () => {
        const pinched = PhotoZoom.pinch(PhotoZoom.fit(), 100, 200, 12, -4, 0, 0, 400, 300);
        expect(pinched).toEqual({ scale: 2, x: 12, y: -4 });
        expect(PhotoZoom.pinch({ scale: 2, x: 0, y: 0 }, 100, 10, 40, 40, 0, 0, 400, 300)).toEqual(
            PhotoZoom.fit(),
        );
    });

    it('treats trackpad scrolls, mouse notches, and ctrl pinches differently', () => {
        expect(PhotoZoom.wheelKind({ deltaY: -8.5 })).toBe('scroll');
        expect(PhotoZoom.wheelKind({ deltaY: 120.4 })).toBe('scroll');
        expect(PhotoZoom.wheelKind({ deltaY: -100 })).toBe('notch');
        expect(PhotoZoom.wheelKind({ deltaY: 3, deltaMode: 1 })).toBe('notch');
        expect(PhotoZoom.wheelKind({ deltaY: -2, ctrlKey: true })).toBe('pinch');
        expect(PhotoZoom.wheelKind({ deltaY: 4, metaKey: true })).toBe('pinch');
        expect(PhotoZoom.wheelKind({ deltaY: 0, ctrlKey: true })).toBe('scroll');
        expect(PhotoZoom.wheelKind(null)).toBe('scroll');

        expect(PhotoZoom.wheelScale(1, -100, 'notch')).toBe(1.25);
        expect(PhotoZoom.wheelScale(1, 100, 'notch')).toBe(1);
        expect(PhotoZoom.wheelScale(1, -480, 'pinch')).toBe(4);
        expect(PhotoZoom.wheelScale(2, -8, 'scroll')).toBe(2);
        expect(PhotoZoom.wheelScale(4, -100, 'notch')).toBe(4);
    });

    it('inverts the transformed box and writes a stable transform', () => {
        const layout = PhotoZoom.layoutBox(
            { left: 100, top: 50, width: 400, height: 200 },
            { scale: 2, x: 10, y: -4 },
        );
        expect(layout).toEqual({ width: 200, height: 100, cx: 290, cy: 154 });
        expect(PhotoZoom.focal(300, 160, layout)).toEqual({ x: 10, y: 6 });
        expect(PhotoZoom.transform(PhotoZoom.fit())).toBe('none');
        expect(PhotoZoom.transform({ scale: 2.5, x: 1.2, y: -3.456 })).toBe(
            'translate(1.2px, -3.46px) scale(2.5)',
        );
    });

    it('does not use the globe altitude controller', () => {
        const source = readFileSync(join(repoRoot, 'js/photoZoom.js'), 'utf8');
        expect(source).not.toContain('GlobeDetail');
        expect(source).not.toContain('nextAltitudeGoal');
    });
});
