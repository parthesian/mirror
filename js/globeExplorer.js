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
        this.rotateToggleBtn = document.getElementById('globe-rotate-toggle');
        this.filterPanel = document.getElementById('country-filter-panel');
        this.filterActive = document.getElementById('country-filter-active');
        this.filterSelect = document.getElementById('country-filter-select');
        this.filterApplyBtn = document.getElementById('country-filter-apply');
        this.filterClearBtn = document.getElementById('country-filter-clear');

        this.isOpen = false;
        this.threeState = null;
        this.locations = [];
        this.locationsByCountry = {};
        this.locationsByPlace = {};
        this.orbitControls = null;
        this._threePromise = null;
        this._orbitPromise = null;
        this._geoPromise = null;
        this._geoFetchedOnce = false;
        this.autoRotateEnabled = true;

        this._bindEvents();
        this._warmup();
    }

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _formatFilterLabel(filterType, filterValue, label = '') {
        const base = filterType === 'location'
            ? `PLACE: ${String(filterValue || '').toUpperCase()}`
            : `COUNTRY: ${String(filterValue || '').toUpperCase()}`;
        return label ? `${base} · ${String(label).toUpperCase()}` : base;
    }

    _parseFilterValue(raw) {
        if (!raw) return null;
        if (raw.startsWith('location:')) {
            return { type: 'location', value: raw.slice('location:'.length) };
        }
        if (raw.startsWith('country:')) {
            return { type: 'country', value: raw.slice('country:'.length) };
        }
        return { type: 'country', value: raw };
    }

    // ── event wiring ──

    _bindEvents() {
        this.openBtn?.addEventListener('click', () => this.open());
        this.closeBtn?.addEventListener('click', () => this.close());
        this.overlay?.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });
        this.filterApplyBtn?.addEventListener('click', () => {
            const raw = this.filterSelect?.value || '';
            const parsed = this._parseFilterValue(raw);
            if (parsed && parsed.value) this._applyFilter(parsed.type, parsed.value);
            else this._clearFilter();
        });
        this.filterClearBtn?.addEventListener('click', () => this._clearFilter());
        this.rotateToggleBtn?.addEventListener('click', () => this._toggleRotation());
        this.filterSelect?.addEventListener('change', () => {
            const parsed = this._parseFilterValue(this.filterSelect.value);
            if (this.filterActive) {
                this.filterActive.textContent = parsed
                    ? this._formatFilterLabel(parsed.type, parsed.value)
                    : 'ALL';
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    // ── open / close ──

    async open() {
        if (this.isOpen) return;
        console.log('[GlobeExplorer] open() called');
        this.isOpen = true;
        this.overlay.classList.remove('hidden');
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        try {
            await this._fetchLocations();
            await this._initScene();
            this._syncRotateToggleUI();
        } catch (err) {
            console.error('[GlobeExplorer] failed to initialize', err);
        }
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.overlay.classList.remove('active');
        this.overlay.classList.add('hidden');
        document.body.style.overflow = '';
        // Keep scene alive for faster subsequent opens.
        // this._destroyScene();
    }

    _warmup() {
        // Warm script/data caches in the background to reduce first-open latency.
        this._loadThree().catch(() => {});
        this._loadThree()
            .then((THREE) => this._loadOrbitControls(THREE))
            .catch(() => {});
        this._fetchLocations().catch(() => {});
    }

    _toggleRotation() {
        this.autoRotateEnabled = !this.autoRotateEnabled;
        const controls = this.threeState?.controls;
        if (controls) {
            controls.autoRotate = this.autoRotateEnabled;
        }
        this._syncRotateToggleUI();
    }

    _syncRotateToggleUI() {
        if (!this.rotateToggleBtn) return;
        this.rotateToggleBtn.classList.toggle('paused', !this.autoRotateEnabled);
        this.rotateToggleBtn.setAttribute(
            'aria-label',
            this.autoRotateEnabled ? 'Pause globe rotation' : 'Resume globe rotation'
        );
        this.rotateToggleBtn.setAttribute(
            'title',
            this.autoRotateEnabled ? 'Pause rotation' : 'Resume rotation'
        );
    }

    // ── data ──

    async _fetchLocations() {
        if (this._geoFetchedOnce) return;
        if (this._geoPromise) return this._geoPromise;
        this._geoPromise = this._fetchLocationsInternal();
        try {
            await this._geoPromise;
        } finally {
            this._geoPromise = null;
        }
    }

    async _fetchLocationsInternal() {
        try {
            const base = (window.CONFIG?.API_BASE_URL || '').replace(/\/$/, '');
            const url = base ? `${base}/api/photos/geo` : '/api/photos/geo';
            const res = await fetch(url);
            console.log('[GlobeExplorer] geo fetch status:', res.status, res.statusText, 'url:', url);
            const data = await res.json();
            this.locations = Array.isArray(data.locations) ? data.locations : [];
            console.log('[GlobeExplorer] geo locations loaded:', this.locations.length);
            this._geoFetchedOnce = true;
        } catch (err) {
            console.error('[GlobeExplorer] failed to fetch geo data', err);
            this.locations = [];
        }

        this.locationsByCountry = {};
        this.locationsByPlace = {};
        for (const loc of this.locations) {
            const c = loc.country || 'Unknown';
            if (!this.locationsByCountry[c]) this.locationsByCountry[c] = [];
            this.locationsByCountry[c].push(loc);
            const place = String(loc.location || '').trim();
            if (place) {
                if (!this.locationsByPlace[place]) this.locationsByPlace[place] = [];
                this.locationsByPlace[place].push(loc);
            }
        }
        this._renderFilterMenu();
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
        let OrbitControls = null;
        try {
            OrbitControls = await this._loadOrbitControls(THREE);
        } catch (err) {
            console.warn('[GlobeExplorer] OrbitControls unavailable, continuing without controls', err);
        }

        await new Promise(r => requestAnimationFrame(r));
        const rect = this.sceneContainer.getBoundingClientRect();
        const w = rect.width || 600;
        const h = rect.height || 600;
        console.log('[GlobeExplorer] scene container size:', { width: w, height: h, rect });

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h);
        this.sceneContainer.innerHTML = '';
        this.sceneContainer.appendChild(renderer.domElement);
        renderer.domElement.style.touchAction = 'none';
        renderer.domElement.addEventListener('wheel', (e) => {
            if (e.ctrlKey || this.isOpen) {
                e.preventDefault();
            }
        }, { passive: false });
        console.log('[GlobeExplorer] renderer canvas appended:', renderer.domElement.width, renderer.domElement.height);

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

        let controls = null;
        if (OrbitControls) {
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.enablePan = false;
            controls.minDistance = 1.8;
            controls.maxDistance = 6;
            controls.rotateSpeed = 0.5;
            controls.enableZoom = true;
            controls.autoRotate = this.autoRotateEnabled;
            controls.autoRotateSpeed = 0.45;
        }

        const group = new THREE.Group();
        group.rotation.y = -Math.PI / 2; // align globe texture and data points
        scene.add(group);

        const geo = new THREE.SphereGeometry(1, 48, 48);
        let tex = null;
        let mat = null;
        try {
            tex = await new THREE.TextureLoader().loadAsync('public/earth_atmos_2048.jpg');
            tex.colorSpace = THREE.SRGBColorSpace;
            mat = new THREE.MeshPhongMaterial({ map: tex, shininess: 1, color: 0xcccccc });
            console.log('[GlobeExplorer] texture loaded successfully');
        } catch (err) {
            console.warn('[GlobeExplorer] texture load failed, using fallback material', err);
            mat = new THREE.MeshPhongMaterial({ color: 0xbdbdbd, shininess: 1 });
        }
        const globe = new THREE.Mesh(geo, mat);
        group.add(globe);
        console.log('[GlobeExplorer] globe mesh added');

        const dotsMesh = this._buildDots(THREE, group);
        this._buildArcs(THREE, group);

        // Fallback drag-rotate (works even when OrbitControls fails to load).
        let drag = null;
        renderer.domElement.addEventListener('pointerdown', (e) => {
            drag = {
                x: e.clientX,
                y: e.clientY,
                rotX: group.rotation.x,
                rotY: group.rotation.y
            };
        });
        renderer.domElement.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            // Only apply fallback while controls are missing.
            if (!controls) {
                group.rotation.y = drag.rotY + dx * 0.005;
                group.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, drag.rotX + dy * 0.005));
            }
        });
        const endDrag = () => { drag = null; };
        renderer.domElement.addEventListener('pointerup', endDrag);
        renderer.domElement.addEventListener('pointerleave', endDrag);

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
                        const selectedLocation = this.locations[idx];
                        const country = selectedLocation?.country;
                        if (country) this._showPointPanel(selectedLocation);
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
            const r = this.sceneContainer.getBoundingClientRect();
            const nw = r.width || w;
            const nh = r.height || h;
            renderer.setSize(nw, nh);
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', state.onResize);

        const animate = () => {
            if (state.disposed) return;
            if (controls) controls.update();
            else if (this.autoRotateEnabled) group.rotation.y += 0.001;
            renderer.render(scene, camera);
            state.rafId = requestAnimationFrame(animate);
        };
        animate();
        console.log('[GlobeExplorer] animation loop started');

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
            size: 0.06,
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

    _showPointPanel(point) {
        const country = point?.country || 'Unknown';
        const place = String(point?.location || '').trim();
        const countryLocs = this.locationsByCountry[country] || [];
        const placeLocs = place ? (this.locationsByPlace[place] || []) : [];
        const defaultType = placeLocs.length > 0 ? 'location' : 'country';
        const defaultValue = defaultType === 'location' ? place : country;
        const activeLocs = defaultType === 'location' ? placeLocs : countryLocs;
        if (!activeLocs.length) return;

        const trips = this._groupTrips(activeLocs);
        const countryEscaped = this._escapeHtml(country);
        const placeEscaped = this._escapeHtml(place);

        let html = `<h3 class="globe-panel-country">${countryEscaped}</h3>`;
        if (place) {
            html += `<p class="globe-panel-count">${placeEscaped}</p>`;
        }
        html += `<p class="globe-panel-count">${activeLocs.length} photo${activeLocs.length !== 1 ? 's' : ''}</p>`;
        html += '<div class="globe-panel-trips">';

        for (const trip of trips) {
            const startDate = new Date(trip[0].takenAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const endDate = new Date(trip[trip.length - 1].takenAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const label = startDate === endDate ? startDate : `${startDate} — ${endDate}`;
            const fromIso = new Date(trip[0].takenAt).toISOString();
            const toIso = new Date(trip[trip.length - 1].takenAt).toISOString();
            html += `<button class="globe-panel-trip-link" data-filter-type="${defaultType}" data-filter-value="${this._escapeHtml(defaultValue)}" data-from="${fromIso}" data-to="${toIso}">
                <span class="trip-date">${label}</span>
                <span class="trip-count">${trip.length}</span>
            </button>`;
        }

        html += '</div>';
        html += '<div class="globe-panel-actions">';
        html += `<button class="globe-panel-filter-btn" id="globe-filter-country">show country photos</button>`;
        if (place) {
            html += `<button class="globe-panel-filter-btn" id="globe-filter-place">show place photos</button>`;
        }
        html += '</div>';

        this.panelContent.innerHTML = html;

        document.getElementById('globe-filter-country')?.addEventListener('click', () => {
            this._applyFilter('country', country);
        });
        document.getElementById('globe-filter-place')?.addEventListener('click', () => {
            this._applyFilter('location', place);
        });
        this.panelContent.querySelectorAll('.globe-panel-trip-link').forEach((el) => {
            el.addEventListener('click', () => {
                const type = el.getAttribute('data-filter-type') || defaultType;
                const value = el.getAttribute('data-filter-value') || defaultValue;
                const from = el.getAttribute('data-from');
                const to = el.getAttribute('data-to');
                const label = el.querySelector('.trip-date')?.textContent || '';
                this._applyFilter(type, value, from, to, label);
            });
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

    _renderFilterMenu() {
        if (!this.filterSelect) return;
        const countries = Object.keys(this.locationsByCountry)
            .filter((c) => c && c !== 'Unknown')
            .sort((a, b) => a.localeCompare(b));
        const places = Object.keys(this.locationsByPlace)
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));

        const currentType = this.imageService.locationFilter ? 'location' : (this.imageService.countryFilter ? 'country' : '');
        const currentValue = this.imageService.locationFilter || this.imageService.countryFilter || '';
        const current = currentType && currentValue ? `${currentType}:${currentValue}` : '';
        this.filterSelect.innerHTML = '<option value="">all places</option>';
        for (const c of countries) {
            const count = this.locationsByCountry[c]?.length || 0;
            const option = document.createElement('option');
            option.value = `country:${c}`;
            option.textContent = `country: ${c} (${count})`;
            this.filterSelect.appendChild(option);
        }
        for (const place of places) {
            const count = this.locationsByPlace[place]?.length || 0;
            const option = document.createElement('option');
            option.value = `location:${place}`;
            option.textContent = `place: ${place} (${count})`;
            this.filterSelect.appendChild(option);
        }
        this.filterSelect.value = current;
        if (this.filterActive) {
            this.filterActive.textContent = currentType
                ? this._formatFilterLabel(currentType, currentValue)
                : 'ALL';
        }
    }

    async _applyFilter(filterType, filterValue, takenFrom = null, takenTo = null, label = '') {
        this.close();
        if (this.filterActive) {
            this.filterActive.textContent = this._formatFilterLabel(filterType, filterValue, label);
        }
        if (this.filterSelect) this.filterSelect.value = `${filterType}:${filterValue}`;

        if (filterType === 'location') {
            this.imageService.locationFilter = filterValue;
            this.imageService.countryFilter = null;
        } else {
            this.imageService.countryFilter = filterValue;
            this.imageService.locationFilter = null;
        }
        this.imageService.takenFromFilter = takenFrom || null;
        this.imageService.takenToFilter = takenTo || null;
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }

    async _clearFilter() {
        if (this.filterActive) this.filterActive.textContent = 'ALL';
        if (this.filterSelect) this.filterSelect.value = '';
        this.imageService.countryFilter = null;
        this.imageService.locationFilter = null;
        this.imageService.takenFromFilter = null;
        this.imageService.takenToFilter = null;
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }
}

window.GlobeExplorer = GlobeExplorer;
