/**
 * Three.js for the modal globe, and the earth photo it shares with the
 * explorer, each fetched once.
 */
class ThreeLoader {
    constructor() {
        this._threePromise = null;
        this._earthImagePromise = null;
        // Vite copies public/ onto the site root. The old public/ prefix 404s
        // and the explorer falls back to a blank gray sphere.
        this.textureUrl = '/earth_atmos_2048.jpg';
    }

    loadThree() {
        if (typeof window !== 'undefined' && window.THREE) {
            return Promise.resolve(window.THREE);
        }
        if (this._threePromise) {
            return this._threePromise;
        }
        this._threePromise = import('three').then((mod) => {
            window.THREE = mod;
            return mod;
        });
        return this._threePromise;
    }

    prefetchEarthImage() {
        return this.loadEarthImage().catch(() => null);
    }

    /** The explorer and the modal globe share one decoded 2048px JPEG. */
    loadEarthImage() {
        if (this._earthImagePromise) {
            return this._earthImagePromise;
        }

        this._earthImagePromise = new Promise((resolve, reject) => {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => resolve(image);
            image.onerror = () => {
                this._earthImagePromise = null;
                reject(new Error('Earth texture failed to load'));
            };
            image.src = this.textureUrl;
        });

        return this._earthImagePromise;
    }

    async createEarthTexture(THREE) {
        const image = await this.loadEarthImage();
        const texture = new THREE.Texture(image);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    /** Modal globes are 160px, so small screens get a coarser mesh. */
    sphereSegments() {
        const width = typeof window === 'undefined' ? 1024 : window.innerWidth;
        const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
        return width <= 768 || dpr >= 2.5 ? 24 : 32;
    }
}

window.ThreeLoader = ThreeLoader;
window.threeLoader = window.threeLoader || new ThreeLoader();
