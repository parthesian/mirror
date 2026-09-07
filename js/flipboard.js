/**
 * Airport-style split-flap transition for gallery reorder.
 *
 * Visible tiles stay put and flip through already-decoded thumbnails,
 * then land on the photo that actually occupies that slot after shuffle.
 * Only missing destination thumbs are fetched — intermediates never hit
 * the network — so the board can start immediately.
 */
const Flipboard = {
    prefersReducedMotion() {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    },

    loadedThumbUrls(preloader) {
        if (!preloader?.loadedImages) {
            return [];
        }
        return Array.from(preloader.loadedImages.keys()).filter(Boolean);
    },

    pickIntermediates(pool, currentUrl, destUrl, count) {
        const choices = pool.filter((url) => url && url !== destUrl);
        if (!choices.length) {
            return destUrl ? [destUrl] : [];
        }

        const sequence = [];
        let last = currentUrl;
        const ticks = Math.max(1, count);
        for (let i = 0; i < ticks; i++) {
            let next = choices[Math.floor(Math.random() * choices.length)];
            if (choices.length > 1) {
                let guard = 0;
                while (next === last && guard < 6) {
                    next = choices[Math.floor(Math.random() * choices.length)];
                    guard += 1;
                }
            }
            sequence.push(next);
            last = next;
        }
        if (destUrl) {
            sequence.push(destUrl);
        }
        return sequence;
    },

    wait(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    },

    flipOnce(item, img, url) {
        return new Promise((resolve) => {
            const finish = () => {
                item.classList.remove('flipboard-out', 'flipboard-in');
                resolve();
            };

            item.classList.add('flipboard-out');
            window.setTimeout(() => {
                if (url && img.src !== url) {
                    img.src = url;
                }
                item.classList.remove('flipboard-out');
                item.classList.add('flipboard-in');
                window.setTimeout(finish, 70);
            }, 70);
        });
    },

    async prefetchDestinations(preloader, urls) {
        const missing = (urls || []).filter((url) => url && !preloader.isImageLoaded(url));
        if (!missing.length) {
            return [];
        }
        return preloader.preloadBatch(missing, { concurrency: Math.min(6, missing.length) });
    },

    async animateWindow(options = {}) {
        const {
            items,
            previousImages = [],
            nextImages = [],
            preloader
        } = options;

        const nodes = Array.from(items || []);
        if (!nodes.length) {
            return false;
        }

        const destUrls = nextImages.map((image) => image?.thumbnailUrl).filter(Boolean);
        // Kick every missing destination now so later tiles do not wait on a
        // second-wave fetch. Intermediates stay cache-only.
        const prefetchPromise = this.prefetchDestinations(preloader, destUrls);

        if (this.prefersReducedMotion()) {
            await prefetchPromise;
            return false;
        }

        const pool = this.loadedThumbUrls(preloader);
        nodes.forEach((item) => item.classList.add('flipboard-busy'));

        const runs = nodes.map((item, index) => {
            const img = item.querySelector('.gallery-item-image');
            const dest = nextImages[index];
            const destUrl = dest?.thumbnailUrl || '';
            const currentUrl = previousImages[index]?.thumbnailUrl || img?.src || '';
            if (!img || !destUrl || destUrl === currentUrl) {
                return Promise.resolve();
            }

            const destReady = typeof preloader.preloadImage === 'function'
                ? preloader.preloadImage(destUrl)
                : prefetchPromise;
            const tickCount = 4 + Math.floor(Math.random() * 3);
            const sequence = this.pickIntermediates(pool, currentUrl, destUrl, tickCount)
                .filter((url) => url !== destUrl);

            return this.wait(index * 18).then(async () => {
                for (const url of sequence) {
                    if (!preloader.isImageLoaded(url)) {
                        continue;
                    }
                    await this.flipOnce(item, img, url);
                }
                await destReady;
                if (destUrl) {
                    await this.flipOnce(item, img, destUrl);
                }
            });
        });

        await Promise.all(runs);
        nodes.forEach((item) => {
            item.classList.remove('flipboard-busy', 'flipboard-out', 'flipboard-in');
        });
        return true;
    }
};

if (typeof window !== 'undefined') {
    window.Flipboard = Flipboard;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Flipboard;
}
