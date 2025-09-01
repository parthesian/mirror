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
                background: rgba(255, 255, 255, 0.95);
                padding: 2rem;
                border-radius: 4px;
                border: 1px solid #ccc;
                backdrop-filter: blur(10px);
                text-align: center;
                max-width: 400px;
                z-index: 9999;
                font-family: 'Helvetica Neue', Arial, sans-serif;
            ">
                <h3 style="
                    color: #333;
                    margin-bottom: 1rem;
                    font-size: 1.1rem;
                    font-weight: 300;
                    letter-spacing: 0.05em;
                    text-transform: uppercase;
                ">
                    Initialization Error
                </h3>
                <p style="
                    margin-bottom: 1.5rem;
                    color: #666;
                    font-size: 0.9rem;
                    line-height: 1.4;
                    font-weight: 300;
                ">
                    Failed to initialize the photo gallery. Please refresh the page and try again.
                </p>
                <button onclick="window.location.reload()" style="
                    background: #666;
                    color: white;
                    border: 1px solid #666;
                    padding: 0.75rem 1.5rem;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.9rem;
                    font-family: 'Helvetica Neue', Arial, sans-serif;
                    letter-spacing: 0.02em;
                    transition: all 0.3s ease;
                " onmouseover="this.style.background='#333'; this.style.borderColor='#333';" 
                   onmouseout="this.style.background='#666'; this.style.borderColor='#666';">
                    Refresh Page
                </button>
            </div>
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(168, 168, 168, 0.8);
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
            background: rgba(255, 255, 255, 0.95);
            color: #333;
            padding: 1rem 1.5rem;
            border-radius: 4px;
            border: 1px solid #ccc;
            backdrop-filter: blur(10px);
            z-index: 10000;
            max-width: 300px;
            font-family: 'Helvetica Neue', Arial, sans-serif;
            font-size: 0.9rem;
            font-weight: 300;
            animation: slideIn 0.3s ease;
        `;
        
        errorNotification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="color: #666; font-size: 1rem;">⚠</span>
                <span style="flex: 1; line-height: 1.4;">${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="
                    background: transparent;
                    border: 1px solid #999;
                    color: #666;
                    cursor: pointer;
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    font-size: 1rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                    flex-shrink: 0;
                " onmouseover="this.style.borderColor='#333'; this.style.color='#333';" 
                   onmouseout="this.style.borderColor='#999'; this.style.color='#666';">&times;</button>
            </div>
        `;
        
        // Add animation styles if not already present
        if (!document.querySelector('#error-slide-animation')) {
            const style = document.createElement('style');
            style.id = 'error-slide-animation';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
        
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
