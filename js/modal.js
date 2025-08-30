/**
 * Modal - Handles the fullscreen image modal with navigation
 */
class Modal {
    constructor(imageService) {
        this.imageService = imageService;
        this.modal = document.getElementById('modal');
        this.modalImage = document.getElementById('modal-image');
        this.modalTitle = document.getElementById('modal-title');
        this.modalDescription = document.getElementById('modal-description');
        this.modalLocation = document.getElementById('modal-location');
        this.modalTimestamp = document.getElementById('modal-timestamp');
        this.closeBtn = document.getElementById('close-modal');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        
        this.currentImageId = null;
        this.isOpen = false;
        
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
        // Close button
        this.closeBtn.addEventListener('click', () => {
            this.close();
        });

        // Navigation buttons
        this.prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPreviousImage();
        });

        this.nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showNextImage();
        });

        // Click outside modal to close
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        // Prevent modal content clicks from closing modal
        this.modal.querySelector('.modal-content').addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen) return;

            switch (e.key) {
                case 'Escape':
                    this.close();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.showPreviousImage();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.showNextImage();
                    break;
            }
        });

        // Listen for custom open modal events
        document.addEventListener('openModal', (e) => {
            console.log('Modal: Received openModal event for image:', e.detail.imageId);
            this.open(e.detail.imageId);
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
        this.modalImage.alt = image.title;
        
        // Set text content
        this.modalTitle.textContent = image.title;
        this.modalDescription.textContent = image.description;
        this.modalLocation.textContent = image.location;
        this.modalTimestamp.textContent = this.imageService.formatTimestamp(image.timestamp);
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
                prevImage ? `Previous image: ${prevImage.title}` : 'Previous image');
            this.nextBtn.setAttribute('aria-label', 
                nextImage ? `Next image: ${nextImage.title}` : 'Next image');
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
