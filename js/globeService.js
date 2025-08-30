/**
 * GlobeService - Lazy-loads Three.js and renders an animated grayscale globe
 * Centered on a target country (Japan, USA, France, India) inside a given container.
 * - Creates one renderer per container
 * - Reuses instance when updating location
 * - Cleans up on destroy(container)
 *
 * Public API:
 *   const svc = new GlobeService();
 *   await svc.createOrUpdate(containerEl, 'Japan'); // or 'USA', 'France', 'India', or a string that includes it
 *   svc.destroy(containerEl);
 */
class GlobeService {
  constructor() {
    this._threePromise = null;
    this.instances = new Map();
    // Texture: use local texture from public folder
    this.textureUrl = 'public/earth_atmos_2048.jpg';
  }

  // Lazy-load Three.js from CDN (once)
  _loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (this._threePromise) return this._threePromise;

    this._threePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
      script.async = true;
      script.onload = () => resolve(window.THREE);
      script.onerror = () => reject(new Error('Failed to load Three.js'));
      document.head.appendChild(script);
    });

    return this._threePromise;
  }

  // Parse a free-form location string and return a supported country key or null
  _parseCountry(location) {
    if (!location || typeof location !== 'string') return null;
    const s = location.toLowerCase();

    // Normalize common USA variants
    const usaPatterns = [
      /\bunited states\b/,
      /\busa\b/,
      /\bu\.s\.a\.?\b/,
      /\bu\.s\.\b/,
      /\bus\b/
    ];
    if (usaPatterns.some((re) => re.test(s))) return 'usa';

    if (s.includes('japan')) return 'japan';
    if (s.includes('france')) return 'france';
    if (s.includes('india')) return 'india';

    // If the string is exactly one of our names
    if (['usa', 'japan', 'france', 'india'].includes(s.trim())) return s.trim();

    return null;
  }

  // Country center coordinates (approx)
  _countryLatLng(countryKey) {
    switch (countryKey) {
      case 'japan':
        return { lat: 36.2048, lon: 138.2529 };
      case 'usa':
        return { lat: 39.8283, lon: -98.5795 };
      case 'france':
        return { lat: 46.2276, lon: 2.2137 };
      case 'india':
        return { lat: 20.5937, lon: 78.9629 };
      default:
        return null;
    }
  }

  // Compute target rotation for the globe group to bring lat/lon to the camera front
  _rotationForLatLng(lat, lon, THREE) {
    // Convert degrees to radians
    const latRad = THREE.MathUtils.degToRad(lat);
    const lonRad = THREE.MathUtils.degToRad(lon);

    // Map so the given lat/lon faces the camera (+Z):
    // - Positive latitude (north rotates up toward camera)
    // - Negative longitude to match typical map projections
    // - Globe mesh is pre-rotated -90° to align texture seam
    return {
      x: latRad,
      y: -lonRad
    };
  }

  async createOrUpdate(containerEl, locationString) {
    try {
      const THREE = await this._loadThree();
      if (!containerEl) return;

      const countryKey = this._parseCountry(locationString);
      if (!countryKey) {
        // No supported country -> hide or clear
        this.destroy(containerEl);
        return;
      }

      const coords = this._countryLatLng(countryKey);
      if (!coords) {
        this.destroy(containerEl);
        return;
      }

      // Ensure container has a height (now circular 160px)
      if (!containerEl.style.height || containerEl.clientHeight === 0) {
        containerEl.style.height = '160px';
      }

      let instance = this.instances.get(containerEl);
      if (!instance) {
        instance = await this._initInstance(containerEl, THREE);
        this.instances.set(containerEl, instance);
      }

      // Set/update target rotation to center on country
      const target = this._rotationForLatLng(coords.lat, coords.lon, THREE);
      instance.targetRotation = target;

      // Make sure visible
      containerEl.classList.remove('hidden');
    } catch (err) {
      console.error('GlobeService createOrUpdate error:', err);
      this.destroy(containerEl);
    }
  }

  async _initInstance(containerEl, THREE) {
    const width = containerEl.clientWidth || 160;
    const height = containerEl.clientHeight || 160;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    containerEl.innerHTML = '';
    containerEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 2.8); // Pull back slightly to show full globe in circular container

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(3, 2, 4);
    scene.add(dirLight);
    
    // Add a light from the camera direction to brighten the front-facing surface
    const frontLight = new THREE.DirectionalLight(0xffffff, 0.7);
    frontLight.position.set(0, 0, 5); // From camera direction
    scene.add(frontLight);
    
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    scene.add(hemiLight);

    // Globe group (we rotate this)
    const group = new THREE.Group();
    scene.add(group);

    // Sphere (Earth)
    const geometry = new THREE.SphereGeometry(1, 64, 64);
    const texture = await new THREE.TextureLoader().loadAsync(this.textureUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshPhongMaterial({
      map: texture,
      shininess: 1,
      color: 0xcccccc,     // Brightens the diffuse color
    });
    const globe = new THREE.Mesh(geometry, material);
    // Pre-rotate globe to align texture seam so 0° longitude faces camera
    globe.rotation.y = -Math.PI / 2;
    group.add(globe);

    // State for animation
    const state = {
      renderer,
      scene,
      camera,
      group,
      globe,
      geometry,
      material,
      texture,
      targetRotation: { x: 0, y: 0 },
      rafId: null,
      onResize: null,
      disposed: false
    };

    // Resize handler
    state.onResize = () => {
      if (state.disposed) return;
      const w = containerEl.clientWidth || width;
      const h = containerEl.clientHeight || height;
      state.renderer.setSize(w, h);
      state.camera.aspect = w / h;
      state.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', state.onResize);

    // Animate
    const animate = () => {
      if (state.disposed) return;

      // Ease current rotation toward target
      const ease = 0.08;
      state.group.rotation.x += (state.targetRotation.x - state.group.rotation.x) * ease;
      state.group.rotation.y += (state.targetRotation.y - state.group.rotation.y) * ease;

      state.renderer.render(state.scene, state.camera);
      state.rafId = requestAnimationFrame(animate);
    };

    animate();

    return state;
  }

  destroy(containerEl) {
    const state = this.instances.get(containerEl);
    if (!state) {
      // Ensure container is cleared/hidden
      if (containerEl) {
        // don't remove in case consumer controls visibility via CSS .hidden
        // containerEl.innerHTML = '';
      }
      return;
    }

    state.disposed = true;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    if (state.onResize) window.removeEventListener('resize', state.onResize);

    // Dispose geometry/material/texture
    try {
      if (state.geometry) state.geometry.dispose();
      if (state.material) state.material.dispose();
      if (state.texture) state.texture.dispose();
      if (state.renderer) {
        state.renderer.dispose();
        if (state.renderer.domElement && state.renderer.domElement.parentNode) {
          state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
        }
      }
    } catch (e) {
      console.warn('GlobeService dispose warning:', e);
    }

    // Clear container
    if (containerEl) {
      // Keep element, just clear content
      containerEl.innerHTML = '';
    }

    this.instances.delete(containerEl);
  }
}

// Export for use in other modules
window.GlobeService = GlobeService;
