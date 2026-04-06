/**
 * Modal - Handles the fullscreen image modal and navigation
 */
class Modal {
    constructor(imageService, imagePreloader) {
        this.imageService = imageService;
        
        // View modal elements
        this.modal = document.getElementById('modal');
        this.modalImage = document.getElementById('modal-image');
        this.modalDescription = document.getElementById('modal-description');
        this.modalLocation = document.getElementById('modal-location');
        this.modalCameraRow = document.getElementById('modal-camera-row');
        this.modalCameraName = document.getElementById('modal-camera-name');
        this.modalCameraIconDslr = document.getElementById('modal-camera-icon-dslr');
        this.modalCameraIconMobile = document.getElementById('modal-camera-icon-mobile');
        this.modalTimestamp = document.getElementById('modal-timestamp');
        this.globeContainer = document.getElementById('modal-globe');
        this.closeBtn = document.getElementById('close-modal');
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
        
        // Globe integration
        this.globeService = new GlobeService();
        this.imagePreloader = imagePreloader || new ImagePreloader();
        
        this.init();
    }

    /**
     * Initialize the modal
     */
    init() {
        this.bindEvents();
        this.addSwipeSupport();
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // View modal events
        this.closeBtn.addEventListener('click', () => {
            this.close();
        });

        this.prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPreviousImage();
        });

        this.nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showNextImage();
        });

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        this.modal.querySelector('.modal-content').addEventListener('click', (e) => {
            e.stopPropagation();
        });

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

        // Handle image load events
        this.modalImage.addEventListener('load', () => {
            this.hideImageLoading();
        });

        this.modalImage.addEventListener('error', () => {
            this.handleImageError();
        });
    }

    /**
     * Open modal with specific image
     * @param {string} imageId - Image ID to display
     */
    async open(imageId) {
        const base = this.imageService.getImageById(imageId);
        if (!base) {
            console.error('Image not found:', imageId);
            return;
        }

        try {
            if (typeof this.imageService.ensurePhotoDetail === 'function') {
                await this.imageService.ensurePhotoDetail(imageId);
            }
        } catch (err) {
            console.error('Modal: failed to load photo metadata', err);
            return;
        }

        const image = this.imageService.getImageById(imageId);
        if (!image) {
            console.error('Image not found after detail load:', imageId);
            return;
        }

        this.currentImageId = imageId;
        this.isOpen = true;

        this.modal.classList.remove('hidden');
        this.modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        this.loadImageContent(image);

        this.updateNavigationButtons();

        this.closeBtn.focus();
    }

    /**
     * Close modal
     */
    close() {
        this.isOpen = false;
        this.currentImageId = null;
        this.isNavigating = false;

        // Keep globe instance alive for reuse across modal opens.
        if (this.globeContainer) {
            this.globeContainer.classList.add('hidden');
        }
        
        // Hide modal
        this.modal.classList.remove('active');
        this.modal.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
        
        // Clear image to prevent flash when reopening
        setTimeout(() => {
            if (!this.isOpen) {
                this.modalImage.src = '';
            }
        }, 300); // Match CSS transition duration
    }

    /**
     * Load image content into modal
     * @param {Object} image - Image object
     */
    loadImageContent(image) {
        this.modalImage.alt = image.description || 'Photo';

        if (image.thumbnailUrl && image.thumbnailUrl !== image.url) {
            this.modalImage.style.opacity = '1';
            this.modalImage.src = image.thumbnailUrl;

            this.imagePreloader.preloadImage(image.url).then((loaded) => {
                if (this.currentImageId === image.id && loaded) {
                    this.modalImage.src = image.url;
                    this.hideImageLoading();
                }
            });
        } else {
            this.showImageLoading();
            this.modalImage.src = image.url;
        }

        // Set text content
        this.modalDescription.textContent = image.description;
        this.modalLocation.textContent = image.location;
        this.modalTimestamp.textContent = this.imageService.formatTimestamp(image.timestamp);

        const camera = (image.camera || '').trim();
        if (camera && this.modalCameraRow && this.modalCameraName) {
            this.modalCameraRow.classList.remove('hidden');
            this.modalCameraName.textContent = camera;
            const mobile = Modal.isMobileCameraName(camera);
            if (this.modalCameraIconDslr) {
                this.modalCameraIconDslr.classList.toggle('hidden', mobile);
            }
            if (this.modalCameraIconMobile) {
                this.modalCameraIconMobile.classList.toggle('hidden', !mobile);
            }
        } else if (this.modalCameraRow) {
            this.modalCameraRow.classList.add('hidden');
        }

        this.updateGlobe({
            latitude: image.latitude,
            longitude: image.longitude,
            country: image.country,
            location: image.location
        });
        this.prefetchAdjacentImages(image.id);
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
     * Update globe display under modal description
     */
    async updateGlobe(locationOrOptions) {
        try {
            if (!this.globeService || !this.globeContainer) return;
            
            this.globeContainer.classList.add('hidden');

            if (this.globeService.instances.has(this.globeContainer)) {
                await this.globeService.createOrUpdate(this.globeContainer, locationOrOptions);
            } else {
                await this.globeService.transferOrCreate(this.globeContainer, locationOrOptions);
            }
            
            // If unsupported or failed, container will likely be empty; keep hidden
            if (!this.globeContainer.firstChild) {
                this.globeContainer.classList.add('hidden');
            }
        } catch (e) {
            console.warn('Modal.updateGlobe error:', e);
            if (this.globeService && this.globeContainer) {
                this.globeService.destroy(this.globeContainer);
                this.globeContainer.classList.add('hidden');
            }
        }
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
                if (typeof this.imageService.ensurePhotoDetail === 'function') {
                    await this.imageService.ensurePhotoDetail(prevImage.id);
                }
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
                if (typeof this.imageService.ensurePhotoDetail === 'function') {
                    await this.imageService.ensurePhotoDetail(nextImage.id);
                }
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
        const adjacentUrls = ['previous', 'next']
            .map((direction) => this.peekAdjacentImage(imageId, direction)?.url)
            .filter(Boolean);

        this.imagePreloader.prefetch(adjacentUrls, { concurrency: 2 });
    }

    /**
     * Show image loading state
     */
    showImageLoading() {
        this.modalImage.style.opacity = '0.5';
        // You could add a spinner here if desired
    }

    /**
     * Hide image loading state
     */
    hideImageLoading() {
        this.modalImage.style.opacity = '1';
    }

    /**
     * Handle image load error
     */
    handleImageError() {
        this.modalImage.style.opacity = '1';
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
                if (typeof this.imageService.ensurePhotoDetail === 'function') {
                    await this.imageService.ensurePhotoDetail(imageId);
                }
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
     * Add swipe gesture support for mobile devices
     */
    addSwipeSupport() {
        let startX = 0;
        let startY = 0;
        let endX = 0;
        let endY = 0;

        this.modalImage.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });

        this.modalImage.addEventListener('touchend', (e) => {
            endX = e.changedTouches[0].clientX;
            endY = e.changedTouches[0].clientY;
            
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            
            // Check if horizontal swipe is more significant than vertical
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                if (deltaX > 0) {
                    // Swipe right - show previous image
                    this.showPreviousImage();
                } else {
                    // Swipe left - show next image
                    this.showNextImage();
                }
            }
        });
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

// Export for use in other modules
window.Modal = Modal;
