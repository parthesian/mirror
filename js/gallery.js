/**
 * Gallery - Handles the display and interaction of images in the gallery grid
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
        
        // Zoom state
        this.currentZoom = 6; // Default 6 images per row
        this.minZoom = 2;
        this.maxZoom = 6;
        
        // Image preloader for smooth loading
        this.imagePreloader = new ImagePreloader();
        
        // Animation state
        this.isAnimating = false;
        this.enterBatchCounter = 0;
        this.batchAnimationDurationMs = 420;
        this.batchAnimationStaggerMs = 45;
        
        // Globe preloading
        this.globeService = new GlobeService();
        this.globePreloaded = false;
        
        this.init();
    }

    /**
     * Initialize the gallery
     */
    init() {
        // Load saved zoom preference before binding events
        this.loadZoomPreference();
        this.bindEvents();
        this.loadImages();
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Zoom buttons
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

        // Initialize scroll state tracking
        this.scrollState = {
            isScrolling: false,
            scrollDirection: 0,
            lastScrollTime: 0
        };

        // Keyboard controls for zoom and enhanced scrolling
        document.addEventListener('keydown', (e) => {
            // Only handle keys when no input is focused
            if (document.activeElement.tagName === 'INPUT' || 
                document.activeElement.tagName === 'TEXTAREA') {
                return;
            }

            // Don't handle scrolling when modal is open
            if (window.app && window.app.modal && window.app.modal.isModalOpen()) {
                return;
            }

            switch(e.key) {
                case '-':
                    e.preventDefault();
                    if (e.shiftKey) return; // Ignore underscore
                    this.zoomOut();
                    break;
                case '=':
                case '+':
                    e.preventDefault();
                    this.zoomIn();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.handleScrollKey(-200, e.repeat);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.handleScrollKey(200, e.repeat);
                    break;
            }
        });

        // Handle key release to stop continuous scrolling
        document.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                this.scrollState.isScrolling = false;
            }
        });

        // Listen for photo uploaded event
        document.addEventListener('photoUploaded', () => {
            this.loadImages();
        });

        // Infinite scroll
        window.addEventListener('scroll', this.throttle(() => {
            this.handleScroll();
        }, 200));

        // Initialize zoom state
        this.updateZoomState();
    }

    /**
     * Handle scroll events for infinite scrolling
     */
    handleScroll() {
        // Check if we're near the bottom of the page
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        
        // Load more when we're within 1000px of the bottom
        const threshold = 1000;
        const nearBottom = scrollTop + windowHeight >= documentHeight - threshold;
        
        if (nearBottom && !this.imageService.isLoading && !this.isAnimating && this.imageService.hasMore) {
            this.loadMoreImages();
        }
    }

    /**
     * Check if page needs more content to enable scrolling
     * This handles the case where initial images don't fill the viewport
     */
    checkIfNeedsMoreContent() {
        // Don't auto-load if we're already loading or if we're in the middle of an animation
        if (this.imageService.isLoading || this.isAnimating) {
            return;
        }
        
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        
        // If document height is less than or equal to window height, we can't scroll
        // Add a small buffer to account for any margins/padding
        const needsMoreContent = documentHeight <= windowHeight + 50;
        
        if (needsMoreContent && this.imageService.hasMore) {
            console.log('Page too short for scrolling, loading more images automatically...');
            this.loadMoreImages();
        }
    }

    /**
     * Throttle function to limit how often a function can be called
     * @param {Function} func - Function to throttle
     * @param {number} limit - Time limit in milliseconds
     * @returns {Function} Throttled function
     */
    throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    /**
     * Load images from the image service
     */
    async loadImages() {
        try {
            this.isAnimating = false;
            this.showLoading();
            this.hideError();
            this.clearGallery();

            const images = await this.imageService.fetchImages();
            await this.renderGallery(images);
            this.hideLoading();
            
            // Check if we need more content to enable scrolling
            setTimeout(() => {
                this.checkIfNeedsMoreContent();
            }, 100); // Small delay to ensure DOM is updated
        } catch (error) {
            console.error('Error loading images:', error);
            this.hideLoading();
            this.showError();
        }
    }

    /**
     * Load more images for infinite scrolling
     */
    async loadMoreImages() {
        try {
            console.log('Loading more images...');
            this.showScrollLoading();
            
            const newImages = await this.imageService.loadMorePhotos();
            
            if (newImages && newImages.length > 0) {
                await this.renderMoreImages(newImages);
                console.log(`Loaded ${newImages.length} more images`);
                
                // Check if we still need more content after loading this batch
                setTimeout(() => {
                    this.checkIfNeedsMoreContent();
                }, 500); // Longer delay to allow animations to complete
            } else {
                console.log('No more images to load');
            }
            
            this.hideScrollLoading();
        } catch (error) {
            console.error('Error loading more images:', error);
            this.hideScrollLoading();
            // Don't show error state for load more failures, just log it
        }
    }

    /**
     * Render additional images and append to existing gallery with cascading animation
     * @param {Array} images - Array of new image objects
     */
    async renderMoreImages(images) {
        if (!images || images.length === 0) {
            return;
        }

        try {
            // First, create skeleton placeholders for the new images
            const startIndex = this.galleryContainer.children.length;
            this.renderSkeletonGridForMore(images.length, startIndex);

            // Preload new images in background
            await this.imagePreloader.preloadGalleryImages(images, images.length, (loaded, total) => {
                console.log(`Preloaded ${loaded}/${total} additional images`);
            });

            // Replace the placeholders as a coordinated batch so follow-up loads
            // wait for the full enter sequence to settle.
            await this.renderMoreImagesWithCascade(images, startIndex);

        } catch (error) {
            console.error('Error preloading additional images:', error);
            // Fallback to immediate rendering
            const fragment = document.createDocumentFragment();
            images.forEach(image => {
                const galleryItem = this.createGalleryItem(image);
                galleryItem.classList.add('loaded');
                fragment.appendChild(galleryItem);
            });
            this.galleryContainer.appendChild(fragment);
        }
    }

    /**
     * Render skeleton placeholders for additional images
     * @param {number} count - Number of skeleton items to render
     * @param {number} startIndex - Starting index for skeleton items
     */
    renderSkeletonGridForMore(count, startIndex) {
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < count; i++) {
            const skeletonItem = document.createElement('div');
            skeletonItem.className = 'gallery-item';
            skeletonItem.dataset.skeletonIndex = startIndex + i;

            const skeleton = document.createElement('div');
            skeleton.className = 'gallery-item-skeleton';
            
            skeletonItem.appendChild(skeleton);
            fragment.appendChild(skeletonItem);
        }

        this.galleryContainer.appendChild(fragment);
    }

    /**
     * Render additional images with cascading animation, replacing skeletons
     * @param {Array} images - Array of image objects
     * @param {number} startIndex - Starting index for the new images
     */
    async renderMoreImagesWithCascade(images, startIndex) {
        const allSkeletonItems = this.galleryContainer.querySelectorAll('[data-skeleton-index]');
        const newSkeletonItems = Array.from(allSkeletonItems).filter(item => {
            const index = parseInt(item.dataset.skeletonIndex);
            return index >= startIndex;
        });

        await this.renderBatchIntoSkeletons(images, newSkeletonItems, {
            eagerCount: this.calculatePriorityImages()
        });
    }

    /**
     * Render the gallery with images using preloading and cascading animation
     * @param {Array} images - Array of image objects
     */
    async renderGallery(images) {
        if (!images || images.length === 0) {
            this.showEmptyState();
            return;
        }

        // Show skeleton placeholders immediately
        this.renderSkeletonGrid(images.length);

        try {
            // Preload images in the background
            const priority = this.calculatePriorityImages();
            await this.imagePreloader.preloadGalleryImages(images, priority, (loaded, total) => {
                console.log(`Preloaded ${loaded}/${total} images`);
            });

            // Replace skeletons with real images using cascading animation
            await this.renderImagesWithCascade(images);

            // Trigger globe preloading after images are rendered
            this.triggerGlobePreloading(images);

        } catch (error) {
            console.error('Error rendering gallery with preloading:', error);
            // Fallback to immediate rendering without preloading
            this.renderGalleryImmediate(images);
            
            // Still try to preload globe even with fallback rendering
            this.triggerGlobePreloading(images);
        }
    }

    /**
     * Render skeleton placeholders immediately
     * @param {number} count - Number of skeleton items to render
     */
    renderSkeletonGrid(count) {
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < count; i++) {
            const skeletonItem = document.createElement('div');
            skeletonItem.className = 'gallery-item';
            skeletonItem.dataset.skeletonIndex = i;

            const skeleton = document.createElement('div');
            skeleton.className = 'gallery-item-skeleton';
            
            skeletonItem.appendChild(skeleton);
            fragment.appendChild(skeletonItem);
        }

        this.galleryContainer.appendChild(fragment);
    }

    /**
     * Calculate number of priority images based on viewport and zoom level
     * @returns {number} Number of priority images to load first
     */
    calculatePriorityImages() {
        // Estimate visible images based on zoom level and viewport
        const baseImages = this.currentZoom * 2; // 2 rows worth
        const mobileMultiplier = window.innerWidth <= 768 ? 1.5 : 1;
        return Math.ceil(baseImages * mobileMultiplier);
    }

    /**
     * Render images with cascading animation, replacing skeletons
     * @param {Array} images - Array of image objects
     */
    async renderImagesWithCascade(images) {
        const skeletonItems = this.galleryContainer.querySelectorAll('[data-skeleton-index]');

        await this.renderBatchIntoSkeletons(images, Array.from(skeletonItems), {
            eagerCount: this.calculatePriorityImages()
        });
    }

    /**
     * Replace a set of skeletons with one coordinated image batch.
     * @param {Array} images - Batch image objects
     * @param {Array<HTMLElement>} skeletonItems - Skeleton nodes to replace
     * @param {Object} options - Batch rendering options
     */
    async renderBatchIntoSkeletons(images, skeletonItems, options = {}) {
        if (!images || images.length === 0 || !skeletonItems || skeletonItems.length === 0) {
            return;
        }

        const batchId = `batch-${++this.enterBatchCounter}`;
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const eagerCount = Math.max(0, options.eagerCount || 0);
        const renderedItems = [];

        images.forEach((image, index) => {
            const skeletonItem = skeletonItems[index];
            if (!skeletonItem || !skeletonItem.parentNode) {
                return;
            }

            const galleryItem = this.createGalleryItem(image, {
                eager: index < eagerCount
            });

            galleryItem.dataset.enterBatch = batchId;
            galleryItem.style.setProperty('--enter-index', index.toString());
            skeletonItem.parentNode.replaceChild(galleryItem, skeletonItem);
            renderedItems.push(galleryItem);
        });

        if (renderedItems.length === 0) {
            return;
        }

        if (prefersReducedMotion) {
            renderedItems.forEach(item => {
                item.classList.add('loaded');
                item.style.removeProperty('--enter-index');
            });
            return;
        }

        this.isAnimating = true;
        await this.waitForNextPaint();

        renderedItems.forEach(item => {
            item.classList.add('is-entering');
        });

        await this.wait(this.getBatchSettleTime(renderedItems.length));

        renderedItems.forEach(item => {
            item.classList.remove('is-entering');
            item.classList.add('loaded');
            item.style.removeProperty('--enter-index');
        });

        this.isAnimating = false;
    }

    /**
     * Wait until the browser has painted pending DOM work.
     * @returns {Promise<void>}
     */
    waitForNextPaint() {
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    }

    /**
     * Wait for a specific duration.
     * @param {number} ms - Milliseconds to wait
     * @returns {Promise<void>}
     */
    wait(ms) {
        return new Promise(resolve => {
            window.setTimeout(resolve, ms);
        });
    }

    /**
     * Calculate how long a batch needs to finish entering.
     * @param {number} count - Number of items in the batch
     * @returns {number} Total settle time in ms
     */
    getBatchSettleTime(count) {
        if (count <= 0) {
            return 0;
        }

        return this.batchAnimationDurationMs + ((count - 1) * this.batchAnimationStaggerMs) + 60;
    }

    /**
     * Fallback rendering without preloading (immediate)
     * @param {Array} images - Array of image objects
     */
    renderGalleryImmediate(images) {
        // Clear any skeletons
        this.clearGallery();
        
        const fragment = document.createDocumentFragment();

        images.forEach(image => {
            const galleryItem = this.createGalleryItem(image);
            galleryItem.classList.add('loaded'); // Skip animation
            fragment.appendChild(galleryItem);
        });

        this.galleryContainer.appendChild(fragment);
    }

    /**
     * Create a gallery item element
     * @param {Object} image - Image object
     * @returns {HTMLElement} Gallery item element
     */
    createGalleryItem(image, options = {}) {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.dataset.imageId = image.id;

        // Create image element
        const img = document.createElement('img');
        img.className = 'gallery-item-image';
        img.src = image.thumbnailUrl;
        img.alt = image.description || 'Photo';
        img.loading = options.eager ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.fetchPriority = options.eager ? 'high' : 'low';

        // Handle image load errors
        img.onerror = () => {
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xNzUgMTI1SDE4NVYxMzVIMTc1VjEyNVoiIGZpbGw9IiM5Q0EzQUYiLz4KPHA+SW1hZ2UgTm90IEZvdW5kPC9wPgo8L3N2Zz4K';
        };

        // Only add the image - no metadata in grid view for minimal aesthetic
        item.appendChild(img);

        // Add click event to open modal
        item.addEventListener('click', () => {
            this.openImageModal(image.id);
        });

        // Add keyboard accessibility
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `View ${image.description || 'photo'} in fullscreen`);

        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openImageModal(image.id);
            }
        });

        return item;
    }

    /**
     * Open image in modal
     * @param {string} imageId - Image ID
     */
    openImageModal(imageId) {
        console.log('Gallery: Opening modal for image:', imageId);
        // Dispatch custom event for modal to handle
        const event = new CustomEvent('openModal', {
            detail: { imageId }
        });
        document.dispatchEvent(event);
    }

    /**
     * Truncate text to specified length
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength).trim() + '...';
    }

    /**
     * Format date for display
     * @param {string} timestamp - ISO timestamp
     * @returns {string} Formatted date
     */
    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    /**
     * Show loading state
     */
    showLoading() {
        this.loadingElement.classList.remove('hidden');
        this.galleryContainer.classList.add('hidden');
    }

    /**
     * Hide loading state
     */
    hideLoading() {
        this.loadingElement.classList.add('hidden');
        this.galleryContainer.classList.remove('hidden');
    }

    /**
     * Show error state
     */
    showError() {
        this.errorElement.classList.remove('hidden');
        this.galleryContainer.classList.add('hidden');
    }

    /**
     * Hide error state
     */
    hideError() {
        this.errorElement.classList.add('hidden');
    }

    /**
     * Show scroll loading indicator
     */
    showScrollLoading() {
        if (this.scrollLoadingElement) {
            this.scrollLoadingElement.classList.remove('hidden');
        }
    }

    /**
     * Hide scroll loading indicator
     */
    hideScrollLoading() {
        if (this.scrollLoadingElement) {
            this.scrollLoadingElement.classList.add('hidden');
        }
    }

    /**
     * Clear gallery container
     */
    clearGallery() {
        this.galleryContainer.innerHTML = '';
    }

    /**
     * Show empty state when no images are available
     */
    showEmptyState() {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #666;">
                <h3>_______</h3>
            </div>
        `;
        this.galleryContainer.appendChild(emptyState);
    }

    /**
     * Get all gallery items
     * @returns {NodeList} Gallery item elements
     */
    getGalleryItems() {
        return this.galleryContainer.querySelectorAll('.gallery-item');
    }

    /**
     * Highlight a specific gallery item
     * @param {string} imageId - Image ID to highlight
     */
    highlightItem(imageId) {
        // Remove existing highlights
        this.getGalleryItems().forEach(item => {
            item.classList.remove('highlighted');
        });

        // Add highlight to specified item
        const targetItem = this.galleryContainer.querySelector(`[data-image-id="${imageId}"]`);
        if (targetItem) {
            targetItem.classList.add('highlighted');
        }
    }

    /**
     * Remove all highlights
     */
    removeHighlights() {
        this.getGalleryItems().forEach(item => {
            item.classList.remove('highlighted');
        });
    }

    /**
     * Zoom in (reduce number of columns)
     */
    zoomIn() {
        if (this.currentZoom > this.minZoom) {
            this.currentZoom--;
            this.updateZoomState();
        }
    }

    /**
     * Zoom out (increase number of columns)
     */
    zoomOut() {
        if (this.currentZoom < this.maxZoom) {
            this.currentZoom++;
            this.updateZoomState();
        }
    }

    /**
     * Update the zoom state and apply CSS classes
     */
    updateZoomState() {
        // Remove all existing zoom classes
        for (let i = 1; i <= 6; i++) {
            this.galleryContainer.classList.remove(`zoom-${i}`);
        }

        // Add current zoom class
        this.galleryContainer.classList.add(`zoom-${this.currentZoom}`);

        // Update button states
        if (this.zoomInBtn) {
            this.zoomInBtn.disabled = this.currentZoom <= this.minZoom;
        }

        if (this.zoomOutBtn) {
            this.zoomOutBtn.disabled = this.currentZoom >= this.maxZoom;
        }

        // Store zoom preference
        this.storeZoomPreference(this.currentZoom);

        console.log(`Zoom level: ${this.currentZoom} columns`);
    }

    /**
     * Store zoom preference in localStorage
     * @param {number} value - Zoom level to store
     */
    storeZoomPreference(value) {
        try {
            localStorage.setItem('mirror-zoom', value.toString());
        } catch (e) {
            console.warn('Could not store zoom preference:', e);
        }
    }

    /**
     * Load zoom preference from localStorage
     * @returns {boolean} Whether a preference was loaded
     */
    loadZoomPreference() {
        try {
            const stored = localStorage.getItem('mirror-zoom');
            if (stored !== null) {
                const value = parseInt(stored);
                if (value >= this.minZoom && value <= this.maxZoom) {
                    this.currentZoom = value;
                    console.log(`Loaded zoom preference: ${value} columns`);
                    return true;
                }
            }
        } catch (e) {
            console.warn('Could not load zoom preference:', e);
        }
        return false;
    }

    /**
     * Handle scroll key press with improved repeat behavior
     * @param {number} distance - Distance to scroll in pixels
     * @param {boolean} isRepeat - Whether this is a key repeat event
     */
    handleScrollKey(distance, isRepeat) {
        const now = Date.now();
        
        if (!isRepeat) {
            // First key press - use smooth scrolling with full distance
            this.scrollState.isScrolling = true;
            this.scrollState.scrollDirection = distance;
            this.scrollState.lastScrollTime = now;
            this.scrollByDistance(distance);
        } else {
            // Key repeat - use faster, smaller increments for responsive hold-to-scroll
            const timeSinceLastScroll = now - this.scrollState.lastScrollTime;
            
            // Use instant scrolling for key repeats to feel more responsive
            if (timeSinceLastScroll > 16) { // ~60fps throttling
                const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
                const scrollIncrement = Math.sign(distance) * 50; // Smaller increments for smooth hold
                const targetScrollY = Math.max(0, currentScrollY + scrollIncrement);
                
                window.scrollTo({
                    top: targetScrollY,
                    behavior: 'instant' // Use instant for key repeats
                });
                
                this.scrollState.lastScrollTime = now;
            }
        }
    }

    /**
     * Scroll the page by a specific distance
     * @param {number} distance - Distance to scroll in pixels (negative for up, positive for down)
     */
    scrollByDistance(distance) {
        const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
        const targetScrollY = Math.max(0, currentScrollY + distance);
        
        window.scrollTo({
            top: targetScrollY,
            behavior: 'smooth'
        });
    }

    /**
     * Trigger globe preloading in background after images are loaded
     * @param {Array} images - Array of loaded images
     */
    triggerGlobePreloading(images) {
        // Only preload once and only if we have images
        if (this.globePreloaded || !images || images.length === 0) {
            return;
        }

        // Get the first image's location for preloading
        const firstImage = images[0];
        if (!firstImage || !firstImage.location) {
            console.log('Gallery: No location available for globe preloading');
            return;
        }

        // Start preloading in background with a small delay to not interfere with image rendering
        setTimeout(async () => {
            try {
                const preloadContainer = document.getElementById('globe-preload-container');
                if (!preloadContainer) {
                    console.warn('Gallery: Globe preload container not found');
                    return;
                }

                console.log('Gallery: Starting globe preloading for first image location:', firstImage.location);
                await this.globeService.preloadGlobe(preloadContainer, firstImage.location);
                this.globePreloaded = true;
                console.log('Gallery: Globe preloading completed successfully');
            } catch (error) {
                console.error('Gallery: Failed to preload globe:', error);
                this.globePreloaded = false;
            }
        }, 500); // Small delay to let image animations settle
    }

}

// Export for use in other modules
window.Gallery = Gallery;
