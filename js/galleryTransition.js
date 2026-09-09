/**
 * Rules for keeping the page surface still while a gallery reload or
 * masonry pass is still in flight. The tile animations can run; the
 * document must not collapse, grow, and collapse again around them.
 */
const GalleryTransition = {
    ASPECT_REFLOW_MS: 180,
    VISIBLE_ASPECT_WAIT_MS: 240,
    HEIGHT_SNAP_PX: 4,
    SETTLING_CLASS: 'is-gallery-settling',

    shouldKeepSurface(mountedCount) {
        return Number(mountedCount) > 0;
    },

    heightDeltaNeedsAnimation(previous, next) {
        return Math.abs((Number(previous) || 0) - (Number(next) || 0)) > this.HEIGHT_SNAP_PX;
    },

    lockDocumentScroll(doc = typeof document !== 'undefined' ? document : null) {
        doc?.documentElement?.classList.add(this.SETTLING_CLASS);
    },

    unlockDocumentScroll(doc = typeof document !== 'undefined' ? document : null) {
        doc?.documentElement?.classList.remove(this.SETTLING_CLASS);
    },

    contentHeight(topSpacer, windowGrid, bottomSpacer) {
        return (topSpacer?.offsetHeight || 0)
            + (windowGrid?.offsetHeight || 0)
            + (bottomSpacer?.offsetHeight || 0);
    }
};

if (typeof window !== 'undefined') {
    window.GalleryTransition = GalleryTransition;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GalleryTransition;
}
