/**
 * Gallery display-order helpers.
 *
 * Chronology stays the source of truth for pagination and timeline jumps.
 * Randomize only remaps the visible sequence so infinite-scroll cursors,
 * hover prefetch, and modal neighbors keep working against the same IDs.
 */
(function attachGalleryOrder(root) {
    function readStoredMode() {
        try {
            const stored = root.localStorage?.getItem('mirror-view-mode');
            if (stored === 'random' || stored === 'chrono') {
                return stored;
            }
        } catch (error) {
            // Private mode / blocked storage should not block first paint.
        }
        return 'chrono';
    }

    function shuffleIds(ids) {
        const next = Array.isArray(ids) ? ids.slice() : [];
        for (let i = next.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const current = next[i];
            next[i] = next[j];
            next[j] = current;
        }
        return next;
    }

    /**
     * Build the visible ID list without reshuffling photos the user already saw.
     * Fresh fetches reshuffle; pages loaded later append a shuffled tail so
     * already-mounted tiles do not jump under the viewport.
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
        root.GalleryOrder = GalleryOrder;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GalleryOrder;
    }
})(typeof window !== 'undefined' ? window : globalThis);
