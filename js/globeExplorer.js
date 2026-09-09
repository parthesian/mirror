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
        this.pickConfirm = document.getElementById('globe-pick-confirm');
        this.pickConfirmKind = document.getElementById('globe-pick-confirm-kind');
        this.pickConfirmTitle = document.getElementById('globe-pick-confirm-title');
        this.pickConfirmMeta = document.getElementById('globe-pick-confirm-meta');
        this.pickConfirmCopy = document.getElementById('globe-pick-confirm-copy');
        this.pickConfirmApply = document.getElementById('globe-pick-confirm-apply');
        this.pickConfirmCancel = document.getElementById('globe-pick-confirm-cancel');
        this.hint = this.overlay?.querySelector('.globe-explorer-hint');
        this.openBtn = document.getElementById('globe-btn'); // optional; CONTROL menu opens the globe now
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
        this.selectedFilters = { country: '', state: '', location: '', color: '' };
        this.colorOptions = [];
        this._colorsFetchedOnce = false;
        this._colorsFilterKey = '';
        this._colorsPromise = null;
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
        this.pendingPick = null;
        this.isExiting = false;
        this._exitPromise = null;

        this._bindEvents();
        this._setFilterPanelExpanded(false);
        this._bindPrefetchIntent();
        this._warmup();
    }

    _escapeHtml(value) {
        return window.DomSafe.escapeHtml(value);
    }

    _formatFilterLabel(filterType, filterValue, label = '') {
        const labels = {
            country: 'COUNTRY',
            state: 'REGION',
            location: 'PLACE',
            color: 'COLOR'
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
            filters.location ? this._formatFilterLabel('location', filters.location) : '',
            filters.color ? this._formatFilterLabel('color', filters.color) : ''
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
        return window.LocationModel.normalizePart(value);
    }

    _stateKeyForLoc(loc) {
        return window.LocationModel.stateKey(loc);
    }

    _locationKeyFor(loc) {
        return window.LocationModel.locationKey(loc);
    }

    _formatLocationWithRegion(loc) {
        return window.LocationModel.formatWithRegion(loc);
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

    _applyGlobePick(option) {
        this._proposeGlobePick(option);
    }

    _buildPendingPick(option) {
        if (!option) return null;
        if (option.kind === 'country' && option.feature) {
            const aliases = option.feature.names || [];
            const value = this._resolveCountryFilterValue(option.feature.name, aliases);
            if (!value) return null;
            return {
                type: 'country',
                value,
                title: option.feature.name || value,
                kind: 'COUNTRY',
                copy: 'view photographs from this country',
                meta: '',
                selection: null
            };
        }
        const loc = option.sample;
        if (loc?.location) {
            return {
                type: 'location',
                value: loc.location,
                title: loc.location,
                kind: 'PLACE',
                copy: 'view photographs from this place',
                meta: [loc.state, loc.country].filter(Boolean).join(' · '),
                selection: {
                    type: 'location',
                    item: {
                        value: loc.location,
                        country: loc.country || '',
                        state: loc.state || ''
                    }
                }
            };
        }
        if (loc?.country) {
            return {
                type: 'country',
                value: loc.country,
                title: loc.country,
                kind: 'COUNTRY',
                copy: 'view photographs from this country',
                meta: '',
                selection: null
            };
        }
        return null;
    }

    _proposeGlobePick(option) {
        this._hideIntersectPicker();
        const pending = this._buildPendingPick(option);
        if (!pending) {
            return;
        }
        this.pendingPick = pending;
        this._showPickConfirm(pending);
    }

    _showPickConfirm(pending) {
        if (!this.pickConfirm || !pending) return;
        if (this.pickConfirmKind) {
            this.pickConfirmKind.textContent = pending.kind;
        }
        if (this.pickConfirmTitle) {
            this.pickConfirmTitle.textContent = pending.title;
        }
        if (this.pickConfirmCopy) {
            this.pickConfirmCopy.textContent = pending.copy;
        }
        if (this.pickConfirmMeta) {
            const meta = pending.meta || '';
            this.pickConfirmMeta.textContent = meta;
            this.pickConfirmMeta.hidden = !meta;
        }
        this.pickConfirm.hidden = false;
        this.pickConfirm.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            this.pickConfirm?.classList.add('is-visible');
        });
        this.pickConfirmApply?.focus();
    }

    _hidePickConfirm() {
        this.pendingPick = null;
        if (!this.pickConfirm) return;
        this.pickConfirm.classList.remove('is-visible');
        this.pickConfirm.setAttribute('aria-hidden', 'true');
        this.pickConfirm.hidden = true;
    }

    async _confirmPendingPick() {
        const pending = this.pendingPick;
        if (!pending || this.isExiting) return;
        this._hidePickConfirm();
        if (pending.selection) {
            this._setFilterSelectionFromOption(pending.selection.type, pending.selection.item, false);
        }
        await this._applyFilter(pending.type, pending.value);
    }

    _normalizeCountryName(value) {
        return window.LocationModel.normalizeCountryName(value);
    }

    _seedCountryAliasesFromLocations() {
        this.countryFilterAliasMap = window.LocationModel.seedCountryAliases(this.locationsByCountry);
    }

    _resolveCountryFilterValue(countryName, aliases = []) {
        return window.LocationModel.resolveCountryFilterValue(
            countryName,
            aliases,
            this.locationsByCountry,
            this.countryFilterAliasMap
        );
    }

    async _ensureCountryBoundariesLoaded() {
        await window.countryBoundaries.ensureLoaded();
        this.countryBoundaryFeatures = window.countryBoundaries.features;
        this.countryBoundaryAliasMap = window.countryBoundaries.aliasMap;
    }

    _dirToLatLon(THREE, worldDirection, group) {
        return window.countryBoundaries.dirToLatLon(THREE, worldDirection, group);
    }

    _findCountryFromDirection(THREE, direction, group) {
        return window.countryBoundaries.findCountryFromDirection(THREE, direction, group);
    }

    _countryFeatureKey(featureRef) {
        return window.countryBoundaries.countryFeatureKey(featureRef);
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

    _hideIntersectPicker() {
        if (!this.intersectPicker) return;
        this.intersectPicker.classList.add('hidden');
        this.intersectPicker.innerHTML = '';
    }

    _showClickPulse(THREE, group, worldDirection) {
        const s = this.threeState;
        if (!s || !THREE || !group || !worldDirection) return;

        const localDir = worldDirection.clone().normalize();
        const worldQuat = group.getWorldQuaternion(new THREE.Quaternion());
        localDir.applyQuaternion(worldQuat.invert()).normalize();

        const axisSeed = Math.abs(localDir.y) < 0.92
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const tangentA = new THREE.Vector3().crossVectors(axisSeed, localDir).normalize();
        const tangentB = new THREE.Vector3().crossVectors(localDir, tangentA).normalize();
        const pulse = {
            startedAt: performance.now(),
            duration: 580,
            delay: 130,
            minAngle: THREE.MathUtils.degToRad(0.4),
            maxAngle: THREE.MathUtils.degToRad(3.7),
            radius: 1.018,
            centerDir: localDir,
            tangentA,
            tangentB,
            rings: []
        };

        for (let i = 0; i < 3; i++) {
            const positions = new Float32Array(96 * 3);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const line = new THREE.LineLoop(geometry, material);
            line.renderOrder = 4;
            group.add(line);
            pulse.rings.push({
                line,
                geometry,
                material,
                positions,
                delay: i * pulse.delay
            });
        }

        s.clickPulses.push(pulse);
    }

    _setClickPulseRingPositions(pulse, ring, angle) {
        const sinAngle = Math.sin(angle);
        const cosAngle = Math.cos(angle);
        const { centerDir, tangentA, tangentB, radius } = pulse;
        const positions = ring.positions;
        const count = positions.length / 3;

        for (let i = 0; i < count; i++) {
            const theta = (i / count) * Math.PI * 2;
            const ringX = Math.cos(theta) * sinAngle;
            const ringY = Math.sin(theta) * sinAngle;
            const point = centerDir.clone().multiplyScalar(cosAngle)
                .add(tangentA.clone().multiplyScalar(ringX))
                .add(tangentB.clone().multiplyScalar(ringY))
                .normalize()
                .multiplyScalar(radius);
            const offset = i * 3;
            positions[offset] = point.x;
            positions[offset + 1] = point.y;
            positions[offset + 2] = point.z;
        }
        ring.geometry.getAttribute('position').needsUpdate = true;
    }

    _updateClickPulses(now) {
        const s = this.threeState;
        if (!s?.clickPulses?.length) return;

        for (let i = s.clickPulses.length - 1; i >= 0; i--) {
            const pulse = s.clickPulses[i];
            let isComplete = true;

            for (const ring of pulse.rings) {
                const progress = (now - pulse.startedAt - ring.delay) / pulse.duration;
                if (progress < 0) {
                    ring.material.opacity = 0;
                    isComplete = false;
                    continue;
                }
                if (progress >= 1) {
                    ring.material.opacity = 0;
                    continue;
                }

                isComplete = false;
                const eased = 1 - Math.pow(1 - progress, 3);
                const angle = pulse.minAngle + (pulse.maxAngle - pulse.minAngle) * eased;
                this._setClickPulseRingPositions(pulse, ring, angle);
                const fadeIn = Math.min(progress / 0.12, 1);
                ring.material.opacity = 0.52 * fadeIn * Math.pow(1 - progress, 1.35);
            }

            if (isComplete) {
                for (const ring of pulse.rings) {
                    s.group.remove(ring.line);
                    ring.geometry.dispose();
                    ring.material.dispose();
                }
                s.clickPulses.splice(i, 1);
            }
        }
    }

    _getCameraFacingDirection(THREE, camera, group) {
        const cameraPos = camera.getWorldPosition(new THREE.Vector3());
        const groupPos = group.getWorldPosition(new THREE.Vector3());
        return cameraPos.sub(groupPos).normalize();
    }

    _isLocationPointFacingCamera(idx, worldQuat, cameraDir) {
        if (idx == null || idx >= this.locationUnitVectors.length) return false;
        const worldNormal = this.locationUnitVectors[idx].clone().applyQuaternion(worldQuat).normalize();
        return worldNormal.dot(cameraDir) > 0.015;
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
        const cameraDir = this._getCameraFacingDirection(THREE, camera, group);
        let bestIdx = null;
        let bestDistSq = Infinity;
        const maxSq = maxPixelDistance * maxPixelDistance;

        for (const hit of hits) {
            const idx = hit.index;
            if (idx == null || idx >= this.locationUnitVectors.length) continue;
            if (!this._isLocationPointFacingCamera(idx, worldQuat, cameraDir)) continue;
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
        const cameraDir = this._getCameraFacingDirection(THREE, camera, group);
        const maxSq = maxPixelDistance * maxPixelDistance;
        const byKey = new Map();

        for (const hit of hits) {
            const idx = hit.index;
            if (idx == null || idx >= this.locationUnitVectors.length) continue;
            if (!this._isLocationPointFacingCamera(idx, worldQuat, cameraDir)) continue;
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

    _collectUniqueHitLocationKeys(hits, camera, group, THREE) {
        if (!Array.isArray(hits) || !hits.length) return [];
        const worldQuat = group.getWorldQuaternion(new THREE.Quaternion());
        const cameraDir = this._getCameraFacingDirection(THREE, camera, group);
        const seen = new Set();
        const keys = [];
        for (const hit of hits) {
            const idx = hit.index;
            if (idx == null || idx >= this.renderedPointLocations.length) continue;
            if (!this._isLocationPointFacingCamera(idx, worldQuat, cameraDir)) continue;
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
        this.pickConfirmApply?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void this._confirmPendingPick();
        });
        this.pickConfirmCancel?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._hidePickConfirm();
        });
        this.pickConfirm?.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        this.overlay?.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                if (this.pendingPick) {
                    this._hidePickConfirm();
                    return;
                }
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
            if (e.key !== 'Escape' || (!this.isOpen && !this.isExiting)) {
                return;
            }
            if (this.pendingPick) {
                this._hidePickConfirm();
                return;
            }
            this._hideIntersectPicker();
            this.close();
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
        if (this.isExiting && this._exitPromise) {
            await this._exitPromise;
        }
        if (this.isOpen) {
            if (focusLocation) {
                await this._focusLocation(focusLocation);
            }
            return;
        }
        this.isOpen = true;
        this.isExiting = false;
        this._hidePickConfirm();
        this.overlay.classList.remove('hidden', 'is-exiting');
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        try {
            this._prefetchAssets({ includeBoundaries: true, includeGeo: true });
            await this._fetchLocations();
            await this._initScene();
            this._setSceneRunning(true);
            this.threeState?.onResize?.();
            this._fitGlobeInView();
            if (focusLocation) {
                await this._focusLocation(focusLocation);
            }
            this._syncRotateToggleUI();
        } catch (err) {
            console.error('[GlobeExplorer] failed to initialize', err);
        }
    }

    close() {
        if (!this.isOpen && !this.isExiting) return;
        void this._playExit();
    }

    _playExit() {
        if (this.isExiting && this._exitPromise) {
            return this._exitPromise;
        }
        if (!this.overlay || this.overlay.classList.contains('hidden')) {
            this._finishClose();
            return Promise.resolve();
        }

        this.isExiting = true;
        this.isOpen = false;
        this._hidePickConfirm();
        this._hideIntersectPicker();
        this._suppressGhostClick();
        this.overlay.classList.remove('active');
        this.overlay.classList.add('is-exiting');

        this._exitPromise = new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                this.overlay.removeEventListener('transitionend', onEnd);
                window.clearTimeout(fallback);
                this._finishClose();
                resolve();
            };
            const onEnd = (event) => {
                if (event.target !== this.overlay) return;
                if (event.propertyName && event.propertyName !== 'opacity') return;
                finish();
            };
            this.overlay.addEventListener('transitionend', onEnd);
            const fallbackMs = this._prefersReducedMotion() ? 40 : 560;
            const fallback = window.setTimeout(finish, fallbackMs);
        });
        return this._exitPromise;
    }

    _finishClose() {
        this.isExiting = false;
        this.isOpen = false;
        this._exitPromise = null;
        this._setHoverHighlight(null, null);
        this._clearCountryBorderHighlight();
        this._hideIntersectPicker();
        this._hidePickConfirm();
        this.overlay?.classList.remove('active', 'is-exiting');
        this.overlay?.classList.add('hidden');
        document.body.style.overflow = '';
        // Keep the WebGL scene, but stop the RAF loop so a closed overlay
        // does not keep rendering 60fps behind the gallery.
        this._setSceneRunning(false);
    }

    _prefersReducedMotion() {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    }

    async _focusLocation(location) {
        await this._fetchLocations();
        if (!this.threeState) return;

        const match = this._findLocationMatch(location) || location;
        if (!match) return;

        this._rotateToLocation(match);
        const key = this._locationKeyFor(match);
        if (this.locationGroupByKey.has(key)) {
            this._setHoverHighlight('location', key);
        }
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

    prefetch() {
        this._prefetchAssets({ includeBoundaries: true, includeGeo: true });
    }

    _bindPrefetchIntent() {
        this.openBtn?.addEventListener('pointerenter', () => this.prefetch());
        this.openBtn?.addEventListener('focus', () => this.prefetch());
    }

    _prefetchAssets({ includeBoundaries = false, includeGeo = false } = {}) {
        window.threeLoader?.prefetchSceneGraph();
        if (includeGeo) {
            this._fetchLocations().catch(() => {});
            this._fetchColors().catch(() => {});
        }
        if (includeBoundaries) {
            window.countryBoundaries?.ensureLoaded()
                .then(() => {
                    this.countryBoundaryFeatures = window.countryBoundaries.features;
                    this.countryBoundaryAliasMap = window.countryBoundaries.aliasMap;
                })
                .catch(() => {});
        }
    }

    _warmup() {
        // Idle warmup must not race first-viewport thumbnails. Opening the
        // CONTROL menu, or hovering GLOBE, still starts Three + geo + borders.
        const start = () => this._prefetchAssets({ includeBoundaries: false, includeGeo: true });
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(start, { timeout: 3500 });
        } else {
            window.setTimeout(start, 1400);
        }
    }

    _setSceneRunning(running) {
        const s = this.threeState;
        if (!s) {
            return;
        }
        s.running = Boolean(running);
        if (s.running) {
            if (!s.rafId && typeof s.animate === 'function') {
                s.animate();
            }
            return;
        }
        if (s.rafId) {
            cancelAnimationFrame(s.rafId);
            s.rafId = null;
        }
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
            this.locations = window.MockPhotos?.enabled?.()
                ? window.MockPhotos.locations()
                : [];
            this._geoFetchedOnce = this.locations.length > 0;
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

    _colorFacetKey() {
        const filters = this.selectedFilters || {};
        return [
            filters.country || '',
            filters.state || '',
            filters.location || '',
            this.imageService?.takenFromFilter || '',
            this.imageService?.takenToFilter || ''
        ].join('\u0001');
    }

    async _fetchColors() {
        const key = this._colorFacetKey();
        if (this._colorsFetchedOnce && this._colorsFilterKey === key && !this._colorsPromise) {
            return;
        }
        if (this._colorsPromise && this._colorsFilterKey === key) {
            return this._colorsPromise;
        }

        this._colorsFilterKey = key;
        const request = this._fetchColorsInternal(key);
        this._colorsPromise = request;
        try {
            await request;
        } finally {
            if (this._colorsPromise === request) {
                this._colorsPromise = null;
            }
        }
    }

    async _fetchColorsInternal(key) {
        try {
            const base = (window.CONFIG?.API_BASE_URL || '').replace(/\/$/, '');
            const url = new URL(base ? `${base}/api/photos/colors` : '/api/photos/colors', window.location.origin);
            const filters = this.selectedFilters || {};
            if (filters.country) url.searchParams.set('country', filters.country);
            if (filters.state) url.searchParams.set('state', filters.state);
            if (filters.location) url.searchParams.set('location', filters.location);
            if (this.imageService?.takenFromFilter) {
                url.searchParams.set('takenFrom', this.imageService.takenFromFilter);
            }
            if (this.imageService?.takenToFilter) {
                url.searchParams.set('takenTo', this.imageService.takenToFilter);
            }

            const res = await fetch(url.toString());
            const data = await res.json();
            if (this._colorFacetKey() !== key) {
                return;
            }
            this.colorOptions = Array.isArray(data.colors) ? data.colors : [];
        } catch (err) {
            if (this._colorFacetKey() !== key) {
                return;
            }
            console.error('[GlobeExplorer] failed to fetch color facets', err);
            this.colorOptions = [];
        } finally {
            if (this._colorFacetKey() === key) {
                this._colorsFetchedOnce = true;
                this._renderFilterMenu();
            }
        }
    }

    // ── Three.js loading ──

    _loadThree() {
        if (window.threeLoader) {
            return window.threeLoader.loadThree();
        }
        if (window.THREE) return Promise.resolve(window.THREE);
        if (this._threePromise) return this._threePromise;
        this._threePromise = import('three').then(mod => {
            window.THREE = mod;
            return mod;
        });
        return this._threePromise;
    }

    _loadOrbitControls() {
        if (window.threeLoader) {
            return window.threeLoader.loadOrbitControls();
        }
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
        camera.position.set(0, 0, GlobeExplorer.globeFitDistance(w, h, 45));

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
            controls.enableRotate = true;
            controls.enablePan = false;
            controls.minDistance = 1.8;
            controls.maxDistance = 8;
            controls.minPolarAngle = Math.PI / 2 - THREE.MathUtils.degToRad(62);
            controls.maxPolarAngle = Math.PI / 2 + THREE.MathUtils.degToRad(62);
            controls.rotateSpeed = 0.5;
            controls.enableZoom = true;
            controls.autoRotate = this.autoRotateEnabled;
            controls.autoRotateSpeed = 0.45;
        }

        const group = new THREE.Group();
        group.rotation.y = -Math.PI / 2; // align globe texture and data points
        scene.add(group);

        const segments = window.threeLoader?.sphereSegments('explorer') || 48;
        const geo = new THREE.SphereGeometry(1, segments, segments);
        let tex = null;
        let mat = null;
        try {
            tex = window.threeLoader
                ? await window.threeLoader.createEarthTexture(THREE)
                : await new THREE.TextureLoader().loadAsync('public/earth_atmos_2048.jpg');
            if (!window.threeLoader) {
                tex.colorSpace = THREE.SRGBColorSpace;
            }
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

        // Fallback drag-rotate keeps interaction available if OrbitControls fails to load.
        let drag = null;
        renderer.domElement.addEventListener('pointerdown', (e) => {
            this.pointerGesture = {
                x: e.clientX,
                y: e.clientY,
                pointerType: e.pointerType || 'mouse',
                dragged: false,
                hadWheel: false,
                tapHandled: false
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
            const slop = (this.pointerGesture?.pointerType === 'touch') ? 18 : 6;
            if (this.pointerGesture && ((dx * dx + dy * dy) > slop * slop)) {
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
        const endDrag = (e) => {
            const gesture = this.pointerGesture;
            this.lastPointerGesture = gesture;
            const shouldTap = Boolean(
                e
                && e.type === 'pointerup'
                && gesture
                && !gesture.dragged
                && !gesture.hadWheel
                && (gesture.pointerType === 'touch' || gesture.pointerType === 'pen')
            );
            this.pointerGesture = null;
            drag = null;
            if (shouldTap) {
                gesture.tapHandled = true;
                this.lastPointerGesture = gesture;
                handleGlobePick(e);
            }
        };
        renderer.domElement.addEventListener('pointerup', endDrag);
        renderer.domElement.addEventListener('pointercancel', endDrag);
        renderer.domElement.addEventListener('pointerleave', (e) => {
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                return;
            }
            endDrag(e);
        });
        renderer.domElement.addEventListener('mouseleave', () => {
            this._setHoverHighlight(null, null);
        });

        const handleGlobePick = (e) => {
            if (this.isExiting) return;
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            const globeHits = raycaster.intersectObject(globe);
            if (!globeHits.length) {
                return;
            }
            const clickDir = globeHits[0].point.clone().normalize();
            this._showClickPulse(THREE, group, clickDir);
            const countryHit = this._findCountryFromDirection(THREE, clickDir, group);
            const applyCountryChoice = () => {
                if (!countryHit?.feature) return;
                this._applyGlobePick({
                    kind: 'country',
                    feature: countryHit.feature
                });
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

                const rawHitKeys = this._collectUniqueHitLocationKeys(expandedHits, camera, group, THREE);
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
                    this._applyGlobePick({
                        sample: option?.sample || selectedLocation
                    });
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
            if (!countryHit?.feature) {
                this._hidePickConfirm();
                return;
            }
            applyCountryChoice();
        };

        renderer.domElement.addEventListener('click', (e) => {
            const gesture = this.lastPointerGesture;
            if (gesture?.tapHandled) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (gesture?.dragged || gesture?.hadWheel) {
                return;
            }
            handleGlobePick(e);
        });

        const state = {
            renderer, scene, camera, group, globe, controls, geo, mat, tex,
            rafId: null, disposed: false, onResize: null, dotsMesh, arcLines,
            dotColors: dotsMesh?.geometry?.getAttribute('color')?.array || null,
            clickPulses: []
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
            if (state.disposed || state.running === false) {
                state.rafId = null;
                return;
            }
            if (controls) controls.update();
            else if (this.autoRotateEnabled) group.rotation.y += 0.001;
            this._updateClickPulses(performance.now());
            renderer.render(scene, camera);
            state.rafId = requestAnimationFrame(animate);
        };
        state.animate = animate;
        state.running = true;
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
            for (const pulse of s.clickPulses || []) {
                for (const ring of pulse.rings || []) {
                    ring.geometry?.dispose();
                    ring.material?.dispose();
                }
            }
            s.renderer?.dispose();
            if (s.renderer?.domElement?.parentNode) {
                s.renderer.domElement.parentNode.removeChild(s.renderer.domElement);
            }
        } catch (e) { /* ignore */ }
        this.threeState = null;
    }

    // ── dots + arcs ──

    _latLonToVec3(lat, lon, radius, THREE) {
        return window.globeRoutes.latLonToVec3(lat, lon, radius, THREE);
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
        return window.globeRoutes.buildArcs(
            THREE,
            group,
            this.locations,
            (loc) => this._locationKeyFor(loc)
        );
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

    // ── filtering: public API for the radial control menu ──

    /**
     * The geo feed backs both the globe and the filter lists. Callers await
     * this before reading options; repeat calls are free once it has landed.
     */
    async ensureFilterData() {
        await Promise.all([this._fetchLocations(), this._fetchColors()]);
        return this.locations;
    }

    get hasFilterData() {
        return this._geoFetchedOnce || this._colorsFetchedOnce;
    }

    get hasColorFilterData() {
        return this._colorsFetchedOnce;
    }

    get hasPlaceFilterData() {
        return this._geoFetchedOnce;
    }

    getFilterOptions(type) {
        if (type === 'color') {
            return this.colorOptions;
        }
        if (!this._geoFetchedOnce) return [];
        return this._getOptionsForType(type);
    }

    getSelectedFilters() {
        return { ...(this.selectedFilters || { country: '', state: '', location: '', color: '' }) };
    }

    getActiveFilterLabel() {
        return this._formatSelectedFiltersLabel();
    }

    async applyFilterOption(type, item) {
        this._setFilterSelectionFromOption(type, item, false);
        if (!this._hasAnySelectedFilter()) {
            await this._clearFilter();
            return;
        }
        await this._applyCurrentFilters();
    }

    async clearFilterType(type) {
        this._clearFilterSelection(type, false);
        if (!this._hasAnySelectedFilter()) {
            await this._clearFilter();
            return;
        }
        await this._applyCurrentFilters();
    }

    async clearFilters() {
        await this._clearFilter();
    }

    _emitFilterChange() {
        document.dispatchEvent(new CustomEvent('galleryFilterChange', {
            detail: {
                filters: this.getSelectedFilters(),
                label: this.getActiveFilterLabel()
            }
        }));
    }

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
            { type: 'location', label: 'place' },
            { type: 'color', label: 'color' }
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
                location: 'places',
                color: 'colors'
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
        if (type === 'color') {
            options = this.colorOptions;
        } else if (type === 'country') {
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
            this.selectedFilters = { country: '', state: '', location: '', color: '' };
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
        if (this._colorsFetchedOnce && this.selectedFilters.color && !this._isOptionValid('color', this.selectedFilters.color)) {
            this.selectedFilters.color = '';
        }
        this._syncSelectedFilterValue();
    }

    _setFilterSelection(type, value, render = true) {
        if (!this.selectedFilters) {
            this.selectedFilters = { country: '', state: '', location: '', color: '' };
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
            this.selectedFilters = { country: '', state: '', location: '', color: '' };
        }
        if (type === 'color') {
            this.selectedFilters.color = item?.value || '';
            this._syncSelectedFilterValue();
            if (render) this._renderFilterMenu();
            return;
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
            this.selectedFilters = { country: '', state: '', location: '', color: '' };
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
        } else if (type === 'color') {
            this.selectedFilters.color = '';
        }
        this._syncSelectedFilterValue();
        if (render) this._renderFilterMenu();
    }

    _getMostSpecificFilterSelection() {
        const filters = this.selectedFilters || {};
        if (filters.location) return { type: 'location', value: filters.location };
        if (filters.state) return { type: 'state', value: filters.state };
        if (filters.country) return { type: 'country', value: filters.country };
        if (filters.color) return { type: 'color', value: filters.color };
        return null;
    }

    _hasAnySelectedFilter() {
        const filters = this.selectedFilters || {};
        return Boolean(filters.country || filters.state || filters.location || filters.color);
    }

    _emptyFilters() {
        return { country: '', state: '', location: '', color: '' };
    }

    _syncImageServiceFilters(takenFrom = null, takenTo = null) {
        const filters = this.selectedFilters || {};
        this.imageService.countryFilter = filters.country || null;
        this.imageService.stateFilter = filters.state || null;
        this.imageService.locationFilter = filters.location || null;
        this.imageService.colorFilter = filters.color || null;
        this.imageService.takenFromFilter = takenFrom || null;
        this.imageService.takenToFilter = takenTo || null;
    }

    async _applyCurrentFilters(takenFrom = null, takenTo = null) {
        if (this.isOpen || this.isExiting) {
            await this._playExit();
        }
        this._syncImageServiceFilters(takenFrom, takenTo);
        await this._fetchColors();
        this._renderFilterMenu();
        this._syncImageServiceFilters(takenFrom, takenTo);
        this._emitFilterChange();
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }

    _suppressGhostClick() {
        const block = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        document.addEventListener('click', block, true);
        window.setTimeout(() => {
            document.removeEventListener('click', block, true);
        }, 450);
    }

    async _applyFilter(filterType, filterValue, takenFrom = null, takenTo = null, label = '') {
        this.selectedFilterType = filterType;
        if (filterType === 'country') {
            this.selectedFilters.state = '';
            this.selectedFilters.location = '';
        }
        if (filterType === 'state') {
            this.selectedFilters.location = '';
        }
        this._setFilterSelection(filterType, filterValue, false);
        if (this.filterActive) {
            this._renderActiveFilterLabel(label ? this._formatFilterLabel(filterType, filterValue, label) : '');
        }
        await this._applyCurrentFilters(takenFrom, takenTo);
    }

    async _clearFilter() {
        if (this.filterActive) this.filterActive.textContent = 'ALL';
        this.selectedFilterType = 'country';
        this.selectedFilterValue = '';
        this.selectedFilters = this._emptyFilters();
        this._syncImageServiceFilters();
        await this._fetchColors();
        this._renderFilterMenu();
        this._emitFilterChange();
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }

    /**
     * Camera distance that keeps a radius-1 globe inside the viewport
     * with a little air on the short side. Portrait phones crop the
     * sides at the old z=3.2 framing.
     */
    static globeFitDistance(width, height, fovDeg = 45, pad = 1.28) {
        const aspect = Math.max(1, Number(width) || 1) / Math.max(1, Number(height) || 1);
        const halfFov = (Number(fovDeg) || 45) * Math.PI / 360;
        const halfMin = Math.min(1, aspect) * Math.tan(halfFov);
        const distance = (Number(pad) || 1.28) / Math.max(halfMin, 0.001);
        return Math.min(8, Math.max(2.6, distance));
    }

    _fitGlobeInView() {
        const state = this.threeState;
        if (!state?.camera || !this.sceneContainer) {
            return;
        }
        const rect = this.sceneContainer.getBoundingClientRect();
        const width = rect.width || 1;
        const height = rect.height || 1;
        const distance = GlobeExplorer.globeFitDistance(width, height, state.camera.fov);
        if (state.controls) {
            state.controls.maxDistance = Math.max(state.controls.maxDistance, distance + 0.35);
        }
        const current = state.camera.position.length();
        if (current > 0.001) {
            state.camera.position.multiplyScalar(distance / current);
        } else {
            state.camera.position.set(0, 0, distance);
        }
        state.camera.updateProjectionMatrix();
        state.controls?.update?.();
    }
}

window.GlobeExplorer = GlobeExplorer;
