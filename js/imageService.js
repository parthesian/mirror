/**
 * Image Service - Handles loading and uploading images via AWS API Gateway
 */
class ImageService {
    constructor() {
        this.images = [];
        this.isLoading = false;
        this.apiBaseUrl = this.getApiBaseUrl();
        this.currentPage = 0;
        this.limit = 54;
        this.hasMore = true;
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
     * Load initial photos from the AWS API
     * @returns {Promise<Array>} Array of image objects
     */
    async fetchImages() {
        this.isLoading = true;
        
        try {
            // Reset pagination state for initial load
            this.currentPage = 1;
            this.hasMore = true;
            
            // Check if API base URL is configured
            if (!this.apiBaseUrl) {
                console.warn('API base URL not configured, using placeholder images');
                this.images = []
                this.hasMore = false;
                this.isLoading = false;
                return this.images;
            }

            const response = await fetch(`${this.apiBaseUrl}/photos?page=${this.currentPage}&limit=${this.limit}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                mode: 'cors'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Initial photos API response:', data);
            
            // Parse the actual response - check if data is wrapped in body property
            let parsedData = data;
            if (data.body && typeof data.body === 'string') {
                try {
                    parsedData = JSON.parse(data.body);
                } catch (parseError) {
                    console.error('Failed to parse response body:', parseError);
                    throw new Error('Invalid API response format');
                }
            }
            
            // Handle the paginated API response format
            if (parsedData && parsedData.photos && Array.isArray(parsedData.photos)) {
                // Transform API response to match our expected format
                this.images = parsedData.photos.map(photo => ({
                    id: photo.photoId || photo.id || `img-${Date.now()}-${Math.random()}`,
                    description: photo.description || 'No description available',
                    location: photo.location || 'Unknown location',
                    timestamp: photo.timestamp || photo.createdAt || new Date().toISOString(),
                    uploadedAt: photo.uploadedAt || photo.timestamp || new Date().toISOString(),
                    url: photo.imageUrl || photo.url || '',
                    thumbnailUrl: photo.thumbnailUrl || photo.imageUrl || photo.url || '',
                    s3Key: photo.s3Key || photo.key || ''
                }));
                
                // Update pagination state based on response
                this.hasMore = parsedData.hasMore !== undefined ? parsedData.hasMore : (parsedData.photos.length === this.limit);
                
                console.log(`Loaded ${this.images.length} initial photos (page ${this.currentPage}). Has more: ${this.hasMore}`);
            } else {
                console.warn('Unexpected API response format:', parsedData);
                this.images = [];
                this.hasMore = false;
            }
            
            this.isLoading = false;
            return this.images;
        } catch (error) {
            this.isLoading = false;
            console.error('Failed to fetch images:', error);
            
            // If it's a CORS or network error, fall back to placeholder images
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                console.warn('Network error detected, using placeholder images');
                this.images = []
                this.hasMore = false;
                return this.images;
            }
            
            throw new Error('Failed to fetch images: ' + error.message);
        }
    }

    /**
     * Load more photos for infinite scrolling
     * @returns {Promise<Array>} Array of newly loaded image objects
     */
    async loadMorePhotos() {
        // Don't load if already loading or no more photos available
        if (this.isLoading || !this.hasMore) {
            return [];
        }

        this.isLoading = true;
        
        try {
            // Check if API base URL is configured
            if (!this.apiBaseUrl) {
                console.warn('API base URL not configured');
                this.isLoading = false;
                return [];
            }

            // Increment page for next batch
            this.currentPage++;

            const response = await fetch(`${this.apiBaseUrl}/photos?page=${this.currentPage}&limit=${this.limit}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                mode: 'cors'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log(`Load more photos API response (page ${this.currentPage}):`, data);
            
            // Parse the actual response - check if data is wrapped in body property
            let parsedData = data;
            if (data.body && typeof data.body === 'string') {
                try {
                    parsedData = JSON.parse(data.body);
                } catch (parseError) {
                    console.error('Failed to parse response body:', parseError);
                    throw new Error('Invalid API response format');
                }
            }
            
            let newPhotos = [];
            
            // Handle the paginated API response format
            if (parsedData && parsedData.photos && Array.isArray(parsedData.photos)) {
                // Transform API response to match our expected format
                newPhotos = parsedData.photos.map(photo => ({
                    id: photo.photoId || photo.id || `img-${Date.now()}-${Math.random()}`,
                    description: photo.description || 'No description available',
                    location: photo.location || 'Unknown location',
                    timestamp: photo.timestamp || photo.createdAt || new Date().toISOString(),
                    uploadedAt: photo.uploadedAt || photo.timestamp || new Date().toISOString(),
                    url: photo.imageUrl || photo.url || '',
                    thumbnailUrl: photo.thumbnailUrl || photo.imageUrl || photo.url || '',
                    s3Key: photo.s3Key || photo.key || ''
                }));
                
                // Append new photos to existing collection
                this.images = [...this.images, ...newPhotos];
                
                // Update pagination state - if we got fewer photos than requested, we've reached the end
                this.hasMore = parsedData.hasMore !== undefined ? parsedData.hasMore : (newPhotos.length === this.limit);
                
                console.log(`Loaded ${newPhotos.length} more photos (page ${this.currentPage}). Total: ${this.images.length}. Has more: ${this.hasMore}`);
            } else {
                console.warn('Unexpected API response format for load more:', parsedData);
                this.hasMore = false;
            }
            
            this.isLoading = false;
            return newPhotos;
        } catch (error) {
            this.isLoading = false;
            console.error('Failed to load more photos:', error);
            // Decrement page on error so we can retry
            this.currentPage--;
            throw new Error('Failed to load more photos: ' + error.message);
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
