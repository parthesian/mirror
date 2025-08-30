/**
 * Modal - Handles the fullscreen image modal with navigation and upload functionality
 */
class Modal {
    constructor(imageService) {
        this.imageService = imageService;
        
        // View modal elements
        this.modal = document.getElementById('modal');
        this.modalImage = document.getElementById('modal-image');
        this.modalDescription = document.getElementById('modal-description');
        this.modalLocation = document.getElementById('modal-location');
        this.modalTimestamp = document.getElementById('modal-timestamp');
        this.globeContainer = document.getElementById('modal-globe');
        this.closeBtn = document.getElementById('close-modal');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        
        // Upload modal elements
        this.uploadModal = document.getElementById('upload-modal');
        this.uploadForm = document.getElementById('upload-form');
        this.uploadPasswordInput = document.getElementById('upload-password');
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
        
        this.currentImageId = null;
        this.isOpen = false;
        this.isUploadModalOpen = false;
        
        // Globe integration
        this.globeService = new GlobeService();
        
        this.init();
    }

    /**
     * Initialize the modal
     */
    init() {
        this.bindEvents();
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

        // Password input change event for validation
        this.uploadPasswordInput.addEventListener('input', async () => {
            await this.validatePassword();
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
            console.log('Modal: Received openModal event for image:', e.detail.imageId);
            this.open(e.detail.imageId);
        });

        document.addEventListener('openUploadModal', () => {
            this.openUploadModal();
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
    open(imageId) {
        console.log('Modal: Opening modal for image:', imageId);
        const image = this.imageService.getImageById(imageId);
        console.log('Modal: Found image:', image);
        if (!image) {
            console.error('Image not found:', imageId);
            return;
        }

        this.currentImageId = imageId;
        this.isOpen = true;
        
        console.log('Modal: Adding active class to modal');
        // Show modal
        this.modal.classList.remove('hidden');
        this.modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        
        console.log('Modal: Modal classes after adding active:', this.modal.className);
        
        // Load image content
        this.loadImageContent(image);
        
        // Update navigation button states
        this.updateNavigationButtons();
        
        // Focus management for accessibility
        this.closeBtn.focus();
        
        console.log('Modal: Modal should now be visible');
    }

    /**
     * Close modal
     */
    close() {
        this.isOpen = false;
        this.currentImageId = null;

        // Tear down globe
        if (this.globeService && this.globeContainer) {
            this.globeService.destroy(this.globeContainer);
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
        // Show loading state
        this.showImageLoading();
        
        // Set image
        this.modalImage.src = image.url;
        this.modalImage.alt = image.description || 'Photo';
        
        // Set text content
        this.modalDescription.textContent = image.description;
        this.modalLocation.textContent = image.location;
        this.modalTimestamp.textContent = this.imageService.formatTimestamp(image.timestamp);

        // Update animated globe under description
        this.updateGlobe(image.location);
    }

    /**
     * Update globe display under modal description
     */
    async updateGlobe(location) {
        try {
            if (!this.globeService || !this.globeContainer) return;
            
            // Hide by default; GlobeService will unhide on success
            this.globeContainer.classList.add('hidden');
            await this.globeService.createOrUpdate(this.globeContainer, location);
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
    showPreviousImage() {
        if (!this.currentImageId) return;
        
        const prevImage = this.imageService.getPreviousImage(this.currentImageId);
        if (prevImage) {
            this.currentImageId = prevImage.id;
            this.loadImageContent(prevImage);
            this.updateNavigationButtons();
        }
    }

    /**
     * Show next image
     */
    showNextImage() {
        if (!this.currentImageId) return;
        
        const nextImage = this.imageService.getNextImage(this.currentImageId);
        if (nextImage) {
            this.currentImageId = nextImage.id;
            this.loadImageContent(nextImage);
            this.updateNavigationButtons();
        }
    }

    /**
     * Update navigation button states
     */
    updateNavigationButtons() {
        const images = this.imageService.images;
        const currentIndex = this.imageService.getImageIndex(this.currentImageId);
        
        // Show/hide navigation buttons based on availability
        if (images.length <= 1) {
            this.prevBtn.style.display = 'none';
            this.nextBtn.style.display = 'none';
        } else {
            this.prevBtn.style.display = 'block';
            this.nextBtn.style.display = 'block';
        }
        
        // Update button accessibility labels
        const currentImage = this.imageService.getImageById(this.currentImageId);
        if (currentImage) {
            const prevImage = this.imageService.getPreviousImage(this.currentImageId);
            const nextImage = this.imageService.getNextImage(this.currentImageId);
            
            this.prevBtn.setAttribute('aria-label', 
                prevImage ? `Previous image: ${prevImage.description || 'Previous image'}` : 'Previous image');
            this.nextBtn.setAttribute('aria-label', 
                nextImage ? `Next image: ${nextImage.description || 'Next image'}` : 'Next image');
        }
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
    navigateToImage(imageId) {
        if (this.isOpen) {
            const image = this.imageService.getImageById(imageId);
            if (image) {
                this.currentImageId = imageId;
                this.loadImageContent(image);
                this.updateNavigationButtons();
            }
        } else {
            this.open(imageId);
        }
    }

    /**
     * Open upload modal
     */
    openUploadModal() {
        this.isUploadModalOpen = true;
        this.uploadModal.classList.remove('hidden');
        this.uploadModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Reset form
        this.resetUploadForm();
        
        // Focus on file input
        this.photoFileInput.focus();
    }

    /**
     * Close upload modal
     */
    closeUploadModal() {
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
        this.uploadForm.reset();
        this.filePreview.classList.add('hidden');
        this.uploadProgress.classList.add('hidden');
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

    /**
     * Validate password using secure client-side hashing
     * @returns {boolean} Whether password is valid
     */
    async validatePassword() {
        const password = this.uploadPasswordInput.value;
        
        if (!password) {
            this.submitUploadBtn.disabled = true;
            return false;
        }

        try {
            // Hash the password using SHA-256
            const encoder = new TextEncoder();
            const data = encoder.encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            // Compare with stored hash
            const isValid = hashHex === window.CONFIG?.UPLOAD_PASSWORD_HASH;
            
            // Enable/disable upload button based on password validity
            this.submitUploadBtn.disabled = !isValid;
            
            if (isValid) {
                this.hideUploadError();
            }
            
            return isValid;
        } catch (error) {
            console.error('Password validation error:', error);
            this.submitUploadBtn.disabled = true;
            return false;
        }
    }

    /**
     * Handle file selection
     * @param {Event} event - File input change event
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        
        if (!file) {
            // Reset to X icon when no file selected
            if (this.fileStatusIcon) {
                this.fileStatusIcon.textContent = '✕';
                this.fileStatusIcon.classList.remove('selected');
            }
            this.filePreview.classList.add('hidden');
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
            this.filePreview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);

        // Clear any previous errors
        this.hideUploadError();
    }

    /**
     * Handle upload form submission
     */
    async handleUploadSubmit() {
        const password = this.uploadPasswordInput.value;
        const file = this.photoFileInput.files[0];
        const location = this.photoLocationInput.value.trim();
        const description = this.photoDescriptionInput.value.trim();
        const timestampValue = this.photoTimestampInput.value;

        // Validate password first
        const isPasswordValid = await this.validatePassword();
        if (!isPasswordValid) {
            this.showUploadError('Invalid upload password. Please enter the correct password.');
            return;
        }

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
        this.uploadProgress.classList.remove('hidden');
        this.submitUploadBtn.disabled = true;
        this.submitUploadBtn.textContent = 'uploading';
    }

    /**
     * Hide upload progress
     */
    hideUploadProgress() {
        this.uploadProgress.classList.add('hidden');
        this.submitUploadBtn.disabled = false;
        this.submitUploadBtn.textContent = 'upload';
    }

    /**
     * Show upload error
     * @param {string} message - Error message
     */
    showUploadError(message) {
        this.uploadError.querySelector('p').textContent = message;
        this.uploadError.classList.remove('hidden');
    }

    /**
     * Hide upload error
     */
    hideUploadError() {
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
}

// Export for use in other modules
window.Modal = Modal;
