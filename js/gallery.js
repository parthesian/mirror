/**
 * Gallery - Handles the display and interaction of images in the gallery grid
 */
class Gallery {
    constructor(imageService) {
        this.imageService = imageService;
        this.galleryContainer = document.getElementById('gallery-container');
        this.loadingElement = document.getElementById('loading');
        this.errorElement = document.getElementById('error-message');
        this.refreshBtn = document.getElementById('refresh-btn');
        
        this.init();
    }

    /**
     * Initialize the gallery
     */
    init() {
        this.bindEvents();
        this.loadImages();
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Refresh button
        this.refreshBtn.addEventListener('click', () => {
            this.loadImages();
        });

        // Upload button
        const uploadBtn = document.getElementById('upload-btn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('openUploadModal'));
            });
        }

        // Listen for photo uploaded event
        document.addEventListener('photoUploaded', () => {
            this.loadImages();
        });
    }

    /**
     * Load images from the image service
     */
    async loadImages() {
        try {
            this.showLoading();
            this.hideError();
            this.clearGallery();

            const images = await this.imageService.fetchImages();
            this.renderGallery(images);
            this.hideLoading();
        } catch (error) {
            console.error('Error loading images:', error);
            this.hideLoading();
            this.showError();
        }
    }

    /**
     * Render the gallery with images
     * @param {Array} images - Array of image objects
     */
    renderGallery(images) {
        if (!images || images.length === 0) {
            this.showEmptyState();
            return;
        }

        const fragment = document.createDocumentFragment();

        images.forEach(image => {
            const galleryItem = this.createGalleryItem(image);
            fragment.appendChild(galleryItem);
        });

        this.galleryContainer.appendChild(fragment);
    }

    /**
     * Create a gallery item element
     * @param {Object} image - Image object
     * @returns {HTMLElement} Gallery item element
     */
    createGalleryItem(image) {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.dataset.imageId = image.id;

        // Create image element
        const img = document.createElement('img');
        img.className = 'gallery-item-image';
        img.src = image.thumbnailUrl;
        img.alt = image.title;
        img.loading = 'lazy'; // Lazy loading for performance

        // Handle image load errors
        img.onerror = () => {
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xNzUgMTI1SDE4NVYxMzVIMTc1VjEyNVoiIGZpbGw9IiM5Q0EzQUYiLz4KPHA+SW1hZ2UgTm90IEZvdW5kPC9wPgo8L3N2Zz4K';
        };

        // Create info section
        const info = document.createElement('div');
        info.className = 'gallery-item-info';

        const title = document.createElement('h3');
        title.className = 'gallery-item-title';
        title.textContent = image.title;

        const description = document.createElement('p');
        description.className = 'gallery-item-description';
        description.textContent = this.truncateText(image.description, 100);

        const metadata = document.createElement('div');
        metadata.className = 'gallery-item-metadata';

        const location = document.createElement('span');
        location.className = 'metadata-item';
        location.textContent = image.location;

        const timestamp = document.createElement('span');
        timestamp.className = 'metadata-item';
        timestamp.textContent = this.formatDate(image.timestamp);

        metadata.appendChild(location);
        metadata.appendChild(timestamp);

        info.appendChild(title);
        info.appendChild(description);
        info.appendChild(metadata);

        item.appendChild(img);
        item.appendChild(info);

        // Add click event to open modal
        item.addEventListener('click', () => {
            this.openImageModal(image.id);
        });

        // Add keyboard accessibility
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `View ${image.title} in fullscreen`);

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
                <h3>No Images Found</h3>
                <p>There are no images to display at the moment.</p>
                <button class="btn" onclick="gallery.loadImages()">Try Again</button>
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
}

// Export for use in other modules
window.Gallery = Gallery;
