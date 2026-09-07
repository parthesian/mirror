/**
 * Shared Three.js / earth-texture loader.
 *
 * Reason: GlobeExplorer and the modal GlobeService both paid for the same
 * CDN graph and 2048px texture. One loader lets hover-intent and idle
 * warmup share work without starting a second WebGL download.
 */
class ThreeLoader {
    constructor() {
        this._threePromise = null;
        this._orbitPromise = null;
        this._earthImagePromise = null;
        this.textureUrl = 'public/earth_atmos_2048.jpg';
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

    loadOrbitControls() {
        if (this._orbitPromise) {
            return this._orbitPromise;
        }
        this._orbitPromise = import('three/addons/controls/OrbitControls.js')
            .then((mod) => mod.OrbitControls);
        return this._orbitPromise;
    }

    prefetchEarthImage() {
        return this._loadEarthImage().catch(() => null);
    }

    _loadEarthImage() {
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

    /**
     * Each renderer needs its own Texture instance, but they can share one
     * decoded HTMLImageElement so the JPEG is fetched once.
     */
    async createEarthTexture(THREE) {
        const image = await this._loadEarthImage();
        const texture = new THREE.Texture(image);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    /**
     * Modal globes are 160px; the explorer is large. Segment counts follow
     * viewport so mobile does not build a 64-segment mesh it cannot resolve.
     */
    sphereSegments(kind = 'explorer') {
        const width = typeof window === 'undefined' ? 1024 : window.innerWidth;
        const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
        if (kind === 'modal') {
            return width <= 768 || dpr >= 2.5 ? 24 : 32;
        }
        if (width <= 480) {
            return 32;
        }
        if (width <= 768 || dpr >= 2.5) {
            return 40;
        }
        return 48;
    }

    prefetchSceneGraph() {
        return this.loadThree()
            .then(() => Promise.all([
                this.loadOrbitControls().catch(() => null),
                this.prefetchEarthImage()
            ]))
            .catch(() => null);
    }
}

window.ThreeLoader = ThreeLoader;
window.threeLoader = window.threeLoader || new ThreeLoader();
