/**
 * @param {typeof globalThis} root
 */
(function attachGalleryOrder(root) {
    /**
     * @returns {'chrono' | 'random'}
     */
    function readStoredMode() {
        try {
            const stored = root.localStorage?.getItem('mirror-view-mode');
            if (stored === 'random' || stored === 'chrono') {
                return stored;
            }
        } catch {
            return 'chrono';
        }
        return 'chrono';
    }

    /**
     * @param {string[]} ids
     * @returns {string[]}
     */
    function shuffleIds(ids) {
        const next = Array.isArray(ids) ? ids.slice() : [];
        for (let i = next.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const current = next[i];
            const swapped = next[j];
            if (current === undefined || swapped === undefined) {
                continue;
            }
            next[i] = swapped;
            next[j] = current;
        }
        return next;
    }

    /**
     * @param {{ chronoIds?: string[], currentOrder?: string[], mode?: 'chrono' | 'random', reshuffle?: boolean }} [options]
     * @returns {string[]}
     */
    function buildDisplayOrder(options = {}) {
        const chronoIds = Array.isArray(options.chronoIds) ? options.chronoIds : [];
        const currentOrder = Array.isArray(options.currentOrder) ? options.currentOrder : [];
        const mode = options.mode === 'random' ? 'random' : 'chrono';
        const reshuffle = Boolean(options.reshuffle);

        if (mode !== 'random') {
            return chronoIds.slice();
        }

        if (reshuffle || currentOrder.length === 0) {
            return shuffleIds(chronoIds);
        }

        const chronoSet = new Set(chronoIds);
        const kept = currentOrder.filter((id) => chronoSet.has(id));
        const keptSet = new Set(kept);
        const incoming = chronoIds.filter((id) => !keptSet.has(id));
        return kept.concat(shuffleIds(incoming));
    }

    const GalleryOrder = { readStoredMode, shuffleIds, buildDisplayOrder };

    if (root) {
        Object.assign(root, { GalleryOrder });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GalleryOrder;
    }
})(globalThis);
