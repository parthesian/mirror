/**
 * Main Application - Initializes and coordinates all components
 */
class PhotoGalleryApp {
    constructor() {
        this.imageService = null;
        this.gallery = null;
        this.modal = null;
        
        this.init();
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            // Wait for DOM to be fully loaded
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    this.initializeComponents();
                });
            } else {
                this.initializeComponents();
            }
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.showInitializationError();
        }
    }

    /**
     * Initialize all components
     */
    initializeComponents() {
        try {
            // Initialize services
            this.imageService = new ImageService();
            
            // Initialize UI components
            this.gallery = new Gallery(this.imageService);
            this.modal = new Modal(this.imageService);
            
            // Swipe support is already enabled in modal constructor
            
            // Set up global error handling
            this.setupErrorHandling();
            
            // Make components globally accessible for debugging
            window.app = this;
            window.gallery = this.gallery;
            window.modal = this.modal;
            window.imageService = this.imageService;
            
            console.log('Photo Gallery App initialized successfully');
            
        } catch (error) {
            console.error('Error initializing components:', error);
            this.showInitializationError();
        }
    }

    /**
     * Set up global error handling
     */
    setupErrorHandling() {
        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.showError('An unexpected error occurred. Please refresh the page and try again.');
        });

        // Handle general JavaScript errors
        window.addEventListener('error', (event) => {
            console.error('JavaScript error:', event.error);
            // Don't show error for every JS error as it might be too intrusive
        });
    }

    /**
     * Show initialization error
     */
    showInitializationError() {
        const errorHtml = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 2rem;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 400px;
                z-index: 9999;
            ">
                <h3 style="color: #e74c3c; margin-bottom: 1rem;">
                    Initialization Error
                </h3>
                <p style="margin-bottom: 1.5rem; color: #666;">
                    Failed to initialize the photo gallery. Please refresh the page and try again.
                </p>
                <button onclick="window.location.reload()" style="
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 0.75rem 1.5rem;
                    border-radius: 4px;
                    cursor: pointer;
                ">
                    Refresh Page
                </button>
            </div>
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                z-index: 9998;
            "></div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', errorHtml);
    }

    /**
     * Show general error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        // Create a temporary error notification
        const errorNotification = document.createElement('div');
        errorNotification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #e74c3c;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            max-width: 300px;
            animation: slideIn 0.3s ease;
        `;
        
        errorNotification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span>⚠️</span>
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="
                    background: none;
                    border: none;
                    color: white;
                    cursor: pointer;
                    margin-left: auto;
                    font-size: 1.2rem;
                ">&times;</button>
            </div>
        `;
        
        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(errorNotification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (errorNotification.parentElement) {
                errorNotification.remove();
            }
        }, 5000);
    }

    /**
     * Refresh the gallery
     */
    async refreshGallery() {
        if (this.gallery) {
            await this.gallery.loadImages();
        }
    }

    /**
     * Open image in modal by ID
     * @param {string} imageId - Image ID to open
     */
    openImage(imageId) {
        if (this.modal) {
            this.modal.navigateToImage(imageId);
        }
    }

    /**
     * Get application state for debugging
     * @returns {Object} Application state
     */
    getState() {
        return {
            imagesLoaded: this.imageService ? this.imageService.images.length : 0,
            isLoading: this.imageService ? this.imageService.getLoadingState() : false,
            modalOpen: this.modal ? this.modal.isModalOpen() : false,
            currentImage: this.modal ? this.modal.getCurrentImageId() : null
        };
    }

    /**
     * Enable debug mode with additional logging
     */
    enableDebugMode() {
        console.log('Debug mode enabled');
        
        // Log all custom events
        ['openModal'].forEach(eventType => {
            document.addEventListener(eventType, (e) => {
                console.log(`Event: ${eventType}`, e.detail);
            });
        });
        
        // Log state changes
        const originalOpen = this.modal.open.bind(this.modal);
        this.modal.open = (imageId) => {
            console.log('Modal opening with image:', imageId);
            return originalOpen(imageId);
        };
        
        const originalClose = this.modal.close.bind(this.modal);
        this.modal.close = () => {
            console.log('Modal closing');
            return originalClose();
        };
        
        console.log('Current state:', this.getState());
    }
}

// Initialize the application
const app = new PhotoGalleryApp();

// Export for global access
window.PhotoGalleryApp = PhotoGalleryApp;
