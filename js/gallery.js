/**
 * Gallery - windowed grid that only mounts viewport-near images.
 */
class Gallery {
    constructor(imageService) {
        this.imageService = imageService;
        this.galleryContainer = document.getElementById('gallery-container');
        this.loadingElement = document.getElementById('loading');
        this.scrollLoadingElement = document.getElementById('scroll-loading');
        this.errorElement = document.getElementById('error-message');
        this.zoomInBtn = document.getElementById('zoom-in-btn');
        this.zoomOutBtn = document.getElementById('zoom-out-btn');

        this.currentZoom = 6;
        this.minZoom = 2;
        this.maxZoom = 6;

        this.imagePreloader = new ImagePreloader();
        this.globeService = new GlobeService();
        this.globePreloaded = false;

        this.scrollState = {
            isScrolling: false,
            scrollDirection: 0,
            lastScrollTime: 0
        };
        this.renderState = {
            startIndex: -1,
            endIndex: -1,
            columns: 0,
            rowHeight: 0,
            gap: 0
        };
        this.isLoadingMore = false;
        this.renderQueued = false;
        this.forceRenderQueued = false;
        this.renderToken = 0;
        this.activeVisibleRenderToken = 0;
        this.nearbyPrefetchTimer = null;

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
            this.zoomInBtn.addEventListener('click', () => {
                this.zoomIn();
            });
        }

        if (this.zoomOutBtn) {
            this.zoomOutBtn.addEventListener('click', () => {
                this.zoomOut();
            });
        }

        document.addEventListener('keydown', (event) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                return;
            }

            if (window.app && window.app.modal && window.app.modal.isModalOpen()) {
                return;
            }

            switch (event.key) {
                case '-':
                    event.preventDefault();
                    if (!event.shiftKey) {
                        this.zoomOut();
                    }
                    break;
                case '=':
                case '+':
                    event.preventDefault();
                    this.zoomIn();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.handleScrollKey(-200, event.repeat);
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    this.handleScrollKey(200, event.repeat);
                    break;
                default:
                    break;
            }
        });

        document.addEventListener('keyup', (event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                this.scrollState.isScrolling = false;
            }
        });

        document.addEventListener('photoUploaded', () => {
            this.loadImages();
        });

        window.addEventListener('scroll', this.throttle(() => {
            this.handleScroll();
        }, 60), { passive: true });

        window.addEventListener('resize', this.throttle(() => {
            this.refreshWindow(true);
            this.checkIfNeedsMoreContent();
        }, 100));

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

    handleScroll() {
        this.refreshWindow();

        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const threshold = Math.max(1000, windowHeight * 1.5);
        const nearBottom = scrollTop + windowHeight >= documentHeight - threshold;

        if (nearBottom && this.imageService.hasMore && !this.isLoadingMore) {
            this.loadMoreImages();
        }
    }

    checkIfNeedsMoreContent() {
        if (this.imageService.isLoading || this.isLoadingMore) {
            return;
        }

        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const needsMoreContent = documentHeight <= windowHeight + 50;

        if (needsMoreContent && this.imageService.hasMore) {
            this.loadMoreImages();
        }
    }

    throttle(func, limit) {
        let inThrottle = false;
        return (...args) => {
            if (inThrottle) {
                return;
            }

            func.apply(this, args);
            inThrottle = true;
            window.setTimeout(() => {
                inThrottle = false;
            }, limit);
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

            this.refreshWindow(true);
            this.triggerGlobePreloading(images);

            window.setTimeout(() => {
                this.checkIfNeedsMoreContent();
            }, 100);
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
                this.refreshWindow(true);
                this.prefetchNearbyImages(this.renderState.endIndex + 1, this.renderState.columns * 2);

                window.setTimeout(() => {
                    this.checkIfNeedsMoreContent();
                }, 100);
            }
        } catch (error) {
            console.error('Error loading more images:', error);
        } finally {
            this.hideScrollLoading();
            this.isLoadingMore = false;
        }
    }

    refreshWindow(force = false) {
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
        });
    }

    renderVisibleWindow(force = false) {
        const images = this.imageService.images;
        this.ensureWindowStructure();

        if (!images || images.length === 0) {
            this.showEmptyState();
            return;
        }

        const layout = this.getLayoutMetrics();
        const totalRows = Math.ceil(images.length / layout.columns);
        const rowSpan = layout.rowHeight + layout.gap;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const viewportTop = scrollTop;
        const viewportBottom = viewportTop + window.innerHeight;
        const contentTop = this.getGalleryContentTop(layout.paddingTop);
        const visibleStartRow = Math.max(0, Math.floor(Math.max(0, viewportTop - contentTop) / rowSpan));
        const visibleEndRow = Math.max(visibleStartRow, Math.floor(Math.max(0, viewportBottom - contentTop) / rowSpan));
        const startRow = Math.max(0, visibleStartRow - layout.overscanRows);
        const endRow = Math.min(totalRows - 1, visibleEndRow + layout.overscanRows);
        const startIndex = startRow * layout.columns;
        const endIndex = Math.min(images.length, (endRow + 1) * layout.columns);

        if (!force &&
            startIndex === this.renderState.startIndex &&
            endIndex === this.renderState.endIndex &&
            layout.columns === this.renderState.columns &&
            Math.abs(layout.rowHeight - this.renderState.rowHeight) < 0.5 &&
            layout.gap === this.renderState.gap) {
            return;
        }

        this.applyWindowLayout(layout);

        const topHeight = startRow * rowSpan;
        const bottomRows = Math.max(0, totalRows - endRow - 1);
        const bottomHeight = bottomRows * rowSpan;
        this.topSpacer.style.height = `${topHeight}px`;
        this.bottomSpacer.style.height = `${bottomHeight}px`;

        const fragment = document.createDocumentFragment();
        const renderToken = ++this.renderToken;
        const eagerLimit = Math.min(images.length, ((visibleEndRow + 2) * layout.columns));
        const orderedLoads = [];

        for (let index = startIndex; index < endIndex; index++) {
            const image = images[index];
            const { item, loadDescriptor } = this.createGalleryItem(image, {
                eager: index < eagerLimit,
                absoluteIndex: index,
                renderToken
            });
            fragment.appendChild(item);
            if (loadDescriptor) {
                orderedLoads.push(loadDescriptor);
            }
        }

        this.windowGrid.innerHTML = '';
        this.windowGrid.appendChild(fragment);

        this.renderState = {
            startIndex,
            endIndex,
            columns: layout.columns,
            rowHeight: layout.rowHeight,
            gap: layout.gap
        };

        this.startVisibleLoadQueue(orderedLoads, renderToken);
        window.clearTimeout(this.nearbyPrefetchTimer);
        this.nearbyPrefetchTimer = window.setTimeout(() => {
            if (this.activeVisibleRenderToken === renderToken) {
                this.prefetchNearbyImages(endIndex, layout.columns);
            }
        }, 180);
    }

    getLayoutMetrics() {
        const containerStyles = window.getComputedStyle(this.galleryContainer);
        const paddingTop = parseFloat(containerStyles.paddingTop) || 0;
        const containerWidth = this.galleryContainer.clientWidth || this.galleryContainer.getBoundingClientRect().width || window.innerWidth;
        const desktopGaps = {
            1: 30,
            2: 25,
            3: 22,
            4: 20,
            5: 18,
            6: 15
        };

        let columns;
        let gap;

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

        const itemWidth = Math.max(1, (containerWidth - (gap * Math.max(columns - 1, 0))) / columns);
        const rowHeight = itemWidth * 0.75;
        const overscanRows = Math.max(3, Math.ceil((window.innerHeight * 1.5) / Math.max(rowHeight, 1)));

        return {
            columns,
            gap,
            rowHeight,
            overscanRows,
            paddingTop
        };
    }

    getGalleryContentTop(paddingTop) {
        const rect = this.galleryContainer.getBoundingClientRect();
        return rect.top + (window.pageYOffset || document.documentElement.scrollTop) + paddingTop;
    }

    applyWindowLayout(layout) {
        this.windowGrid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
        this.windowGrid.style.gap = `${layout.gap}px`;
    }

    prefetchNearbyImages(startIndex, count) {
        if (!Number.isFinite(startIndex) || count <= 0) {
            return;
        }

        const urls = this.imageService.images
            .slice(Math.max(0, startIndex), Math.max(0, startIndex) + count)
            .map((image) => image.thumbnailUrl)
            .filter(Boolean);

        this.imagePreloader.prefetch(urls, { concurrency: 3 });
    }

    createGalleryItem(image, options = {}) {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.dataset.imageId = image.id;

        const img = document.createElement('img');
        img.className = 'gallery-item-image';
        img.alt = image.description || 'Photo';
        img.loading = options.eager ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.fetchPriority = options.eager ? 'high' : 'low';

        if (image.width) {
            img.width = image.width;
        }

        if (image.height) {
            img.height = image.height;
        }

        const skeleton = document.createElement('div');
        skeleton.className = 'gallery-item-skeleton';

        item.appendChild(img);
        item.appendChild(skeleton);

        item.addEventListener('click', () => {
            this.openImageModal(image.id);
        });

        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `View ${image.description || 'photo'} in fullscreen`);

        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openImageModal(image.id);
            }
        });

        const loadDescriptor = {
            absoluteIndex: options.absoluteIndex,
            renderToken: options.renderToken,
            url: image.thumbnailUrl,
            img,
            item,
            skeleton,
            immediate: this.imagePreloader.isImageLoaded(image.thumbnailUrl)
        };

        return {
            item,
            loadDescriptor
        };
    }

    startVisibleLoadQueue(entries, renderToken) {
        this.activeVisibleRenderToken = renderToken;

        const orderedEntries = entries
            .filter((entry) => entry && entry.url)
            .sort((left, right) => left.absoluteIndex - right.absoluteIndex);

        if (orderedEntries.length === 0) {
            return;
        }

        (async () => {
            for (const entry of orderedEntries) {
                if (this.activeVisibleRenderToken !== renderToken) {
                    return;
                }

                if (entry.immediate) {
                    entry.img.src = entry.url;
                    this.revealVisibleItem(entry, renderToken);
                    continue;
                }

                const preloadedImage = await this.imagePreloader.preloadImage(entry.url);
                if (this.activeVisibleRenderToken !== renderToken) {
                    return;
                }

                entry.img.src = preloadedImage ? entry.url : this.getImageFallbackSrc();
                this.revealVisibleItem(entry, renderToken);
            }
        })().catch((error) => {
            console.error('Visible image queue failed:', error);
        });
    }

    revealVisibleItem(entry, renderToken) {
        if (this.activeVisibleRenderToken !== renderToken || !entry.item.isConnected) {
            return;
        }

        entry.item.classList.add('loaded');
        if (entry.skeleton.isConnected) {
            entry.skeleton.remove();
        }
    }

    getImageFallbackSrc() {
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xNzUgMTI1SDE4NVYxMzVIMTc1VjEyNVoiIGZpbGw9IiM5Q0EzQUYiLz4KPHA+SW1hZ2UgTm90IEZvdW5kPC9wPgo8L3N2Zz4K';
    }

    openImageModal(imageId) {
        document.dispatchEvent(new CustomEvent('openModal', {
            detail: { imageId }
        }));
    }

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
        if (this.scrollLoadingElement) {
            this.scrollLoadingElement.classList.remove('hidden');
        }
    }

    hideScrollLoading() {
        if (this.scrollLoadingElement) {
            this.scrollLoadingElement.classList.add('hidden');
        }
    }

    clearGallery() {
        this.ensureWindowStructure();
        this.windowGrid.innerHTML = '';
        this.topSpacer.style.height = '0px';
        this.bottomSpacer.style.height = '0px';
        this.renderState = {
            startIndex: -1,
            endIndex: -1,
            columns: 0,
            rowHeight: 0,
            gap: 0
        };
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
        this.getGalleryItems().forEach((item) => {
            item.classList.remove('highlighted');
        });

        const targetItem = this.galleryContainer.querySelector(`[data-image-id="${imageId}"]`);
        if (targetItem) {
            targetItem.classList.add('highlighted');
        }
    }

    removeHighlights() {
        this.getGalleryItems().forEach((item) => {
            item.classList.remove('highlighted');
        });
    }

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

        if (this.zoomInBtn) {
            this.zoomInBtn.disabled = this.currentZoom <= this.minZoom;
        }

        if (this.zoomOutBtn) {
            this.zoomOutBtn.disabled = this.currentZoom >= this.maxZoom;
        }

        this.storeZoomPreference(this.currentZoom);

        if (refresh) {
            this.refreshWindow(true);
        }
    }

    storeZoomPreference(value) {
        try {
            localStorage.setItem('mirror-zoom', value.toString());
        } catch (error) {
            console.warn('Could not store zoom preference:', error);
        }
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
        } catch (error) {
            console.warn('Could not load zoom preference:', error);
        }

        return false;
    }

    handleScrollKey(distance, isRepeat) {
        const now = Date.now();

        if (!isRepeat) {
            this.scrollState.isScrolling = true;
            this.scrollState.scrollDirection = distance;
            this.scrollState.lastScrollTime = now;
            this.scrollByDistance(distance);
            return;
        }

        const timeSinceLastScroll = now - this.scrollState.lastScrollTime;
        if (timeSinceLastScroll > 16) {
            const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
            const scrollIncrement = Math.sign(distance) * 50;
            const targetScrollY = Math.max(0, currentScrollY + scrollIncrement);

            window.scrollTo({
                top: targetScrollY,
                behavior: 'auto'
            });

            this.scrollState.lastScrollTime = now;
        }
    }

    scrollByDistance(distance) {
        const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
        const targetScrollY = Math.max(0, currentScrollY + distance);

        window.scrollTo({
            top: targetScrollY,
            behavior: 'smooth'
        });
    }

    triggerGlobePreloading(images) {
        if (this.globePreloaded || !images || images.length === 0) {
            return;
        }

        const firstImage = images[0];
        if (!firstImage || !firstImage.location) {
            return;
        }

        setTimeout(async () => {
            try {
                const preloadContainer = document.getElementById('globe-preload-container');
                if (!preloadContainer) {
                    return;
                }

                await this.globeService.preloadGlobe(preloadContainer, firstImage.location);
                this.globePreloaded = true;
            } catch (error) {
                console.error('Gallery: Failed to preload globe:', error);
                this.globePreloaded = false;
            }
        }, 250);
    }
}

window.Gallery = Gallery;
