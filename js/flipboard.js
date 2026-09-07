/**
 * Airport-style split-flap transition for gallery reorder.
 *
 * Visible tiles stay put. Each flap face is a thumbnail already in the
 * preloader (or the destination once it arrives). Full-size hover
 * prefetches are never used as faces. Missing destinations are fetched
 * once, as a single concurrent batch, while the board is already flipping
 * through cache.
 */
const Flipboard = {
    FLAP_MS: 52,
    STAGGER_MS: 12,
    MIN_TICKS: 4,
    MAX_TICKS: 6,

    prefersReducedMotion() {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    },

    /**
     * Only collection thumbnails that are already decoded.
     * Hover-prefetched full images are excluded on purpose.
     */
    loadedThumbUrls(preloader, thumbCandidates = []) {
        const unique = Array.from(new Set((thumbCandidates || []).filter(Boolean)));
        if (!preloader) {
            return unique;
        }
        return unique.filter((url) => preloader.isImageLoaded(url));
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

    nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    },

    ensureFlap(item) {
        let flap = item.querySelector('.flipboard-flap');
        if (flap) {
            return flap;
        }
        flap = document.createElement('div');
        flap.className = 'flipboard-flap';
        flap.setAttribute('aria-hidden', 'true');
        const flapImg = document.createElement('img');
        flapImg.className = 'flipboard-flap-image';
        flapImg.alt = '';
        flapImg.decoding = 'async';
        flap.appendChild(flapImg);
        item.appendChild(flap);
        return flap;
    },

    removeFlap(item) {
        item.querySelector('.flipboard-flap')?.remove();
        item.classList.remove('flipboard-out', 'flipboard-in');
    },

    async flipOnce(item, img, nextUrl) {
        if (!nextUrl || img.src === nextUrl) {
            return;
        }

        const flap = this.ensureFlap(item);
        const flapImg = flap.querySelector('.flipboard-flap-image');
        flapImg.src = img.currentSrc || img.src;
        item.classList.remove('flipboard-out');
        flap.style.transition = 'none';
        flap.style.transform = 'rotateX(0deg)';
        img.src = nextUrl;

        await this.nextFrame();
        await this.nextFrame();
        flap.style.transition = `transform ${this.FLAP_MS}ms linear`;
        item.classList.add('flipboard-out');
        await this.wait(this.FLAP_MS);
        // Match the flap to the face underneath so resetting the hinge
        // does not cover the destination with the previous tick.
        flapImg.src = img.currentSrc || img.src || nextUrl;
        item.classList.remove('flipboard-out');
        flap.style.transition = 'none';
        flap.style.transform = 'rotateX(0deg)';
    },

    async prefetchDestinations(preloader, urls) {
        const missing = (urls || []).filter((url) => url && !preloader.isImageLoaded(url));
        if (!missing.length) {
            return [];
        }
        return preloader.preloadBatch(missing, {
            concurrency: Math.min(8, missing.length)
        });
    },

    async animateWindow(options = {}) {
        const {
            items,
            previousImages = [],
            nextImages = [],
            preloader,
            thumbCandidates = []
        } = options;

        const nodes = Array.from(items || []);
        if (!nodes.length) {
            return false;
        }

        const destUrls = nextImages.map((image) => image?.thumbnailUrl).filter(Boolean);
        const prefetchPromise = this.prefetchDestinations(preloader, destUrls);

        if (this.prefersReducedMotion()) {
            await prefetchPromise;
            return false;
        }

        const candidateThumbs = thumbCandidates.length
            ? thumbCandidates
            : [...previousImages, ...nextImages].map((image) => image?.thumbnailUrl);
        const pool = this.loadedThumbUrls(preloader, candidateThumbs);
        nodes.forEach((item) => item.classList.add('flipboard-busy'));

        const runs = nodes.map((item, index) => {
            const img = item.querySelector('.gallery-item-image');
            const dest = nextImages[index];
            const destUrl = dest?.thumbnailUrl || '';
            const currentUrl = previousImages[index]?.thumbnailUrl || img?.src || '';
            if (!img || !destUrl || destUrl === currentUrl) {
                return Promise.resolve();
            }

            if (typeof preloader.preloadImage === 'function') {
                void preloader.preloadImage(destUrl);
            }
            const tickCount = this.MIN_TICKS + Math.floor(Math.random() * (this.MAX_TICKS - this.MIN_TICKS + 1));
            const sequence = this.pickIntermediates(pool, currentUrl, destUrl, tickCount)
                .filter((url) => url !== destUrl && preloader.isImageLoaded(url));

            return this.wait(index * this.STAGGER_MS).then(async () => {
                for (const url of sequence) {
                    await this.flipOnce(item, img, url);
                }
                // Keep flapping cached faces if dest is still arriving so the
                // board never sits still, then land on dest as the last tick.
                let extras = 0;
                while (destUrl && !preloader.isImageLoaded(destUrl) && extras < this.MAX_TICKS) {
                    const filler = sequence[extras % Math.max(sequence.length, 1)]
                        || pool[extras % Math.max(pool.length, 1)];
                    if (filler && filler !== destUrl) {
                        await this.flipOnce(item, img, filler);
                    }
                    extras += 1;
                }
                await this.flipOnce(item, img, destUrl);
                this.removeFlap(item);
                item.classList.remove('flipboard-busy');
            });
        });

        await Promise.all(runs);
        nodes.forEach((item) => {
            this.removeFlap(item);
            item.classList.remove('flipboard-busy');
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
