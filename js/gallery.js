/**
 * Gallery - windowed grid/masonry that only mounts viewport-near images.
 */
class Gallery {
    constructor(imageService, imagePreloader, globeService) {
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
        this.globeService = globeService || new GlobeService();
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
        this.isReordering = false;
        this.morphFreeze = false;
        this.renderQueued = false;
        this.forceRenderQueued = false;
        this.cachedLayout = null;
        this.pendingAspectRefresh = false;
        this.aspectReflowTimer = null;
        this.aspectReflowNeeded = false;

        this.topSpacer = null;
        this.windowGrid = null;
        this.bottomSpacer = null;
        this._loadToken = 0;
        this._loadWatchdog = null;
        this.loadQueue = new ImageLoadQueue({ limit: 8 });

        this.init();
    }

    init() {
        this.loadColumnPreference();
        this.loadLayoutPreference();
        this.ensureWindowStructure();
        this.bindEvents();
        this.applyLayoutModeClass();
        this.imagePreloader.onAspect((url, img) => {
            this.adoptAspectFromUrl(url, img);
        });
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
            if (this.isMorphing || this.isReordering) {
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
        const token = ++this._loadToken;
        try {
            this.showLoading();
            this.hideError();
            this.clearGallery();

            const images = await this.imageService.fetchImages();
            if (token !== this._loadToken) {
                return;
            }
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
            if (token !== this._loadToken) {
                return;
            }
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
                if (this.isMasonry) {
                    this.warmUnknownAspects();
                }
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
        const constrained = GalleryLayout.isConstrainedViewport();
        layout.overscan = GalleryLayout.overscanPixels({
            rowSpan: referenceRow,
            viewportHeight: window.innerHeight,
            columns: metrics.columns,
            constrained
        });
        layout.constrained = constrained;

        const dpr = window.devicePixelRatio || 1;
        if (typeof this.imageService.setThumbEdge === 'function') {
            this.imageService.setThumbEdge(ImageService.thumbEdgeFor(metrics.columnWidth, dpr));
        }
        this.loadQueue.setLimit(constrained && metrics.columns >= 5 ? 6 : 8);

        this.cachedLayout = layout;
        return layout;
    }

    /**
     * Index range to mount for the current scroll position, in layout space.
     */
    visibleRange(layout, imageCount, overscan = layout.overscan) {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const pad = overscan == null ? layout.overscan : overscan;
        const windowTop = scrollTop - layout.contentTop - pad;
        const windowBottom = scrollTop - layout.contentTop + window.innerHeight + pad;
        return GalleryLayout.rangeForViewport(
            layout,
            imageCount,
            Math.max(0, windowTop),
            Math.max(0, windowBottom)
        );
    }

    thumbPriority(layout, index) {
        const tight = this.visibleRange(layout, (this.imageService.images || []).length, 0);
        if (index >= tight.startIndex && index < tight.endIndex) {
            return 0;
        }
        return 1;
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
        this.scheduleLoadWatchdog();

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
                this.releaseItem(child);
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
        this.loadQueue.pump();
    }

    releaseItem(child) {
        const img = child.querySelector('.gallery-item-image');
        const url = img?.dataset.loadUrl || img?.getAttribute('src');
        if (img && url && !img.complete) {
            this.imagePreloader.abandon(url);
            img.removeAttribute('src');
        }
        if (img) {
            this.loadQueue.cancel(img);
        }
        this.mountedItems.delete(child.dataset.imageId);
        child.remove();
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
            const img = existing.querySelector('.gallery-item-image');
            if (this.adoptNaturalAspect(image, img)) {
                this.scheduleAspectReflow();
            }
            if (img && image.thumbnailUrl && !img.naturalWidth) {
                this.loadQueue.assign(img, image.thumbnailUrl, this.thumbPriority(layout, absoluteIndex));
            }
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
        if ('fetchPriority' in img) {
            img.fetchPriority = 'high';
        }

        item.appendChild(img);

        const url = image.thumbnailUrl;
        this.bindThumbLoad(item, img, image, url, this.thumbPriority(layout, absoluteIndex));

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

    bindThumbLoad(item, img, image, url, priority) {
        const markReady = () => {
            this.imagePreloader.markLoaded(url, img);
            item.classList.add('loaded');
            if (this.adoptNaturalAspect(image, img)) {
                this.scheduleAspectReflow();
            }
        };

        img.addEventListener('load', markReady, { once: true });
        img.addEventListener('error', () => {
            this.imagePreloader.markFailed(url);
            img.src = this.getImageFallbackSrc();
            item.classList.add('loaded');
        }, { once: true });

        const cached = this.imagePreloader.isImageLoaded(url);
        if (cached) {
            img.src = url;
            img.dataset.loadUrl = url;
            item.classList.add('loaded', 'instant');
            const cachedImg = this.imagePreloader.getLoadedImage(url);
            if (this.adoptNaturalAspect(image, cachedImg || img)) {
                this.scheduleAspectReflow();
            }
            return;
        }

        img.dataset.loadUrl = url;
        this.loadQueue.assign(img, url, priority);
        if (img.complete && img.naturalWidth) {
            markReady();
        }
    }

    scheduleLoadWatchdog() {
        if (this._loadWatchdog != null) {
            return;
        }
        this._loadWatchdog = window.setTimeout(() => {
            this._loadWatchdog = null;
            const stuck = [];
            for (const item of this.mountedItems.values()) {
                const img = item.querySelector('.gallery-item-image');
                if (img && img.isConnected && !img.naturalWidth) {
                    stuck.push(img);
                }
            }
            if (stuck.length === 0) {
                return;
            }
            this.loadQueue.retryStuck(stuck);
            this.scheduleLoadWatchdog();
        }, 1600);
    }

    /**
     * Photos uploaded before dimensions were recorded arrive as 4:3. Record
     * the real ratio whenever a thumbnail is available — including grid
     * mode and prefetched off-screen images — so masonry does not crop
     * portraits that were below the first viewport.
     */
    adoptNaturalAspect(image, img) {
        if (!image || image.aspectRatioKnown) return false;
        const width = img?.naturalWidth;
        const height = img?.naturalHeight;
        if (!width || !height) return false;
        image.aspectRatio = width / height;
        image.aspectRatioKnown = true;
        return true;
    }

    adoptAspectFromUrl(url, img) {
        if (!url || !img) return;
        const images = this.imageService.images || [];
        let changed = false;
        for (const image of images) {
            if (image.thumbnailUrl === url && this.adoptNaturalAspect(image, img)) {
                changed = true;
            }
        }
        if (changed) this.scheduleAspectReflow();
    }

    harvestKnownAspects() {
        const images = this.imageService.images || [];
        let changed = false;
        for (const image of images) {
            if (image.aspectRatioKnown) continue;
            const mounted = this.mountedItems.get(image.id);
            const mountedImg = mounted?.querySelector('.gallery-item-image');
            if (this.adoptNaturalAspect(image, mountedImg)) {
                changed = true;
                continue;
            }
            const cached = this.imagePreloader.getLoadedImage(image.thumbnailUrl);
            if (this.adoptNaturalAspect(image, cached)) {
                changed = true;
            }
        }
        return changed;
    }

    /**
     * Kick off thumbs for anything still missing a ratio. Completions land
     * through the preloader callback and reflow masonry in one pass.
     */
    warmUnknownAspects() {
        const urls = (this.imageService.images || [])
            .filter((image) => !image.aspectRatioKnown && image.thumbnailUrl)
            .map((image) => image.thumbnailUrl);
        if (urls.length === 0) return;
        const constrained = this.cachedLayout?.constrained || GalleryLayout.isConstrainedViewport();
        this.imagePreloader.prefetch(urls, { concurrency: constrained ? 2 : 6 });
    }

    scheduleAspectReflow() {
        if (!this.isMasonry) return;
        this.aspectReflowNeeded = true;
        if (this.isMorphing || this.aspectReflowTimer != null) return;
        this.aspectReflowTimer = window.setTimeout(() => {
            this.aspectReflowTimer = null;
            if (!this.aspectReflowNeeded || !this.isMasonry || this.isMorphing) return;
            this.aspectReflowNeeded = false;
            this.cachedLayout = null;
            const images = this.imageService.images || [];
            if (this.shouldAnimateLayout()) {
                void this.morphLayout(images);
                return;
            }
            this.renderVisibleWindow(true);
        }, 48);
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
            const constrained = this.cachedLayout?.constrained || GalleryLayout.isConstrainedViewport();
            this.imagePreloader.prefetch(urls, {
                concurrency: constrained && columns >= 5 ? 2 : 4
            });
        }
        if (this.isMasonry) {
            this.warmUnknownAspects();
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
            this.isReordering = true;
            try {
                const thumbCandidates = [...previous, ...next]
                    .map((image) => image?.thumbnailUrl)
                    .filter(Boolean);
                const viewportHeight = window.innerHeight;
                const flipItems = [];
                const flipPrevious = [];
                const flipNext = [];
                nodes.forEach((node, index) => {
                    const imageIndex = start + index;
                    const rect = node.getBoundingClientRect();
                    const onScreen = rect.bottom > 0 && rect.top < viewportHeight;
                    if (!onScreen) {
                        return;
                    }
                    flipItems.push(node);
                    flipPrevious.push(previous[imageIndex]);
                    flipNext.push(next[imageIndex]);
                });
                await window.Flipboard.animateWindow({
                    items: flipItems.length ? flipItems : nodes,
                    previousImages: flipItems.length ? flipPrevious : previous.slice(start, end),
                    nextImages: flipItems.length ? flipNext : next.slice(start, end),
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
            } finally {
                this.isReordering = false;
            }
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
        if (this._loadWatchdog != null) {
            window.clearTimeout(this._loadWatchdog);
            this._loadWatchdog = null;
        }
        for (const child of Array.from(this.windowGrid.children)) {
            this.loadQueue.cancel(child.querySelector('.gallery-item-image'));
        }
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
        if (next === 'masonry') {
            this.harvestKnownAspects();
            this.warmUnknownAspects();
        }

        const animate = options.animate !== false && this.shouldAnimateLayout();

        if (!animate) {
            this.cachedLayout = null;
            this.renderVisibleWindow(true);
            return;
        }

        await this.morphLayout(images);
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
        this.loadQueue.pause();
        const grid = this.windowGrid;

        try {
            this.harvestKnownAspects();
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
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const viewTop = scrollTop - layout.contentTop;
            const viewBottom = viewTop + window.innerHeight;

            // Collapse spacers and lock into absolute space in the same turn
            // as the invert, so the destination grid is never painted first.
            this.topSpacer.style.height = '0px';
            this.bottomSpacer.style.height = '0px';
            grid.style.height = `${previousHeight}px`;
            grid.classList.add('is-masonry', 'is-morphing', 'is-morph-invert');

            this.morphFreeze = true;
            this.syncNodes(images, union.startIndex, union.endIndex, layout);
            this.morphFreeze = false;

            const nodes = Array.from(grid.querySelectorAll('.gallery-item'));
            for (const node of nodes) {
                const id = String(node.dataset.imageId);
                const to = after.get(id);
                if (!to) continue;
                const from = before.get(id) || this.growInPlace(to);
                const visible = GalleryLayout.rectIntersectsBand(from, viewTop, viewBottom)
                    || GalleryLayout.rectIntersectsBand(to, viewTop, viewBottom);
                if (!visible) {
                    this.playTo(node, to);
                    continue;
                }
                this.invertTo(node, from, to);
            }

            const duration = this.morphDurationMs();
            const ease = this.morphEasing();
            const boxTransition = `left ${duration}ms ${ease}, top ${duration}ms ${ease}, width ${duration}ms ${ease}, height ${duration}ms ${ease}`;
            const flyTransition = `transform ${duration}ms ${ease}`;
            void grid.offsetHeight;
            grid.classList.remove('is-morph-invert');
            grid.style.transition = `height ${duration}ms ${ease}`;
            for (const node of nodes) {
                if (node.classList.contains('is-flying')) {
                    node.style.transition = flyTransition;
                } else if (node.classList.contains('is-boxing')) {
                    node.style.transition = boxTransition;
                } else {
                    node.style.transition = 'none';
                }
            }
            void grid.offsetHeight;
            grid.style.height = `${layout.totalHeight}px`;

            for (const node of nodes) {
                const to = after.get(String(node.dataset.imageId));
                if (!to) continue;
                this.playTo(node, to);
            }

            await this.waitForMorph();

            for (const node of nodes) {
                node.classList.remove('is-flying', 'is-boxing');
                node.style.transform = '';
                node.style.transformOrigin = '';
                node.style.opacity = '';
                node.style.transition = '';
            }
        } finally {
            this.morphFreeze = false;
            grid.classList.remove('is-morphing', 'is-morph-invert');
            this.isMorphing = false;
            this.loadQueue.resume();
            this.cachedLayout = null;
            grid.style.height = '';
            grid.style.transition = '';
            this.aspectReflowNeeded = false;
            if (this.aspectReflowTimer != null) {
                window.clearTimeout(this.aspectReflowTimer);
                this.aspectReflowTimer = null;
            }
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
            rects.set(String(node.dataset.imageId), {
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
                rects.set(String(image.id), {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                });
                continue;
            }

            const col = i % layout.columns;
            const row = Math.floor(i / layout.columns);
            rects.set(String(image.id), {
                left: col * (layout.columnWidth + layout.gap),
                top: row * layout.rowSpan,
                width: layout.columnWidth,
                height: layout.rowHeight
            });
        }

        return rects;
    }

    /**
     * A tile that was not on screen should grow downward from its dest
     * cell instead of flying out of the top-left photo.
     */
    growInPlace(to) {
        const placeholderHeight = to.width / GalleryLayout.GRID_ASPECT;
        return {
            left: to.left,
            top: to.top,
            width: to.width,
            height: Math.min(to.height, placeholderHeight)
        };
    }

    invertTo(node, from, to) {
        const fromAspect = from.height ? from.width / from.height : 1;
        const toAspect = to.height ? to.width / to.height : 1;
        const sameAspect = Math.abs(fromAspect - toAspect) < 0.04;

        // Grid column changes keep 4:3, so a compositor transform is enough
        // and does not stretch the photo. Masonry aspect changes still
        // interpolate the box so object-fit:cover can crop instead of squash.
        if (sameAspect) {
            const sx = to.width ? from.width / to.width : 1;
            const sy = to.height ? from.height / to.height : 1;
            node.style.left = `${to.left}px`;
            node.style.top = `${to.top}px`;
            node.style.width = `${to.width}px`;
            node.style.height = `${to.height}px`;
            node.style.transformOrigin = 'top left';
            node.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
            node.classList.add('is-flying');
            return;
        }

        node.style.left = `${from.left}px`;
        node.style.top = `${from.top}px`;
        node.style.width = `${from.width}px`;
        node.style.height = `${from.height}px`;
        node.style.transform = '';
        node.style.transformOrigin = '';
        node.classList.add('is-boxing');
    }

    playTo(node, to) {
        if (node.classList.contains('is-flying')) {
            node.style.transform = 'translate(0px, 0px) scale(1, 1)';
            return;
        }
        node.style.left = `${to.left}px`;
        node.style.top = `${to.top}px`;
        node.style.width = `${to.width}px`;
        node.style.height = `${to.height}px`;
        node.style.transform = '';
    }

    morphDurationMs() {
        const raw = getComputedStyle(document.documentElement)
            .getPropertyValue('--dur-slow')
            .trim() || '520ms';
        const ms = raw.endsWith('ms')
            ? parseFloat(raw)
            : parseFloat(raw) * 1000;
        return Number.isFinite(ms) ? ms : 520;
    }

    morphEasing() {
        return getComputedStyle(document.documentElement)
            .getPropertyValue('--ease')
            .trim() || 'cubic-bezier(0.22, 1, 0.36, 1)';
    }

    waitForMorph() {
        return new Promise((resolve) => {
            window.setTimeout(resolve, this.morphDurationMs() + 32);
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

        void this.morphLayout(images);
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
