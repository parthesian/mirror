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
        this.locationsByState = {};
        this.locationsByStateKey = {};
        this.locationsByPlace = {};
        this.locationsByPlaceKey = {};
        this.orbitControls = null;
        this._threePromise = null;
        this._orbitPromise = null;
        this._geoPromise = null;
        this._geoFetchedOnce = false;
        this.autoRotateEnabled = true;
        this.locationUnitVectors = [];
        this.renderedPointLocations = [];
        this.locationGroups = [];
        this.pointerGesture = null;
        this.lastPointerGesture = null;
        this.selectedFilterType = 'country';
        this.selectedFilterValue = '';
        this.selectedFilters = { country: '', state: '', location: '' };
        this.lastManualRotateAt = 0;
        this.locationGroupByKey = new Map();
        this.hoverHighlight = { type: null, key: null };
        this.highlightedDotIndices = [];
        this.isFilterPanelExpanded = false;
        this._countryBoundaryPromise = null;
        this.countryBoundaryFeatures = [];
        this.countryBoundaryAliasMap = new Map();
        this.countryFilterAliasMap = new Map();
        this.countryBoundaryBorder = null;
        this.countryBorderHighlightKey = '';
        this.filterOptionCache = new Map();

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
        const labels = {
            country: 'COUNTRY',
            state: 'REGION',
            location: 'PLACE'
        };
        const base = `${labels[filterType] || 'FILTER'}: ${String(filterValue || '').toUpperCase()}`;
        return label ? `${base} · ${String(label).toUpperCase()}` : base;
    }

    _formatSelectedFiltersLabel() {
        const filters = this.selectedFilters || {};
        const parts = this._getSelectedFilterLabels();
        return parts.length ? parts.join(' · ') : 'ALL';
    }

    _getSelectedFilterLabels() {
        const filters = this.selectedFilters || {};
        return [
            filters.country ? this._formatFilterLabel('country', filters.country) : '',
            filters.state ? this._formatFilterLabel('state', filters.state) : '',
            filters.location ? this._formatFilterLabel('location', filters.location) : ''
        ].filter(Boolean);
    }

    _renderActiveFilterLabel(label = '') {
        if (!this.filterActive) return;
        if (label) {
            this.filterActive.textContent = label;
            return;
        }

        const parts = this._getSelectedFilterLabels();
        this.filterActive.innerHTML = '';
        if (!parts.length) {
            this.filterActive.textContent = 'ALL';
            return;
        }
        for (const part of parts) {
            const span = document.createElement('span');
            span.className = 'country-filter-active-segment';
            span.textContent = part;
            this.filterActive.appendChild(span);
        }
    }

    _normalizeLocationPart(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
    }

    _stateKeyForLoc(loc) {
        const state = this._normalizeLocationPart(loc?.state);
        if (!state) return '';
        const country = this._normalizeLocationPart(loc?.country);
        return `state:${state}|country:${country}`;
    }

    _locationKeyFor(loc) {
        const place = String(loc?.location || '').trim();
        if (place) {
            const state = this._normalizeLocationPart(loc?.state);
            const country = this._normalizeLocationPart(loc?.country);
            return `place:${this._normalizeLocationPart(place)}|state:${state}|country:${country}`;
        }
        const lat = Number(loc?.latitude);
        const lon = Number(loc?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return `coords:${lat.toFixed(3)},${lon.toFixed(3)}`;
        }
        return `photo:${String(loc?.id || '')}`;
    }

    _formatLocationWithRegion(loc) {
        const location = String(loc?.location || '').trim();
        const region = String(loc?.state || '').trim();
        if (!region || region.toLowerCase() === location.toLowerCase()) {
            return location;
        }
        return location ? `${location}, ${region}` : region;
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

    _setPendingFilterSelection(type, value, loc = null) {
        this.selectedFilterType = type;
        if (loc?.country) this.selectedFilters.country = loc.country;
        if (loc?.state) this.selectedFilters.state = loc.state;
        this._setFilterSelection(type, value, false);
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
            if (mapped && this.locationsByCountry[mapped]?.length > 0) return mapped;
            if (candidate && this.locationsByCountry[candidate]?.length > 0) return candidate;
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

    _countryFeatureKey(featureRef) {
        if (!featureRef) return '';
        return featureRef.iso3 || featureRef.iso2 || featureRef.name || '';
    }

    _clearCountryBorderHighlight() {
        this.countryBorderHighlightKey = '';
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
        const featureKey = this._countryFeatureKey(featureRef);
        if (featureKey && featureKey === this.countryBorderHighlightKey && this.countryBoundaryBorder) {
            return;
        }
        this._clearCountryBorderHighlight();
        this.countryBorderHighlightKey = featureKey;
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
        html += `<button class="globe-panel-filter-btn" id="globe-filter-country-boundary" ${photos.length ? '' : 'disabled'}>show photos</button>`;
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

    _showClickPulse(clientX, clientY) {
        if (!this.sceneContainer) return;
        const rect = this.sceneContainer.getBoundingClientRect();
        const pulse = document.createElement('span');
        pulse.className = 'globe-click-pulse';
        pulse.style.left = `${clientX - rect.left}px`;
        pulse.style.top = `${clientY - rect.top}px`;
        pulse.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 3; i++) {
            const ring = document.createElement('span');
            ring.className = 'globe-click-pulse-ring';
            pulse.appendChild(ring);
        }
        this.sceneContainer.appendChild(pulse);
        pulse.addEventListener('animationend', (event) => {
            if (event.target === pulse) pulse.remove();
        }, { once: true });
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
            const region = this._escapeHtml(choice.state || '');
            const classes = choice.kind === 'country'
                ? 'globe-intersect-picker-item globe-intersect-picker-item-country'
                : 'globe-intersect-picker-item';
            html += `<button class="${classes}" data-key="${this._escapeHtml(choice.key)}">
                <span class="globe-intersect-picker-label">${label}</span>
                ${region ? `<span class="globe-intersect-picker-country">${region}</span>` : ''}
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

            const key = this._locationKeyFor(this.renderedPointLocations[idx]);
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
            if (idx == null || idx >= this.renderedPointLocations.length) continue;
            const key = this._locationKeyFor(this.renderedPointLocations[idx]);
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
        for (const i of this.highlightedDotIndices || []) {
            if (i < 0 || i >= this.renderedPointLocations.length) continue;
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
        this.highlightedDotIndices = [...indices];

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
            const selected = this._getMostSpecificFilterSelection();
            if (selected) {
                this._applyFilter(selected.type, selected.value);
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

    async open(focusLocation = null) {
        if (this.isOpen) {
            if (focusLocation) {
                await this._focusLocation(focusLocation);
            }
            return;
        }
        this.isOpen = true;
        this.overlay.classList.remove('hidden');
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        try {
            await this._fetchLocations();
            await this._initScene();
            if (focusLocation) {
                await this._focusLocation(focusLocation);
            }
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

    async _focusLocation(location) {
        await this._fetchLocations();
        if (!this.threeState) return;

        const match = this._findLocationMatch(location) || location;
        if (!match) return;

        this._rotateToLocation(match);
        const place = String(match.location || '').trim();
        if (place) {
            this._setPendingFilterSelection('location', place, match);
        } else if (match.state) {
            this._setPendingFilterSelection('state', match.state, match);
        } else if (match.country) {
            this._setPendingFilterSelection('country', match.country, match);
        }
        const key = this._locationKeyFor(match);
        if (this.locationGroupByKey.has(key)) {
            this._setHoverHighlight('location', key);
        }
        this._showPointPanel(match, null);
    }

    _findLocationMatch(location) {
        if (!location) return null;
        const id = String(location.id || '').trim();
        if (id) {
            const byId = this.locations.find((loc) => String(loc.id || '') === id);
            if (byId) return byId;
        }

        const lat = Number(location.latitude);
        const lon = Number(location.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const byCoords = this.locations.find((loc) => (
                Math.abs(Number(loc.latitude) - lat) < 0.000001 &&
                Math.abs(Number(loc.longitude) - lon) < 0.000001
            ));
            if (byCoords) return byCoords;
        }

        const key = this._locationKeyFor(location);
        return this.locationGroupByKey.get(key)?.sample || null;
    }

    _rotateToLocation(location) {
        const THREE = window.THREE;
        const s = this.threeState;
        const lat = Number(location?.latitude);
        const lon = Number(location?.longitude);
        if (!THREE || !s?.group || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

        this.autoRotateEnabled = false;
        if (s.controls) {
            s.controls.autoRotate = false;
            s.controls.reset?.();
        }
        s.group.rotation.x = THREE.MathUtils.degToRad(lat);
        s.group.rotation.y = -Math.PI / 2 - THREE.MathUtils.degToRad(lon);
        this.lastManualRotateAt = Date.now();
        this._syncRotateToggleUI();
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
        const stateBuckets = new Map();
        const placeBuckets = new Map();
        this.locationsByState = {};
        this.locationsByStateKey = {};
        this.locationsByPlace = {};
        this.locationsByPlaceKey = {};
        for (const loc of this.locations) {
            const c = loc.country || 'Unknown';
            if (!this.locationsByCountry[c]) this.locationsByCountry[c] = [];
            this.locationsByCountry[c].push(loc);
            const stateRaw = String(loc.state || '').trim();
            if (stateRaw) {
                const stateKey = this._stateKeyForLoc(loc);
                if (!stateBuckets.has(stateKey)) {
                    stateBuckets.set(stateKey, { label: stateRaw, items: [] });
                }
                stateBuckets.get(stateKey).items.push(loc);
            }
            const placeRaw = String(loc.location || '').trim();
            if (placeRaw) {
                const placeKey = this._locationKeyFor(loc);
                if (!placeBuckets.has(placeKey)) {
                    placeBuckets.set(placeKey, { label: placeRaw, items: [] });
                }
                placeBuckets.get(placeKey).items.push(loc);
            }
        }
        for (const [key, bucket] of stateBuckets.entries()) {
            this.locationsByState[bucket.label] = bucket.items;
            this.locationsByStateKey[key] = bucket.items;
        }
        for (const [key, bucket] of placeBuckets.entries()) {
            this.locationsByPlace[bucket.label] = bucket.items;
            this.locationsByPlaceKey[key] = bucket.items;
        }
        this.filterOptionCache.clear();
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
        const arcLines = this._buildArcs(THREE, group);
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
        let pendingHoverPointer = null;
        let hoverRafId = null;
        const processHoverPointer = (e) => {
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
                if (preciseIdx != null && preciseIdx < this.renderedPointLocations.length) {
                    const key = this._locationKeyFor(this.renderedPointLocations[preciseIdx]);
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
        };
        renderer.domElement.addEventListener('mousemove', (e) => {
            pendingHoverPointer = { clientX: e.clientX, clientY: e.clientY };
            if (hoverRafId != null) {
                return;
            }
            hoverRafId = requestAnimationFrame(() => {
                hoverRafId = null;
                const nextPointer = pendingHoverPointer;
                pendingHoverPointer = null;
                if (nextPointer) {
                    processHoverPointer(nextPointer);
                }
            });
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
            const gesture = this.lastPointerGesture;
            if (gesture?.dragged || gesture?.hadWheel) {
                return;
            }
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            const globeHits = raycaster.intersectObject(globe);
            if (!globeHits.length) {
                return;
            }
            this._showClickPulse(e.clientX, e.clientY);
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
                const selectedLocation = (preciseIdx != null && preciseIdx < this.renderedPointLocations.length)
                    ? this.renderedPointLocations[preciseIdx]
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
                            state: sample.state || '',
                            sample
                        };
                    })
                    .filter(Boolean);

                if (options.length > 1 && countryHit?.feature) {
                    options.unshift({
                        key: '__country__',
                        kind: 'country',
                        label: countryHit.feature.name,
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
                        this._setPendingFilterSelection('location', selectedForPanel.location, selectedForPanel);
                    } else {
                        this._setPendingFilterSelection('country', selectedForPanel.country, selectedForPanel);
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
            rafId: null, disposed: false, onResize: null, dotsMesh, arcLines,
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
            s.dotsMesh?.geometry?.dispose();
            s.dotsMesh?.material?.dispose();
            s.arcLines?.geometry?.dispose();
            s.arcLines?.material?.dispose();
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

        const radius = 1.01;
        this.locationUnitVectors = [];
        this.renderedPointLocations = [];
        this.locationGroups = [];
        this.locationGroupByKey = new Map();
        this.highlightedDotIndices = [];
        const groupMap = new Map();

        for (let i = 0; i < this.locations.length; i++) {
            const loc = this.locations[i];
            const lat = Number(loc?.latitude);
            const lon = Number(loc?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

            const v = this._latLonToVec3(lat, lon, radius, THREE);
            const key = this._locationKeyFor(loc);
            if (!groupMap.has(key)) {
                groupMap.set(key, {
                    key,
                    sample: loc,
                    photoIndices: [],
                    sum: new THREE.Vector3(),
                    count: 0
                });
            }
            const entry = groupMap.get(key);
            entry.photoIndices.push(i);
            entry.sum.add(v.clone().normalize());
            entry.count += 1;
        }

        this.locationGroups = Array.from(groupMap.values()).map((entry, index) => {
            const unitVec = entry.sum.clone().normalize();
            return {
                key: entry.key,
                sample: entry.sample,
                indices: [index],
                photoIndices: entry.photoIndices,
                unitVec,
                count: entry.count
            };
        });
        if (this.locationGroups.length === 0) return null;

        const positions = new Float32Array(this.locationGroups.length * 3);
        const colors = new Float32Array(this.locationGroups.length * 3);
        this.locationGroups.forEach((entry, index) => {
            const v = entry.unitVec.clone().multiplyScalar(radius);
            positions[index * 3] = v.x;
            positions[index * 3 + 1] = v.y;
            positions[index * 3 + 2] = v.z;
            colors[index * 3] = 1;
            colors[index * 3 + 1] = 1;
            colors[index * 3 + 2] = 1;
            this.locationUnitVectors.push(entry.unitVec.clone());
            this.renderedPointLocations.push(entry.sample);
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
        dots.renderOrder = 2;
        group.add(dots);
        return dots;
    }

    _buildArcs(THREE, group) {
        if (this.locations.length < 2) return null;

        const radius = 1.01;
        const minArcAngle = THREE.MathUtils.degToRad(1.0);
        const arcMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const seenEdges = new Set();
        const arcs = [];
        let prev = null;
        let prevKey = '';
        let sequence = 0;
        for (const loc of this.locations) {
            const lat = Number(loc?.latitude);
            const lon = Number(loc?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                continue;
            }

            const locKey = this._locationKeyFor(loc);
            if (!prev) {
                prev = loc;
                prevKey = locKey;
                continue;
            }

            if (locKey === prevKey) {
                continue;
            }

            const edgeKey = [prevKey, locKey].sort().join('->');
            if (!seenEdges.has(edgeKey)) {
                const start = this._latLonToVec3(prev.latitude, prev.longitude, radius, THREE);
                const end = this._latLonToVec3(lat, lon, radius, THREE);
                const angle = start.clone().normalize().angleTo(end.clone().normalize());
                if (angle >= minArcAngle) {
                    seenEdges.add(edgeKey);
                    arcs.push({ start, end, angle, sequence });
                    sequence += 1;
                }
            }

            prev = loc;
            prevKey = locKey;
        }

        if (!arcs.length) return null;

        arcs.sort((a, b) => {
            if (b.angle !== a.angle) return b.angle - a.angle;
            return a.sequence - b.sequence;
        });

        const segmentPoints = [];
        for (const arc of arcs) {
            const mid = new THREE.Vector3().addVectors(arc.start, arc.end).multiplyScalar(0.5);
            const dist = arc.start.distanceTo(arc.end);
            mid.normalize().multiplyScalar(radius + dist * 0.3);

            const curve = new THREE.QuadraticBezierCurve3(arc.start, mid, arc.end);
            const angleDeg = THREE.MathUtils.radToDeg(arc.angle);
            const segments = Math.max(8, Math.min(32, Math.ceil(angleDeg / 4)));
            const points = curve.getPoints(segments);
            for (let i = 1; i < points.length; i++) {
                segmentPoints.push(points[i - 1], points[i]);
            }
        }

        const lineGeo = new THREE.BufferGeometry().setFromPoints(segmentPoints);
        const arcLines = new THREE.LineSegments(lineGeo, arcMat);
        arcLines.renderOrder = 1;
        group.add(arcLines);
        return arcLines;
    }

    // ── panel ──

    _showPointPanel(point, cycleInfo = null) {
        const country = point?.country || 'Unknown';
        const state = String(point?.state || '').trim();
        const place = String(point?.location || '').trim();
        const countryLocs = this.locationsByCountry[country] || [];
        const stateLocs = state ? (this.locationsByStateKey[this._stateKeyForLoc(point)] || this.locationsByState[state] || []) : [];
        const placeLocs = place ? (this.locationsByPlaceKey[this._locationKeyFor(point)] || this.locationsByPlace[place] || []) : [];
        const defaultType = placeLocs.length > 0 ? 'location' : (stateLocs.length > 0 ? 'state' : 'country');
        const defaultValue = defaultType === 'location' ? place : (defaultType === 'state' ? state : country);
        const activeLocs = defaultType === 'location' ? placeLocs : (defaultType === 'state' ? stateLocs : countryLocs);
        if (!activeLocs.length) return;

        const trips = this._groupTrips(activeLocs);
        const title = this._formatLocationWithRegion(point) || country;
        const titleEscaped = this._escapeHtml(title);

        let html = `<h3 class="globe-panel-country">${titleEscaped}</h3>`;
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
        const placeAndRegionMatch = place && state && place.toLowerCase() === state.toLowerCase();
        const filterScopes = [
            place ? { type: 'location', value: place, label: placeAndRegionMatch ? `${place} (place)` : place } : null,
            state ? { type: 'state', value: state, label: placeAndRegionMatch ? `${state} (region)` : state } : null,
            country ? { type: 'country', value: country, label: country } : null
        ].filter(Boolean);
        html += '<div class="globe-panel-actions">';
        if (filterScopes.length > 1) {
            html += '<label class="globe-panel-filter-scope">';
            html += '<span>filter by</span>';
            html += '<select id="globe-filter-scope-select">';
            for (const scope of filterScopes) {
                html += `<option value="${scope.type}" ${scope.type === defaultType ? 'selected' : ''}>${this._escapeHtml(scope.label)}</option>`;
            }
            html += '</select>';
            html += '</label>';
        }
        html += '<button class="globe-panel-filter-btn" id="globe-filter-selected">show photos</button>';
        html += '</div>';

        this.panelContent.innerHTML = html;

        document.getElementById('globe-filter-selected')?.addEventListener('click', () => {
            const selectedType = document.getElementById('globe-filter-scope-select')?.value || defaultType;
            const selectedScope = filterScopes.find((scope) => scope.type === selectedType)
                || filterScopes.find((scope) => scope.type === defaultType)
                || filterScopes[0];
            if (selectedScope) {
                this._applyFilter(selectedScope.type, selectedScope.value);
            }
        });
        this.panelContent.querySelectorAll('.globe-panel-trip-link').forEach((el) => {
            el.addEventListener('click', () => {
                const selectedType = document.getElementById('globe-filter-scope-select')?.value || el.getAttribute('data-filter-type') || defaultType;
                const selectedScope = filterScopes.find((scope) => scope.type === selectedType)
                    || filterScopes.find((scope) => scope.type === defaultType)
                    || filterScopes[0];
                const type = selectedScope?.type || defaultType;
                const value = selectedScope?.value || defaultValue;
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
        html += '<button class="globe-panel-filter-btn" id="globe-filter-country-inferred">show photos</button>';
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
        this._normalizeFilterSelections();

        this.filterTypeList.innerHTML = '';
        const kinds = [
            { type: 'country', label: 'country' },
            { type: 'state', label: 'region' },
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
                this._syncSelectedFilterValue();
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
            btn.classList.toggle('active', this._isFilterOptionActive(this.selectedFilterType, item));
            btn.addEventListener('click', () => {
                if (this._isFilterOptionActive(this.selectedFilterType, item)) {
                    this._clearFilterSelection(this.selectedFilterType, false);
                } else {
                    this._setFilterSelectionFromOption(this.selectedFilterType, item, false);
                }
                this._renderFilterMenu();
            });
            this.filterOptionList.appendChild(btn);
        }

        if (this.filterScopeTitle) {
            const titles = {
                country: 'countries',
                state: 'regions',
                location: 'places'
            };
            this.filterScopeTitle.textContent = titles[this.selectedFilterType] || 'options';
        }
        if (this.filterActive) {
            this._renderActiveFilterLabel();
        }
    }

    _getOptionsForType(type) {
        const filters = this.selectedFilters || {};
        const cacheKey = [
            type,
            type !== 'country' ? (filters.country || '') : '',
            type === 'location' ? (filters.state || '') : ''
        ].join('\u0001');
        if (this.filterOptionCache.has(cacheKey)) {
            return this.filterOptionCache.get(cacheKey);
        }

        let options;
        if (type === 'country') {
            options = this._buildFilterOptions(this.locations, 'country', { excludeUnknown: true });
        } else if (type === 'state') {
            options = this._buildFilterOptions(this._getLocationsForFilterScope('state'), 'state', { includeCountryContext: true });
        } else {
            options = this._buildFilterOptions(this._getLocationsForFilterScope('location'), 'location', { includePlaceContext: true });
        }
        this.filterOptionCache.set(cacheKey, options);
        return options;
    }

    _isOptionValid(type, value) {
        if (!value) return false;
        return this._getOptionsForType(type).some((option) => option.value === value);
    }

    _buildFilterOptions(locations, field, options = {}) {
        const buckets = new Map();
        const labelContexts = new Map();
        for (const loc of Array.isArray(locations) ? locations : []) {
            const raw = String(loc?.[field] || '').trim();
            if (!raw || (options.excludeUnknown && raw === 'Unknown')) continue;
            const country = String(loc?.country || '').trim();
            const state = String(loc?.state || '').trim();
            const contextParts = [];
            if (options.includePlaceContext) {
                if (state) contextParts.push(state);
                if (country) contextParts.push(country);
            } else if (options.includeCountryContext && country) {
                contextParts.push(country);
            }
            const key = [raw, ...contextParts].join('\u0001').toLowerCase();
            if (!buckets.has(key)) {
                buckets.set(key, {
                    value: raw,
                    label: raw,
                    count: 0,
                    country: country || '',
                    state: state || ''
                });
            }
            buckets.get(key).count += 1;

            const labelKey = raw.toLowerCase();
            if (!labelContexts.has(labelKey)) {
                labelContexts.set(labelKey, new Set());
            }
            labelContexts.get(labelKey).add(contextParts.join('\u0001').toLowerCase());
        }
        return [...buckets.values()]
            .sort((a, b) => {
                const byLabel = a.label.localeCompare(b.label);
                if (byLabel !== 0) return byLabel;
                const byState = String(a.state || '').localeCompare(String(b.state || ''));
                if (byState !== 0) return byState;
                return String(a.country || '').localeCompare(String(b.country || ''));
            })
            .map((item) => ({
                value: item.value,
                label: this._formatFilterOptionLabel(item, labelContexts.get(item.value.toLowerCase())?.size > 1),
                count: item.count,
                country: item.country,
                state: item.state
            }));
    }

    _formatFilterOptionLabel(item, includeContext) {
        if (!includeContext) return item.label;
        const context = [item.state, item.country].filter(Boolean);
        return context.length ? `${item.label}, ${context.join(', ')}` : item.label;
    }

    _getLocationsForFilterScope(type) {
        const filters = this.selectedFilters || {};
        return (this.locations || []).filter((loc) => {
            if (type !== 'country' && filters.country && loc.country !== filters.country) {
                return false;
            }
            if (type === 'location' && filters.state) {
                return String(loc.state || '').trim().toLowerCase() === filters.state.toLowerCase();
            }
            return true;
        });
    }

    _syncSelectedFilterValue() {
        this.selectedFilterValue = this.selectedFilters?.[this.selectedFilterType] || '';
    }

    _normalizeFilterSelections() {
        if (!this.selectedFilters) {
            this.selectedFilters = { country: '', state: '', location: '' };
        }
        if (this.selectedFilters.country && !this._isOptionValid('country', this.selectedFilters.country)) {
            this.selectedFilters.country = '';
        }
        if (this.selectedFilters.state && !this._isOptionValid('state', this.selectedFilters.state)) {
            this.selectedFilters.state = '';
        }
        if (this.selectedFilters.location && !this._isOptionValid('location', this.selectedFilters.location)) {
            this.selectedFilters.location = '';
        }
        this._syncSelectedFilterValue();
    }

    _setFilterSelection(type, value, render = true) {
        if (!this.selectedFilters) {
            this.selectedFilters = { country: '', state: '', location: '' };
        }
        this.selectedFilters[type] = value || '';
        if (type === 'country') {
            if (this.selectedFilters.state && !this._isOptionValid('state', this.selectedFilters.state)) {
                this.selectedFilters.state = '';
            }
            if (this.selectedFilters.location && !this._isOptionValid('location', this.selectedFilters.location)) {
                this.selectedFilters.location = '';
            }
        }
        if (type === 'state' && this.selectedFilters.location && !this._isOptionValid('location', this.selectedFilters.location)) {
            this.selectedFilters.location = '';
        }
        this._syncSelectedFilterValue();
        if (render) this._renderFilterMenu();
    }

    _setFilterSelectionFromOption(type, item, render = true) {
        if (!this.selectedFilters) {
            this.selectedFilters = { country: '', state: '', location: '' };
        }
        if (type === 'state') {
            if (item.country) this.selectedFilters.country = item.country;
            this.selectedFilters.state = item.value || '';
            this.selectedFilters.location = '';
        } else if (type === 'location') {
            if (item.country) this.selectedFilters.country = item.country;
            if (item.state) this.selectedFilters.state = item.state;
            this.selectedFilters.location = item.value || '';
        } else {
            this._setFilterSelection(type, item.value, false);
        }
        this._syncSelectedFilterValue();
        if (render) this._renderFilterMenu();
    }

    _isFilterOptionActive(type, item) {
        if (!item || this.selectedFilters?.[type] !== item.value) return false;
        if (type === 'state' && item.country) {
            return this.selectedFilters.country === item.country;
        }
        if (type === 'location') {
            if (item.country && this.selectedFilters.country !== item.country) return false;
            if (item.state && this.selectedFilters.state !== item.state) return false;
        }
        return true;
    }

    _clearFilterSelection(type, render = true) {
        if (!this.selectedFilters) {
            this.selectedFilters = { country: '', state: '', location: '' };
        }
        if (type === 'country') {
            this.selectedFilters.country = '';
            this.selectedFilters.state = '';
            this.selectedFilters.location = '';
        } else if (type === 'state') {
            this.selectedFilters.state = '';
            this.selectedFilters.location = '';
        } else if (type === 'location') {
            this.selectedFilters.location = '';
        }
        this._syncSelectedFilterValue();
        if (render) this._renderFilterMenu();
    }

    _getMostSpecificFilterSelection() {
        const filters = this.selectedFilters || {};
        if (filters.location) return { type: 'location', value: filters.location };
        if (filters.state) return { type: 'state', value: filters.state };
        if (filters.country) return { type: 'country', value: filters.country };
        return null;
    }

    async _applyFilter(filterType, filterValue, takenFrom = null, takenTo = null, label = '') {
        this.close();
        this.selectedFilterType = filterType;
        if (filterType === 'country') {
            this.selectedFilters.state = '';
            this.selectedFilters.location = '';
        }
        if (filterType === 'state') {
            this.selectedFilters.location = '';
        }
        this._setFilterSelection(filterType, filterValue, false);
        this._renderFilterMenu();
        if (this.filterActive) {
            this._renderActiveFilterLabel(label ? this._formatFilterLabel(filterType, filterValue, label) : '');
        }

        this.imageService.countryFilter = null;
        this.imageService.stateFilter = null;
        this.imageService.locationFilter = null;
        if (filterType === 'location') {
            this.imageService.countryFilter = this.selectedFilters.country || null;
            this.imageService.stateFilter = this.selectedFilters.state || null;
            this.imageService.locationFilter = filterValue;
        } else if (filterType === 'state') {
            this.imageService.countryFilter = this.selectedFilters.country || null;
            this.imageService.stateFilter = filterValue;
        } else {
            this.imageService.countryFilter = filterValue;
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
        this.selectedFilters = { country: '', state: '', location: '' };
        this.imageService.countryFilter = null;
        this.imageService.stateFilter = null;
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
