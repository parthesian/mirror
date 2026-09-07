/**
 * ImagePreloader - lightweight prefetch helper for nearby thumbnails/full images.
 */
class ImagePreloader {
    constructor() {
        this.loadedImages = new Map();
        this.loadingPromises = new Map();
        this._aspectHandler = null;
    }

    /**
     * Preload a single image URL.
     * @param {string} url - Image URL
     * @returns {Promise<HTMLImageElement|null>} Loaded image or null on failure
     */
    preloadImage(url) {
        if (!url) {
            return Promise.resolve(null);
        }

        if (this.loadedImages.has(url)) {
            return Promise.resolve(this.loadedImages.get(url));
        }

        if (this.loadingPromises.has(url)) {
            return this.loadingPromises.get(url);
        }

        const loadPromise = new Promise((resolve) => {
            const image = new Image();
            image.decoding = 'async';

            image.onload = async () => {
                try {
                    if (typeof image.decode === 'function') {
                        await image.decode();
                    }
                } catch {
                    // The image is still usable after load even if decode rejects.
                }

                this.loadedImages.set(url, image);
                this.loadingPromises.delete(url);
                this.notifyAspect(url, image);
                resolve(image);
            };

            image.onerror = () => {
                this.loadingPromises.delete(url);
                resolve(null);
            };

            image.src = url;
        });

        this.loadingPromises.set(url, loadPromise);
        return loadPromise;
    }

    /**
     * Preload a batch of URLs with light concurrency control.
     * @param {Array<string>} urls - URLs to preload
     * @param {Object} options - Preload options
     * @returns {Promise<Array<HTMLImageElement>>} Loaded images
     */
    async preloadBatch(urls, options = {}) {
        const {
            concurrency = 4
        } = options;
        const uniqueUrls = Array.from(new Set((urls || []).filter(Boolean)));

        if (uniqueUrls.length === 0) {
            return [];
        }

        const results = [];
        let index = 0;

        const worker = async () => {
            while (index < uniqueUrls.length) {
                const nextUrl = uniqueUrls[index++];
                const image = await this.preloadImage(nextUrl);
                if (image) {
                    results.push(image);
                }
            }
        };

        const workers = Array.from({
            length: Math.min(concurrency, uniqueUrls.length)
        }, () => worker());

        await Promise.all(workers);
        return results;
    }

    /**
     * Fire-and-forget prefetch for nearby assets.
     * @param {Array<string>} urls - URLs to prefetch
     * @param {Object} options - Prefetch options
     */
    prefetch(urls, options = {}) {
        this.preloadBatch(urls, options).catch((error) => {
            console.warn('Image prefetch failed:', error);
        });
    }

    /**
     * Register that a URL is already being loaded by an external element (e.g.
     * a visible <img> in the DOM) so the preloader won't create a duplicate
     * request.
     */
    registerPending(url, loadPromise) {
        if (this.loadedImages.has(url) || this.loadingPromises.has(url)) return;
        this.loadingPromises.set(url, loadPromise);
    }

    /**
     * Mark a URL as successfully loaded (from an external element).
     * Keep the element when we have one so masonry can read its aspect.
     */
    markLoaded(url, image) {
        if (image && image.naturalWidth && image.naturalHeight) {
            this.loadedImages.set(url, image);
            this.notifyAspect(url, image);
        } else if (!this.loadedImages.has(url)) {
            this.loadedImages.set(url, true);
        }
        this.loadingPromises.delete(url);
    }

    /**
     * Mark a URL load as failed (cleanup only).
     */
    markFailed(url) {
        this.loadingPromises.delete(url);
    }

    /**
     * Check if an image is already cached.
     * @param {string} url - URL to check
     * @returns {boolean} Cache presence
     */
    isImageLoaded(url) {
        return this.loadedImages.has(url);
    }

    /**
     * Get a loaded image from cache.
     * @param {string} url - Image URL
     * @returns {HTMLImageElement|null} Cached image
     */
    getLoadedImage(url) {
        const value = this.loadedImages.get(url);
        return value instanceof HTMLImageElement ? value : null;
    }

    /**
     * Gallery listens so a prefetch that finishes off-screen can still
     * teach masonry the real ratio before that tile is mounted.
     */
    onAspect(handler) {
        this._aspectHandler = typeof handler === 'function' ? handler : null;
    }

    notifyAspect(url, image) {
        if (!this._aspectHandler || !image?.naturalWidth || !image?.naturalHeight) {
            return;
        }
        this._aspectHandler(url, image);
    }

    /**
     * Clear the image cache.
     */
    clearCache() {
        this.loadedImages.clear();
        this.loadingPromises.clear();
    }
}

window.ImagePreloader = ImagePreloader;
