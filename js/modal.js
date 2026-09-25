/**
 * Modal - Handles the fullscreen image modal and navigation
 */
class Modal {
    constructor(imageService, imagePreloader, globeService) {
        this.imageService = imageService;
        
        // View modal elements
        this.modal = document.getElementById('modal');
        this.modalImage = document.getElementById('modal-image');
        this.modalDescription = document.getElementById('modal-description');
        this.modalLocation = document.getElementById('modal-location');
        this.modalCountry = document.getElementById('modal-country');
        this.modalCameraRow = document.getElementById('modal-camera-row');
        this.modalCameraName = document.getElementById('modal-camera-name');
        this.modalCameraIconDslr = document.getElementById('modal-camera-icon-dslr');
        this.modalCameraIconMobile = document.getElementById('modal-camera-icon-mobile');
        this.modalCameraIconTlr = document.getElementById('modal-camera-icon-tlr');
        this.modalTimestamp = document.getElementById('modal-timestamp');
        this.globeContainer = document.getElementById('modal-globe');
        this.modalCopy = this.modal?.querySelector('.modal-copy');
        this.modalContent = this.modal?.querySelector('.modal-content');
        this.modalImageContainer = this.modal?.querySelector('.modal-image-container');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        
        // Upload modal elements
        this.uploadModal = document.getElementById('upload-modal');
        this.uploadForm = document.getElementById('upload-form');
        this.photoFileInput = document.getElementById('photo-file');
        this.photoLocationInput = document.getElementById('photo-location');
        this.photoDescriptionInput = document.getElementById('photo-description');
        this.photoTimestampInput = document.getElementById('photo-timestamp');
        this.filePreview = document.getElementById('file-preview');
        this.previewImage = document.getElementById('preview-image');
        this.closeUploadBtn = document.getElementById('close-upload-modal');
        this.cancelUploadBtn = document.getElementById('cancel-upload');
        this.submitUploadBtn = document.getElementById('submit-upload');
        this.uploadProgress = document.getElementById('upload-progress');
        this.uploadError = document.getElementById('upload-error');
        
        // File input elements for custom styling
        this.fileStatusIcon = document.getElementById('file-status-icon');
        this.hasUploadUi = Boolean(
            this.uploadModal &&
            this.uploadForm &&
            this.photoFileInput &&
            this.photoLocationInput &&
            this.submitUploadBtn
        );
        
        this.currentImageId = null;
        this.isOpen = false;
        this.isUploadModalOpen = false;
        this.isNavigating = false;
        this._photoLayoutReady = false;
        this._layoutAnimTimer = 0;
        this._resizeTimer = 0;
        this._safeAreaTop = null;
        this._photoToken = 0;
        this._photoStage = 'placeholder';
        this._frameAspect = 0;
        
        // Globe integration — share the gallery preload instance so the
        // hidden warmup actually transfers into the modal.
        this.globeService = globeService || new GlobeService();
        this.imagePreloader = imagePreloader || new ImagePreloader();
        
        this.init();
    }

    /**
     * Initialize the modal
     */
    init() {
        this.setPhotoSource(Modal.BLANK_SRC, 'placeholder');
        this.bindEvents();
        this.addSwipeSupport();
        this.addDismissGesture();
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        this.prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPreviousImage();
        });

        this.nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showNextImage();
        });

        this.modal.addEventListener('click', (e) => {
            if (!this.isOpen) return;
            if (this.isKeepOpenTarget(e.target)) return;
            this.close();
        });

        this.globeContainer?.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.openCurrentImageInGlobeExplorer();
        });

        window.addEventListener('resize', () => {
            if (!this.isOpen) return;
            window.clearTimeout(this._resizeTimer);
            this._resizeTimer = window.setTimeout(() => this.onViewportChange(), 120);
        }, { passive: true });

        // Upload modal events
        if (this.hasUploadUi) {
            this.closeUploadBtn.addEventListener('click', () => {
                this.closeUploadModal();
            });

            this.cancelUploadBtn.addEventListener('click', () => {
                this.closeUploadModal();
            });

            this.uploadModal.addEventListener('click', (e) => {
                if (e.target === this.uploadModal) {
                    this.closeUploadModal();
                }
            });

            this.uploadModal.querySelector('.modal-content').addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // File input change event
            this.photoFileInput.addEventListener('change', (e) => {
                this.handleFileSelect(e);
            });

            // Form submission
            this.uploadForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleUploadSubmit();
            });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (this.isUploadModalOpen && e.key === 'Escape') {
                this.closeUploadModal();
                return;
            }
            
            if (!this.isOpen) return;

            switch (e.key) {
                case 'Escape':
                    this.close();
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault();
                    this.showPreviousImage();
                    break;
                case 'ArrowRight':
                case 'ArrowDown':
                    e.preventDefault();
                    this.showNextImage();
                    break;
                case ' ':
                case 'Enter':
                    e.preventDefault();
                    // Optional: Could toggle play/pause or other functionality
                    break;
            }
        });

        // Listen for custom events
        document.addEventListener('openModal', (e) => {
            void this.open(e.detail.imageId);
        });

        this.modalImage.addEventListener('load', () => {
            if (this._photoStage === 'placeholder' || this._photoStage === 'error') return;
            this.refinePhotoPlacementFromNaturalSize();
        });

        this.modalImage.addEventListener('error', () => {
            if (this._photoStage === 'thumb') {
                this.setPhotoSource(Modal.BLANK_SRC, 'placeholder');
                return;
            }
            if (this._photoStage === 'full') {
                this.handleImageError();
            }
        });
    }

    /**
     * Open modal with specific image. The photo is on screen in the same
     * frame as the click; metadata fills in when it arrives.
     * @param {string} imageId - Image ID to display
     */
    async open(imageId) {
        const image = this.imageService.getImageById(imageId);
        if (!image) {
            console.error('Image not found:', imageId);
            return;
        }

        this.currentImageId = imageId;
        this.isOpen = true;

        this.modal.classList.remove('hidden');
        this.modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        this.loadImageContent(image);

        this.updateNavigationButtons();

        this.modal.focus({ preventScroll: true });
    }

    /**
     * The photo and its globe stay interactive. Everything else — metadata,
     * padding, the dimmed field — dismisses the overlay.
     */
    isKeepOpenTarget(target) {
        if (!target || !target.closest) return false;
        return Boolean(
            target.closest('#modal-image') ||
            target.closest('#modal-globe') ||
            target.closest('.nav-btn')
        );
    }

    /**
     * Close modal
     */
    close() {
        this.isOpen = false;
        this.currentImageId = null;
        this.isNavigating = false;
        this.clearPhotoPlacement();

        // Keep globe instance alive for reuse across modal opens, but
        // stop the hidden 60fps loop until the next photo needs it.
        this.hideModalGlobe();
        
        // Hide modal
        this.modal.classList.remove('active');
        this.modal.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
        
        // An empty src paints the broken-image glyph on the next open, so
        // park a transparent pixel instead once the fade-out is done.
        this._photoToken += 1;
        setTimeout(() => {
            if (!this.isOpen) {
                this.setPhotoSource(Modal.BLANK_SRC, 'placeholder');
            }
        }, 300); // Match CSS transition duration
    }

    formatLocationWithState(image) {
        if (window.LocationModel?.formatWithRegion) {
            return window.LocationModel.formatWithRegion({
                location: image?.location,
                state: image?.state
            });
        }
        const location = String(image?.location || '').trim();
        const state = String(image?.state || '').trim();
        if (!state || state.toLowerCase() === location.toLowerCase()) {
            return location;
        }
        return location ? `${location}, ${state}` : state;
    }

    /**
     * Load image content into modal
     * @param {Object} image - Image object
     */
    loadImageContent(image) {
        this.showPhoto(image);
        this.renderDetails(image);
        this.prefetchAdjacentImages(image.id);

        if (!image.detailLoaded && typeof this.imageService.ensurePhotoDetail === 'function') {
            this.imageService.ensurePhotoDetail(image.id).then((detailed) => {
                if (!detailed || !this.isOpen || this.currentImageId !== image.id) return;
                if (Math.abs(this.getPhotoAspect(detailed) - this._frameAspect) > 0.02) {
                    this.applyPhotoPlacement(detailed, { animate: this.shouldAnimatePhotoLayout() });
                }
                this.renderDetails(detailed);
                this.updateNavigationButtons();
            }).catch((err) => {
                console.error('Modal: failed to load photo metadata', err);
            });
        }
    }

    /**
     * Progressive photo: the frame is sized from the known aspect before any
     * pixels arrive, the grid's already-decoded thumbnail fills it at once,
     * and the full image replaces it only after it has decoded — so the box
     * never changes size and the swap reads as the photo sharpening.
     */
    showPhoto(image) {
        const token = ++this._photoToken;
        this.applyPhotoPlacement(image, { animate: this.shouldAnimatePhotoLayout() });
        this.modalImage.alt = image.description || 'Photo';

        const fullUrl = image.url;
        const thumbUrl = image.thumbnailUrl && image.thumbnailUrl !== fullUrl ? image.thumbnailUrl : null;
        const isCurrent = () => token === this._photoToken;

        if (this.imagePreloader.isImageLoaded(fullUrl)) {
            this.setPhotoSource(fullUrl, 'full');
            return;
        }

        if (thumbUrl && this.imagePreloader.isImageLoaded(thumbUrl)) {
            this.setPhotoSource(thumbUrl, 'thumb');
        } else {
            this.setPhotoSource(Modal.BLANK_SRC, 'placeholder');
            if (thumbUrl) {
                this.imagePreloader.preloadImage(thumbUrl).then((loaded) => {
                    if (loaded && isCurrent() && this._photoStage === 'placeholder') {
                        this.setPhotoSource(thumbUrl, 'thumb');
                    }
                });
            }
        }

        // A failed or timed-out preload still hands the URL to the <img> so
        // the browser can finish it or surface the error state.
        this.imagePreloader.preloadImage(fullUrl).then(() => {
            if (isCurrent()) {
                this.setPhotoSource(fullUrl, 'full');
            }
        });
    }

    setPhotoSource(url, stage) {
        this._photoStage = stage;
        this.modalImage.classList.toggle('is-placeholder', stage === 'placeholder');
        if (this.modalImage.getAttribute('src') !== url) {
            this.modalImage.src = url;
        }
    }

    renderDetails(image) {
        this.modalImage.alt = image.description || 'Photo';
        this.modalDescription.textContent = image.description || '';
        const place = this.formatLocationWithState(image);
        this.modalLocation.textContent = place;
        this.modalLocation.classList.toggle('hidden', !place);
        this.modalTimestamp.textContent = this.imageService.formatTimestamp(image.timestamp);

        const country = String(image.country || '').trim();
        if (country && this.modalCountry) {
            this.modalCountry.classList.remove('hidden');
            this.modalCountry.textContent = country;
        } else if (this.modalCountry) {
            this.modalCountry.classList.add('hidden');
            this.modalCountry.textContent = '';
        }

        const camera = (image.camera || '').trim();
        if (camera && this.modalCameraRow && this.modalCameraName) {
            this.modalCameraRow.classList.remove('hidden');
            this.modalCameraName.textContent = camera;
            this.applyCameraIcon(camera);
        } else if (this.modalCameraRow) {
            this.modalCameraRow.classList.add('hidden');
            this.modalCameraRow.classList.remove('is-tlr');
        }

        this.syncModalGlobeSize();
        // List rows carry no coordinates; wait for the detail record rather
        // than spinning the globe to nowhere and back.
        if (image.detailLoaded) {
            this.updateGlobe({
                latitude: image.latitude,
                longitude: image.longitude,
                country: image.country,
                location: image.location
            });
        }
    }

    isVerticalModal() {
        return Boolean(window.matchMedia?.('(max-width: 768px)')?.matches);
    }

    prefersReducedMotion() {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    }

    shouldAnimatePhotoLayout() {
        return this._photoLayoutReady && this.isVerticalModal() && !this.prefersReducedMotion();
    }

    globeIsShowing() {
        return Boolean(
            this.globeContainer
            && !this.globeContainer.classList.contains('hidden')
            && this.globeContainer.firstChild
        );
    }

    hideModalGlobe() {
        if (!this.globeContainer) {
            return;
        }
        this.globeService?.pause?.(this.globeContainer);
        this.globeContainer.classList.add('hidden');
        this.globeContainer.style.width = '';
        this.globeContainer.style.height = '';
    }

    onViewportChange() {
        if (!this.isOpen) {
            return;
        }
        this._safeAreaTop = null;
        const image = this.imageService.getImageById(this.currentImageId);
        if (image) {
            this.applyPhotoPlacement(image, { animate: false });
        }
        this.syncModalGlobeSize();
    }

    getPhotoAspect(image) {
        const ratio = Number(image?.aspectRatio);
        if (image?.aspectRatioKnown && Number.isFinite(ratio) && ratio > 0) {
            return ratio;
        }
        const thumb = this.imagePreloader.getLoadedImage(image?.thumbnailUrl);
        if (thumb?.naturalWidth && thumb?.naturalHeight) {
            return thumb.naturalWidth / thumb.naturalHeight;
        }
        if (Number.isFinite(ratio) && ratio > 0) {
            return ratio;
        }
        return 4 / 3;
    }

    getSafeAreaTop() {
        if (this._safeAreaTop != null) {
            return this._safeAreaTop;
        }
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
        document.body.appendChild(probe);
        this._safeAreaTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
        probe.remove();
        return this._safeAreaTop;
    }

    /**
     * Match the mobile max-height / width caps in CSS so reserved frames
     * land on the same size the image would have used on its own.
     */
    verticalPhotoMetrics() {
        const narrow = Boolean(window.matchMedia?.('(max-width: 480px)')?.matches);
        const containerWidth = this.modalImageContainer?.clientWidth
            || this.modalContent?.clientWidth
            || window.innerWidth;
        return {
            maxHeight: window.innerHeight * (narrow ? 0.62 : 0.68),
            maxWidth: Math.min(narrow ? window.innerWidth * 0.95 : Infinity, containerWidth),
            minOffset: Math.max(narrow ? 8 : 12, this.getSafeAreaTop())
        };
    }

    measurePhotoBox(image) {
        const aspect = this.getPhotoAspect(image);
        const { maxHeight, maxWidth } = this.verticalPhotoMetrics();
        let width = Math.max(1, maxWidth);
        let height = width / aspect;
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspect;
        }
        return { width, height, aspect };
    }

    /**
     * Sit the photo around 65% of the way up the screen. Tall frames clamp
     * to the safe top so they are not cropped.
     */
    computePhotoOffset(photoHeight) {
        const { minOffset } = this.verticalPhotoMetrics();
        const padTop = parseFloat(getComputedStyle(this.modalContent).paddingTop) || 0;
        const anchor = window.innerHeight * 0.35;
        return Math.max(minOffset, Math.round(anchor - padTop - photoHeight / 2));
    }

    beginLayoutAnimation(container) {
        const from = container.getBoundingClientRect();
        const fromMargin = parseFloat(getComputedStyle(container).marginTop) || 0;
        this.modalContent.classList.remove('modal-layout-animating');
        container.style.height = `${Math.round(from.height)}px`;
        container.style.marginTop = `${Math.round(fromMargin)}px`;
        void container.offsetHeight;
        this.modalContent.classList.add('modal-layout-animating');
    }

    scheduleLayoutAnimEnd() {
        window.clearTimeout(this._layoutAnimTimer);
        this._layoutAnimTimer = window.setTimeout(() => {
            this.modalContent?.classList.remove('modal-layout-animating');
        }, 580);
    }

    applyPhotoPlacement(image, { animate = false } = {}) {
        const container = this.modalImageContainer;
        if (!container || !this.modalContent) {
            return;
        }

        if (!this.isVerticalModal()) {
            this.clearPhotoPlacement();
            this.sizePhotoFrame(this.measureDesktopPhotoBox(image));
            return;
        }

        const box = this.measurePhotoBox(image);
        this.sizePhotoFrame(box);
        const offset = this.computePhotoOffset(box.height);

        if (animate) {
            this.beginLayoutAnimation(container);
        } else {
            this.modalContent.classList.remove('modal-layout-animating');
        }

        this.modalContent.classList.add('modal-photo-placed');
        container.style.height = `${Math.round(box.height)}px`;
        container.style.marginTop = `${offset}px`;
        this.modalContent.style.setProperty('--modal-photo-w', `${Math.round(box.width)}px`);
        this._photoLayoutReady = true;

        if (animate) {
            this.scheduleLayoutAnimEnd();
        }
    }

    /**
     * Desktop mirror of the CSS caps (container width, 90vh). Photos are
     * never enlarged past their stored pixel size.
     */
    measureDesktopPhotoBox(image) {
        const aspect = this.getPhotoAspect(image);
        const container = this.modalImageContainer;
        const maxWidth = Math.max(1, container?.clientWidth || window.innerWidth * 0.6);
        const maxHeight = Math.max(1, Math.min(container?.clientHeight || window.innerHeight, window.innerHeight * 0.9));
        let width = maxWidth;
        let height = width / aspect;
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspect;
        }
        const storedWidth = Number(image?.width);
        if (storedWidth > 0 && width > storedWidth) {
            width = storedWidth;
            height = width / aspect;
        }
        return { width, height, aspect };
    }

    /**
     * Pin the <img> box so a small thumbnail is stretched into the final
     * frame instead of rendering at its own pixel size first.
     */
    sizePhotoFrame(box) {
        if (!this.modalImage || !box) {
            return;
        }
        this.modalImage.style.width = `${Math.round(box.width)}px`;
        this.modalImage.style.height = `${Math.round(box.height)}px`;
        this._frameAspect = box.aspect;
    }

    refinePhotoPlacementFromNaturalSize() {
        if (!this.isOpen || !this.modalImage) {
            return;
        }
        const image = this.imageService.getImageById(this.currentImageId);
        if (!image) {
            return;
        }
        const { naturalWidth: width, naturalHeight: height } = this.modalImage;
        if (!width || !height) {
            return;
        }
        const natural = width / height;
        const matchesFrame = Math.abs(this._frameAspect - natural) < 0.02;
        if (image.aspectRatioKnown && matchesFrame) {
            return;
        }
        image.aspectRatio = natural;
        image.aspectRatioKnown = true;
        if (matchesFrame) {
            return;
        }
        this.applyPhotoPlacement(image, { animate: this._photoLayoutReady && !this.prefersReducedMotion() });
    }

    clearPhotoPlacement() {
        this._photoLayoutReady = false;
        window.clearTimeout(this._layoutAnimTimer);
        this._layoutAnimTimer = 0;
        if (!this.modalContent || !this.modalImageContainer) {
            return;
        }
        this.modalContent.classList.remove('modal-layout-animating', 'modal-photo-placed');
        this.modalImageContainer.style.height = '';
        this.modalImageContainer.style.marginTop = '';
        this.modalContent.style.removeProperty('--modal-photo-w');
    }

    /**
     * Resolve whether navigation is available even if an older cached ImageService is loaded.
     * @returns {boolean} Whether navigation controls should be shown
     */
    hasNavigableImages() {
        if (typeof this.imageService.hasNavigableImages === 'function') {
            return this.imageService.hasNavigableImages();
        }

        const images = Array.isArray(this.imageService.images) ? this.imageService.images : [];
        return images.length > 1 || Boolean(this.imageService.hasMore);
    }

    /**
     * Peek at an adjacent image with compatibility fallback for older ImageService instances.
     * @param {string} imageId - Current image ID
     * @param {'previous'|'next'} direction - Navigation direction
     * @returns {Object|null} Adjacent image if already known
     */
    peekAdjacentImage(imageId, direction) {
        if (typeof this.imageService.peekAdjacentImage === 'function') {
            return this.imageService.peekAdjacentImage(imageId, direction);
        }

        if (direction === 'previous' && typeof this.imageService.getPreviousImage === 'function') {
            return this.imageService.getPreviousImage(imageId);
        }

        if (direction === 'next' && typeof this.imageService.getNextImage === 'function') {
            return this.imageService.getNextImage(imageId);
        }

        return null;
    }

    /**
     * Navigate with compatibility fallback for older ImageService instances.
     * @param {string} imageId - Current image ID
     * @param {'previous'|'next'} direction - Navigation direction
     * @returns {Promise<Object|null>} Resolved adjacent image
     */
    async getAdjacentImage(imageId, direction) {
        if (typeof this.imageService.getAdjacentImage === 'function') {
            return this.imageService.getAdjacentImage(imageId, direction);
        }

        return this.peekAdjacentImage(imageId, direction);
    }

    /**
     * On a phone the globe sits beside the facts and matches their height.
     * Desktop keeps the fixed 160px disc. Does not touch the explorer globe.
     */
    syncModalGlobeSize() {
        const globe = this.globeContainer;
        const copy = this.modalCopy;
        if (!globe || globe.classList.contains('hidden')) {
            return;
        }

        const beside = Boolean(window.matchMedia?.('(max-width: 768px)')?.matches);
        if (!beside || !copy) {
            globe.style.width = '';
            globe.style.height = '';
        } else {
            const height = Math.round(copy.getBoundingClientRect().height);
            if (height > 0) {
                const size = Math.min(height, Math.round(window.innerWidth * 0.42));
                globe.style.width = `${size}px`;
                globe.style.height = `${size}px`;
            }
        }

        this.globeService?.instances?.get(globe)?.onResize?.();
    }

    /**
     * Update globe display under modal description
     */
    async updateGlobe(locationOrOptions) {
        try {
            if (!this.globeService || !this.globeContainer) return;

            const keepVisible = this.globeIsShowing();
            if (!keepVisible) {
                this.globeContainer.classList.add('hidden');
            }
            this.globeContainer.removeAttribute('title');

            if (this.globeService.instances.has(this.globeContainer)) {
                await this.globeService.createOrUpdate(this.globeContainer, locationOrOptions);
            } else {
                await this.globeService.transferOrCreate(this.globeContainer, locationOrOptions);
            }
            
            // If unsupported or failed, container will likely be empty; keep hidden
            if (!this.globeContainer.firstChild) {
                this.hideModalGlobe();
            } else {
                this.globeContainer.setAttribute('title', 'Open globe explorer at this location');
                this.syncModalGlobeSize();
            }
        } catch (e) {
            console.warn('Modal.updateGlobe error:', e);
            if (this.globeService && this.globeContainer) {
                this.globeService.destroy(this.globeContainer);
                this.hideModalGlobe();
            }
        }
    }

    async openCurrentImageInGlobeExplorer() {
        if (!this.currentImageId) return;
        const image = this.imageService.getImageById(this.currentImageId);
        if (!image || !window.app?.globeExplorer) return;

        this.close();
        await window.app.globeExplorer.open({
            id: image.id,
            latitude: image.latitude,
            longitude: image.longitude,
            country: image.country,
            state: image.state,
            location: image.location
        });
    }

    /**
     * Show previous image
     */
    async showPreviousImage() {
        if (!this.currentImageId || this.isNavigating) return;

        this.isNavigating = true;
        try {
            const prevImage = await this.getAdjacentImage(this.currentImageId, 'previous');
            if (prevImage) {
                const resolved = this.imageService.getImageById(prevImage.id) || prevImage;
                this.currentImageId = resolved.id;
                this.loadImageContent(resolved);
            }
        } finally {
            this.isNavigating = false;
            this.updateNavigationButtons();
        }
    }

    /**
     * Show next image
     */
    async showNextImage() {
        if (!this.currentImageId || this.isNavigating) return;

        this.isNavigating = true;
        try {
            const nextImage = await this.getAdjacentImage(this.currentImageId, 'next');
            if (nextImage) {
                const resolved = this.imageService.getImageById(nextImage.id) || nextImage;
                this.currentImageId = resolved.id;
                this.loadImageContent(resolved);
            }
        } finally {
            this.isNavigating = false;
            this.updateNavigationButtons();
        }
    }

    /**
     * Update navigation button states
     */
    updateNavigationButtons() {
        if (!this.hasNavigableImages()) {
            this.prevBtn.style.display = 'none';
            this.nextBtn.style.display = 'none';
        } else {
            this.prevBtn.style.display = 'block';
            this.nextBtn.style.display = 'block';
        }

        this.prevBtn.disabled = this.isNavigating;
        this.nextBtn.disabled = this.isNavigating;
        
        // Update button accessibility labels
        const currentImage = this.imageService.getImageById(this.currentImageId);
        if (currentImage) {
            const prevImage = this.peekAdjacentImage(this.currentImageId, 'previous');
            const nextImage = this.peekAdjacentImage(this.currentImageId, 'next');

            const label = (img) => {
                if (!img) return 'image';
                if (img.description) return img.description;
                if (img.timestamp) return this.imageService.formatTimestamp(img.timestamp);
                return 'image';
            };

            this.prevBtn.setAttribute('aria-label',
                prevImage ? `Previous image: ${label(prevImage)}` : 'Previous image');
            this.nextBtn.setAttribute('aria-label',
                nextImage ? `Next image: ${label(nextImage)}` : 'Next image');
        }
    }

    /**
     * Prefetch adjacent full-size images for instant modal navigation.
     * @param {string} imageId - Current image ID
     */
    prefetchAdjacentImages(imageId) {
        const adjacent = ['previous', 'next']
            .map((direction) => this.peekAdjacentImage(imageId, direction))
            .filter(Boolean);

        this.imagePreloader.prefetch(adjacent.map((image) => image.url).filter(Boolean), { concurrency: 2 });
        if (typeof this.imageService.ensurePhotoDetail === 'function') {
            for (const image of adjacent) {
                if (!image.detailLoaded) {
                    this.imageService.ensurePhotoDetail(image.id).catch(() => {});
                }
            }
        }
    }

    /**
     * Handle image load error
     */
    handleImageError() {
        this.setPhotoSource(Modal.BLANK_SRC, 'error');
        this.modalImage.classList.remove('is-placeholder');
        this.modalImage.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgdmlld0JveD0iMCAwIDgwMCA2MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI4MDAiIGhlaWdodD0iNjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0zNzUgMjc1SDQyNVYzMjVIMzc1VjI3NVoiIGZpbGw9IiM5Q0EzQUYiLz4KPHA+SW1hZ2UgTm90IEZvdW5kPC9wPgo8L3N2Zz4K';
        
        // Show error message in description
        this.modalDescription.innerHTML = `
            <span style="color: #e74c3c;">
                <strong>Error:</strong> Failed to load image. The image may be unavailable or the URL may be incorrect.
            </span>
        `;
    }

    /**
     * Get current image ID
     * @returns {string|null} Current image ID
     */
    getCurrentImageId() {
        return this.currentImageId;
    }

    /**
     * Check if modal is open
     * @returns {boolean} Modal open state
     */
    isModalOpen() {
        return this.isOpen;
    }

    /**
     * Navigate to specific image by ID
     * @param {string} imageId - Image ID to navigate to
     */
    async navigateToImage(imageId) {
        if (this.isOpen) {
            const image = this.imageService.getImageById(imageId);
            if (image) {
                const resolved = this.imageService.getImageById(imageId) || image;
                this.currentImageId = imageId;
                this.loadImageContent(resolved);
                this.updateNavigationButtons();
            }
        } else {
            await this.open(imageId);
        }
    }

    /**
     * Open upload modal
     */
    openUploadModal() {
        if (!this.hasUploadUi) {
            return;
        }

        this.isUploadModalOpen = true;
        this.uploadModal.classList.remove('hidden');
        this.uploadModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Reset form
        this.resetUploadForm();
        
        // Initialize custom calendars for any date inputs in the modal
        if (window.initializeCustomCalendars) {
            setTimeout(() => {
                window.initializeCustomCalendars();
            }, 100); // Small delay to ensure modal is fully rendered
        }
        
        // Focus on file input
        this.photoFileInput.focus();
    }

    /**
     * Close upload modal
     */
    closeUploadModal() {
        if (!this.hasUploadUi) {
            return;
        }

        this.isUploadModalOpen = false;
        this.uploadModal.classList.remove('active');
        this.uploadModal.classList.add('hidden');
        document.body.style.overflow = '';
        
        // Reset form
        this.resetUploadForm();
    }

    /**
     * Reset upload form
     */
    resetUploadForm() {
        if (!this.hasUploadUi) {
            return;
        }

        this.uploadForm.reset();
        this.uploadProgress.classList.remove('active');
        this.uploadError.classList.add('hidden');
        this.previewImage.src = '';
        
        // Reset file status icon
        if (this.fileStatusIcon) {
            this.fileStatusIcon.textContent = '✕';
            this.fileStatusIcon.classList.remove('selected');
        }
        
        // Disable upload button initially
        this.submitUploadBtn.disabled = true;
    }

    handleFileSelect(event) {
        if (!this.hasUploadUi) {
            return;
        }

        const file = event.target.files[0];
        
        if (!file) {
            // Reset to X icon when no file selected
            if (this.fileStatusIcon) {
                this.fileStatusIcon.textContent = '✕';
                this.fileStatusIcon.classList.remove('selected');
            }
            this.previewImage.src = '';
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.showUploadError('Please select a valid image file.');
            if (this.fileStatusIcon) {
                this.fileStatusIcon.textContent = '✕';
                this.fileStatusIcon.classList.remove('selected');
            }
            return;
        }

        // No file size limit since we compress images

        // Update icon to checkmark when file is successfully selected
        if (this.fileStatusIcon) {
            this.fileStatusIcon.textContent = '✓';
            this.fileStatusIcon.classList.add('selected');
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            this.previewImage.src = e.target.result;
        };
        reader.readAsDataURL(file);

        // Clear any previous errors
        this.hideUploadError();
    }

    /**
     * Handle upload form submission
     */
    async handleUploadSubmit() {
        if (!this.hasUploadUi) {
            return;
        }

        const file = this.photoFileInput.files[0];
        const location = this.photoLocationInput.value.trim();
        const description = this.photoDescriptionInput.value.trim();
        const timestampValue = this.photoTimestampInput.value;

        // Validate required fields
        if (!file) {
            this.showUploadError('Please select a photo to upload.');
            return;
        }

        if (!location) {
            this.showUploadError('Please enter a location for the photo.');
            return;
        }

        // Parse timestamp if provided
        let timestamp = null;
        if (timestampValue) {
            const date = new Date(timestampValue);
            timestamp = {
                day: date.getDate(),
                month: date.getMonth() + 1, // JavaScript months are 0-indexed
                year: date.getFullYear()
            };
        }

        try {
            // Show progress
            this.showUploadProgress();
            this.hideUploadError();

            // Upload photo with optional timestamp
            const result = await this.imageService.uploadPhoto(file, location, description, timestamp);

            // Success - reset button state before closing modal
            this.hideUploadProgress();
            this.closeUploadModal();
            
            // Dispatch event to refresh gallery
            document.dispatchEvent(new CustomEvent('photoUploaded', {
                detail: { result }
            }));

        } catch (error) {
            console.error('Upload failed:', error);
            this.hideUploadProgress();
            this.showUploadError(error.message || 'Failed to upload photo. Please try again.');
        }
    }

    /**
     * Show upload progress
     */
    showUploadProgress() {
        if (!this.hasUploadUi) {
            return;
        }

        this.uploadProgress.classList.add('active');
        this.submitUploadBtn.disabled = true;
        this.submitUploadBtn.textContent = 'uploading';
    }

    /**
     * Hide upload progress
     */
    hideUploadProgress() {
        if (!this.hasUploadUi) {
            return;
        }

        this.uploadProgress.classList.remove('active');
        this.submitUploadBtn.disabled = false;
        this.submitUploadBtn.textContent = 'upload';
    }

    /**
     * Show upload error
     * @param {string} message - Error message
     */
    showUploadError(message) {
        if (!this.hasUploadUi) {
            return;
        }

        this.uploadError.querySelector('p').textContent = message;
        this.uploadError.classList.remove('hidden');
    }

    /**
     * Hide upload error
     */
    hideUploadError() {
        if (!this.hasUploadUi) {
            return;
        }

        this.uploadError.classList.add('hidden');
    }

    /**
     * One tracker for swipe-to-navigate and pull-to-dismiss. A gesture runs
     * from the first finger down until the last finger lifts, so the stray
     * finger left over from a pinch can never be read as a swipe. Listeners
     * are passive and nothing moves until the gesture ends, so native
     * pinch-zoom and scrolling stay untouched.
     */
    addSwipeSupport() {
        const surface = this.modalContent || this.modal;
        if (!surface) return;

        let gesture = null;

        const findTouch = (list, id) => {
            for (let i = 0; i < list.length; i++) {
                if (list[i].identifier === id) return list[i];
            }
            return null;
        };

        surface.addEventListener('touchstart', (e) => {
            if (!this.isOpen) return;
            if (gesture) {
                gesture.multiTouch = true;
                return;
            }
            const touch = e.touches[0];
            gesture = {
                id: touch.identifier,
                startX: touch.clientX,
                startY: touch.clientY,
                lastX: touch.clientX,
                lastY: touch.clientY,
                startTime: performance.now(),
                multiTouch: e.touches.length > 1,
                zoomed: Modal.isPageZoomed(),
                onImage: Boolean(e.target.closest?.('#modal-image')),
                onGlobe: Boolean(e.target.closest?.('#modal-globe')),
                startScroll: surface.scrollTop || 0
            };
        }, { passive: true });

        surface.addEventListener('touchmove', (e) => {
            if (!gesture) return;
            if (e.touches.length > 1) gesture.multiTouch = true;
            const touch = findTouch(e.touches, gesture.id);
            if (touch) {
                gesture.lastX = touch.clientX;
                gesture.lastY = touch.clientY;
            }
        }, { passive: true });

        const finish = (e, cancelled) => {
            if (!gesture || e.touches.length > 0) return;
            const g = gesture;
            gesture = null;
            if (cancelled || !this.isOpen) return;

            const touch = findTouch(e.changedTouches, g.id);
            const action = Modal.classifyTouchGesture({
                dx: (touch ? touch.clientX : g.lastX) - g.startX,
                dy: (touch ? touch.clientY : g.lastY) - g.startY,
                duration: performance.now() - g.startTime,
                multiTouch: g.multiTouch,
                zoomed: g.zoomed || Modal.isPageZoomed(),
                onImage: g.onImage,
                onGlobe: g.onGlobe,
                atTop: g.startScroll <= 1 && (surface.scrollTop || 0) <= 1,
                viewportWidth: window.innerWidth
            });

            if (action === 'next') this.showNextImage();
            else if (action === 'previous') this.showPreviousImage();
            else if (action === 'dismiss') this.close();
        };

        surface.addEventListener('touchend', (e) => finish(e, false), { passive: true });
        surface.addEventListener('touchcancel', (e) => finish(e, true), { passive: true });
    }

    /**
     * Decide what a finished single-finger gesture meant. Pinches, pans on a
     * zoomed page, and diagonal drags return null so the photo stays put.
     * Swipes count as either a quick flick or a deliberate drag across a
     * good share of the screen, and must be clearly horizontal.
     */
    static classifyTouchGesture({
        dx = 0,
        dy = 0,
        duration = 0,
        multiTouch = false,
        zoomed = false,
        onImage = false,
        onGlobe = false,
        atTop = false,
        viewportWidth = 390
    } = {}) {
        if (multiTouch || zoomed || onGlobe) {
            return null;
        }

        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (onImage && absX > absY * 1.8) {
            const speed = absX / Math.max(1, duration);
            const flick = absX >= 40 && speed >= 0.4 && duration <= 350;
            const drag = absX >= Math.min(140, viewportWidth * 0.3);
            if (flick || drag) {
                return dx < 0 ? 'next' : 'previous';
            }
            return null;
        }

        if (atTop && dy > 72 && dy > absX * 1.15) {
            return 'dismiss';
        }
        return null;
    }

    /**
     * True while the page is pinch-zoomed; one-finger drags then pan the
     * zoomed photo instead of navigating or dismissing.
     */
    static isPageZoomed(win = typeof window !== 'undefined' ? window : null) {
        const scale = Number(win?.visualViewport?.scale);
        return Number.isFinite(scale) && scale > 1.02;
    }

    /**
     * Pull down past the top of the overlay (trackpad or wheel) to return to
     * the gallery. Touch pulls are handled by the shared gesture tracker.
     */
    addDismissGesture() {
        const scroller = this.modalContent || this.modal;
        if (!scroller) return;

        let wheelPull = 0;

        scroller.addEventListener('wheel', (e) => {
            if (!this.isOpen) return;
            const atTop = (scroller.scrollTop || 0) <= 0;
            if (atTop && e.deltaY < 0) {
                wheelPull += -e.deltaY;
                if (wheelPull > 140) {
                    wheelPull = 0;
                    this.close();
                }
                return;
            }
            wheelPull = 0;
        }, { passive: true });
    }

    applyCameraIcon(name) {
        const kind = Modal.cameraIconKind(name);
        if (this.modalCameraRow) {
            this.modalCameraRow.classList.toggle('is-tlr', kind === 'tlr');
        }
        if (this.modalCameraIconDslr) {
            this.modalCameraIconDslr.classList.toggle('hidden', kind !== 'dslr');
        }
        if (this.modalCameraIconMobile) {
            this.modalCameraIconMobile.classList.toggle('hidden', kind !== 'mobile');
        }
        if (this.modalCameraIconTlr) {
            this.modalCameraIconTlr.classList.toggle('hidden', kind !== 'tlr');
        }
    }

    /**
     * Pick the camera glyph: Rolleicord uses the twin-lens mark, phones use
     * the mobile mark, everything else uses the SLR body.
     * @param {string} name - Camera or device name from metadata
     * @returns {'tlr'|'mobile'|'dslr'}
     */
    static cameraIconKind(name) {
        if (Modal.isTlrCameraName(name)) {
            return 'tlr';
        }
        if (Modal.isMobileCameraName(name)) {
            return 'mobile';
        }
        return 'dslr';
    }

    /**
     * Twin-lens Rolleicord (and close family names) use the stacked-lens glyph.
     * @param {string} name - Camera or device name from metadata
     * @returns {boolean} Whether to show the TLR icon
     */
    static isTlrCameraName(name) {
        const n = (name || '').toLowerCase();
        if (!n.trim()) {
            return false;
        }
        return n.includes('rolleicord') || n.includes('rolleiflex') || /\btlr\b/.test(n);
    }

    /**
     * Heuristic for icon: common phone / tablet device strings use the mobile glyph.
     * @param {string} name - Camera or device name from metadata
     * @returns {boolean} Whether to show the mobile icon
     */
    static isMobileCameraName(name) {
        const n = (name || '').toLowerCase();
        if (!n.trim()) {
            return false;
        }
        const mobileHints = [
            'iphone', 'ipad', 'ipod', 'pixel', 'galaxy', 'samsung', 'oneplus', 'one plus', '1+', 'xiaomi', 'huawei', 'oppo',
            'vivo', 'motorola', 'lg-', 'nokia', 'mobile', 'phone', 'android', 'sm-', 'rmx', 'redmi', 'honor',
            'realme', 'nothing phone', 'asus_z'
        ];
        return mobileHints.some((h) => n.includes(h));
    }
}

/** Transparent 1×1 GIF: a valid, instantly decoded "nothing" for the viewer. */
Modal.BLANK_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

if (typeof window !== 'undefined') {
    window.Modal = Modal;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Modal;
}
