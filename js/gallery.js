/**
 * Gallery - windowed grid that only mounts viewport-near images.
 */
class Gallery {
    constructor(imageService, imagePreloader) {
        this.imageService = imageService;
        this.galleryContainer = document.getElementById('gallery-container');
        this.loadingElement = document.getElementById('loading');
        this.scrollLoadingElement = document.getElementById('scroll-loading');
        this.errorElement = document.getElementById('error-message');
        this.zoomInBtn = document.getElementById('zoom-in-btn');
        this.zoomOutBtn = document.getElementById('zoom-out-btn');

        this.currentZoom = 4;
        this.minZoom = 2;
        this.maxZoom = 6;

        this.imagePreloader = imagePreloader || new ImagePreloader();
        this.globeService = new GlobeService();
        this.globePreloaded = false;

        this.keyScrollRaf = null;
        this.keyScrollDirection = 0;
        this.keyScrollSpeed = 0;

        this.renderState = {
            startIndex: -1,
            endIndex: -1
        };
        this.mountedItems = new Map();
        this.isLoadingMore = false;
        this.renderQueued = false;
        this.forceRenderQueued = false;
        this.cachedLayout = null;

        this.topSpacer = null;
        this.windowGrid = null;
        this.bottomSpacer = null;

        this.init();
    }

    init() {
        this.loadZoomPreference();
        this.ensureWindowStructure();
        this.bindEvents();
        this.loadImages();
    }

    bindEvents() {
        if (this.zoomInBtn) {
            this.zoomInBtn.addEventListener('click', () => this.zoomIn());
        }
        if (this.zoomOutBtn) {
            this.zoomOutBtn.addEventListener('click', () => this.zoomOut());
        }

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

        this.updateZoomState(false);
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

    getLayout() {
        if (this.cachedLayout) {
            return this.cachedLayout;
        }

        const containerWidth = this.galleryContainer.clientWidth || window.innerWidth;
        const desktopGaps = { 1: 30, 2: 25, 3: 22, 4: 20, 5: 18, 6: 15 };
        let columns, gap;

        if (window.innerWidth <= 480) {
            gap = 10;
            columns = Math.max(1, Math.floor((containerWidth + gap) / (120 + gap)));
        } else if (window.innerWidth <= 768) {
            gap = 15;
            columns = Math.max(1, Math.floor((containerWidth + gap) / (150 + gap)));
        } else {
            columns = this.currentZoom;
            gap = desktopGaps[this.currentZoom] || 15;
        }

        const itemWidth = Math.max(1, (containerWidth - gap * Math.max(columns - 1, 0)) / columns);
        const rowHeight = itemWidth * 0.75;
        const rowSpan = rowHeight + gap;
        const overscanRows = Math.max(2, Math.ceil(window.innerHeight / Math.max(rowSpan, 1)));

        const containerRect = this.galleryContainer.getBoundingClientRect();
        const paddingTop = parseFloat(getComputedStyle(this.galleryContainer).paddingTop) || 0;
        const contentTop = containerRect.top + (window.pageYOffset || document.documentElement.scrollTop) + paddingTop;

        this.cachedLayout = { columns, gap, rowHeight, rowSpan, overscanRows, contentTop };
        return this.cachedLayout;
    }

    // ── core renderer: incremental DOM diff ──

    renderVisibleWindow(force = false) {
        const images = this.imageService.images;
        this.ensureWindowStructure();

        if (!images || images.length === 0) {
            this.showEmptyState();
            return;
        }

        const layout = this.getLayout();
        const totalRows = Math.ceil(images.length / layout.columns);
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const viewportTop = scrollTop;
        const viewportBottom = viewportTop + window.innerHeight;

        const visibleStartRow = Math.max(0, Math.floor(Math.max(0, viewportTop - layout.contentTop) / layout.rowSpan));
        const visibleEndRow = Math.max(visibleStartRow, Math.floor(Math.max(0, viewportBottom - layout.contentTop) / layout.rowSpan));
        const startRow = Math.max(0, visibleStartRow - layout.overscanRows);
        const endRow = Math.min(totalRows - 1, visibleEndRow + layout.overscanRows);
        const startIndex = startRow * layout.columns;
        const endIndex = Math.min(images.length, (endRow + 1) * layout.columns);

        const indicesChanged = startIndex !== this.renderState.startIndex ||
            endIndex !== this.renderState.endIndex;
        const columnsChanged = layout.columns !== (this.renderState.columns || 0);

        this.applyWindowLayout(layout);
        this.topSpacer.style.height = `${startRow * layout.rowSpan}px`;
        const bottomRows = Math.max(0, totalRows - endRow - 1);
        this.bottomSpacer.style.height = `${bottomRows * layout.rowSpan}px`;

        if (!force && !indicesChanged) {
            return;
        }

        const prevStart = this.renderState.startIndex;
        const prevEnd = this.renderState.endIndex;

        if (prevStart === -1 || columnsChanged) {
            this.fullRebuild(images, startIndex, endIndex, layout);
        } else if (indicesChanged) {
            this.incrementalUpdate(images, prevStart, prevEnd, startIndex, endIndex, layout);
        }

        this.renderState = { startIndex, endIndex, columns: layout.columns };
        this.prefetchNearby(images, endIndex, layout.columns);
    }

    fullRebuild(images, startIndex, endIndex, layout) {
        const fragment = document.createDocumentFragment();

        for (let i = startIndex; i < endIndex; i++) {
            const node = this.getOrCreateItem(images[i], i, layout);
            fragment.appendChild(node);
        }

        this.windowGrid.innerHTML = '';
        this.windowGrid.appendChild(fragment);
    }

    incrementalUpdate(images, prevStart, prevEnd, nextStart, nextEnd, layout) {
        if (nextStart < prevStart) {
            const fragment = document.createDocumentFragment();
            for (let i = nextStart; i < Math.min(prevStart, nextEnd); i++) {
                fragment.appendChild(this.getOrCreateItem(images[i], i, layout));
            }
            this.windowGrid.insertBefore(fragment, this.windowGrid.firstChild);
        }

        if (nextEnd > prevEnd) {
            const fragment = document.createDocumentFragment();
            for (let i = Math.max(prevEnd, nextStart); i < nextEnd; i++) {
                fragment.appendChild(this.getOrCreateItem(images[i], i, layout));
            }
            this.windowGrid.appendChild(fragment);
        }

        while (this.windowGrid.firstChild && prevStart < nextStart) {
            this.windowGrid.removeChild(this.windowGrid.firstChild);
            prevStart++;
        }

        while (this.windowGrid.lastChild && prevEnd > nextEnd) {
            this.windowGrid.removeChild(this.windowGrid.lastChild);
            prevEnd--;
        }
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
        const dateLabel = this.imageService.formatTimestamp(image.timestamp);
        img.alt = image.description ? image.description : `Photo from ${dateLabel}`;
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
        }

        item.addEventListener('click', () => this.openImageModal(image.id));
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', image.description
            ? `View ${image.description} in fullscreen`
            : `View photo from ${dateLabel} in fullscreen`);
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openImageModal(image.id);
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
                if (image.url && image.thumbnailUrl !== image.url) {
                    this.imagePreloader.prefetch([image.url], { concurrency: 1 });
                }
            }, 250);
        });
        item.addEventListener('pointerleave', clearHoverPrefetch);
        item.addEventListener('pointercancel', clearHoverPrefetch);

        this.mountedItems.set(image.id, item);
        return item;
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

    // ── layout helpers ──

    applyWindowLayout(layout) {
        this.windowGrid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
        this.windowGrid.style.gap = `${layout.gap}px`;
    }

    // ── modal ──

    openImageModal(imageId) {
        document.dispatchEvent(new CustomEvent('openModal', { detail: { imageId } }));
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
        this.renderState = { startIndex: -1, endIndex: -1 };
    }

    showEmptyState() {
        this.ensureWindowStructure();
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

    // ── zoom ──

    zoomIn() {
        if (this.currentZoom > this.minZoom) {
            this.currentZoom--;
            this.updateZoomState();
        }
    }

    zoomOut() {
        if (this.currentZoom < this.maxZoom) {
            this.currentZoom++;
            this.updateZoomState();
        }
    }

    updateZoomState(refresh = true) {
        for (let i = 1; i <= 6; i++) {
            this.galleryContainer.classList.remove(`zoom-${i}`);
        }
        this.galleryContainer.classList.add(`zoom-${this.currentZoom}`);

        if (this.zoomInBtn) this.zoomInBtn.disabled = this.currentZoom <= this.minZoom;
        if (this.zoomOutBtn) this.zoomOutBtn.disabled = this.currentZoom >= this.maxZoom;
        this.storeZoomPreference(this.currentZoom);

        if (refresh) {
            this.cachedLayout = null;
            this.scheduleRefresh(true);
        }
    }

    storeZoomPreference(value) {
        try { localStorage.setItem('mirror-zoom', value.toString()); }
        catch (e) { /* ignore */ }
    }

    loadZoomPreference() {
        try {
            const stored = localStorage.getItem('mirror-zoom');
            if (stored !== null) {
                const value = parseInt(stored, 10);
                if (value >= this.minZoom && value <= this.maxZoom) {
                    this.currentZoom = value;
                    return true;
                }
            }
        } catch (e) { /* ignore */ }
        return false;
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

        setTimeout(async () => {
            try {
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
        }, 300);
    }
}

window.Gallery = Gallery;
