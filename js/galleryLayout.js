/**
 * Layout maths for the gallery, shared by both display modes.
 *
 * Grid keeps every tile at 4:3 and lets CSS grid place them. Masonry keeps
 * each photo's real aspect ratio and returns explicit rectangles, which the
 * renderer applies as absolute positions. Both use the same column count and
 * gap so switching modes never changes the rhythm of the page.
 */

const GRID_ASPECT = 4 / 3;
const DESKTOP_GAPS = { 1: 30, 2: 25, 3: 22, 4: 20, 5: 18, 6: 15 };

// Keeps a single very tall or very wide frame from wrecking a column.
const MIN_ASPECT = 0.5;
const MAX_ASPECT = 2.4;

const GalleryLayout = {
    GRID_ASPECT,

    /**
     * Column count and gap for the current viewport. Below the desktop
     * breakpoint the column count is derived from a minimum tile width, so
     * the requested count only applies on desktop.
     */
    metrics(containerWidth, requestedColumns) {
        const width = Math.max(1, containerWidth);
        let columns;
        let gap;

        if (window.innerWidth <= 480) {
            gap = 10;
            columns = Math.max(1, Math.floor((width + gap) / (120 + gap)));
        } else if (window.innerWidth <= 768) {
            gap = 15;
            columns = Math.max(1, Math.floor((width + gap) / (150 + gap)));
        } else {
            columns = requestedColumns;
            gap = DESKTOP_GAPS[requestedColumns] || 15;
        }

        const columnWidth = Math.max(1, (width - gap * Math.max(columns - 1, 0)) / columns);
        return { columns, gap, columnWidth };
    },

    clampAspect(ratio) {
        const value = Number(ratio);
        if (!Number.isFinite(value) || value <= 0) {
            return GRID_ASPECT;
        }
        return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, value));
    },

    /**
     * Uniform 4:3 rows. Row geometry is constant, so the renderer can map a
     * scroll offset straight to a row index without measuring anything.
     */
    grid(imageCount, { columns, gap, columnWidth }) {
        const rowHeight = columnWidth / GRID_ASPECT;
        const rowSpan = rowHeight + gap;
        const rows = Math.ceil(imageCount / columns);

        return {
            mode: 'grid',
            columns,
            gap,
            columnWidth,
            rowHeight,
            rowSpan,
            rows,
            totalHeight: rows > 0 ? rows * rowSpan - gap : 0
        };
    },

    /**
     * Column-balanced masonry: each photo goes to the shortest column so far.
     * Returns a rectangle per image plus the overall height.
     */
    masonry(images, { columns, gap, columnWidth }) {
        const columnHeights = new Array(columns).fill(0);
        const rects = new Array(images.length);

        for (let i = 0; i < images.length; i++) {
            let target = 0;
            for (let c = 1; c < columns; c++) {
                if (columnHeights[c] < columnHeights[target] - 0.5) {
                    target = c;
                }
            }

            const aspect = this.clampAspect(images[i]?.aspectRatio);
            const height = columnWidth / aspect;
            const top = columnHeights[target];

            rects[i] = {
                left: target * (columnWidth + gap),
                top,
                width: columnWidth,
                height,
                column: target
            };

            columnHeights[target] = top + height + gap;
        }

        const tallest = columnHeights.length ? Math.max(...columnHeights) : 0;

        return {
            mode: 'masonry',
            columns,
            gap,
            columnWidth,
            rects,
            totalHeight: Math.max(0, tallest - gap)
        };
    },

    /**
     * Phone in "desktop site" mode: the layout viewport is wide enough for
     * 5–6 columns, but the device is still a coarse-pointer handset.
     */
    isConstrainedViewport(win = typeof window !== 'undefined' ? window : null) {
        if (!win) {
            return false;
        }
        const screenWidth = Number(win.screen?.width) || 0;
        const layoutWidth = Number(win.innerWidth) || 0;
        let coarse = false;
        try {
            coarse = Boolean(win.matchMedia?.('(pointer: coarse)')?.matches);
        } catch {
            coarse = false;
        }
        return Boolean(coarse || (layoutWidth >= 769 && screenWidth > 0 && screenWidth <= 600));
    },

    /**
     * Extra pixels above and below the viewport to keep mounted. A full
     * viewport of overscan at 5–6 columns on a tall phone attaches the
     * entire collection and stalls decode + layout animation.
     */
    overscanPixels({ rowSpan, viewportHeight, columns, constrained = false } = {}) {
        const row = Math.max(1, Number(rowSpan) || 1);
        const view = Math.max(1, Number(viewportHeight) || 1);
        const count = Math.max(1, Number(columns) || 1);
        if (constrained && count >= 5) {
            return row * 2;
        }
        if (constrained && count >= 4) {
            return row * 3;
        }
        return row * Math.min(4, Math.max(2, Math.ceil(view / row)));
    },

    rectIntersectsBand(rect, top, bottom) {
        if (!rect) {
            return false;
        }
        const height = Number(rect.height) || 0;
        const y = Number(rect.top) || 0;
        return y < bottom && y + height > top;
    },

    /**
     * Contiguous index range covering a scroll window. Masonry tops are not
     * strictly monotonic in index, so the bounds are taken as the min and max
     * index of everything that intersects the window rather than the first
     * and last hit.
     */
    rangeForViewport(layout, imageCount, windowTop, windowBottom) {
        if (imageCount === 0) {
            return { startIndex: 0, endIndex: 0 };
        }

        if (layout.mode === 'grid') {
            const startRow = Math.max(0, Math.floor(windowTop / layout.rowSpan));
            const endRow = Math.min(
                layout.rows - 1,
                Math.max(startRow, Math.floor(windowBottom / layout.rowSpan))
            );
            return {
                startIndex: startRow * layout.columns,
                endIndex: Math.min(imageCount, (endRow + 1) * layout.columns)
            };
        }

        let start = -1;
        let end = -1;
        for (let i = 0; i < layout.rects.length; i++) {
            const rect = layout.rects[i];
            if (!rect) continue;
            if (rect.top + rect.height < windowTop || rect.top > windowBottom) {
                continue;
            }
            if (start === -1) start = i;
            end = i;
        }

        if (start === -1) {
            return { startIndex: 0, endIndex: 0 };
        }
        return { startIndex: start, endIndex: Math.min(imageCount, end + 1) };
    }
};

if (typeof window !== 'undefined') {
    window.GalleryLayout = GalleryLayout;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GalleryLayout;
}
