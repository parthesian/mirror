/**
 * Image Service - Handles loading and uploading images via AWS API Gateway
 */
class ImageService {
    constructor() {
        this.images = [];
        this.isLoading = false;
        this.apiBaseUrl = this.getApiBaseUrl();
    }

    /**
     * Get API base URL from config or fallback
     * @returns {string} API base URL
     */
    getApiBaseUrl() {
        // Try to get from config or use default
        return window.CONFIG?.API_BASE_URL;
    }

    /**
     * Fetch images from the AWS API
     * @returns {Promise<Array>} Array of image objects
     */
    async fetchImages() {
        this.isLoading = true;
        
        try {
            // Check if API base URL is configured
            if (!this.apiBaseUrl) {
                console.warn('API base URL not configured, using placeholder images');
                this.images = this.generatePlaceholderImages();
                this.isLoading = false;
                return this.images;
            }

            const response = await fetch(`${this.apiBaseUrl}/photos`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                mode: 'cors' // Explicitly set CORS mode
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('API Response received:', data);
            
            // Handle different possible response structures
            let photosArray = [];
            let actualData = data;
            
            // Check if response is wrapped in AWS API Gateway format
            if (data && data.body && typeof data.body === 'string') {
                try {
                    actualData = JSON.parse(data.body);
                    console.log('Parsed response body:', actualData);
                } catch (e) {
                    console.error('Failed to parse response body:', e);
                    actualData = data;
                }
            }
            
            if (actualData && Array.isArray(actualData)) {
                // Response is directly an array
                photosArray = actualData;
                console.log('Using direct array format, found', photosArray.length, 'photos');
            } else if (actualData && actualData.photos && Array.isArray(actualData.photos)) {
                // Response has photos property
                photosArray = actualData.photos;
                console.log('Using photos property format, found', photosArray.length, 'photos');
            } else if (actualData && actualData.Items && Array.isArray(actualData.Items)) {
                // DynamoDB response format
                photosArray = actualData.Items;
                console.log('Using DynamoDB Items format, found', photosArray.length, 'photos');
            } else {
                console.warn('Unexpected API response format:', actualData);
                photosArray = [];
            }
            
            // Transform API response to match our expected format
            this.images = photosArray.map(photo => ({
                id: photo.photoId || photo.id || `img-${Date.now()}-${Math.random()}`,
                description: photo.description || 'No description available',
                location: photo.location || 'Unknown location',
                timestamp: photo.timestamp || photo.createdAt || new Date().toISOString(),
                uploadedAt: photo.uploadedAt || photo.timestamp || new Date().toISOString(),
                url: photo.imageUrl || photo.url || '',
                thumbnailUrl: photo.thumbnailUrl || photo.imageUrl || photo.url || '',
                s3Key: photo.s3Key || photo.key || ''
            }));
            
            this.isLoading = false;
            return this.images;
        } catch (error) {
            this.isLoading = false;
            console.error('Failed to fetch images:', error);
            
            // If it's a CORS or network error, fall back to placeholder images
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                console.warn('Network error detected, using placeholder images');
                this.images = this.generatePlaceholderImages();
                return this.images;
            }
            
            throw new Error('Failed to fetch images: ' + error.message);
        }
    }

    /**
     * Upload a new photo to the API
     * @param {File} file - Image file to upload
     * @param {string} location - Required location information
     * @param {string} description - Optional description
     * @param {Object} timestamp - Optional timestamp object with day, month, year
     * @returns {Promise<Object>} Upload response
     */
    async uploadPhoto(file, location, description = '', timestamp = null) {
        try {
            // Check if API base URL is configured
            if (!this.apiBaseUrl) {
                throw new Error('API base URL not configured. Cannot upload photos.');
            }

            // Compress image if it's too large
            const compressedFile = await this.compressImage(file);
            
            // Convert file to base64
            const base64Data = await this.fileToBase64(compressedFile);
            
            // Remove data URL prefix to get just the base64 data
            const base64Only = base64Data.split(',')[1];
            
            const requestBody = {
                imageData: base64Only,
                location: location,
                description: description,
                contentType: compressedFile.type
            };

            // Add timestamp if provided
            if (timestamp) {
                requestBody.timestamp = timestamp;
            }

            console.log('Uploading photo with request body:', {
                location: requestBody.location,
                description: requestBody.description,
                contentType: requestBody.contentType,
                timestamp: requestBody.timestamp || 'not provided',
                imageDataSize: requestBody.imageData.length + ' characters'
            });

            const response = await fetch(`${this.apiBaseUrl}/photos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                mode: 'cors',
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                console.error('Upload failed with status:', response.status, response.statusText);
                if (response.status === 413) {
                    throw new Error('Image file is too large. Please try a smaller image or reduce the quality.');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('Upload response received:', result);
            
            // Refresh images after successful upload
            await this.fetchImages();
            
            return result;
        } catch (error) {
            console.error('Failed to upload photo:', error);
            
            // Handle specific error types
            if (error.message.includes('413') || error.message.includes('too large')) {
                throw new Error('Image file is too large. Please try a smaller image.');
            } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Network error. Please check your connection and try again.');
            }
            
            throw new Error('Failed to upload photo: ' + error.message);
        }
    }

    /**
     * Compress image to reduce file size
     * @param {File} file - Image file to compress
     * @param {number} maxWidth - Maximum width (default: 2560)
     * @param {number} maxHeight - Maximum height (default: 1440)
     * @param {number} quality - Compression quality 0-1 (default: 0.92)
     * @returns {Promise<File>} Compressed image file
     */
    compressImage(file, maxWidth = 2560, maxHeight = 1440, quality = 0.92) {
        return new Promise((resolve, reject) => {
            // If file is not an image, return as is
            if (!file.type.startsWith('image/')) {
                resolve(file);
                return;
            }

            // If file is already small enough, return as is
            if (file.size < 2 * 1024 * 1024) { // Less than 2MB
                resolve(file);
                return;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            img.onload = () => {
                // Calculate new dimensions
                let { width, height } = img;
                
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width *= ratio;
                    height *= ratio;
                }

                // Set canvas dimensions
                canvas.width = width;
                canvas.height = height;

                // Draw and compress
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            // Create new File object with compressed data
                            const compressedFile = new File([blob], file.name, {
                                type: file.type,
                                lastModified: Date.now()
                            });
                            resolve(compressedFile);
                        } else {
                            reject(new Error('Failed to compress image'));
                        }
                    },
                    file.type,
                    quality
                );
            };

            img.onerror = () => {
                reject(new Error('Failed to load image for compression'));
            };

            img.src = URL.createObjectURL(file);
        });
    }

    /**
     * Convert file to base64 data URL
     * @param {File} file - File to convert
     * @returns {Promise<string>} Base64 data URL
     */
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
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
                description: 'A breathtaking sunrise over the Rocky Mountains, captured during an early morning hike. The golden light illuminates the peaks while morning mist dances through the valleys below.',
                location: 'Rocky Mountain National Park, Colorado',
                timestamp: '2024-03-15T06:30:00Z',
                url: 'https://picsum.photos/800/600?random=1',
                thumbnailUrl: 'https://picsum.photos/400/300?random=1'
            },
            {
                id: 'img-002',
                description: 'Powerful waves crash against the rugged coastline during a spectacular sunset. The interplay of light and water creates a mesmerizing display of natural beauty.',
                location: 'Big Sur, California',
                timestamp: '2024-03-10T19:45:00Z',
                url: 'https://picsum.photos/800/600?random=2',
                thumbnailUrl: 'https://picsum.photos/400/300?random=2'
            },
            {
                id: 'img-003',
                description: 'A winding path through an ancient forest, where shafts of sunlight filter through the canopy, creating a magical atmosphere perfect for contemplation.',
                location: 'Olympic National Park, Washington',
                timestamp: '2024-03-08T14:20:00Z',
                url: 'https://picsum.photos/800/600?random=3',
                thumbnailUrl: 'https://picsum.photos/400/300?random=3'
            },
            {
                id: 'img-004',
                description: 'The vast expanse of the desert stretches endlessly under a brilliant blue sky. Ancient rock formations tell stories of millions of years of geological history.',
                location: 'Joshua Tree National Park, California',
                timestamp: '2024-03-05T12:15:00Z',
                url: 'https://picsum.photos/800/600?random=4',
                thumbnailUrl: 'https://picsum.photos/400/300?random=4'
            },
            {
                id: 'img-005',
                description: 'The urban landscape comes alive at twilight, with countless lights beginning to twinkle as the city transitions from day to night.',
                location: 'Seattle, Washington',
                timestamp: '2024-03-01T20:30:00Z',
                url: 'https://picsum.photos/800/600?random=5',
                thumbnailUrl: 'https://picsum.photos/400/300?random=5'
            },
            {
                id: 'img-006',
                description: 'Fall foliage creates a stunning tapestry of colors, with vibrant reds, oranges, and yellows painting the landscape in nature\'s finest palette.',
                location: 'Vermont',
                timestamp: '2024-02-28T15:45:00Z',
                url: 'https://picsum.photos/800/600?random=6',
                thumbnailUrl: 'https://picsum.photos/400/300?random=6'
            },
            {
                id: 'img-007',
                description: 'Fresh powder snow blankets the mountain peaks, creating a pristine winter wonderland that sparkles under the clear blue sky.',
                location: 'Aspen, Colorado',
                timestamp: '2024-02-25T11:00:00Z',
                url: 'https://picsum.photos/800/600?random=7',
                thumbnailUrl: 'https://picsum.photos/400/300?random=7'
            },
            {
                id: 'img-008',
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
        day: 'numeric'
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
