/**
 * GlobeExplorer - Interactive Three.js globe with photo location dots,
 * travel-path arcs, and country-click filtering.
 */
class GlobeExplorer {
    constructor(imageService) {
        this.imageService = imageService;
        this.overlay = document.getElementById('globe-explorer');
        this.sceneContainer = document.getElementById('globe-explorer-scene');
        this.intersectPicker = document.getElementById('globe-intersect-picker');
        this.panelContent = document.getElementById('globe-panel-content');
        this.hint = this.overlay?.querySelector('.globe-explorer-hint');
        this.openBtn = document.getElementById('globe-btn');
        this.closeBtn = document.getElementById('globe-explorer-close');
        this.rotateToggleBtn = document.getElementById('globe-rotate-toggle');
        this.filterPanel = document.getElementById('country-filter-panel');
        this.filterToggleBtn = document.getElementById('country-filter-toggle');
        this.filterToggleIcon = document.getElementById('country-filter-toggle-icon');
        this.filterBody = document.getElementById('country-filter-body');
        this.filterActive = document.getElementById('country-filter-active');
        this.filterTypeList = document.getElementById('country-filter-kind-list');
        this.filterOptionList = document.getElementById('country-filter-option-list');
        this.filterScopeTitle = document.getElementById('country-filter-scope-title');
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
        this.locationUnitVectors = [];
        this.locationGroups = [];
        this.pointerGesture = null;
        this.lastPointerGesture = null;
        this.selectedFilterType = 'country';
        this.selectedFilterValue = '';
        this.lastManualRotateAt = 0;
        this.locationGroupByKey = new Map();
        this.hoverHighlight = { type: null, key: null };
        this.isFilterPanelExpanded = false;
        this._countryBoundaryPromise = null;
        this.countryBoundaryFeatures = [];
        this.countryBoundaryAliasMap = new Map();
        this.countryFilterAliasMap = new Map();
        this.countryBoundaryBorder = null;

        this._bindEvents();
        this._setFilterPanelExpanded(false);
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

    _locationKeyFor(loc) {
        const place = String(loc?.location || '').trim();
        if (place) {
            return `place:${place.toLowerCase()}`;
        }
        const lat = Number(loc?.latitude);
        const lon = Number(loc?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return `coords:${lat.toFixed(3)},${lon.toFixed(3)}`;
        }
        return `photo:${String(loc?.id || '')}`;
    }

    _setHoverHighlight(type, key) {
        const nextType = type || null;
        const nextKey = key || null;
        if (this.hoverHighlight.type === nextType && this.hoverHighlight.key === nextKey) {
            return;
        }
        this.hoverHighlight = { type: nextType, key: nextKey };
        this._applyDotHighlight();
    }

    _setPendingFilterSelection(type, value) {
        this.selectedFilterType = type;
        this.selectedFilterValue = value || '';
        this._renderFilterMenu();
    }

    _normalizeCountryName(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    _seedCountryAliasesFromLocations() {
        this.countryFilterAliasMap = new Map();
        const addAlias = (alias, canonical) => {
            const key = this._normalizeCountryName(alias);
            if (!key || !canonical) return;
            if (!this.countryFilterAliasMap.has(key)) {
                this.countryFilterAliasMap.set(key, canonical);
            }
        };
        const explicitAliases = {
            usa: 'USA',
            us: 'USA',
            'u s a': 'USA',
            'u s': 'USA',
            'united states': 'USA',
            'united states of america': 'USA',
            uk: 'United Kingdom',
            'united kingdom': 'United Kingdom',
            britain: 'United Kingdom',
            'great britain': 'United Kingdom',
            uae: 'United Arab Emirates',
            'united arab emirates': 'United Arab Emirates',
            russia: 'Russia',
            'russian federation': 'Russia',
            korea: 'South Korea',
            'south korea': 'South Korea',
            'republic of korea': 'South Korea',
            'north korea': 'North Korea',
            'dprk': 'North Korea'
        };
        for (const [alias, canonical] of Object.entries(explicitAliases)) {
            addAlias(alias, canonical);
        }

        for (const country of Object.keys(this.locationsByCountry || {})) {
            if (!country || country === 'Unknown') continue;
            addAlias(country, country);
        }
    }

    _resolveCountryFilterValue(countryName, aliases = []) {
        const candidates = [countryName, ...(Array.isArray(aliases) ? aliases : [])];
        for (const candidate of candidates) {
            const key = this._normalizeCountryName(candidate);
            const mapped = this.countryFilterAliasMap.get(key);
            if (mapped && this.locationsByCountry[mapped]?.length >= 0) return mapped;
            if (candidate && this.locationsByCountry[candidate]?.length >= 0) return candidate;
        }
        return countryName || '';
    }

    async _ensureCountryBoundariesLoaded() {
        if (this.countryBoundaryFeatures.length) return;
        if (this._countryBoundaryPromise) return this._countryBoundaryPromise;
        this._countryBoundaryPromise = this._loadCountryBoundaries();
        try {
            await this._countryBoundaryPromise;
        } finally {
            this._countryBoundaryPromise = null;
        }
    }

    async _loadCountryBoundaries() {
        const dataSources = [
            'public/data/ne_110m_admin_0_countries.geojson',
            'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'
        ];
        let featureCollection = null;
        for (const src of dataSources) {
            try {
                const res = await fetch(src, { cache: 'force-cache' });
                if (!res.ok) continue;
                featureCollection = await res.json();
                if (featureCollection?.features?.length) break;
            } catch (_) {
                // Continue to next source.
            }
        }
        if (!featureCollection?.features?.length) {
            console.warn('[GlobeExplorer] country boundaries unavailable');
            this.countryBoundaryFeatures = [];
            this.countryBoundaryAliasMap = new Map();
            return;
        }

        const aliases = new Map();
        const features = [];

        const normalizeLon = (lon) => {
            const out = ((Number(lon) + 540) % 360) - 180;
            return Number.isFinite(out) ? out : lon;
        };
        const getBbox = (rings) => {
            let minLon = Infinity;
            let maxLon = -Infinity;
            let minLat = Infinity;
            let maxLat = -Infinity;
            for (const ring of rings) {
                for (const point of ring) {
                    const lon = normalizeLon(point[0]);
                    const lat = Number(point[1]);
                    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
                    minLon = Math.min(minLon, lon);
                    maxLon = Math.max(maxLon, lon);
                    minLat = Math.min(minLat, lat);
                    maxLat = Math.max(maxLat, lat);
                }
            }
            if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
            return { minLon, maxLon, minLat, maxLat };
        };
        const normalizeAlias = (value) => this._normalizeCountryName(value);
        const addAlias = (value, featureRef) => {
            const key = normalizeAlias(value);
            if (!key) return;
            if (!aliases.has(key)) aliases.set(key, featureRef);
        };
        const cleanName = (value) => String(value || '').trim();
        const namesForProps = (props) => ([
            props?.NAME,
            props?.NAME_LONG,
            props?.BRK_NAME,
            props?.FORMAL_EN,
            props?.ADMIN,
            props?.ABBREV,
            props?.ISO_A2,
            props?.ISO_A3
        ].map(cleanName).filter(Boolean));

        for (const feature of featureCollection.features) {
            const geometry = feature?.geometry;
            if (!geometry) continue;
            const type = geometry.type;
            const polygons = [];
            if (type === 'Polygon') {
                if (Array.isArray(geometry.coordinates)) polygons.push(geometry.coordinates);
            } else if (type === 'MultiPolygon') {
                if (Array.isArray(geometry.coordinates)) polygons.push(...geometry.coordinates);
            } else continue;

            const ringsForBbox = [];
            for (const polygon of polygons) {
                if (!Array.isArray(polygon)) continue;
                for (const ring of polygon) {
                    if (Array.isArray(ring)) ringsForBbox.push(ring);
                }
            }
            const bbox = getBbox(ringsForBbox);
            if (!bbox) continue;

            const props = feature.properties || {};
            const names = namesForProps(props);
            const primaryName = cleanName(props.ADMIN || props.NAME || props.BRK_NAME || props.NAME_LONG || '');
            if (!primaryName) continue;

            const featureRef = {
                name: primaryName,
                names,
                iso2: cleanName(props.ISO_A2),
                iso3: cleanName(props.ISO_A3),
                polygons,
                bbox
            };
            features.push(featureRef);
            for (const n of names) addAlias(n, featureRef);
        }

        this.countryBoundaryFeatures = features;
        this.countryBoundaryAliasMap = aliases;
    }

    _pointInRing(lon, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = Number(ring[i][0]);
            const yi = Number(ring[i][1]);
            const xj = Number(ring[j][0]);
            const yj = Number(ring[j][1]);
            if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
            const intersects = ((yi > lat) !== (yj > lat))
                && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    _pointInPolygon(lon, lat, polygon) {
        if (!Array.isArray(polygon) || !polygon.length) return false;
        const [outer, ...holes] = polygon;
        if (!Array.isArray(outer) || !outer.length) return false;
        if (!this._pointInRing(lon, lat, outer)) return false;
        for (const hole of holes) {
            if (Array.isArray(hole) && hole.length && this._pointInRing(lon, lat, hole)) return false;
        }
        return true;
    }

    _dirToLatLon(THREE, worldDirection, group) {
        const localDir = worldDirection.clone().normalize();
        if (group) {
            // Raycast hit points are in world space; convert to globe local space
            // so lon/lat math matches the same frame as _latLonToVec3.
            const worldQuat = group.getWorldQuaternion(new THREE.Quaternion());
            localDir.applyQuaternion(worldQuat.invert()).normalize();
        }
        const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(localDir.y, -1, 1)));
        let lon = THREE.MathUtils.radToDeg(Math.atan2(-localDir.z, localDir.x));
        lon = ((lon + 540) % 360) - 180;
        return { lat, lon };
    }

    _isWithinBbox(lon, lat, bbox) {
        if (!bbox) return true;
        const latOk = lat >= bbox.minLat && lat <= bbox.maxLat;
        if (!latOk) return false;
        // Dateline-spanning ranges get very large width. In that case skip strict lon clipping.
        if ((bbox.maxLon - bbox.minLon) > 300) return true;
        return lon >= bbox.minLon && lon <= bbox.maxLon;
    }

    _findCountryFromDirection(THREE, direction, group) {
        if (!this.countryBoundaryFeatures.length) return null;
        const { lat, lon } = this._dirToLatLon(THREE, direction, group);
        for (const feature of this.countryBoundaryFeatures) {
            if (!this._isWithinBbox(lon, lat, feature.bbox)) continue;
            for (const polygon of feature.polygons) {
                if (this._pointInPolygon(lon, lat, polygon)) {
                    return {
                        feature,
                        lat,
                        lon
                    };
                }
            }
        }
        return null;
    }

    _clearCountryBorderHighlight() {
        const s = this.threeState;
        if (!s?.group || !this.countryBoundaryBorder) return;
        s.group.remove(this.countryBoundaryBorder);
        this.countryBoundaryBorder.traverse?.((obj) => {
            if (obj.geometry?.dispose) obj.geometry.dispose();
            if (obj.material?.dispose) obj.material.dispose();
        });
        this.countryBoundaryBorder = null;
    }

    _setCountryBorderHighlight(THREE, featureRef, group) {
        if (!featureRef || !group) {
            this._clearCountryBorderHighlight();
            return;
        }
        this._clearCountryBorderHighlight();
        const borderGroup = new THREE.Group();
        const radius = 1.012;
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x9ed8ff,
            transparent: true,
            opacity: 0.95
        });
        for (const polygon of featureRef.polygons) {
            if (!Array.isArray(polygon) || !polygon.length) continue;
            const outer = polygon[0];
            if (!Array.isArray(outer) || outer.length < 2) continue;
            const points = [];
            for (const coord of outer) {
                const lon = Number(coord[0]);
                const lat = Number(coord[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                points.push(this._latLonToVec3(lat, lon, radius, THREE));
            }
            if (points.length < 2) continue;
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(lineGeo, lineMaterial.clone());
            borderGroup.add(line);
        }
        group.add(borderGroup);
        this.countryBoundaryBorder = borderGroup;
    }

    _showCountryPanel(country, aliases = []) {
        const resolvedCountry = this._resolveCountryFilterValue(country, aliases);
        const photos = this.locationsByCountry[resolvedCountry] || [];
        let html = `<h3 class="globe-panel-country">${this._escapeHtml(country || 'Unknown')}</h3>`;
        html += `<p class="globe-panel-count">${photos.length} photo${photos.length !== 1 ? 's' : ''}</p>`;
        if (!photos.length) {
            html += '<p class="globe-panel-count">no photos in this country yet</p>';
        }
        html += '<div class="globe-panel-actions">';
        html += `<button class="globe-panel-filter-btn" id="globe-filter-country-boundary" ${photos.length ? '' : 'disabled'}>show country photos</button>`;
        html += '</div>';
        this.panelContent.innerHTML = html;
        document.getElementById('globe-filter-country-boundary')?.addEventListener('click', () => {
            if (!photos.length) return;
            this._applyFilter('country', resolvedCountry);
        });
    }

    _hideIntersectPicker() {
        if (!this.intersectPicker) return;
        this.intersectPicker.classList.add('hidden');
        this.intersectPicker.innerHTML = '';
    }

    _showIntersectPicker(choices, onPick, anchorClient = null) {
        if (!this.intersectPicker) return;
        if (!Array.isArray(choices) || choices.length === 0) {
            this._hideIntersectPicker();
            return;
        }

        let html = '<div class="globe-intersect-picker-title">choose location</div>';
        for (const choice of choices) {
            const label = this._escapeHtml(choice.label || choice.key || 'unknown');
            const country = this._escapeHtml(choice.country || '');
            const classes = choice.kind === 'country'
                ? 'globe-intersect-picker-item globe-intersect-picker-item-country'
                : 'globe-intersect-picker-item';
            html += `<button class="${classes}" data-key="${this._escapeHtml(choice.key)}">
                <span class="globe-intersect-picker-label">${label}</span>
                ${country ? `<span class="globe-intersect-picker-country">${country}</span>` : ''}
            </button>`;
        }
        this.intersectPicker.innerHTML = html;
        this.intersectPicker.classList.remove('hidden');
        this.intersectPicker.style.left = '';
        this.intersectPicker.style.top = '';
        this.intersectPicker.style.right = '';

        this.intersectPicker.querySelectorAll('.globe-intersect-picker-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key') || '';
                const selected = choices.find((c) => c.key === key);
                if (selected) {
                    onPick(selected);
                }
                this._hideIntersectPicker();
            });
        });

        if (anchorClient && this.intersectPicker.parentElement) {
            const parentRect = this.intersectPicker.parentElement.getBoundingClientRect();
            const desiredX = anchorClient.x - parentRect.left + 16;
            const desiredY = anchorClient.y - parentRect.top - 12;
            requestAnimationFrame(() => {
                const panelW = this.intersectPicker.offsetWidth || 220;
                const panelH = this.intersectPicker.offsetHeight || 180;
                const minPad = 12;
                const maxX = Math.max(minPad, parentRect.width - panelW - minPad);
                const maxY = Math.max(minPad, parentRect.height - panelH - minPad);
                const clampedX = Math.min(Math.max(minPad, desiredX), maxX);
                const clampedY = Math.min(Math.max(minPad, desiredY), maxY);
                this.intersectPicker.style.left = `${clampedX}px`;
                this.intersectPicker.style.top = `${clampedY}px`;
            });
        }
    }

    _pickPrecisePointIndex(hits, pointerPx, camera, renderer, group, THREE, maxPixelDistance = 14) {
        if (!Array.isArray(hits) || !hits.length) return null;
        const width = renderer.domElement.clientWidth || 1;
        const height = renderer.domElement.clientHeight || 1;
        const worldQuat = group.getWorldQuaternion(new THREE.Quaternion());
        let bestIdx = null;
        let bestDistSq = Infinity;
        const maxSq = maxPixelDistance * maxPixelDistance;

        for (const hit of hits) {
            const idx = hit.index;
            if (idx == null || idx >= this.locationUnitVectors.length) continue;
            const worldPos = this.locationUnitVectors[idx].clone().multiplyScalar(1.01).applyQuaternion(worldQuat);
            const ndc = worldPos.clone().project(camera);
            if (ndc.z < -1 || ndc.z > 1) continue;
            const sx = (ndc.x * 0.5 + 0.5) * width;
            const sy = (-ndc.y * 0.5 + 0.5) * height;
            const dx = sx - pointerPx.x;
            const dy = sy - pointerPx.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= maxSq && d2 < bestDistSq) {
                bestDistSq = d2;
                bestIdx = idx;
            }
        }
        return bestIdx;
    }

    _collectIntersectingLocationKeys(hits, pointerPx, camera, renderer, group, THREE, maxPixelDistance = 15) {
        if (!Array.isArray(hits) || !hits.length) return [];
        const width = renderer.domElement.clientWidth || 1;
        const height = renderer.domElement.clientHeight || 1;
        const worldQuat = group.getWorldQuaternion(new THREE.Quaternion());
        const maxSq = maxPixelDistance * maxPixelDistance;
        const byKey = new Map();

        for (const hit of hits) {
            const idx = hit.index;
            if (idx == null || idx >= this.locationUnitVectors.length) continue;
            const worldPos = this.locationUnitVectors[idx].clone().multiplyScalar(1.01).applyQuaternion(worldQuat);
            const ndc = worldPos.clone().project(camera);
            if (ndc.z < -1 || ndc.z > 1) continue;
            const sx = (ndc.x * 0.5 + 0.5) * width;
            const sy = (-ndc.y * 0.5 + 0.5) * height;
            const dx = sx - pointerPx.x;
            const dy = sy - pointerPx.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > maxSq) continue;

            const key = this._locationKeyFor(this.locations[idx]);
            const prev = byKey.get(key);
            if (!prev || d2 < prev.distSq) {
                byKey.set(key, { key, distSq: d2 });
            }
        }

        return Array.from(byKey.values())
            .sort((a, b) => {
                if (a.distSq !== b.distSq) return a.distSq - b.distSq;
                return a.key.localeCompare(b.key);
            })
            .map((x) => x.key);
    }

    _collectUniqueHitLocationKeys(hits) {
        if (!Array.isArray(hits) || !hits.length) return [];
        const seen = new Set();
        const keys = [];
        for (const hit of hits) {
            const idx = hit.index;
            if (idx == null || idx >= this.locations.length) continue;
            const key = this._locationKeyFor(this.locations[idx]);
            if (seen.has(key)) continue;
            seen.add(key);
            keys.push(key);
        }
        return keys;
    }

    _applyDotHighlight() {
        const s = this.threeState;
        if (!s?.dotColors || !s?.dotsMesh?.geometry) return;

        const colors = s.dotColors;
        const base = [1.0, 1.0, 1.0];
        const highlight = [0.3, 0.3, 0.3];
        for (let i = 0; i < this.locations.length; i++) {
            const p = i * 3;
            colors[p] = base[0];
            colors[p + 1] = base[1];
            colors[p + 2] = base[2];
        }

        let indices = [];
        if (this.hoverHighlight.type === 'location' && this.hoverHighlight.key) {
            indices = this.locationGroupByKey.get(this.hoverHighlight.key)?.indices || [];
        }

        for (const idx of indices) {
            const p = idx * 3;
            colors[p] = highlight[0];
            colors[p + 1] = highlight[1];
            colors[p + 2] = highlight[2];
        }

        const colorAttr = s.dotsMesh.geometry.getAttribute('color');
        if (colorAttr) {
            colorAttr.needsUpdate = true;
        }
    }

    // ── event wiring ──

    _bindEvents() {
        this.openBtn?.addEventListener('click', () => this.open());
        this.closeBtn?.addEventListener('click', () => this.close());
        this.overlay?.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this._hideIntersectPicker();
                this.close();
            }
        });
        this.filterApplyBtn?.addEventListener('click', () => {
            if (this.selectedFilterValue) {
                this._applyFilter(this.selectedFilterType, this.selectedFilterValue);
            }
            else this._clearFilter();
        });
        this.filterClearBtn?.addEventListener('click', () => this._clearFilter());
        this.filterToggleBtn?.addEventListener('click', () => this._toggleFilterPanel());
        this.rotateToggleBtn?.addEventListener('click', () => this._toggleRotation());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this._hideIntersectPicker();
                this.close();
            }
        });
    }

    _setFilterPanelExpanded(expanded) {
        this.isFilterPanelExpanded = Boolean(expanded);
        this.filterPanel?.classList.toggle('expanded', this.isFilterPanelExpanded);
        this.filterPanel?.classList.toggle('collapsed', !this.isFilterPanelExpanded);
        if (this.filterBody) {
            this.filterBody.setAttribute('aria-hidden', this.isFilterPanelExpanded ? 'false' : 'true');
        }
        if (this.filterToggleBtn) {
            this.filterToggleBtn.setAttribute('aria-expanded', this.isFilterPanelExpanded ? 'true' : 'false');
            this.filterToggleBtn.setAttribute(
                'aria-label',
                this.isFilterPanelExpanded ? 'Minimize filter panel' : 'Expand filter panel'
            );
            this.filterToggleBtn.setAttribute(
                'title',
                this.isFilterPanelExpanded ? 'Minimize filter panel' : 'Expand filter panel'
            );
        }
        if (this.filterToggleIcon) {
            this.filterToggleIcon.textContent = this.isFilterPanelExpanded ? '−' : '+';
        }
    }

    _toggleFilterPanel() {
        this._setFilterPanelExpanded(!this.isFilterPanelExpanded);
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
            this._syncRotateToggleUI();
        } catch (err) {
            console.error('[GlobeExplorer] failed to initialize', err);
        }
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this._setHoverHighlight(null, null);
        this._clearCountryBorderHighlight();
        this._hideIntersectPicker();
        this.overlay.classList.remove('active');
        this.overlay.classList.add('hidden');
        document.body.style.overflow = '';
        // Keep scene alive for faster subsequent opens.
        // this._destroyScene();
    }

    _warmup() {
        this._loadThree()
            .then(() => this._loadOrbitControls())
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
            const data = await res.json();
            this.locations = Array.isArray(data.locations) ? data.locations : [];
            this._geoFetchedOnce = true;
        } catch (err) {
            console.error('[GlobeExplorer] failed to fetch geo data', err);
            this.locations = [];
        }

        this.locationsByCountry = {};
        const placeBuckets = new Map();
        this.locationsByPlace = {};
        for (const loc of this.locations) {
            const c = loc.country || 'Unknown';
            if (!this.locationsByCountry[c]) this.locationsByCountry[c] = [];
            this.locationsByCountry[c].push(loc);
            const placeRaw = String(loc.location || '').trim();
            if (placeRaw) {
                const placeKey = placeRaw.toLowerCase();
                if (!placeBuckets.has(placeKey)) {
                    placeBuckets.set(placeKey, { label: placeRaw, items: [] });
                }
                placeBuckets.get(placeKey).items.push(loc);
            }
        }
        for (const bucket of placeBuckets.values()) {
            this.locationsByPlace[bucket.label] = bucket.items;
        }
        this._seedCountryAliasesFromLocations();
        this._renderFilterMenu();
    }

    // ── Three.js loading ──

    _loadThree() {
        if (window.THREE) return Promise.resolve(window.THREE);
        if (this._threePromise) return this._threePromise;
        this._threePromise = import('three').then(mod => {
            window.THREE = mod;
            return mod;
        });
        return this._threePromise;
    }

    _loadOrbitControls() {
        if (this._orbitPromise) return this._orbitPromise;
        this._orbitPromise = import('three/addons/controls/OrbitControls.js')
            .then(mod => mod.OrbitControls);
        return this._orbitPromise;
    }

    // ── scene lifecycle ──

    async _initScene() {
        if (this.threeState) return;

        const THREE = await this._loadThree();
        let OrbitControls = null;
        try {
            OrbitControls = await this._loadOrbitControls();
        } catch (err) {
            console.warn('[GlobeExplorer] OrbitControls unavailable, continuing without controls', err);
        }

        await new Promise(r => requestAnimationFrame(r));
        const rect = this.sceneContainer.getBoundingClientRect();
        const w = rect.width || 600;
        const h = rect.height || 600;
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
        } catch (err) {
            console.warn('[GlobeExplorer] texture load failed, using fallback material', err);
            mat = new THREE.MeshPhongMaterial({ color: 0xbdbdbd, shininess: 1 });
        }
        const globe = new THREE.Mesh(geo, mat);
        group.add(globe);
        await this._ensureCountryBoundariesLoaded();

        const dotsMesh = this._buildDots(THREE, group);
        this._buildArcs(THREE, group);
        const raycaster = new THREE.Raycaster();
        raycaster.params.Points = { threshold: 0.034 };
        const mouse = new THREE.Vector2();

        // Fallback drag-rotate (works even when OrbitControls fails to load).
        let drag = null;
        renderer.domElement.addEventListener('pointerdown', (e) => {
            this.pointerGesture = {
                x: e.clientX,
                y: e.clientY,
                dragged: false,
                hadWheel: false
            };
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
            if (this.pointerGesture && ((dx * dx + dy * dy) > 36)) {
                this.pointerGesture.dragged = true;
                this.lastManualRotateAt = Date.now();
                if (this.autoRotateEnabled) {
                    this.autoRotateEnabled = false;
                    if (controls) {
                        controls.autoRotate = false;
                    }
                    this._syncRotateToggleUI();
                }
            }
            // Only apply fallback while controls are missing.
            if (!controls) {
                group.rotation.y = drag.rotY + dx * 0.005;
                group.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, drag.rotX + dy * 0.005));
            }
        });
        renderer.domElement.addEventListener('mousemove', (e) => {
            const rect = renderer.domElement.getBoundingClientRect();
            const hoverMouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            raycaster.setFromCamera(hoverMouse, camera);
            if (dotsMesh) {
                const hits = raycaster.intersectObject(dotsMesh);
                const preciseIdx = this._pickPrecisePointIndex(
                    hits,
                    { x: e.clientX - rect.left, y: e.clientY - rect.top },
                    camera,
                    renderer,
                    group,
                    THREE,
                    13
                );
                if (preciseIdx != null && preciseIdx < this.locations.length) {
                    const key = this._locationKeyFor(this.locations[preciseIdx]);
                    this._setHoverHighlight('location', key);
                    this._clearCountryBorderHighlight();
                    return;
                }
            }

            const globeHits = raycaster.intersectObject(globe);
            if (!globeHits.length) {
                this._setHoverHighlight(null, null);
                this._clearCountryBorderHighlight();
                return;
            }
            this._setHoverHighlight(null, null);
            const hitDir = globeHits[0].point.clone().normalize();
            const countryHit = this._findCountryFromDirection(THREE, hitDir, group);
            if (countryHit?.feature) {
                this._setCountryBorderHighlight(THREE, countryHit.feature, group);
            } else {
                this._clearCountryBorderHighlight();
            }
        });
        renderer.domElement.addEventListener('wheel', () => {
            if (this.pointerGesture) {
                this.pointerGesture.hadWheel = true;
            }
        }, { passive: true });
        const endDrag = () => {
            this.lastPointerGesture = this.pointerGesture;
            this.pointerGesture = null;
            drag = null;
        };
        renderer.domElement.addEventListener('pointerup', endDrag);
        renderer.domElement.addEventListener('pointerleave', endDrag);
        renderer.domElement.addEventListener('mouseleave', () => {
            this._setHoverHighlight(null, null);
        });

        renderer.domElement.addEventListener('click', (e) => {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            const globeHits = raycaster.intersectObject(globe);
            if (!globeHits.length) {
                return;
            }
            const clickDir = globeHits[0].point.clone().normalize();
            const countryHit = this._findCountryFromDirection(THREE, clickDir, group);
            const applyCountryChoice = () => {
                if (!countryHit?.feature) return;
                const aliases = countryHit.feature.names || [];
                const canonicalCountry = this._resolveCountryFilterValue(countryHit.feature.name, aliases);
                this._setPendingFilterSelection('country', canonicalCountry);
                this._showCountryPanel(countryHit.feature.name, aliases);
                this._setCountryBorderHighlight(THREE, countryHit.feature, group);
            };

            if (dotsMesh) {
                const hits = raycaster.intersectObject(dotsMesh);
                const pointerPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                const preciseIdx = this._pickPrecisePointIndex(
                    hits,
                    pointerPx,
                    camera,
                    renderer,
                    group,
                    THREE,
                    15
                );
                const selectedLocation = (preciseIdx != null && preciseIdx < this.locations.length)
                    ? this.locations[preciseIdx]
                    : null;
                const preferredKey = selectedLocation
                    ? this._locationKeyFor(selectedLocation)
                    : '';

                const intersectKeys = this._collectIntersectingLocationKeys(
                    hits,
                    pointerPx,
                    camera,
                    renderer,
                    group,
                    THREE,
                    22
                );
                const previousThreshold = raycaster.params.Points?.threshold ?? 0.034;
                raycaster.params.Points.threshold = 0.095;
                const expandedHits = raycaster.intersectObject(dotsMesh);
                raycaster.params.Points.threshold = previousThreshold;

                const rawHitKeys = this._collectUniqueHitLocationKeys(expandedHits);
                let candidateKeys = [];
                if (intersectKeys.length > 1) candidateKeys = intersectKeys;
                else if (rawHitKeys.length > 1) candidateKeys = rawHitKeys;
                else if (preferredKey) candidateKeys = [preferredKey];
                else if (rawHitKeys.length === 1) candidateKeys = rawHitKeys;

                const uniqueKeys = [...new Set(candidateKeys)];
                const options = uniqueKeys
                    .map((key) => {
                        const groupEntry = this.locationGroupByKey.get(key);
                        const sample = groupEntry?.sample;
                        if (!sample) return null;
                        return {
                            key,
                            label: sample.location || sample.country || 'Unknown',
                            country: sample.country || '',
                            sample
                        };
                    })
                    .filter(Boolean);

                if (options.length > 1 && countryHit?.feature) {
                    options.unshift({
                        key: '__country__',
                        kind: 'country',
                        label: `country: ${countryHit.feature.name}`,
                        country: '',
                        feature: countryHit.feature
                    });
                }

                const applyPickedOption = (option) => {
                    if (option?.kind === 'country') {
                        applyCountryChoice();
                        return;
                    }
                    const selectedForPanel = option.sample || selectedLocation;
                    if (!selectedForPanel?.country) return;
                    if (selectedForPanel.location) {
                        this._setPendingFilterSelection('location', selectedForPanel.location);
                    } else {
                        this._setPendingFilterSelection('country', selectedForPanel.country);
                    }
                    this._showPointPanel(selectedForPanel, null);
                };

                if (options.length > 1) {
                    this._showIntersectPicker(options, applyPickedOption, { x: e.clientX, y: e.clientY });
                    return;
                }
                if (options.length === 1) {
                    this._hideIntersectPicker();
                    applyPickedOption(options[0]);
                    return;
                }
            }

            // If no point is selected, fallback to country polygons.
            this._hideIntersectPicker();
            applyCountryChoice();
            return;
        });

        const state = {
            renderer, scene, camera, group, globe, controls, geo, mat, tex,
            rafId: null, disposed: false, onResize: null, dotsMesh,
            dotColors: dotsMesh?.geometry?.getAttribute('color')?.array || null
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

        this.threeState = state;
        this._applyDotHighlight();
    }

    _destroyScene() {
        const s = this.threeState;
        if (!s) return;
        s.disposed = true;
        this._clearCountryBorderHighlight();
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
        const colors = new Float32Array(this.locations.length * 3);
        const radius = 1.01;
        this.locationUnitVectors = [];
        this.locationGroups = [];
        this.locationGroupByKey = new Map();
        const groupMap = new Map();

        for (let i = 0; i < this.locations.length; i++) {
            const v = this._latLonToVec3(this.locations[i].latitude, this.locations[i].longitude, radius, THREE);
            positions[i * 3] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
            colors[i * 3] = 1;
            colors[i * 3 + 1] = 1;
            colors[i * 3 + 2] = 1;
            this.locationUnitVectors.push(v.clone().normalize());

            const loc = this.locations[i];
            const key = this._locationKeyFor(loc);
            if (!groupMap.has(key)) {
                groupMap.set(key, {
                    key,
                    sample: loc,
                    indices: [],
                    sum: new THREE.Vector3()
                });
            }
            const entry = groupMap.get(key);
            entry.indices.push(i);
            entry.sum.add(v.clone().normalize());
        }

        this.locationGroups = Array.from(groupMap.values()).map((entry) => ({
            key: entry.key,
            sample: entry.sample,
            indices: entry.indices,
            unitVec: entry.sum.clone().normalize()
        }));
        this.locationGroups.forEach((entry) => {
            this.locationGroupByKey.set(entry.key, entry);
        });

        const dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        dotGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const dotMat = new THREE.PointsMaterial({
            vertexColors: true,
            size: 0.06,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.94,
            blending: THREE.NormalBlending,
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

    _showPointPanel(point, cycleInfo = null) {
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

    _showInferredCountryPanel(country, nearestLoc, angleDeg, cycleInfo = null) {
        const countryLocs = this.locationsByCountry[country] || [];
        if (!countryLocs.length) return;
        const countryEscaped = this._escapeHtml(country);
        const nearestPlace = String(nearestLoc?.location || '').trim();
        const nearestPlaceEscaped = this._escapeHtml(nearestPlace);

        let html = `<h3 class="globe-panel-country">${countryEscaped}</h3>`;
        html += `<p class="globe-panel-count">${countryLocs.length} photo${countryLocs.length !== 1 ? 's' : ''}</p>`;
        html += '<p class="globe-panel-count">inferred from nearest globe point</p>';
        if (nearestPlace) {
            html += `<p class="globe-panel-count">nearest place: ${nearestPlaceEscaped}</p>`;
        }
        if (cycleInfo && cycleInfo.clusterTotal > 1) {
            html += `<p class="globe-panel-count">nearby match ${cycleInfo.clusterPosition + 1}/${cycleInfo.clusterTotal}</p>`;
        }
        html += `<p class="globe-panel-count">distance: ${Math.round(angleDeg)}°</p>`;
        html += '<div class="globe-panel-actions">';
        html += '<button class="globe-panel-filter-btn" id="globe-filter-country-inferred">show country photos</button>';
        html += '</div>';

        this.panelContent.innerHTML = html;
        document.getElementById('globe-filter-country-inferred')?.addEventListener('click', () => {
            this._applyFilter('country', country);
        });
    }

    _pickNearestCountryFromSurface(THREE, clickDir, group, maxAngleDeg = 24) {
        const groupQuat = group.getWorldQuaternion(new THREE.Quaternion());
        const maxAngle = THREE.MathUtils.degToRad(maxAngleDeg);
        let bestGroup = null;
        let bestAngle = Infinity;

        for (const item of this.locationGroups) {
            const loc = item.sample;
            if (!loc || !loc.country) continue;
            const worldDir = item.unitVec.clone().applyQuaternion(groupQuat).normalize();
            const dot = THREE.MathUtils.clamp(clickDir.dot(worldDir), -1, 1);
            const angle = Math.acos(dot);
            if (angle < bestAngle) {
                bestAngle = angle;
                bestGroup = item;
            }
        }

        if (!bestGroup || bestAngle > maxAngle) return null;
        return {
            key: bestGroup.key,
            location: bestGroup.sample,
            angleDeg: THREE.MathUtils.radToDeg(bestAngle)
        };
    }

    _getGlobeCenterDirection(raycaster, camera, globe) {
        raycaster.setFromCamera({ x: 0, y: 0 }, camera);
        const hits = raycaster.intersectObject(globe);
        if (!hits.length) return null;
        return hits[0].point.clone().normalize();
    }

    _resolveClusterClick(THREE, clickDir, group, preferredKey = '') {
        const cluster = this._buildClickCluster(THREE, clickDir, group);
        if (!cluster.length) return null;

        const now = Date.now();
        const clusterKey = cluster.map((item) => item.key).join(',');
        const anchorTolerance = THREE.MathUtils.degToRad(2.0);
        const cycleTimeoutMs = 1800;
        let position = cluster.findIndex((item) => item.key === preferredKey);
        if (position === -1) position = 0;

        const canCycle = Boolean(
            this.clickCycleState
            && this.clickCycleState.clusterKey === clusterKey
            && (now - this.clickCycleState.timestamp) <= cycleTimeoutMs
            && this.clickCycleState.anchorDir.dot(clickDir) >= Math.cos(anchorTolerance)
        );
        if (canCycle) {
            position = (this.clickCycleState.position + 1) % cluster.length;
        }

        this.clickCycleState = {
            anchorDir: clickDir.clone(),
            clusterKey,
            position,
            timestamp: now
        };

        const chosen = cluster[position];
        return {
            key: chosen.key,
            location: chosen.location,
            angleDeg: THREE.MathUtils.radToDeg(chosen.angle),
            clusterPosition: position,
            clusterTotal: cluster.length
        };
    }

    _buildClickCluster(THREE, clickDir, group) {
        const groupQuat = group.getWorldQuaternion(new THREE.Quaternion());
        const clusterRadius = THREE.MathUtils.degToRad(5.0);
        const cluster = [];

        for (const item of this.locationGroups) {
            const loc = item.sample;
            if (!loc || !loc.country) continue;
            const worldDir = item.unitVec.clone().applyQuaternion(groupQuat).normalize();
            const dot = THREE.MathUtils.clamp(clickDir.dot(worldDir), -1, 1);
            const angle = Math.acos(dot);
            if (angle <= clusterRadius) {
                cluster.push({
                    key: item.key,
                    angle,
                    location: loc
                });
            }
        }

        cluster.sort((a, b) => {
            if (a.angle !== b.angle) return a.angle - b.angle;
            const la = String(a.location.location || '');
            const lb = String(b.location.location || '');
            const byLoc = la.localeCompare(lb);
            if (byLoc !== 0) return byLoc;
            return String(a.location.takenAt || '').localeCompare(String(b.location.takenAt || ''));
        });
        return cluster;
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
        if (!this.filterTypeList || !this.filterOptionList) return;
        if (!this.selectedFilterType) {
            this.selectedFilterType = 'country';
        }
        if (this.selectedFilterValue && !this._isOptionValid(this.selectedFilterType, this.selectedFilterValue)) {
            this.selectedFilterValue = '';
        }

        this.filterTypeList.innerHTML = '';
        const kinds = [
            { type: 'country', label: 'country' },
            { type: 'location', label: 'place' }
        ];
        for (const kind of kinds) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'country-filter-option';
            btn.dataset.type = kind.type;
            btn.textContent = kind.label;
            btn.classList.toggle('active', this.selectedFilterType === kind.type);
            btn.addEventListener('click', () => {
                this.selectedFilterType = kind.type;
                if (!this._isOptionValid(this.selectedFilterType, this.selectedFilterValue)) {
                    this.selectedFilterValue = '';
                }
                this._renderFilterMenu();
            });
            this.filterTypeList.appendChild(btn);
        }

        const options = this._getOptionsForType(this.selectedFilterType);
        this.filterOptionList.innerHTML = '';
        for (const item of options) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'country-filter-option';
            btn.dataset.type = this.selectedFilterType;
            btn.dataset.value = item.value;
            btn.textContent = `${item.label} (${item.count})`;
            btn.classList.toggle('active', this.selectedFilterValue === item.value);
            btn.addEventListener('click', () => {
                this.selectedFilterValue = item.value;
                this._renderFilterMenu();
            });
            this.filterOptionList.appendChild(btn);
        }

        if (this.filterScopeTitle) {
            this.filterScopeTitle.textContent = this.selectedFilterType === 'location' ? 'places' : 'countries';
        }
        if (this.filterActive) {
            this.filterActive.textContent = this.selectedFilterValue
                ? this._formatFilterLabel(this.selectedFilterType, this.selectedFilterValue)
                : 'ALL';
        }
    }

    _getOptionsForType(type) {
        if (type === 'location') {
            return Object.keys(this.locationsByPlace)
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b))
                .map((place) => ({
                    value: place,
                    label: place,
                    count: this.locationsByPlace[place]?.length || 0
                }));
        }
        return Object.keys(this.locationsByCountry)
            .filter((c) => c && c !== 'Unknown')
            .sort((a, b) => a.localeCompare(b))
            .map((country) => ({
                value: country,
                label: country,
                count: this.locationsByCountry[country]?.length || 0
            }));
    }

    _isOptionValid(type, value) {
        if (!value) return false;
        if (type === 'location') return Boolean(this.locationsByPlace[value]?.length);
        return Boolean(this.locationsByCountry[value]?.length);
    }

    async _applyFilter(filterType, filterValue, takenFrom = null, takenTo = null, label = '') {
        this.close();
        if (this.filterActive) {
            this.filterActive.textContent = this._formatFilterLabel(filterType, filterValue, label);
        }
        this.selectedFilterType = filterType;
        this.selectedFilterValue = filterValue;
        this._renderFilterMenu();

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
        this.selectedFilterType = 'country';
        this.selectedFilterValue = '';
        this.imageService.countryFilter = null;
        this.imageService.locationFilter = null;
        this.imageService.takenFromFilter = null;
        this.imageService.takenToFilter = null;
        this._renderFilterMenu();
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }
}

window.GlobeExplorer = GlobeExplorer;
