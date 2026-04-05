/**
 * Image Service - Handles loading and uploading images via Cloudflare Pages Functions
 */
class ImageService {
    constructor() {
        this.images = [];
        this.isLoading = false;
        this.apiBaseUrl = this.getApiBaseUrl();
        this.limit = 24;
        this.hasMore = true;
        this.nextCursor = null;
    }

    /**
     * Get API base URL from config or fallback
     * @returns {string} API base URL
     */
    getApiBaseUrl() {
        const configuredBaseUrl = (window.CONFIG?.API_BASE_URL || '').trim();
        return configuredBaseUrl.endsWith('/')
            ? configuredBaseUrl.slice(0, -1)
            : configuredBaseUrl;
    }

    /**
     * Build a fully qualified API URL.
     * @param {string} path - API path
     * @returns {string} Fully qualified URL
     */
    buildApiUrl(path) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return this.apiBaseUrl ? `${this.apiBaseUrl}${normalizedPath}` : normalizedPath;
    }

    /**
     * Parse API responses, including legacy API Gateway wrappers.
     * @param {Response} response - Fetch response
     * @returns {Promise<Object>} Parsed response body
     */
    async parseJsonResponse(response) {
        const data = await response.json();

        if (data && data.body && typeof data.body === 'string') {
            try {
                return JSON.parse(data.body);
            } catch (parseError) {
                console.error('Failed to parse wrapped response body:', parseError);
                throw new Error('Invalid API response format');
            }
        }

        return data;
    }

    /**
     * Map API photo objects into the gallery model.
     * @param {Object} photo - Raw API photo object
     * @returns {Object} Normalized photo
     */
    mapPhoto(photo) {
        return {
            id: photo.id || photo.photoId || `img-${Date.now()}-${Math.random()}`,
            description: photo.description || '',
            location: photo.location || 'Unknown location',
            timestamp: photo.takenAt || photo.timestamp || photo.createdAt || new Date().toISOString(),
            uploadedAt: photo.uploadedAt || photo.timestamp || new Date().toISOString(),
            url: photo.image?.url || photo.imageUrl || photo.url || '',
            thumbnailUrl: photo.thumbnail?.url || photo.thumbnailUrl || photo.image?.url || photo.imageUrl || photo.url || '',
            storageKey: photo.storageKey || photo.s3Key || photo.key || '',
            width: photo.width || photo.image?.width || null,
            height: photo.height || photo.image?.height || null
        };
    }

    /**
     * Request a page of photos from the API.
     * @param {string|null} cursor - Cursor for pagination
     * @returns {Promise<Object>} Page result
     */
    async requestPhotos(cursor = null) {
        if (!this.apiBaseUrl && window.location.protocol === 'file:') {
            console.warn('API base URL not configured, using empty gallery');
            return {
                photos: [],
                nextCursor: null,
                hasMore: false
            };
        }

        const url = new URL(this.buildApiUrl('/api/photos'), window.location.origin);
        url.searchParams.set('limit', this.limit.toString());
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const parsedData = await this.parseJsonResponse(response);
        const rawPhotos = Array.isArray(parsedData.photos) ? parsedData.photos : [];
        const photos = rawPhotos.map(photo => this.mapPhoto(photo));
        const nextCursor = parsedData.nextCursor || null;
        const hasMore = parsedData.hasMore !== undefined ? parsedData.hasMore : Boolean(nextCursor);

        return {
            photos,
            nextCursor,
            hasMore
        };
    }

    /**
     * Fetch the authenticated admin session if one exists.
     * @returns {Promise<Object>} Session payload
     */
    async getAdminSession() {
        const response = await fetch(this.buildApiUrl('/api/admin/session'), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });

        const payload = await this.parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(payload.error || 'Unable to verify admin session.');
        }

        return payload;
    }

    /**
     * Load initial photos from the gallery API
     * @returns {Promise<Array>} Array of image objects
     */
    async fetchImages() {
        this.isLoading = true;
        
        try {
            // Reset pagination state for initial load
            this.hasMore = true;
            this.nextCursor = null;

            const result = await this.requestPhotos();
            this.images = result.photos;
            this.nextCursor = result.nextCursor;
            this.hasMore = result.hasMore;

            console.log(`Loaded ${this.images.length} initial photos. Has more: ${this.hasMore}`);
            return this.images;
        } catch (error) {
            console.error('Failed to fetch images:', error);
            
            // If it's a CORS or network error, fall back to placeholder images
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                console.warn('Network error detected, using placeholder images');
                this.images = [];
                this.hasMore = false;
                this.nextCursor = null;
                return this.images;
            }
            
            throw new Error('Failed to fetch images: ' + error.message);
        } finally {
            this.isLoading = false;
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
            if (!this.nextCursor) {
                this.hasMore = false;
                return [];
            }

            const result = await this.requestPhotos(this.nextCursor);
            const newPhotos = result.photos;

            this.images = [...this.images, ...newPhotos];
            this.nextCursor = result.nextCursor;
            this.hasMore = result.hasMore;

            console.log(`Loaded ${newPhotos.length} more photos. Total: ${this.images.length}. Has more: ${this.hasMore}`);
            return newPhotos;
        } catch (error) {
            console.error('Failed to load more photos:', error);
            throw new Error('Failed to load more photos: ' + error.message);
        } finally {
            this.isLoading = false;
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
            if (!this.apiBaseUrl && window.location.protocol === 'file:') {
                throw new Error('API base URL not configured. Cannot upload photos.');
            }

            // Compress image if it's too large
            const compressedFile = await this.compressImage(file);

            const formData = new FormData();
            formData.append('photo', compressedFile, compressedFile.name);
            formData.append('location', location);
            formData.append('description', description);

            const normalizedTimestamp = this.normalizeTimestamp(timestamp);
            if (normalizedTimestamp) {
                formData.append('takenAt', normalizedTimestamp);
            }

            console.log('Uploading photo with multipart payload:', {
                location,
                description,
                contentType: compressedFile.type,
                takenAt: normalizedTimestamp || 'not provided',
                fileSize: compressedFile.size
            });

            const response = await fetch(this.buildApiUrl('/api/admin/photos'), {
                method: 'POST',
                mode: 'cors',
                credentials: 'same-origin',
                body: formData
            });

            if (!response.ok) {
                console.error('Upload failed with status:', response.status, response.statusText);
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Upload access is restricted. Sign in through Cloudflare Access and try again.');
                }
                if (response.status === 413) {
                    throw new Error('Image file is too large. Please try a smaller image or reduce the quality.');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await this.parseJsonResponse(response);
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
     * Normalize the legacy timestamp input into an ISO timestamp.
     * @param {Object|null} timestamp - Legacy timestamp object
     * @returns {string|null} ISO timestamp
     */
    normalizeTimestamp(timestamp) {
        if (!timestamp || !timestamp.year || !timestamp.month || !timestamp.day) {
            return null;
        }

        const year = timestamp.year;
        const month = String(timestamp.month).padStart(2, '0');
        const day = String(timestamp.day).padStart(2, '0');
        return `${year}-${month}-${day}T12:00:00.000Z`;
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
