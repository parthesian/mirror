/**
 * Zoom math for the photo viewer.
 *
 * The viewer scales the photo. It does not zoom the page, and it does not
 * use the globe explorer's altitude controller. Pinch and a mouse wheel
 * step the photo directly. A double-tap eases to a fixed magnification
 * because that jump has no stream of events to follow.
 *
 * Classic script. Sets window.PhotoZoom.
 *
 * @param {typeof globalThis} root
 */
(function attachPhotoZoom(root) {
    const MIN_SCALE = 1;
    const MAX_SCALE = 4;
    const TAP_SCALE = 2.5;
    /** A mouse notch below this pixel size is treated as a trackpad scroll. */
    const NOTCH_PX = 100;

    /**
     * @typedef {{ scale: number, x: number, y: number }} PhotoZoomState
     * @typedef {{ left: number, top: number, width: number, height: number }} PhotoZoomBox
     * @typedef {{ width: number, height: number, cx: number, cy: number }} PhotoZoomLayout
     */

    /**
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    /**
     * @param {number} value
     * @returns {number}
     */
    function roundPx(value) {
        return Math.round(value * 100) / 100;
    }

    /**
     * @param {number} value
     * @returns {number}
     */
    function roundScale(value) {
        return Math.round(value * 1000) / 1000;
    }

    /**
     * @returns {PhotoZoomState}
     */
    function fit() {
        return { scale: 1, x: 0, y: 0 };
    }

    /**
     * @param {PhotoZoomState} state
     * @returns {boolean}
     */
    function isZoomed(state) {
        return Boolean(state) && state.scale > 1.01;
    }

    /**
     * @param {number} scale
     * @param {number} viewW
     * @param {number} viewH
     * @returns {{ maxX: number, maxY: number }}
     */
    function panLimits(scale, viewW, viewH) {
        return {
            maxX: Math.max(0, (viewW * (scale - 1)) / 2),
            maxY: Math.max(0, (viewH * (scale - 1)) / 2)
        };
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} scale
     * @param {number} viewW
     * @param {number} viewH
     * @returns {{ x: number, y: number }}
     */
    function clampPan(x, y, scale, viewW, viewH) {
        const limits = panLimits(scale, viewW, viewH);
        return {
            x: clamp(x, -limits.maxX, limits.maxX),
            y: clamp(y, -limits.maxY, limits.maxY)
        };
    }

    /**
     * Keep the point under (focalX, focalY) fixed. Coordinates are CSS pixels
     * relative to the unscaled photo's center. translate() is applied after
     * scale(), so pan is in screen pixels.
     *
     * @param {PhotoZoomState} state
     * @param {number} nextScale
     * @param {number} focalX
     * @param {number} focalY
     * @param {number} viewW
     * @param {number} viewH
     * @returns {PhotoZoomState}
     */
    function zoomAt(state, nextScale, focalX, focalY, viewW, viewH) {
        const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
        const from = state.scale > 0 ? state.scale : 1;
        const gain = scale / from;
        const pan = clampPan(
            focalX - (focalX - state.x) * gain,
            focalY - (focalY - state.y) * gain,
            scale,
            viewW,
            viewH
        );
        if (scale <= 1.001) {
            return fit();
        }
        return { scale, x: pan.x, y: pan.y };
    }

    /**
     * @param {PhotoZoomState} state
     * @param {number} focalX
     * @param {number} focalY
     * @param {number} viewW
     * @param {number} viewH
     * @returns {PhotoZoomState}
     */
    function toggle(state, focalX, focalY, viewW, viewH) {
        if (isZoomed(state)) {
            return fit();
        }
        return zoomAt(state, TAP_SCALE, focalX, focalY, viewW, viewH);
    }

    /**
     * @param {PhotoZoomState} state
     * @param {number} dx
     * @param {number} dy
     * @param {number} viewW
     * @param {number} viewH
     * @returns {PhotoZoomState}
     */
    function pan(state, dx, dy, viewW, viewH) {
        const moved = clampPan(state.x + dx, state.y + dy, state.scale, viewW, viewH);
        return { scale: state.scale, x: moved.x, y: moved.y };
    }

    /**
     * Scale from the gesture's starting state, then follow the midpoint so
     * moving both fingers pans.
     *
     * @param {PhotoZoomState} start
     * @param {number} span0
     * @param {number} span1
     * @param {number} midDx
     * @param {number} midDy
     * @param {number} focalX
     * @param {number} focalY
     * @param {number} viewW
     * @param {number} viewH
     * @returns {PhotoZoomState}
     */
    function pinch(start, span0, span1, midDx, midDy, focalX, focalY, viewW, viewH) {
        const base = span0 > 0 ? span0 : 1;
        const scale = clamp(start.scale * (span1 / base), MIN_SCALE, MAX_SCALE);
        const zoomed = zoomAt(start, scale, focalX, focalY, viewW, viewH);
        const moved = clampPan(zoomed.x + midDx, zoomed.y + midDy, scale, viewW, viewH);
        if (scale <= 1.001) {
            return fit();
        }
        return { scale, x: moved.x, y: moved.y };
    }

    /**
     * Mouse wheels report large integer pixels or line mode. Trackpad scrolls
     * report small fractional pixels. Trackpad pinch arrives as ctrl/meta.
     *
     * @param {{ deltaY?: number, deltaMode?: number, ctrlKey?: boolean, metaKey?: boolean } | null | undefined} event
     * @returns {'pinch' | 'notch' | 'scroll'}
     */
    function wheelKind(event) {
        const deltaY = Number(event && event.deltaY) || 0;
        if (!deltaY) {
            return 'scroll';
        }
        if (event && (event.ctrlKey || event.metaKey)) {
            return 'pinch';
        }
        const deltaMode = Number(event && event.deltaMode) || 0;
        if (deltaMode === 1 || deltaMode === 2) {
            return 'notch';
        }
        if (Math.abs(deltaY) >= NOTCH_PX && Number.isInteger(deltaY)) {
            return 'notch';
        }
        return 'scroll';
    }

    /**
     * @param {number} scale
     * @param {number} deltaY
     * @param {'pinch' | 'notch' | 'scroll'} kind
     * @returns {number}
     */
    function wheelScale(scale, deltaY, kind) {
        switch (kind) {
            case 'pinch':
                return clamp(scale * Math.exp(-deltaY * 0.01), MIN_SCALE, MAX_SCALE);
            case 'notch':
                return clamp(scale * (deltaY > 0 ? 0.8 : 1.25), MIN_SCALE, MAX_SCALE);
            case 'scroll':
                return scale;
            default: {
                /** @type {never} */
                const unexpected = kind;
                void unexpected;
                return scale;
            }
        }
    }

    /**
     * Undo a center-origin translate-then-scale so later gestures use the
     * photo's layout box, not the transformed border box.
     *
     * @param {PhotoZoomBox} visual
     * @param {PhotoZoomState} state
     * @returns {PhotoZoomLayout}
     */
    function layoutBox(visual, state) {
        const scale = state.scale > 0 ? state.scale : 1;
        const width = visual.width / scale;
        const height = visual.height / scale;
        return {
            width,
            height,
            cx: visual.left + visual.width / 2 - state.x,
            cy: visual.top + visual.height / 2 - state.y
        };
    }

    /**
     * @param {number} clientX
     * @param {number} clientY
     * @param {PhotoZoomLayout} layout
     * @returns {{ x: number, y: number }}
     */
    function focal(clientX, clientY, layout) {
        return {
            x: clientX - layout.cx,
            y: clientY - layout.cy
        };
    }

    /**
     * @param {PhotoZoomState} state
     * @returns {string}
     */
    function transform(state) {
        if (!isZoomed(state)) {
            return 'none';
        }
        return `translate(${roundPx(state.x)}px, ${roundPx(state.y)}px) scale(${roundScale(state.scale)})`;
    }

    const PhotoZoom = {
        MIN_SCALE,
        MAX_SCALE,
        TAP_SCALE,
        NOTCH_PX,
        fit,
        isZoomed,
        clampPan,
        zoomAt,
        toggle,
        pan,
        pinch,
        wheelKind,
        wheelScale,
        layoutBox,
        focal,
        transform
    };

    /** @type {Record<string, unknown>} */ (root).PhotoZoom = PhotoZoom;
    const moduleRef = /** @type {{ exports?: unknown } | undefined} */ (
        typeof module !== 'undefined' ? module : undefined
    );
    if (moduleRef) {
        moduleRef.exports = PhotoZoom;
    }
})(/** @type {typeof globalThis} */ (typeof window !== 'undefined' ? window : globalThis));
