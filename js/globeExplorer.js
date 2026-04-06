/**
 * GlobeExplorer - Interactive Three.js globe with photo location dots,
 * travel-path arcs, and country-click filtering.
 */
class GlobeExplorer {
    constructor(imageService) {
        this.imageService = imageService;
        this.overlay = document.getElementById('globe-explorer');
        this.sceneContainer = document.getElementById('globe-explorer-scene');
        this.panelContent = document.getElementById('globe-panel-content');
        this.hint = this.overlay?.querySelector('.globe-explorer-hint');
        this.openBtn = document.getElementById('globe-btn');
        this.closeBtn = document.getElementById('globe-explorer-close');
        this.filterChip = document.getElementById('country-filter-chip');
        this.filterChipLabel = document.getElementById('filter-chip-label');
        this.filterChipClear = document.getElementById('filter-chip-clear');

        this.isOpen = false;
        this.threeState = null;
        this.locations = [];
        this.locationsByCountry = {};
        this.orbitControls = null;
        this._threePromise = null;
        this._orbitPromise = null;

        this._bindEvents();
    }

    // ── event wiring ──

    _bindEvents() {
        this.openBtn?.addEventListener('click', () => this.open());
        this.closeBtn?.addEventListener('click', () => this.close());
        this.overlay?.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });
        this.filterChipClear?.addEventListener('click', () => this._clearFilter());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    // ── open / close ──

    async open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.overlay.classList.remove('hidden');
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        try {
            await this._fetchLocations();
            await this._initScene();
        } catch (err) {
            console.error('GlobeExplorer: failed to initialize', err);
        }
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.overlay.classList.remove('active');
        this.overlay.classList.add('hidden');
        document.body.style.overflow = '';
        this._destroyScene();
    }

    // ── data ──

    async _fetchLocations() {
        try {
            const base = (window.CONFIG?.API_BASE_URL || '').replace(/\/$/, '');
            const url = base ? `${base}/api/photos/geo` : '/api/photos/geo';
            const res = await fetch(url);
            const data = await res.json();
            this.locations = Array.isArray(data.locations) ? data.locations : [];
        } catch (err) {
            console.error('GlobeExplorer: failed to fetch geo data', err);
            this.locations = [];
        }

        this.locationsByCountry = {};
        for (const loc of this.locations) {
            const c = loc.country || 'Unknown';
            if (!this.locationsByCountry[c]) this.locationsByCountry[c] = [];
            this.locationsByCountry[c].push(loc);
        }
    }

    // ── Three.js loading ──

    _loadThree() {
        if (window.THREE) return Promise.resolve(window.THREE);
        if (this._threePromise) return this._threePromise;
        this._threePromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
            s.async = true;
            s.onload = () => resolve(window.THREE);
            s.onerror = () => reject(new Error('Failed to load Three.js'));
            document.head.appendChild(s);
        });
        return this._threePromise;
    }

    _loadOrbitControls(THREE) {
        if (THREE.OrbitControls) return Promise.resolve(THREE.OrbitControls);
        if (this._orbitPromise) return this._orbitPromise;
        this._orbitPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/controls/OrbitControls.js';
            s.async = true;
            s.onload = () => resolve(THREE.OrbitControls);
            s.onerror = () => reject(new Error('Failed to load OrbitControls'));
            document.head.appendChild(s);
        });
        return this._orbitPromise;
    }

    // ── scene lifecycle ──

    async _initScene() {
        if (this.threeState) return;

        const THREE = await this._loadThree();
        const OrbitControls = await this._loadOrbitControls(THREE);

        const w = this.sceneContainer.clientWidth || 600;
        const h = this.sceneContainer.clientHeight || 600;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h);
        this.sceneContainer.innerHTML = '';
        this.sceneContainer.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
        camera.position.set(0, 0, 3.2);

        scene.add(new THREE.AmbientLight(0xffffff, 1.0));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(3, 2, 4);
        scene.add(dir);
        const front = new THREE.DirectionalLight(0xffffff, 0.6);
        front.position.set(0, 0, 5);
        scene.add(front);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = false;
        controls.minDistance = 1.8;
        controls.maxDistance = 6;
        controls.rotateSpeed = 0.5;
        if (window.innerWidth <= 768) {
            controls.enableZoom = false;
        }

        const group = new THREE.Group();
        scene.add(group);

        const geo = new THREE.SphereGeometry(1, 64, 64);
        const tex = await new THREE.TextureLoader().loadAsync('public/earth_atmos_2048.jpg');
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshPhongMaterial({ map: tex, shininess: 1, color: 0xcccccc });
        const globe = new THREE.Mesh(geo, mat);
        globe.rotation.y = -Math.PI / 2;
        group.add(globe);

        const dotsMesh = this._buildDots(THREE, group);
        this._buildArcs(THREE, group);

        const raycaster = new THREE.Raycaster();
        raycaster.params.Points = { threshold: 0.06 };
        const mouse = new THREE.Vector2();

        renderer.domElement.addEventListener('click', (e) => {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            if (dotsMesh) {
                const hits = raycaster.intersectObject(dotsMesh);
                if (hits.length > 0) {
                    const idx = hits[0].index;
                    if (idx != null && idx < this.locations.length) {
                        const country = this.locations[idx].country;
                        if (country) this._showCountryPanel(country);
                    }
                }
            }
        });

        const state = {
            renderer, scene, camera, group, globe, controls, geo, mat, tex,
            rafId: null, disposed: false, onResize: null, dotsMesh
        };

        state.onResize = () => {
            if (state.disposed) return;
            const nw = this.sceneContainer.clientWidth || w;
            const nh = this.sceneContainer.clientHeight || h;
            renderer.setSize(nw, nh);
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', state.onResize);

        const animate = () => {
            if (state.disposed) return;
            controls.update();
            renderer.render(scene, camera);
            state.rafId = requestAnimationFrame(animate);
        };
        animate();

        this.threeState = state;
    }

    _destroyScene() {
        const s = this.threeState;
        if (!s) return;
        s.disposed = true;
        if (s.rafId) cancelAnimationFrame(s.rafId);
        if (s.onResize) window.removeEventListener('resize', s.onResize);
        if (s.controls) s.controls.dispose();
        try {
            s.geo?.dispose();
            s.mat?.dispose();
            s.tex?.dispose();
            s.renderer?.dispose();
            if (s.renderer?.domElement?.parentNode) {
                s.renderer.domElement.parentNode.removeChild(s.renderer.domElement);
            }
        } catch (e) { /* ignore */ }
        this.threeState = null;
    }

    // ── dots + arcs ──

    _latLonToVec3(lat, lon, radius, THREE) {
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const theta = THREE.MathUtils.degToRad(lon + 180);
        return new THREE.Vector3(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }

    _buildDots(THREE, group) {
        if (this.locations.length === 0) return null;

        const positions = new Float32Array(this.locations.length * 3);
        const radius = 1.01;

        for (let i = 0; i < this.locations.length; i++) {
            const v = this._latLonToVec3(this.locations[i].latitude, this.locations[i].longitude, radius, THREE);
            positions[i * 3] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
        }

        const dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const dotMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.04,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const dots = new THREE.Points(dotGeo, dotMat);
        group.add(dots);
        return dots;
    }

    _buildArcs(THREE, group) {
        if (this.locations.length < 2) return;

        const radius = 1.01;
        const arcMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        let prev = null;
        for (const loc of this.locations) {
            if (prev && prev.country !== loc.country) {
                const start = this._latLonToVec3(prev.latitude, prev.longitude, radius, THREE);
                const end = this._latLonToVec3(loc.latitude, loc.longitude, radius, THREE);

                const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                const dist = start.distanceTo(end);
                mid.normalize().multiplyScalar(radius + dist * 0.3);

                const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
                const points = curve.getPoints(32);
                const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
                group.add(new THREE.Line(lineGeo, arcMat));
            }
            prev = loc;
        }
    }

    // ── panel ──

    _showCountryPanel(country) {
        const locs = this.locationsByCountry[country];
        if (!locs || locs.length === 0) return;

        if (this.hint) this.hint.style.display = 'none';

        const trips = this._groupTrips(locs);

        let html = `<h3 class="globe-panel-country">${country}</h3>`;
        html += `<p class="globe-panel-count">${locs.length} photo${locs.length !== 1 ? 's' : ''}</p>`;
        html += '<div class="globe-panel-trips">';

        for (const trip of trips) {
            const startDate = new Date(trip[0].takenAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const endDate = new Date(trip[trip.length - 1].takenAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const label = startDate === endDate ? startDate : `${startDate} — ${endDate}`;
            html += `<div class="globe-panel-trip">
                <span class="trip-dot"></span>
                <span class="trip-date">${label}</span>
                <span class="trip-count">${trip.length}</span>
            </div>`;
        }

        html += '</div>';
        html += `<button class="globe-panel-filter-btn" id="globe-filter-btn">show photos</button>`;
        html += `<button class="globe-panel-showall-btn" id="globe-showall-btn">show all</button>`;

        this.panelContent.innerHTML = html;

        document.getElementById('globe-filter-btn')?.addEventListener('click', () => {
            this._applyFilter(country);
        });
        document.getElementById('globe-showall-btn')?.addEventListener('click', () => {
            this._clearFilter();
        });
    }

    _groupTrips(locs) {
        const sorted = [...locs].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
        const trips = [];
        let current = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            const gap = new Date(sorted[i].takenAt) - new Date(sorted[i - 1].takenAt);
            if (gap > 30 * 24 * 60 * 60 * 1000) {
                trips.push(current);
                current = [];
            }
            current.push(sorted[i]);
        }
        trips.push(current);
        return trips;
    }

    // ── filtering ──

    async _applyFilter(country) {
        this.close();
        this.filterChip?.classList.remove('hidden');
        if (this.filterChipLabel) this.filterChipLabel.textContent = country;

        this.imageService.countryFilter = country;
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }

    async _clearFilter() {
        this.filterChip?.classList.add('hidden');
        this.imageService.countryFilter = null;
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }
}

window.GlobeExplorer = GlobeExplorer;
