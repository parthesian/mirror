/**
 * Chronological vs randomized gallery view.
 *
 * Randomize is a view, not a new feed: the API stays chronological so
 * cursors and filters keep working. The timeline is hidden because month
 * ticks would lie about a shuffled grid. Hover prefetch is unchanged
 * because it is bound to mounted tiles, not to sort order.
 */
class ViewMode {
    constructor(imageService, gallery, timeline) {
        this.imageService = imageService;
        this.gallery = gallery;
        this.timeline = timeline;
        this.button = document.getElementById('randomize-btn');
        this.isTransitioning = false;
        this.pendingMode = null;
        this.syncDocument();
        this.bindEvents();
    }

    static readStoredMode() {
        return (window.GalleryOrder && window.GalleryOrder.readStoredMode)
            ? window.GalleryOrder.readStoredMode()
            : 'chrono';
    }

    get mode() {
        return this.imageService?.viewMode === 'random' ? 'random' : 'chrono';
    }

    bindEvents() {
        this.button?.addEventListener('click', () => {
            this.toggle();
        });

        document.addEventListener('keydown', (event) => {
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
                return;
            }
            if (window.app?.modal?.isModalOpen()) {
                return;
            }
            if (event.key === 'r' || event.key === 'R') {
                if (event.metaKey || event.ctrlKey || event.altKey) {
                    return;
                }
                event.preventDefault();
                this.toggle();
            }
        });
    }

    toggle() {
        void this.setMode(this.mode === 'random' ? 'chrono' : 'random');
    }

    async setMode(mode, options = {}) {
        const next = mode === 'random' ? 'random' : 'chrono';
        const refresh = options.refresh !== false;
        if (this.isTransitioning) {
            this.pendingMode = next;
            return;
        }
        const previousImages = this.imageService.images.slice();
        const changed = this.imageService.setViewMode(next);

        this.store(next);
        this.syncButton();

        if (!refresh || !this.gallery) {
            this.syncDocument();
            return;
        }
        if (!changed && options.forceRefresh !== true) {
            this.syncDocument();
            return;
        }

        this.isTransitioning = true;
        try {
            // Start the timeline slide with the first flap so the rail does
            // not sit still and then snap after the board finishes.
            if (next === 'random') {
                document.body.classList.add('view-random');
                this.timeline?.slideAway();
            } else {
                document.body.classList.remove('view-random');
                this.timeline?.slideIn();
            }

            if (typeof this.gallery.transitionToNewOrder === 'function') {
                await this.gallery.transitionToNewOrder(previousImages);
            } else {
                this.gallery.cachedLayout = null;
                this.gallery.clearGallery();
                this.gallery.scheduleRefresh(true);
            }
            this.syncDocument();
            document.dispatchEvent(new CustomEvent('galleryUpdated'));
            document.dispatchEvent(new CustomEvent('viewModeChange', {
                detail: { mode: next }
            }));
        } finally {
            this.isTransitioning = false;
            this.syncButton();
            const queued = this.pendingMode;
            this.pendingMode = null;
            if (queued && queued !== this.mode) {
                void this.setMode(queued);
            }
        }
    }

    syncButton() {
        const isRandom = this.mode === 'random';
        if (!this.button) {
            return;
        }

        this.button.classList.toggle('is-active', isRandom);
        this.button.setAttribute('aria-pressed', isRandom ? 'true' : 'false');
        this.button.setAttribute(
            'aria-label',
            isRandom ? 'Restore chronological gallery' : 'Randomize gallery order'
        );
        this.button.setAttribute(
            'title',
            isRandom ? 'Restore timeline order' : 'Randomize gallery'
        );
    }

    syncDocument() {
        const isRandom = this.mode === 'random';
        document.body.classList.toggle('view-random', isRandom);
        this.syncButton();
        if (typeof this.timeline?.settleAfterSlide === 'function') {
            this.timeline.settleAfterSlide(isRandom);
            return;
        }
        this.timeline?.updateSidebarPosition();
    }

    store(mode) {
        try {
            localStorage.setItem('mirror-view-mode', mode);
        } catch (error) {
            // Ignore quota / private-mode failures.
        }
    }
}

window.ViewMode = ViewMode;
