/**
 * Gallery - windowed grid/masonry that only mounts viewport-near images.
 */
class Gallery {
    constructor(imageService, imagePreloader) {
        this.imageService = imageService;
        this.galleryContainer = document.getElementById('gallery-container');
        this.loadingElement = document.getElementById('loading');
        this.scrollLoadingElement = document.getElementById('scroll-loading');
        this.errorElement = document.getElementById('error-message');

        this.minColumns = 2;
        this.maxColumns = 6;
        this.columns = 4;
        this.layoutMode = 'grid';

        this.imagePreloader = imagePreloader || new ImagePreloader();
        this.globeService = new GlobeService();
        this.globePreloaded = false;

        this.keyScrollRaf = null;
        this.keyScrollDirection = 0;
        this.keyScrollSpeed = 0;

        this.renderState = {
            startIndex: -1,
            endIndex: -1,
            columns: 0,
            mode: ''
        };
        this.mountedItems = new Map();
        this.isLoadingMore = false;
        this.isMorphing = false;
        this.morphFreeze = false;
        this.renderQueued = false;
        this.forceRenderQueued = false;
        this.cachedLayout = null;
        this.pendingAspectRefresh = false;

        this.topSpacer = null;
        this.windowGrid = null;
        this.bottomSpacer = null;

        this.init();
    }

    init() {
        this.loadColumnPreference();
        this.loadLayoutPreference();
        this.ensureWindowStructure();
        this.bindEvents();
        this.applyLayoutModeClass();
        this.loadImages();
    }

    bindEvents() {
        document.addEventListener('keydown', (event) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                return;
            }
            if (window.app && window.app.modal && window.app.modal.isModalOpen()) {
                this.releaseKeyScroll();
                return;
            }
            switch (event.key) {
                case '-':
                    event.preventDefault();
                    if (!event.shiftKey) this.zoomOut();
                    break;
                case '=':
                case '+':
                    event.preventDefault();
                    this.zoomIn();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.startKeyScroll(-1);
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    this.startKeyScroll(1);
                    break;
                default:
                    break;
            }
        });

        document.addEventListener('keyup', (event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                this.releaseKeyScroll();
            }
        });

        document.addEventListener('photoUploaded', () => this.loadImages());

        window.addEventListener('scroll', () => this.scheduleRefresh(), { passive: true });

        window.addEventListener('resize', this.throttle(() => {
            const prevColumns = this.cachedLayout?.columns;
            this.cachedLayout = null;
            const columnsChanged = prevColumns != null && this.getLayout().columns !== prevColumns;
            this.scheduleRefresh(columnsChanged);
            this.checkIfNeedsMoreContent();
        }, 200));
    }

    ensureWindowStructure() {
        if (this.topSpacer && this.windowGrid && this.bottomSpacer) {
            return;
        }

        this.galleryContainer.innerHTML = '';

        this.topSpacer = document.createElement('div');
        this.topSpacer.className = 'gallery-spacer gallery-spacer-top';
        this.topSpacer.setAttribute('aria-hidden', 'true');

        this.windowGrid = document.createElement('div');
        this.windowGrid.className = 'gallery-window';

        this.bottomSpacer = document.createElement('div');
        this.bottomSpacer.className = 'gallery-spacer gallery-spacer-bottom';
        this.bottomSpacer.setAttribute('aria-hidden', 'true');

        this.galleryContainer.appendChild(this.topSpacer);
        this.galleryContainer.appendChild(this.windowGrid);
        this.galleryContainer.appendChild(this.bottomSpacer);
    }

    scheduleRefresh(force = false) {
        this.forceRenderQueued = this.forceRenderQueued || force;
        if (this.renderQueued) {
            return;
        }
        this.renderQueued = true;
        requestAnimationFrame(() => {
            const shouldForce = this.forceRenderQueued;
            this.renderQueued = false;
            this.forceRenderQueued = false;
            if (this.isMorphing) {
                return;
            }
            this.renderVisibleWindow(shouldForce);
            this.checkInfiniteScroll();
        });
    }

    checkInfiniteScroll() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const threshold = Math.max(1200, windowHeight * 2);

        if (scrollTop + windowHeight >= documentHeight - threshold && this.imageService.hasMore && !this.isLoadingMore) {
            this.loadMoreImages();
        }
    }

    checkIfNeedsMoreContent() {
        if (this.imageService.isLoading || this.isLoadingMore) {
            return;
        }
        if (document.documentElement.scrollHeight <= window.innerHeight + 50 && this.imageService.hasMore) {
            this.loadMoreImages();
        }
    }

    throttle(func, limit) {
        let timer = null;
        return (...args) => {
            if (timer) return;
            func.apply(this, args);
            timer = window.setTimeout(() => { timer = null; }, limit);
        };
    }

    async loadImages() {
        try {
            this.showLoading();
            this.hideError();
            this.clearGallery();

            const images = await this.imageService.fetchImages();
            this.hideLoading();

            if (!images || images.length === 0) {
                this.showEmptyState();
                return;
            }

            this.cachedLayout = null;
            this.scheduleRefresh(true);
            this.triggerGlobePreloading(images);
            document.dispatchEvent(new CustomEvent('galleryUpdated'));

            window.setTimeout(() => this.checkIfNeedsMoreContent(), 60);
        } catch (error) {
            console.error('Error loading images:', error);
            this.hideLoading();
            this.showError();
        }
    }

    async loadMoreImages() {
        if (this.isLoadingMore || this.imageService.isLoading || !this.imageService.hasMore) {
            return;
        }

        this.isLoadingMore = true;
        this.showScrollLoading();

        try {
            const newImages = await this.imageService.loadMorePhotos();
            if (newImages.length > 0) {
                this.cachedLayout = null;
                this.scheduleRefresh(true);
                document.dispatchEvent(new CustomEvent('galleryUpdated'));
                window.setTimeout(() => this.checkIfNeedsMoreContent(), 60);
            }
        } catch (error) {
            console.error('Error loading more images:', error);
        } finally {
            this.hideScrollLoading();
            this.isLoadingMore = false;
        }
    }

    // ── layout metrics (cached between scroll ticks) ──

    get isMasonry() {
        return this.layoutMode === 'masonry';
    }

    getLayout() {
        if (this.cachedLayout) {
            return this.cachedLayout;
        }

        const containerWidth = this.galleryContainer.clientWidth || window.innerWidth;
        const images = this.imageService.images || [];
        const metrics = GalleryLayout.metrics(containerWidth, this.columns);

        const layout = this.isMasonry
            ? GalleryLayout.masonry(images, metrics)
            : GalleryLayout.grid(images.length, metrics);

        const containerRect = this.galleryContainer.getBoundingClientRect();
        const paddingTop = parseFloat(getComputedStyle(this.galleryContainer).paddingTop) || 0;
        layout.contentTop = containerRect.top + (window.pageYOffset || document.documentElement.scrollTop) + paddingTop;

        const referenceRow = this.isMasonry
            ? metrics.columnWidth / GalleryLayout.GRID_ASPECT + metrics.gap
            : layout.rowSpan;
        layout.overscan = Math.max(window.innerHeight, referenceRow * 2);

        this.cachedLayout = layout;
        return layout;
    }

    /**
     * Index range to mount for the current scroll position, in layout space.
     */
    visibleRange(layout, imageCount) {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowTop = scrollTop - layout.contentTop - layout.overscan;
        const windowBottom = scrollTop - layout.contentTop + window.innerHeight + layout.overscan;
        return GalleryLayout.rangeForViewport(
            layout,
            imageCount,
            Math.max(0, windowTop),
            Math.max(0, windowBottom)
        );
    }

    /**
     * Document-space Y of an image, and its inverse. The timeline scrubs by
     * these instead of row arithmetic so it works in masonry too.
     */
    documentYForIndex(index) {
        const layout = this.getLayout();
        if (layout.mode === 'masonry') {
            const rect = layout.rects[index];
            return layout.contentTop + (rect ? rect.top : 0);
        }
        const row = Math.floor(index / layout.columns);
        return layout.contentTop + row * layout.rowSpan;
    }

    indexAtDocumentY(y) {
        const layout = this.getLayout();
        const local = Math.max(0, y - layout.contentTop);
        const count = (this.imageService.images || []).length;
        if (count === 0) return 0;

        if (layout.mode === 'masonry') {
            let best = 0;
            let bestTop = -Infinity;
            for (let i = 0; i < layout.rects.length; i++) {
                const rect = layout.rects[i];
                if (!rect || rect.top > local) continue;
                if (rect.top > bestTop) {
                    bestTop = rect.top;
                    best = i;
                }
            }
            return Math.min(count - 1, best);
        }

        const row = Math.max(0, Math.floor(local / layout.rowSpan));
        return Math.min(count - 1, row * layout.columns);
    }

    // ── core renderer ──

    renderVisibleWindow(force = false, overrideRange = null) {
        const images = this.imageService.images;
        this.ensureWindowStructure();

        if (!images || images.length === 0) {
            this.showEmptyState();
            return;
        }

        const layout = this.getLayout();
        const range = overrideRange || this.visibleRange(layout, images.length);
        const { startIndex, endIndex } = range;

        const indicesChanged = startIndex !== this.renderState.startIndex ||
            endIndex !== this.renderState.endIndex;
        const shapeChanged = layout.columns !== this.renderState.columns ||
            layout.mode !== this.renderState.mode;

        this.applyContainerMetrics(layout, startIndex, endIndex, images.length);

        if (!force && !indicesChanged && !shapeChanged) {
            return;
        }

        this.syncNodes(images, startIndex, endIndex, layout);

        this.renderState = {
            startIndex,
            endIndex,
            columns: layout.columns,
            mode: layout.mode
        };
        this.prefetchNearby(images, endIndex, layout.columns);
    }

    /**
     * Grid holds its scroll height with spacers above and below the mounted
     * slice; masonry positions tiles absolutely, so the window itself carries
     * the full height instead.
     */
    applyContainerMetrics(layout, startIndex, endIndex, imageCount) {
        if (layout.mode === 'masonry') {
            this.windowGrid.classList.add('is-masonry');
            this.windowGrid.style.gridTemplateColumns = '';
            this.windowGrid.style.gap = '';
            this.windowGrid.style.height = `${layout.totalHeight}px`;
            this.topSpacer.style.height = '0px';
            this.bottomSpacer.style.height = '0px';
            return;
        }

        this.windowGrid.classList.remove('is-masonry');
        this.windowGrid.style.height = '';
        this.windowGrid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
        this.windowGrid.style.gap = `${layout.gap}px`;

        const startRow = Math.floor(startIndex / layout.columns);
        const endRow = Math.ceil(endIndex / layout.columns) - 1;
        const bottomRows = Math.max(0, layout.rows - endRow - 1);
        this.topSpacer.style.height = `${startRow * layout.rowSpan}px`;
        this.bottomSpacer.style.height = `${bottomRows * layout.rowSpan}px`;
    }

    /**
     * Reconcile the mounted slice against the desired index range, keeping
     * DOM order equal to index order because grid placement depends on it.
     */
    syncNodes(images, startIndex, endIndex, layout) {
        const desired = [];
        for (let i = startIndex; i < endIndex; i++) {
            if (images[i]) desired.push(i);
        }

        const wanted = new Set(desired.map((i) => images[i].id));
        for (const child of Array.from(this.windowGrid.children)) {
            if (!wanted.has(child.dataset.imageId)) {
                child.remove();
            }
        }

        let cursor = this.windowGrid.firstElementChild;
        for (const index of desired) {
            const image = images[index];
            const node = this.getOrCreateItem(image, index, layout);
            this.positionItem(node, index, layout);

            if (cursor === node) {
                cursor = node.nextElementSibling;
                continue;
            }
            this.windowGrid.insertBefore(node, cursor);
        }
    }

    positionItem(node, index, layout) {
        if (this.morphFreeze) {
            return;
        }

        if (layout.mode !== 'masonry') {
            node.style.left = '';
            node.style.top = '';
            node.style.width = '';
            node.style.height = '';
            node.style.transform = '';
            node.style.transformOrigin = '';
            node.style.opacity = '';
            return;
        }

        const rect = layout.rects[index];
        if (!rect) return;
        node.style.left = `${rect.left}px`;
        node.style.top = `${rect.top}px`;
        node.style.width = `${rect.width}px`;
        node.style.height = `${rect.height}px`;
        node.style.transform = '';
    }

    // ── item creation ──

    getOrCreateItem(image, absoluteIndex, layout) {
        const existing = this.mountedItems.get(image.id);
        if (existing) {
            return existing;
        }
        return this.createGalleryItem(image, absoluteIndex, layout);
    }

    createGalleryItem(image, absoluteIndex, layout) {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.dataset.imageId = image.id;

        const img = document.createElement('img');
        img.className = 'gallery-item-image';
        img.decoding = 'async';

        item.appendChild(img);

        const url = image.thumbnailUrl;
        const cached = this.imagePreloader.isImageLoaded(url);

        if (cached) {
            img.src = url;
            item.classList.add('loaded', 'instant');
        } else {
            const loadPromise = new Promise((resolve) => {
                img.addEventListener('load', () => {
                    this.imagePreloader.markLoaded(url);
                    item.classList.add('loaded');
                    this.captureNaturalAspect(item.dataset.imageId, img);
                    resolve(img);
                }, { once: true });

                img.addEventListener('error', () => {
                    this.imagePreloader.markFailed(url);
                    img.src = this.getImageFallbackSrc();
                    item.classList.add('loaded');
                    resolve(null);
                }, { once: true });
            });

            this.imagePreloader.registerPending(url, loadPromise);
            img.src = url;
            if (this.isMorphing) {
                item.classList.add('loaded', 'instant');
            }
        }

        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        this.bindItemMetadata(item, image);

        // Read dataset at event time so a flipboard landing rebind stays correct.
        item.addEventListener('click', () => this.openImageModal(item.dataset.imageId));
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openImageModal(item.dataset.imageId);
            }
        });

        let hoverPrefetchTimer = null;
        const clearHoverPrefetch = () => {
            if (hoverPrefetchTimer != null) {
                window.clearTimeout(hoverPrefetchTimer);
                hoverPrefetchTimer = null;
            }
        };
        item.addEventListener('pointerenter', () => {
            clearHoverPrefetch();
            hoverPrefetchTimer = window.setTimeout(() => {
                hoverPrefetchTimer = null;
                const live = this.imageService.getImageById(item.dataset.imageId);
                if (live?.url && live.thumbnailUrl !== live.url) {
                    this.imagePreloader.prefetch([live.url], { concurrency: 1 });
                }
            }, 250);
        });
        item.addEventListener('pointerleave', clearHoverPrefetch);
        item.addEventListener('pointercancel', clearHoverPrefetch);

        this.mountedItems.set(image.id, item);
        return item;
    }

    /**
     * Photos uploaded before dimensions were recorded arrive without a size.
     * The first thumbnail load supplies the real ratio; masonry reflows once
     * on the next frame rather than once per image.
     */
    captureNaturalAspect(imageId, img) {
        if (!this.isMasonry || !imageId) return;
        const image = this.imageService.getImageById(imageId);
        if (!image || image.aspectRatioKnown) return;
        if (!img.naturalWidth || !img.naturalHeight) return;

        image.aspectRatio = img.naturalWidth / img.naturalHeight;
        image.aspectRatioKnown = true;

        if (this.pendingAspectRefresh) return;
        this.pendingAspectRefresh = true;
        requestAnimationFrame(() => {
            this.pendingAspectRefresh = false;
            if (this.isMorphing) return;
            this.cachedLayout = null;
            this.renderVisibleWindow(true);
        });
    }

    getImageFallbackSrc() {
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xNzUgMTI1SDE4NVYxMzVIMTc1VjEyNVoiIGZpbGw9IiM5Q0EzQUYiLz4KPHA+SW1hZ2UgTm90IEZvdW5kPC9wPgo8L3N2Zz4K';
    }

    // ── prefetch ──

    prefetchNearby(images, endIndex, columns) {
        const count = columns * 3;
        const urls = images
            .slice(Math.max(0, endIndex), Math.max(0, endIndex) + count)
            .map((img) => img.thumbnailUrl)
            .filter(Boolean);
        if (urls.length > 0) {
            this.imagePreloader.prefetch(urls, { concurrency: 4 });
        }
    }

    // ── modal ──

    openImageModal(imageId) {
        document.dispatchEvent(new CustomEvent('openModal', { detail: { imageId } }));
    }

    bindItemMetadata(item, image) {
        if (!item || !image) {
            return;
        }
        item.dataset.imageId = image.id;
        const img = item.querySelector('.gallery-item-image');
        const dateLabel = this.imageService.formatTimestamp(image.timestamp);
        if (img) {
            img.alt = image.description ? image.description : `Photo from ${dateLabel}`;
        }
        item.setAttribute(
            'aria-label',
            image.description
                ? `View ${image.description} in fullscreen`
                : `View photo from ${dateLabel} in fullscreen`
        );
    }

    /**
     * Flip visible tiles in place, then retarget the same nodes.
     * Remounting would erase the flaps, so the window is rebound instead.
     */
    async transitionToNewOrder(previousImages) {
        const previous = Array.isArray(previousImages) ? previousImages : [];
        const next = this.imageService.images || [];
        const start = Math.max(0, this.renderState.startIndex);
        const end = this.renderState.endIndex > start ? this.renderState.endIndex : start;
        const nodes = this.windowGrid
            ? Array.from(this.windowGrid.querySelectorAll('.gallery-item'))
            : [];

        if (end > start && nodes.length && window.Flipboard) {
            const thumbCandidates = [...previous, ...next]
                .map((image) => image?.thumbnailUrl)
                .filter(Boolean);
            await window.Flipboard.animateWindow({
                items: nodes,
                previousImages: previous.slice(start, end),
                nextImages: next.slice(start, end),
                preloader: this.imagePreloader,
                thumbCandidates,
                onTileLanded: (item, index, image) => {
                    this.rebindOne(item, image);
                }
            });
            this.rebindMountedWindow(nodes, next.slice(start, end));
            // A shuffle reorders aspect ratios, so masonry has to re-solve.
            if (this.isMasonry) {
                this.cachedLayout = null;
                this.renderVisibleWindow(true);
            }
            this.checkIfNeedsMoreContent();
            return;
        }

        this.cachedLayout = null;
        this.scheduleRefresh(true);
    }

    rebindOne(node, image) {
        if (!node || !image) {
            return;
        }
        this.bindItemMetadata(node, image);
        const img = node.querySelector('.gallery-item-image');
        if (img && image.thumbnailUrl && !this.sameImageUrl(img.src, image.thumbnailUrl)) {
            img.src = image.thumbnailUrl;
        }
        node.classList.add('loaded', 'instant');
        this.mountedItems.set(image.id, node);
    }

    sameImageUrl(left, right) {
        if (!left || !right) {
            return false;
        }
        if (left === right) {
            return true;
        }
        try {
            return new URL(left, window.location.href).href === new URL(right, window.location.href).href;
        } catch (error) {
            return false;
        }
    }

    rebindMountedWindow(nodes, nextImages) {
        this.mountedItems.clear();
        nodes.forEach((node, index) => this.rebindOne(node, nextImages[index]));
    }

    // ── UI state ──

    showLoading() {
        this.loadingElement.classList.remove('hidden');
        this.galleryContainer.classList.add('hidden');
    }

    hideLoading() {
        this.loadingElement.classList.add('hidden');
        this.galleryContainer.classList.remove('hidden');
    }

    showError() {
        this.errorElement.classList.remove('hidden');
        this.galleryContainer.classList.add('hidden');
    }

    hideError() {
        this.errorElement.classList.add('hidden');
    }

    showScrollLoading() {
        if (this.scrollLoadingElement) this.scrollLoadingElement.classList.remove('hidden');
    }

    hideScrollLoading() {
        if (this.scrollLoadingElement) this.scrollLoadingElement.classList.add('hidden');
    }

    clearGallery() {
        this.ensureWindowStructure();
        this.windowGrid.innerHTML = '';
        this.mountedItems.clear();
        this.topSpacer.style.height = '0px';
        this.bottomSpacer.style.height = '0px';
        this.windowGrid.style.height = '';
        this.renderState = { startIndex: -1, endIndex: -1, columns: 0, mode: '' };
    }

    showEmptyState() {
        this.ensureWindowStructure();
        this.windowGrid.classList.remove('is-masonry');
        this.windowGrid.style.height = '';
        this.windowGrid.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 3rem; color: #666;">
                <h3>_______</h3>
            </div>
        `;
        this.topSpacer.style.height = '0px';
        this.bottomSpacer.style.height = '0px';
    }

    getGalleryItems() {
        return this.galleryContainer.querySelectorAll('.gallery-item');
    }

    highlightItem(imageId) {
        this.getGalleryItems().forEach((item) => item.classList.remove('highlighted'));
        const target = this.galleryContainer.querySelector(`[data-image-id="${imageId}"]`);
        if (target) target.classList.add('highlighted');
    }

    removeHighlights() {
        this.getGalleryItems().forEach((item) => item.classList.remove('highlighted'));
    }

    // ── layout mode ──

    applyLayoutModeClass() {
        document.body.classList.toggle('layout-masonry', this.isMasonry);
        document.body.classList.toggle('layout-grid', !this.isMasonry);
    }

    /**
     * Swap grid and masonry with a FLIP morph: capture where every mounted
     * tile is, let the new layout decide where it should be, then animate the
     * gap. The union of both index ranges stays mounted for the duration so
     * no tile pops out mid-flight.
     */
    async setLayoutMode(mode, options = {}) {
        const next = mode === 'masonry' ? 'masonry' : 'grid';
        if (next === this.layoutMode || this.isMorphing) {
            return;
        }

        this.layoutMode = next;
        this.storeLayoutPreference(next);
        this.applyLayoutModeClass();
        this.emitLayoutChange();

        const images = this.imageService.images || [];
        const animate = options.animate !== false && this.shouldAnimateLayout();

        if (!animate) {
            this.cachedLayout = null;
            this.renderVisibleWindow(true);
            return;
        }

        await window.UIAnimation.run(() => this.morphLayout(images));
    }

    shouldAnimateLayout() {
        const images = this.imageService.images || [];
        return images.length > 0
            && !this.prefersReducedMotion()
            && Boolean(this.windowGrid?.querySelector('.gallery-item'));
    }

    prefersReducedMotion() {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    }

    async morphLayout(images) {
        this.isMorphing = true;
        const grid = this.windowGrid;

        try {
            const before = this.captureContentRects();
            const spacerTop = this.windowGrid.classList.contains('is-masonry')
                ? 0
                : (this.topSpacer?.offsetHeight || 0);
            const previousHeight = spacerTop
                + grid.offsetHeight
                + (this.bottomSpacer?.offsetHeight || 0);

            this.cachedLayout = null;
            const layout = this.getLayout();
            const nextRange = this.visibleRange(layout, images.length);
            const prevStart = this.renderState.startIndex >= 0
                ? this.renderState.startIndex
                : nextRange.startIndex;
            const prevEnd = this.renderState.endIndex > prevStart
                ? this.renderState.endIndex
                : nextRange.endIndex;
            const union = {
                startIndex: Math.min(prevStart, nextRange.startIndex),
                endIndex: Math.max(prevEnd, nextRange.endIndex)
            };
            const after = this.rectsFromLayout(layout, union.startIndex, union.endIndex);

            // Collapse spacers and lock into absolute space in the same turn
            // as the invert, so the destination grid is never painted first.
            this.topSpacer.style.height = '0px';
            this.bottomSpacer.style.height = '0px';
            grid.style.height = `${Math.max(previousHeight, layout.totalHeight)}px`;
            grid.classList.add('is-morphing', 'is-masonry');

            this.morphFreeze = true;
            this.syncNodes(images, union.startIndex, union.endIndex, layout);
            this.morphFreeze = false;

            const nodes = Array.from(grid.querySelectorAll('.gallery-item'));
            for (const node of nodes) {
                const id = node.dataset.imageId;
                const to = after.get(id);
                if (!to) continue;
                node.classList.add('loaded', 'instant');
                const from = before.get(id);
                this.invertTo(node, from || { ...to, top: to.top + 24 }, to);
                if (!from) node.style.opacity = '0';
            }

            // Flush the inverted positions before the targets are applied so
            // the browser has two distinct states to interpolate between.
            void grid.offsetHeight;

            for (const node of nodes) {
                const to = after.get(node.dataset.imageId);
                if (!to) continue;
                this.playTo(node, to);
                node.style.opacity = '1';
            }

            await this.waitForMorph(grid);

            for (const node of nodes) {
                node.style.transform = '';
                node.style.transformOrigin = '';
                node.style.opacity = '';
            }
        } finally {
            this.morphFreeze = false;
            grid.classList.remove('is-morphing');
            this.isMorphing = false;
            this.cachedLayout = null;
            grid.style.height = '';
            this.renderVisibleWindow(true);
            this.checkIfNeedsMoreContent();
        }
    }

    /**
     * Tile boxes in content space (above the window grid's spacer). That
     * lets the morph drop the spacer without the tiles jumping with it.
     */
    captureContentRects() {
        const rects = new Map();
        const base = this.windowGrid.getBoundingClientRect();
        const spacer = this.windowGrid.classList.contains('is-masonry')
            ? 0
            : (this.topSpacer?.offsetHeight || 0);

        for (const node of this.windowGrid.querySelectorAll('.gallery-item')) {
            const rect = node.getBoundingClientRect();
            rects.set(node.dataset.imageId, {
                left: rect.left - base.left,
                top: rect.top - base.top + spacer,
                width: rect.width,
                height: rect.height
            });
        }
        return rects;
    }

    rectsFromLayout(layout, startIndex, endIndex) {
        const rects = new Map();
        const images = this.imageService.images || [];

        for (let i = startIndex; i < endIndex; i++) {
            const image = images[i];
            if (!image) continue;

            if (layout.mode === 'masonry') {
                const rect = layout.rects[i];
                if (!rect) continue;
                rects.set(image.id, {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                });
                continue;
            }

            const col = i % layout.columns;
            const row = Math.floor(i / layout.columns);
            rects.set(image.id, {
                left: col * (layout.columnWidth + layout.gap),
                top: row * layout.rowSpan,
                width: layout.columnWidth,
                height: layout.rowHeight
            });
        }

        return rects;
    }

    invertTo(node, from, to) {
        const sx = to.width ? from.width / to.width : 1;
        const sy = to.height ? from.height / to.height : 1;
        node.style.left = '0px';
        node.style.top = '0px';
        node.style.width = `${to.width}px`;
        node.style.height = `${to.height}px`;
        node.style.transformOrigin = '0 0';
        node.style.transform = `translate(${from.left}px, ${from.top}px) scale(${sx}, ${sy})`;
    }

    playTo(node, to) {
        node.style.transform = `translate(${to.left}px, ${to.top}px) scale(1, 1)`;
    }

    waitForMorph(grid) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                grid.removeEventListener('transitionend', onEnd);
                window.clearTimeout(timer);
                resolve();
            };
            const onEnd = (event) => {
                if (event.propertyName === 'transform' && event.target.classList.contains('gallery-item')) {
                    window.clearTimeout(timer);
                    timer = window.setTimeout(finish, 60);
                }
            };
            let timer = window.setTimeout(finish, 700);
            grid.addEventListener('transitionend', onEnd);
        });
    }

    emitLayoutChange() {
        document.dispatchEvent(new CustomEvent('galleryLayoutChange', {
            detail: { mode: this.layoutMode, columns: this.columns }
        }));
    }

    // ── columns ──

    zoomIn() {
        this.setColumns(this.columns - 1);
    }

    zoomOut() {
        this.setColumns(this.columns + 1);
    }

    setColumns(value) {
        const next = Math.min(this.maxColumns, Math.max(this.minColumns, Number(value) || this.columns));
        if (next === this.columns) {
            return;
        }
        this.columns = next;
        this.galleryContainer.dataset.columns = String(next);
        this.storeColumnPreference(next);
        this.emitLayoutChange();

        if (this.isMorphing) {
            this.cachedLayout = null;
            return;
        }

        const images = this.imageService.images || [];
        if (!this.shouldAnimateLayout()) {
            this.cachedLayout = null;
            this.scheduleRefresh(true);
            return;
        }

        void window.UIAnimation.run(() => this.morphLayout(images));
    }

    storeColumnPreference(value) {
        try { localStorage.setItem('mirror-zoom', value.toString()); }
        catch (e) { /* ignore */ }
    }

    loadColumnPreference() {
        try {
            const stored = localStorage.getItem('mirror-zoom');
            if (stored !== null) {
                const value = parseInt(stored, 10);
                if (value >= this.minColumns && value <= this.maxColumns) {
                    this.columns = value;
                }
            }
        } catch (e) { /* ignore */ }
        this.galleryContainer.dataset.columns = String(this.columns);
    }

    storeLayoutPreference(mode) {
        try { localStorage.setItem('mirror-layout', mode); }
        catch (e) { /* ignore */ }
    }

    loadLayoutPreference() {
        try {
            const stored = localStorage.getItem('mirror-layout');
            if (stored === 'masonry' || stored === 'grid') {
                this.layoutMode = stored;
            }
        } catch (e) { /* ignore */ }
    }

    // ── keyboard scroll ──

    startKeyScroll(direction) {
        this.keyScrollDirection = direction;
        if (this.keyScrollRaf != null) return;

        const maxSpeed = 1200;
        const accel = 4000;
        const decel = 3000;
        let lastTs = performance.now();

        const step = (ts) => {
            const dt = Math.min(40, ts - lastTs) / 1000;
            lastTs = ts;

            if (this.keyScrollDirection) {
                this.keyScrollSpeed += this.keyScrollDirection * accel * dt;
                const cap = maxSpeed * Math.sign(this.keyScrollSpeed);
                if (Math.abs(this.keyScrollSpeed) > maxSpeed) {
                    this.keyScrollSpeed = cap;
                }
            } else {
                const decay = decel * dt;
                if (Math.abs(this.keyScrollSpeed) <= decay) {
                    this.keyScrollSpeed = 0;
                    cancelAnimationFrame(this.keyScrollRaf);
                    this.keyScrollRaf = null;
                    return;
                }
                this.keyScrollSpeed -= Math.sign(this.keyScrollSpeed) * decay;
            }

            window.scrollBy(0, Math.round(this.keyScrollSpeed * dt));
            this.keyScrollRaf = requestAnimationFrame(step);
        };

        this.keyScrollRaf = requestAnimationFrame(step);
    }

    releaseKeyScroll() {
        this.keyScrollDirection = 0;
    }

    // ── globe preloading ──

    triggerGlobePreloading(images) {
        if (this.globePreloaded || !images || images.length === 0) return;
        this.globePreloaded = true;

        const start = async () => {
            try {
                window.threeLoader?.prefetchEarthImage();
                const container = document.getElementById('globe-preload-container');
                if (!container) return;
                const first = images[0];
                await this.globeService.preloadGlobe(container, {
                    latitude: first.latitude,
                    longitude: first.longitude,
                    country: first.country,
                    location: first.location
                });
            } catch (error) {
                console.error('Gallery: Failed to preload globe:', error);
                this.globePreloaded = false;
            }
        };

        // Idle beats a fixed 300ms timer: first-viewport thumbnails and hover
        // prefetch should win the network before the modal globe texture.
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(start, { timeout: 4000 });
        } else {
            setTimeout(start, 1200);
        }
    }
}

window.Gallery = Gallery;
