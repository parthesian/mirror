/**
 * Main Application - Initializes and coordinates all components
 */
class PhotoGalleryApp {
    constructor() {
            this.imageService = null;
        this.gallery = null;
        this.modal = null;
        this.timeline = null;
        this.viewMode = null;
        this.filmEffects = null;
        this.globeExplorer = null;
        
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
            window.notifications.showInitializationError();
        }
    }

    /**
     * Initialize all components
     */
    initializeComponents() {
        try {
            // Initialize services
            this.imageService = new ImageService();
            this.imagePreloader = new ImagePreloader();
            
            // Initialize UI components
            this.gallery = new Gallery(this.imageService, this.imagePreloader);
            this.modal = new Modal(this.imageService, this.imagePreloader);
            this.timeline = new Timeline(this.imageService, this.gallery);
            this.viewMode = new ViewMode(this.imageService, this.gallery, this.timeline);
            this.filmEffects = new FilmEffects();
            this.globeExplorer = new GlobeExplorer(this.imageService);
            
            // Set up global error handling
            this.setupErrorHandling();
            
            // Make components globally accessible for debugging
            window.app = this;
            window.gallery = this.gallery;
            window.modal = this.modal;
            window.timeline = this.timeline;
            window.viewMode = this.viewMode;
            window.imageService = this.imageService;
        } catch (error) {
            console.error('Error initializing components:', error);
            window.notifications.showInitializationError();
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
        window.notifications.showInitializationError();
    }

    /**
     * Show general error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        window.notifications.showError(message);
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
            currentImage: this.modal ? this.modal.getCurrentImageId() : null,
            viewMode: this.imageService ? this.imageService.viewMode : 'chrono'
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
