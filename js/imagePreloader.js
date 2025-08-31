/**
 * ImagePreloader - Handles preloading images in the background for smooth gallery rendering
 */
class ImagePreloader {
    constructor() {
        this.loadedImages = new Map(); // Cache for loaded images
        this.loadingPromises = new Map(); // Track ongoing loads
    }

    /**
     * Preload a single image
     * @param {string} url - Image URL to preload
     * @returns {Promise<HTMLImageElement>} Promise that resolves when image is loaded
     */
    preloadImage(url) {
        // Return cached image if already loaded
        if (this.loadedImages.has(url)) {
            return Promise.resolve(this.loadedImages.get(url));
        }

        // Return existing promise if already loading
        if (this.loadingPromises.has(url)) {
            return this.loadingPromises.get(url);
        }

        // Create new loading promise
        const loadPromise = new Promise((resolve, reject) => {
            const img = new Image();
            
            img.onload = () => {
                this.loadedImages.set(url, img);
                this.loadingPromises.delete(url);
                resolve(img);
            };

            img.onerror = () => {
                this.loadingPromises.delete(url);
                reject(new Error(`Failed to load image: ${url}`));
            };

            // Start loading
            img.src = url;
        });

        this.loadingPromises.set(url, loadPromise);
        return loadPromise;
    }

    /**
     * Preload multiple images in parallel
     * @param {Array<string>} urls - Array of image URLs to preload
     * @param {Function} onProgress - Optional progress callback (loaded, total)
     * @returns {Promise<Array<HTMLImageElement>>} Promise that resolves when all images are loaded
     */
    async preloadBatch(urls, onProgress = null) {
        if (!urls || urls.length === 0) {
            return [];
        }

        let loadedCount = 0;
        const total = urls.length;

        // Create promises for all images
        const loadPromises = urls.map(async (url) => {
            try {
                const img = await this.preloadImage(url);
                loadedCount++;
                if (onProgress) {
                    onProgress(loadedCount, total);
                }
                return img;
            } catch (error) {
                console.warn(`Failed to preload image: ${url}`, error);
                loadedCount++;
                if (onProgress) {
                    onProgress(loadedCount, total);
                }
                return null; // Return null for failed images
            }
        });

        // Wait for all images to complete (success or failure)
        const results = await Promise.all(loadPromises);
        
        // Filter out failed images
        return results.filter(img => img !== null);
    }

    /**
     * Preload images with priority batching
     * @param {Array<string>} urls - Array of image URLs to preload
     * @param {number} batchSize - Number of images to load simultaneously (default: 6)
     * @param {Function} onProgress - Optional progress callback (loaded, total)
     * @param {Function} onBatchComplete - Optional callback when each batch completes
     * @returns {Promise<Array<HTMLImageElement>>} Promise that resolves when all images are loaded
     */
    async preloadWithBatching(urls, batchSize = 6, onProgress = null, onBatchComplete = null) {
        if (!urls || urls.length === 0) {
            return [];
        }

        const results = [];
        let loadedCount = 0;
        const total = urls.length;

        // Process URLs in batches
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            
            const batchResults = await this.preloadBatch(batch, (batchLoaded, batchTotal) => {
                const totalLoaded = loadedCount + batchLoaded;
                if (onProgress) {
                    onProgress(totalLoaded, total);
                }
            });

            results.push(...batchResults);
            loadedCount += batch.length;

            if (onBatchComplete) {
                onBatchComplete(batchResults, i / batchSize + 1, Math.ceil(urls.length / batchSize));
            }
        }

        return results;
    }

    /**
     * Check if an image is already loaded
     * @param {string} url - Image URL to check
     * @returns {boolean} True if image is loaded
     */
    isImageLoaded(url) {
        return this.loadedImages.has(url);
    }

    /**
     * Get a loaded image from cache
     * @param {string} url - Image URL
     * @returns {HTMLImageElement|null} Loaded image or null if not found
     */
    getLoadedImage(url) {
        return this.loadedImages.get(url) || null;
    }

    /**
     * Clear the image cache
     */
    clearCache() {
        this.loadedImages.clear();
        this.loadingPromises.clear();
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            loadedImages: this.loadedImages.size,
            loadingImages: this.loadingPromises.size,
            totalMemoryEstimate: this.estimateMemoryUsage()
        };
    }

    /**
     * Estimate memory usage of cached images (rough calculation)
     * @returns {string} Memory usage estimate
     */
    estimateMemoryUsage() {
        let totalPixels = 0;
        
        this.loadedImages.forEach(img => {
            totalPixels += (img.naturalWidth || 0) * (img.naturalHeight || 0);
        });

        // Rough estimate: 4 bytes per pixel (RGBA)
        const bytes = totalPixels * 4;
        
        if (bytes < 1024 * 1024) {
            return `${Math.round(bytes / 1024)}KB`;
        } else {
            return `${Math.round(bytes / (1024 * 1024))}MB`;
        }
    }

    /**
     * Preload images for a specific gallery configuration
     * @param {Array<Object>} images - Array of image objects with thumbnailUrl
     * @param {number} priority - Number of priority images to load first
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Array<HTMLImageElement>>} Promise that resolves when images are loaded
     */
    async preloadGalleryImages(images, priority = 12, onProgress = null) {
        if (!images || images.length === 0) {
            return [];
        }

        // Extract thumbnail URLs
        const urls = images.map(img => img.thumbnailUrl).filter(url => url);
        
        if (urls.length === 0) {
            return [];
        }

        // Split into priority and remaining images
        const priorityUrls = urls.slice(0, priority);
        const remainingUrls = urls.slice(priority);

        let allResults = [];

        // Load priority images first (visible on screen)
        if (priorityUrls.length > 0) {
            const priorityResults = await this.preloadBatch(priorityUrls, onProgress);
            allResults.push(...priorityResults);
        }

        // Load remaining images in background with smaller batches
        if (remainingUrls.length > 0) {
            const remainingResults = await this.preloadWithBatching(
                remainingUrls, 
                4, // Smaller batch size for background loading
                onProgress
            );
            allResults.push(...remainingResults);
        }

        return allResults;
    }
}

// Export for use in other modules
window.ImagePreloader = ImagePreloader;
