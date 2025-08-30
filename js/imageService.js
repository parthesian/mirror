/**
 * Image Service - Handles loading images from data source
 * This service is designed to be easily replaced with AWS S3 integration
 */
class ImageService {
    constructor() {
        this.images = [];
        this.isLoading = false;
    }

    /**
     * Fetch images from the data source
     * In production, this would connect to AWS S3
     * @returns {Promise<Array>} Array of image objects
     */
    async fetchImages() {
        this.isLoading = true;
        
        try {
            // Simulate API call delay
            await this.delay(1000);
            
            // Placeholder data - in production this would come from AWS
            const placeholderImages = this.generatePlaceholderImages();
            
            this.images = placeholderImages;
            this.isLoading = false;
            
            return this.images;
        } catch (error) {
            this.isLoading = false;
            throw new Error('Failed to fetch images: ' + error.message);
        }
    }

    /**
     * Get a specific image by ID
     * @param {string} id - Image ID
     * @returns {Object|null} Image object or null if not found
     */
    getImageById(id) {
        return this.images.find(image => image.id === id) || null;
    }

    /**
     * Get the index of an image in the collection
     * @param {string} id - Image ID
     * @returns {number} Index of the image or -1 if not found
     */
    getImageIndex(id) {
        return this.images.findIndex(image => image.id === id);
    }

    /**
     * Get the next image in the collection
     * @param {string} currentId - Current image ID
     * @returns {Object|null} Next image object or null
     */
    getNextImage(currentId) {
        const currentIndex = this.getImageIndex(currentId);
        if (currentIndex === -1) return null;
        
        const nextIndex = (currentIndex + 1) % this.images.length;
        return this.images[nextIndex];
    }

    /**
     * Get the previous image in the collection
     * @param {string} currentId - Current image ID
     * @returns {Object|null} Previous image object or null
     */
    getPreviousImage(currentId) {
        const currentIndex = this.getImageIndex(currentId);
        if (currentIndex === -1) return null;
        
        const prevIndex = currentIndex === 0 ? this.images.length - 1 : currentIndex - 1;
        return this.images[prevIndex];
    }

    /**
     * Generate placeholder images for development
     * In production, this would be replaced with AWS S3 API calls
     * @returns {Array} Array of placeholder image objects
     */
    generatePlaceholderImages() {
        const placeholderImages = [
            {
                id: 'img-001',
                title: 'Mountain Sunrise',
                description: 'A breathtaking sunrise over the Rocky Mountains, captured during an early morning hike. The golden light illuminates the peaks while morning mist dances through the valleys below.',
                location: 'Rocky Mountain National Park, Colorado',
                timestamp: '2024-03-15T06:30:00Z',
                url: 'https://picsum.photos/800/600?random=1',
                thumbnailUrl: 'https://picsum.photos/400/300?random=1'
            },
            {
                id: 'img-002',
                title: 'Ocean Waves',
                description: 'Powerful waves crash against the rugged coastline during a spectacular sunset. The interplay of light and water creates a mesmerizing display of natural beauty.',
                location: 'Big Sur, California',
                timestamp: '2024-03-10T19:45:00Z',
                url: 'https://picsum.photos/800/600?random=2',
                thumbnailUrl: 'https://picsum.photos/400/300?random=2'
            },
            {
                id: 'img-003',
                title: 'Forest Path',
                description: 'A winding path through an ancient forest, where shafts of sunlight filter through the canopy, creating a magical atmosphere perfect for contemplation.',
                location: 'Olympic National Park, Washington',
                timestamp: '2024-03-08T14:20:00Z',
                url: 'https://picsum.photos/800/600?random=3',
                thumbnailUrl: 'https://picsum.photos/400/300?random=3'
            },
            {
                id: 'img-004',
                title: 'Desert Landscape',
                description: 'The vast expanse of the desert stretches endlessly under a brilliant blue sky. Ancient rock formations tell stories of millions of years of geological history.',
                location: 'Joshua Tree National Park, California',
                timestamp: '2024-03-05T12:15:00Z',
                url: 'https://picsum.photos/800/600?random=4',
                thumbnailUrl: 'https://picsum.photos/400/300?random=4'
            },
            {
                id: 'img-005',
                title: 'City Skyline',
                description: 'The urban landscape comes alive at twilight, with countless lights beginning to twinkle as the city transitions from day to night.',
                location: 'Seattle, Washington',
                timestamp: '2024-03-01T20:30:00Z',
                url: 'https://picsum.photos/800/600?random=5',
                thumbnailUrl: 'https://picsum.photos/400/300?random=5'
            },
            {
                id: 'img-006',
                title: 'Autumn Leaves',
                description: 'Fall foliage creates a stunning tapestry of colors, with vibrant reds, oranges, and yellows painting the landscape in nature\'s finest palette.',
                location: 'Vermont',
                timestamp: '2024-02-28T15:45:00Z',
                url: 'https://picsum.photos/800/600?random=6',
                thumbnailUrl: 'https://picsum.photos/400/300?random=6'
            },
            {
                id: 'img-007',
                title: 'Snowy Mountains',
                description: 'Fresh powder snow blankets the mountain peaks, creating a pristine winter wonderland that sparkles under the clear blue sky.',
                location: 'Aspen, Colorado',
                timestamp: '2024-02-25T11:00:00Z',
                url: 'https://picsum.photos/800/600?random=7',
                thumbnailUrl: 'https://picsum.photos/400/300?random=7'
            },
            {
                id: 'img-008',
                title: 'Tropical Beach',
                description: 'Crystal clear turquoise waters meet pristine white sand beaches, while palm trees sway gently in the tropical breeze.',
                location: 'Maui, Hawaii',
                timestamp: '2024-02-20T16:20:00Z',
                url: 'https://picsum.photos/800/600?random=8',
                thumbnailUrl: 'https://picsum.photos/400/300?random=8'
            }
        ];

        return placeholderImages;
    }

    /**
     * Utility function to simulate async delay
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise} Promise that resolves after the delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Format timestamp for display
     * @param {string} timestamp - ISO timestamp string
     * @returns {string} Formatted date string
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Check if service is currently loading
     * @returns {boolean} Loading state
     */
    getLoadingState() {
        return this.isLoading;
    }
}

// Export for use in other modules
window.ImageService = ImageService;
