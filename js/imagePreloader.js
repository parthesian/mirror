/**
 * ImagePreloader - lightweight prefetch helper for nearby thumbnails/full images.
 *
 * Visible tiles assign src through ImageLoadQueue so a 5–6 column window
 * cannot open 80+ decodes at once (the usual cause of tiles that stay
 * blank). preloadImage never waits on a DOM element's promise — removing
 * that <img> used to leave the map entry pending forever.
 */
class ImageLoadQueue {
    constructor(options = {}) {
        this.limit = Math.max(1, options.limit || 8);
        this.active = 0;
        this.queue = [];
        this.paused = false;
        this._inflight = new WeakSet();
    }

    setLimit(limit) {
        this.limit = Math.max(1, Number(limit) || 8);
        this.pump();
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
        this.pump();
    }

    cancel(img) {
        this.queue = this.queue.filter((job) => job.img !== img);
    }

    assign(img, url, priority = 1) {
        if (!img || !url) {
            return;
        }
        this.cancel(img);
        if (img.dataset.loadUrl === url && this.hasAssignedSrc(img)) {
            return;
        }
        this.queue.push({ img, url, priority: Number(priority) || 0 });
        this.queue.sort((left, right) => left.priority - right.priority);
        this.pump();
    }

    hasAssignedSrc(img) {
        const src = img.getAttribute('src') || '';
        return Boolean(src);
    }

    pump() {
        if (this.paused) {
            return;
        }
        while (this.active < this.limit && this.queue.length) {
            const job = this.queue.shift();
            if (!job.img.isConnected) {
                continue;
            }
            this.start(job);
        }
    }

    start(job) {
        const { img, url } = job;
        this.active += 1;
        this._inflight.add(img);

        const finish = () => {
            if (!this._inflight.has(img)) {
                return;
            }
            this._inflight.delete(img);
            this.active = Math.max(0, this.active - 1);
            this.pump();
        };

        const onDone = () => {
            img.removeEventListener('load', onDone);
            img.removeEventListener('error', onDone);
            finish();
        };

        img.addEventListener('load', onDone);
        img.addEventListener('error', onDone);
        img.dataset.loadUrl = url;
        img.src = url;
        if (img.complete) {
            onDone();
        }
    }

    retryStuck(images) {
        for (const img of images) {
            if (!img || !img.isConnected || img.complete) {
                continue;
            }
            const url = img.dataset.loadUrl || img.getAttribute('src');
            if (!url) {
                continue;
            }
            img.removeAttribute('src');
            delete img.dataset.loadUrl;
            this.assign(img, url, 0);
        }
    }
}

class ImagePreloader {
    constructor() {
        this.loadedImages = new Map();
        this.loadingPromises = new Map();
        this._aspectHandler = null;
        this.loadTimeoutMs = 12000;
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
            if ('fetchPriority' in image) {
                image.fetchPriority = 'low';
            }

            let settled = false;
            const settle = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                window.clearTimeout(timer);
                this.loadingPromises.delete(url);
                resolve(result);
            };

            image.onload = async () => {
                try {
                    if (typeof image.decode === 'function') {
                        await image.decode();
                    }
                } catch {
                    // The image is still usable after load even if decode rejects.
                }

                this.loadedImages.set(url, image);
                this.notifyAspect(url, image);
                settle(image);
            };

            image.onerror = () => {
                settle(null);
            };

            const timer = window.setTimeout(() => {
                image.onload = null;
                image.onerror = null;
                try {
                    image.src = '';
                } catch {
                    // Ignore revoke failures on already-cleared images.
                }
                settle(null);
            }, this.loadTimeoutMs);

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
     * Visible <img> tags used to park their load promise here so prefetch
     * would not start a second request. Unmounting that element cancelled
     * the request without resolving the promise, so later preloads of the
     * same URL waited forever. Browser HTTP caches already coalesce.
     */
    registerPending(url, loadPromise) {
        if (!url || this.loadedImages.has(url) || this.loadingPromises.has(url)) {
            return;
        }
        if (loadPromise && typeof loadPromise.then === 'function') {
            loadPromise.then(
                (image) => {
                    if (image) {
                        this.markLoaded(url, image);
                    } else {
                        this.markFailed(url);
                    }
                },
                () => this.markFailed(url)
            );
        }
    }

    /**
     * Drop a pending map entry so a cancelled DOM load cannot starve the
     * next preload or remount of the same URL.
     */
    abandon(url) {
        if (!url || this.loadedImages.has(url)) {
            return;
        }
        this.loadingPromises.delete(url);
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

if (typeof window !== 'undefined') {
    window.ImagePreloader = ImagePreloader;
    window.ImageLoadQueue = ImageLoadQueue;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ImagePreloader, ImageLoadQueue };
}
