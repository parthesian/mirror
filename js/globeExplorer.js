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
        this.backStack = (typeof window !== 'undefined' ? window.overlayBackStack : null);

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
        this._setLineHover(0);
    }

    _setCountryBorderHighlight(_THREE, featureRef) {
        if (!featureRef) {
            this._clearCountryBorderHighlight();
            return;
        }
        const featureKey = this._countryFeatureKey(featureRef);
        this.countryBorderHighlightKey = featureKey;
        this._setLineHover(featureRef.runtimeId || 0);
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
        const dotScale = s.dotScale || 1;
        const pulse = {
            startedAt: performance.now(),
            duration: 580,
            delay: 130,
            minAngle: THREE.MathUtils.degToRad(0.4) * dotScale,
            maxAngle: THREE.MathUtils.degToRad(3.7) * dotScale,
            radius: window.GlobeDetail?.CONFIG?.PULSE_RADIUS || 1.003,
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
            const worldPos = this.locationUnitVectors[idx].clone().multiplyScalar(this._dotRadius()).applyQuaternion(worldQuat);
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
            const worldPos = this.locationUnitVectors[idx].clone().multiplyScalar(this._dotRadius()).applyQuaternion(worldQuat);
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
                this._focusLocation(focusLocation);
            }
            return;
        }
        this.isOpen = true;
        this.isExiting = false;
        this._hidePickConfirm();
        this.overlay.classList.remove('hidden', 'is-exiting');
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        this.backStack?.claim('globe', () => this.close());

        try {
            this._prefetchAssets({ includeBoundaries: true, includeGeo: true });
            // Idle spin stays on when nothing is focused. A photo click must
            // not orbit, and a resumed scene must not paint, before the place
            // is facing the camera. The geo fetch below yields a frame.
            const focusLat = Number(focusLocation?.latitude);
            const focusLon = Number(focusLocation?.longitude);
            const focusOnPlace = Number.isFinite(focusLat) && Number.isFinite(focusLon);
            if (focusOnPlace) {
                this.autoRotateEnabled = false;
                if (this.threeState?.controls) this.threeState.controls.autoRotate = false;
                this._setSceneRunning(false);
            }
            await this._fetchLocations();
            await this._initScene();
            if (focusLocation) {
                this._focusLocation(focusLocation);
            }
            this.threeState?.onResize?.();
            this._fitGlobeInView();
            this._setSceneRunning(true);
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
        this.backStack?.release('globe');
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

    _focusLocation(location) {
        if (!this.threeState || !location) return;

        const match = this._findLocationMatch(location) || location;
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

    /**
     * Upright group yaw plus camera polar angle that puts this coordinate on
     * the camera axis while keeping the globe's North Pole on world +Y.
     * Pitching group.rotation.x would tilt the mesh pole off OrbitControls's
     * (0, 1, 0) orbit axis and make subsequent spins wobble on a skewed axis.
     */
    static focusRotation(lat, lon) {
        const clampedLat = Math.max(-85, Math.min(85, Number(lat) || 0));
        const latRad = (clampedLat * Math.PI) / 180;
        return {
            x: 0,
            y: -Math.PI / 2 - (lon * Math.PI) / 180,
            latRad,
            polarAngle: Math.PI / 2 - latRad
        };
    }

    _rotateToLocation(location) {
        const s = this.threeState;
        const lat = Number(location?.latitude);
        const lon = Number(location?.longitude);
        if (!s?.group || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

        this.autoRotateEnabled = false;
        const pose = GlobeExplorer.focusRotation(lat, lon);
        s.group.rotation.x = 0;
        s.group.rotation.y = pose.y;
        if (s.camera) {
            const distance = s.camera.position.length() || 3.2;
            s.camera.position.set(
                0,
                distance * Math.sin(pose.latRad),
                distance * Math.cos(pose.latRad)
            );
            s.camera.lookAt(0, 0, 0);
        }
        if (s.controls) {
            s.controls.autoRotate = false;
            this._resetFocusOrbit(s.controls, pose.polarAngle);
        }
        this.lastManualRotateAt = Date.now();
        this._syncRotateToggleUI();
        this._syncZoomFromCamera();
    }

    _resetFocusOrbit(controls, polarAngle = Math.PI / 2) {
        const damping = controls.enableDamping;
        const minAzimuthAngle = controls.minAzimuthAngle;
        const maxAzimuthAngle = controls.maxAzimuthAngle;
        const minPolarAngle = Math.min(controls.minPolarAngle, polarAngle);
        const maxPolarAngle = Math.max(controls.maxPolarAngle, polarAngle);
        controls.target?.set?.(0, 0, 0);
        controls.saveState?.();
        controls.enableDamping = false;
        controls.minAzimuthAngle = 0;
        controls.maxAzimuthAngle = 0;
        controls.minPolarAngle = polarAngle;
        controls.maxPolarAngle = polarAngle;
        try {
            controls.reset();
        } finally {
            controls.minAzimuthAngle = minAzimuthAngle;
            controls.maxAzimuthAngle = maxAzimuthAngle;
            controls.minPolarAngle = minPolarAngle;
            controls.maxPolarAngle = maxPolarAngle;
            controls.enableDamping = damping;
        }
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
        const s = this.threeState;
        if (s?.controls) {
            s.controls.autoRotate = this.autoRotateEnabled;
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
            if (this.pointerGesture) {
                this.pointerGesture.hadWheel = true;
            }
            this._onZoomWheel(e);
        }, { passive: false });
        for (const gestureType of ['gesturestart', 'gesturechange', 'gestureend']) {
            renderer.domElement.addEventListener(gestureType, (event) => {
                this._onGesture(event);
            }, { passive: false });
        }

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
            controls.dampingFactor = 0.16;
            controls.enableRotate = true;
            controls.enablePan = false;
            controls.minDistance = 1.30;
            controls.maxDistance = 8;
            controls.minPolarAngle = Math.PI / 2 - THREE.MathUtils.degToRad(62);
            controls.maxPolarAngle = Math.PI / 2 + THREE.MathUtils.degToRad(62);
            controls.rotateSpeed = 0.65;
            controls.enableZoom = false;
            controls.autoRotate = false;
            controls.autoRotateSpeed = 0.85;
            controls.touches.TWO = -1;
        }

        const group = new THREE.Group();
        group.rotation.y = -Math.PI / 2; // align globe texture and data points
        scene.add(group);

        const explorerSegments = window.threeLoader?.explorerSphereSegments?.() || [192, 96];
        const geo = new THREE.SphereGeometry(1, explorerSegments[0], explorerSegments[1]);
        let tex = null;
        let mat = null;
        try {
            tex = window.threeLoader
                ? await window.threeLoader.createEarthTexture(THREE)
                : await new THREE.TextureLoader().loadAsync('/earth_atmos_2048.jpg');
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
            this._pointers = this._pointers || new Map();
            this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (this._pointers.size >= 2) {
                this._beginPinch();
            }
            const camDist = camera.position.length() || 3.2;
            drag = {
                x: e.clientX,
                y: e.clientY,
                lat: Math.asin(THREE.MathUtils.clamp(camera.position.y / camDist, -1, 1)),
                rotY: group.rotation.y
            };
        });
        renderer.domElement.addEventListener('pointermove', (e) => {
            if (this._pointers?.has(e.pointerId)) {
                this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }
            if ((this._pointers?.size || 0) >= 2) {
                this._updatePinch();
                if (this.pointerGesture) {
                    this.pointerGesture.dragged = true;
                }
                return;
            }
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
                const maxLat = THREE.MathUtils.degToRad(85);
                const nextLat = Math.max(-maxLat, Math.min(maxLat, drag.lat + dy * 0.005));
                const dist = camera.position.length() || 3.2;
                camera.position.set(0, dist * Math.sin(nextLat), dist * Math.cos(nextLat));
                camera.lookAt(0, 0, 0);
            }
        });
        let pendingHoverPointer = null;
        let hoverRafId = null;
        const processHoverPointer = (e) => {
            if (this._zoomBlocksHover()) {
                return;
            }
            const rect = this._canvasRect();
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

            const hit = this._hitGlobeNdc(hoverMouse, raycaster, camera);
            if (!hit) {
                this._setHoverHighlight(null, null);
                this._clearCountryBorderHighlight();
                return;
            }
            this._setHoverHighlight(null, null);
            const countryHit = this._findCountryFromDirection(THREE, hit.normalize(), group);
            if (countryHit?.feature) {
                this._setCountryBorderHighlight(THREE, countryHit.feature, group);
            } else {
                this._clearCountryBorderHighlight();
            }
        };
        let lastHoverPointer = null;
        renderer.domElement.addEventListener('mousemove', (e) => {
            lastHoverPointer = { clientX: e.clientX, clientY: e.clientY };
            if (this._zoomBlocksHover()) {
                return;
            }
            pendingHoverPointer = lastHoverPointer;
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
        const endDrag = (e) => {
            if (e && e.pointerId != null) {
                const pinching = (this._pointers?.size || 0) >= 2;
                this._pointers?.delete(e.pointerId);
                if (pinching && this.pointerGesture) {
                    this.pointerGesture.dragged = true;
                }
                if ((this._pointers?.size || 0) < 2) {
                    this._endPinch();
                }
            }
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
            const rect = this._canvasRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            const hit = this._hitGlobeNdc(mouse, raycaster, camera);
            if (!hit) {
                return;
            }
            const clickDir = hit.normalize();
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
                const pointerPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                const pointerType = e.pointerType || 'mouse';
                // Screen-space radius, so a tap on an empty country never
                // snaps to a dot that is visibly elsewhere on the globe.
                const pickRadiusPx = (pointerType === 'touch' || pointerType === 'pen') ? 26 : 18;
                const allDots = this.locationUnitVectors.map((_, index) => ({ index }));
                const candidateKeys = this._collectIntersectingLocationKeys(
                    allDots,
                    pointerPx,
                    camera,
                    renderer,
                    group,
                    THREE,
                    pickRadiusPx
                );

                const options = candidateKeys
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
                        sample: option?.sample
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

        const fitDistance = camera.position.length() || 3.2;
        const zoom = {
            h: Math.max(0.3, fitDistance - 1),
            hGoal: Math.max(0.3, fitDistance - 1),
            hMax: (controls?.maxDistance || 8) - 1,
            tau: 110,
            settled: true,
            settledAt: performance.now(),
            anchor: null,
            pointerNdc: { x: 0, y: 0 },
            pinch: null,
            gestureH: null,
            needsHover: false,
            viewWidth: w,
            viewHeight: h,
            rampStart: 0,
            rampOn: false
        };
        const lines = {
            meshes: { world: null, regional: null, local: null },
            level: 'world',
            lod: 0,
            worldIntro: 0,
            worldIntroStart: 0,
            worldStarted: false,
            baseMaterial: null,
            worker: null,
            workerFailed: false,
            requests: {},
            requestSerial: 0,
            loaded: { '50m': false, '10m': false },
            loading: { '50m': false, '10m': false },
            failed: { '50m': false, '10m': false },
            warned: { '50m': false, '10m': false },
            cooldown: { '50m': 0, '10m': 0 },
            rearm: { '50m': false, '10m': false },
            hoverA: { id: 0, weight: 0, from: 0, to: 0, startedAt: 0, duration: 0 },
            hoverB: { id: 0, weight: 0, from: 0, to: 0, startedAt: 0, duration: 0 },
            cancelled: false,
            idleId: 0,
            worldIdle: 0
        };
        const state = {
            renderer, scene, camera, group, globe, controls, geo, mat, tex,
            THREE,
            rafId: null, disposed: false, onResize: null, dotsMesh, arcLines,
            raycaster,
            dotScale: 1,
            canvasRect: renderer.domElement.getBoundingClientRect(),
            zoom,
            lines,
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
            state.canvasRect = renderer.domElement.getBoundingClientRect();
            state.zoom.viewWidth = nw;
            state.zoom.viewHeight = nh;
            this._syncZoomFromCamera();
            this._applyLineDprScale();
        };
        window.addEventListener('resize', state.onResize);

        const animate = () => {
            if (state.disposed || state.running === false) {
                state.rafId = null;
                return;
            }
            const now = performance.now();
            const dt = state.lastTick == null ? 16.67 : Math.min(48, now - state.lastTick);
            state.lastTick = now;
            this._stepZoom(dt, now);
            if (controls) {
                controls.update();
            } else if (this.autoRotateEnabled) {
                group.rotation.y += 0.12 * (dt / 1000);
            }
            this._stepLines(dt, now);
            if (state.zoom.needsHover && state.zoom.settled && lastHoverPointer) {
                state.zoom.needsHover = false;
                processHoverPointer(lastHoverPointer);
            }
            this._updateClickPulses(now);
            renderer.render(scene, camera);
            state.rafId = requestAnimationFrame(animate);
        };
        state.animate = animate;
        // open() focuses a photo, then starts the loop, so the first frame
        // is not an auto-rotate step around the pole.
        state.running = false;

        this.threeState = state;
        group.updateMatrixWorld(true);
        this._applyDotHighlight();
        this._startWorldLines();
    }

    _destroyScene() {
        const s = this.threeState;
        if (!s) return;
        s.disposed = true;
        this._disposeLines();
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

        const radius = this._dotRadius();
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

    _getGlobeCenterDirection(raycaster, camera) {
        const hit = this._hitGlobeNdc({ x: 0, y: 0 }, raycaster, camera);
        return hit ? hit.normalize() : null;
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
            state.controls.minDistance = 1.30;
        }
        if (state.zoom) {
            state.zoom.viewWidth = width;
            state.zoom.viewHeight = height;
        }
        state.canvasRect = state.renderer?.domElement?.getBoundingClientRect?.() || rect;
        const current = state.camera.position.length();
        if (current > 0.001) {
            state.camera.position.multiplyScalar(distance / current);
        } else {
            state.camera.position.set(0, 0, distance);
        }
        state.camera.lookAt(0, 0, 0);
        state.camera.updateProjectionMatrix();
        state.controls?.update?.();
        this._syncZoomFromCamera();
        this._resetLineLevelToCamera();
    }

    _dotRadius() {
        return window.GlobeDetail?.CONFIG?.DOT_RADIUS || 1.0025;
    }

    _canvasRect() {
        const state = this.threeState;
        if (state?.canvasRect?.width) {
            return state.canvasRect;
        }
        const rect = state?.renderer?.domElement?.getBoundingClientRect?.();
        if (state && rect) {
            state.canvasRect = rect;
        }
        return rect || { left: 0, top: 0, width: 1, height: 1 };
    }

    _clientToNdc(clientX, clientY) {
        const rect = this._canvasRect();
        const width = rect.width || 1;
        const height = rect.height || 1;
        return {
            x: ((clientX - rect.left) / width) * 2 - 1,
            y: -((clientY - rect.top) / height) * 2 + 1
        };
    }

    _hitGlobeNdc(ndc, raycaster = this.threeState?.raycaster, camera = this.threeState?.camera) {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state || !GD || !raycaster || !camera) {
            return null;
        }
        raycaster.setFromCamera(ndc, camera);
        const ray = raycaster.ray;
        const hit = GD.rayUnitSphere(
            ray.origin.x,
            ray.origin.y,
            ray.origin.z,
            ray.direction.x,
            ray.direction.y,
            ray.direction.z
        );
        if (!hit) {
            return null;
        }
        return new state.THREE.Vector3(hit.x, hit.y, hit.z);
    }

    _zoomBlocksHover() {
        const zoom = this.threeState?.zoom;
        if (!zoom || !(zoom.h > 0) || !(zoom.hGoal > 0)) {
            return false;
        }
        return Math.abs(Math.log(zoom.h / zoom.hGoal)) > 0.002;
    }

    _syncZoomFromCamera() {
        const state = this.threeState;
        if (!state?.camera || !state.zoom) {
            return;
        }
        const distance = state.camera.position.length();
        const altitude = Math.max(0.3, distance - 1);
        state.zoom.h = altitude;
        state.zoom.hGoal = altitude;
        state.zoom.settled = true;
        state.zoom.settledAt = performance.now();
        if (state.controls) {
            state.zoom.hMax = state.controls.maxDistance - 1;
            state.controls.minDistance = 1.30;
            state.controls.maxDistance = state.zoom.hMax + 1;
        }
    }

    _resetLineLevelToCamera() {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.lines || !state.camera || !GD) {
            return;
        }
        const distance = state.camera.position.length();
        const level = distance < GD.CONFIG.LEVEL_D.local
            ? 'local'
            : distance < GD.CONFIG.LEVEL_D.regional
                ? 'regional'
                : 'world';
        state.lines.level = level;
        const cap = state.lines.meshes.local ? 2 : state.lines.meshes.regional ? 1 : 0;
        state.lines.lod = Math.min(GD.levelIndex(level), cap);
    }

    _onZoomWheel(event) {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.zoom || !GD || !this.isOpen) {
            return;
        }
        const rect = this._canvasRect();
        const norm = GD.normalizeWheel({
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            ctrlKey: event.ctrlKey,
            canvasHeight: rect.height || 0
        });
        state.zoom.hGoal = GD.nextAltitudeGoal(
            state.zoom.hGoal,
            norm.px,
            norm.k,
            GD.CONFIG.H_MIN,
            state.zoom.hMax
        );
        state.zoom.tau = this._prefersReducedMotion() ? GD.CONFIG.TAU_REDUCED_MS : norm.tau;
        state.zoom.settled = false;
        this._captureZoomAnchor(event.clientX, event.clientY);
    }

    _onGesture(event) {
        if (event?.preventDefault) {
            event.preventDefault();
        }
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.zoom || !GD || !this.isOpen) {
            return;
        }
        state.zoom.tau = this._prefersReducedMotion() ? GD.CONFIG.TAU_REDUCED_MS : GD.CONFIG.TAU_PINCH_MS;
        if (event.type === 'gesturestart') {
            state.zoom.gestureH = state.zoom.hGoal;
            this._captureZoomAnchor(event.clientX, event.clientY);
            return;
        }
        if (event.type === 'gesturechange') {
            const scale = Number(event.scale) || 1;
            const base = state.zoom.gestureH || state.zoom.hGoal;
            state.zoom.hGoal = Math.max(GD.CONFIG.H_MIN, Math.min(state.zoom.hMax, base / (scale || 1)));
            state.zoom.settled = false;
        }
    }

    _captureZoomAnchor(clientX, clientY) {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.zoom || !GD || !state.group) {
            return;
        }
        const ndc = this._clientToNdc(clientX, clientY);
        state.zoom.pointerNdc = ndc;
        state.group.updateMatrixWorld(true);
        const hit = this._hitGlobeNdc(ndc);
        if (!hit) {
            state.zoom.anchor = null;
            return;
        }
        state.group.worldToLocal(hit);
        hit.normalize();
        state.zoom.anchor = hit;
    }

    _beginPinch() {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        const points = [...(this._pointers?.values() || [])];
        if (!state?.zoom || points.length < 2) {
            return;
        }
        const a = points[0];
        const b = points[1];
        const span = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        state.zoom.pinch = { span, h: state.zoom.hGoal };
        state.zoom.tau = this._prefersReducedMotion()
            ? (GD?.CONFIG?.TAU_REDUCED_MS || 40)
            : (GD?.CONFIG?.TAU_TOUCH_MS || 30);
        this._captureZoomAnchor((a.x + b.x) / 2, (a.y + b.y) / 2);
        if (state.controls) {
            state.controls.enableRotate = false;
        }
        if (this.pointerGesture) {
            this.pointerGesture.dragged = true;
        }
    }

    _updatePinch() {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        const points = [...(this._pointers?.values() || [])];
        if (!state?.zoom?.pinch || points.length < 2) {
            return;
        }
        const a = points[0];
        const b = points[1];
        const span = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const hMin = GD?.CONFIG?.H_MIN || 0.3;
        const next = state.zoom.pinch.h * state.zoom.pinch.span / span;
        state.zoom.hGoal = Math.max(hMin, Math.min(state.zoom.hMax, next));
        state.zoom.tau = this._prefersReducedMotion()
            ? (GD?.CONFIG?.TAU_REDUCED_MS || 40)
            : (GD?.CONFIG?.TAU_TOUCH_MS || 30);
        state.zoom.settled = false;
        state.zoom.pointerNdc = this._clientToNdc((a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    _endPinch() {
        const state = this.threeState;
        if (state?.zoom) {
            state.zoom.pinch = null;
        }
        if (state?.controls) {
            state.controls.enableRotate = true;
        }
    }

    _autoRotateRamp(active, now) {
        const zoom = this.threeState?.zoom;
        const rampMs = window.GlobeDetail?.CONFIG?.AUTO_ROTATE_RAMP_MS || 600;
        if (!zoom) {
            return active ? 1 : 0;
        }
        if (!active) {
            zoom.rampOn = false;
            zoom.rampStart = 0;
            return 0;
        }
        if (!zoom.rampOn) {
            zoom.rampOn = true;
            zoom.rampStart = now;
        }
        const t = Math.min(1, (now - zoom.rampStart) / rampMs);
        return t * t * (3 - 2 * t);
    }

    _stepZoom(dt, now) {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.zoom || !state.camera || !GD) {
            return;
        }
        const zoom = state.zoom;
        const stepped = GD.stepAltitude(zoom.h, zoom.hGoal, dt, zoom.tau);
        const wasSettled = zoom.settled;
        zoom.h = stepped.h;
        zoom.settled = stepped.settled;
        if (zoom.settled && !wasSettled) {
            zoom.settledAt = now;
            zoom.needsHover = true;
        } else if (!zoom.settled) {
            zoom.settledAt = 0;
        }
        const radius = 1 + zoom.h;
        const camera = state.camera;
        if (camera.position.length() > 0.001) {
            camera.position.setLength(radius);
        } else {
            camera.position.set(0, 0, radius);
        }
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        if (!zoom.settled && zoom.anchor && state.raycaster && state.group) {
            state.group.updateMatrixWorld(true);
            const worldAnchor = zoom.anchor.clone().applyMatrix4(state.group.matrixWorld).normalize();
            state.raycaster.setFromCamera(zoom.pointerNdc, camera);
            const ray = state.raycaster.ray;
            const hit = GD.rayUnitSphere(
                ray.origin.x, ray.origin.y, ray.origin.z,
                ray.direction.x, ray.direction.y, ray.direction.z
            );
            if (hit) {
                const fit = GlobeExplorer.globeFitDistance(zoom.viewWidth, zoom.viewHeight, camera.fov);
                const weight = GD.anchorWeight(
                    worldAnchor.x, worldAnchor.y, worldAnchor.z,
                    camera.position.x, camera.position.y, camera.position.z,
                    fit
                );
                const phiMin = state.controls
                    ? state.controls.minPolarAngle
                    : Math.PI / 2 - (62 * Math.PI) / 180;
                const phiMax = state.controls
                    ? state.controls.maxPolarAngle
                    : Math.PI / 2 + (62 * Math.PI) / 180;
                const next = GD.adjustSpherical({
                    x: camera.position.x,
                    y: camera.position.y,
                    z: camera.position.z,
                    px: worldAnchor.x,
                    py: worldAnchor.y,
                    pz: worldAnchor.z,
                    qx: hit.x,
                    qy: hit.y,
                    qz: hit.z,
                    w: weight,
                    phiMin,
                    phiMax
                });
                camera.position.set(next.x, next.y, next.z);
                camera.lookAt(0, 0, 0);
                camera.updateMatrixWorld();
            }
        }
        const distance = camera.position.length();
        const altitude = distance - 1;
        if (state.lines) {
            state.lines.level = GD.stepLevel(state.lines.level, distance);
        }
        const clip = GD.clipPlanes(altitude, distance);
        if (GD.clipChanged(camera.near, camera.far, clip.near, clip.far)) {
            camera.near = clip.near;
            camera.far = clip.far;
            camera.updateProjectionMatrix();
        }
        const dot = GD.dotScale(altitude);
        state.dotScale = dot;
        if (state.dotsMesh?.material) {
            state.dotsMesh.material.size = GD.CONFIG.DOT_SIZE * dot;
        }
        if (state.raycaster?.params?.Points) {
            state.raycaster.params.Points.threshold = GD.CONFIG.POINTS_THRESHOLD * dot;
        }
        if (state.controls) {
            state.controls.rotateSpeed = GD.CONFIG.ROTATE_SPEED * GD.rotateScale(altitude);
            state.controls.minDistance = 1 + GD.CONFIG.H_MIN;
            state.controls.maxDistance = zoom.hMax + 1;
            if (this._prefersReducedMotion()) {
                state.controls.autoRotate = this.autoRotateEnabled;
                state.controls.autoRotateSpeed = GD.CONFIG.AUTO_ROTATE_SPEED;
            } else {
                const level = state.lines?.level || 'world';
                const resume = Boolean(
                    zoom.settled
                    && zoom.settledAt
                    && (now - zoom.settledAt > GD.CONFIG.AUTO_ROTATE_RESUME_MS)
                );
                const spinning = this.autoRotateEnabled && level === 'world' && resume;
                state.controls.autoRotate = spinning;
                state.controls.autoRotateSpeed = GD.CONFIG.AUTO_ROTATE_SPEED
                    * GD.autoRotateScale(altitude)
                    * this._autoRotateRamp(spinning, now);
            }
        }
    }

    _stepHoverSlots(now) {
        const lines = this.threeState?.lines;
        if (!lines) {
            return;
        }
        for (const slot of [lines.hoverA, lines.hoverB]) {
            const duration = slot.duration > 0 ? slot.duration : 1;
            const t = Math.min(1, (now - slot.startedAt) / duration);
            const eased = 1 - (1 - t) * (1 - t);
            slot.weight = slot.from + (slot.to - slot.from) * eased;
        }
    }

    _setLineHover(id) {
        const lines = this.threeState?.lines;
        const GD = window.GlobeDetail;
        if (!lines) {
            return;
        }
        const nextId = id || 0;
        const now = performance.now();
        const fadeIn = GD?.CONFIG?.HOVER_IN_MS || 140;
        const fadeOut = GD?.CONFIG?.HOVER_OUT_MS || 220;
        const slots = [lines.hoverA, lines.hoverB];
        if (nextId && slots.some((slot) => slot.id === nextId && slot.to === 1)) {
            for (const slot of slots) {
                if (slot.id !== nextId && slot.to !== 0) {
                    slot.from = slot.weight;
                    slot.to = 0;
                    slot.startedAt = now;
                    slot.duration = fadeOut;
                }
            }
            return;
        }
        if (!nextId) {
            for (const slot of slots) {
                if (slot.weight > 0 || slot.to !== 0) {
                    slot.from = slot.weight;
                    slot.to = 0;
                    slot.startedAt = now;
                    slot.duration = fadeOut;
                }
            }
            return;
        }
        const slot = lines.hoverA.weight <= lines.hoverB.weight ? lines.hoverA : lines.hoverB;
        const other = slot === lines.hoverA ? lines.hoverB : lines.hoverA;
        slot.id = nextId;
        slot.from = 0;
        slot.weight = 0;
        slot.to = 1;
        slot.startedAt = now;
        slot.duration = fadeIn;
        other.from = other.weight;
        other.to = 0;
        other.startedAt = now;
        other.duration = fadeOut;
    }

    _stepLines(dt, now) {
        // Boundaries arrive after the first frame. Retry until the 110m
        // rings are in memory, then build the world mesh in idle chunks.
        this._startWorldLines();
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.lines || !state.camera || !GD) {
            return;
        }
        const lines = state.lines;
        const distance = state.camera.position.length();
        const reduced = this._prefersReducedMotion();
        const fadeMs = reduced ? GD.CONFIG.CROSSFADE_REDUCED_MS : GD.CONFIG.CROSSFADE_MS;
        if (lines.worldIntroStart) {
            const intro = Math.min(1, (now - lines.worldIntroStart) / fadeMs);
            lines.worldIntro = intro;
            if (intro >= 1) {
                lines.worldIntroStart = 0;
            }
        }
        let cap = -1;
        if (lines.meshes.world) cap = 0;
        if (lines.meshes.regional) cap = 1;
        if (lines.meshes.local) cap = 2;
        let target = GD.levelIndex(lines.level);
        if (cap < 0) {
            target = 0;
        } else if (target > cap) {
            target = cap;
        }
        const maxStep = fadeMs > 0 ? dt / fadeMs : 1;
        lines.lod += Math.max(-maxStep, Math.min(maxStep, target - lines.lod));
        if (Math.abs(lines.lod - target) < 1e-4) {
            lines.lod = target;
        }
        this._stepHoverSlots(now);
        const weights = GD.crossfadeWeights(lines.lod);
        weights[0] *= lines.meshes.world ? lines.worldIntro : 0;
        const names = ['world', 'regional', 'local'];
        for (let i = 0; i < names.length; i++) {
            const mesh = lines.meshes[names[i]];
            if (!mesh) {
                continue;
            }
            const weight = weights[i] || 0;
            mesh.visible = weight > 0.0001;
            const uniforms = mesh.material.uniforms;
            uniforms.uLevelWeight.value = weight;
            uniforms.uDistance.value = distance;
            uniforms.uHoverIdA.value = lines.hoverA.id;
            uniforms.uHoverWA.value = lines.hoverA.weight;
            uniforms.uHoverIdB.value = lines.hoverB.id;
            uniforms.uHoverWB.value = lines.hoverB.weight;
        }
        if (this.isOpen) {
            this._considerLinePrefetch(distance);
        }
    }

    _scheduleIdle(fn) {
        if (typeof window.requestIdleCallback === 'function') {
            return window.requestIdleCallback(fn, { timeout: 500 });
        }
        return window.setTimeout(() => fn({ timeRemaining: () => 4, didTimeout: true }), 0);
    }

    _cancelIdle(id) {
        if (id == null) {
            return;
        }
        if (typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(id);
        }
        window.clearTimeout(id);
    }

    _startWorldLines() {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        const features = window.countryBoundaries?.features;
        if (!state?.lines || !GD || !features?.length || state.lines.worldStarted) {
            return;
        }
        state.lines.worldStarted = true;
        const acc = GD.createEdgeAccumulator();
        let index = 0;
        const step = (deadline) => {
            if (state.disposed || state.lines.cancelled) {
                return;
            }
            const start = performance.now();
            let processed = 0;
            while (index < features.length && processed < 20 && (performance.now() - start) < 4) {
                if (
                    processed > 0
                    && deadline
                    && typeof deadline.timeRemaining === 'function'
                    && deadline.timeRemaining() < 1
                ) {
                    break;
                }
                const feature = features[index];
                index += 1;
                processed += 1;
                if (feature) {
                    GD.addFeatureEdges(acc, feature, feature.runtimeId || index);
                }
            }
            // The first slice waits for idle. Later slices use a timeout so a
            // continuous render loop, which never goes idle, still finishes
            // the build in ≤4 ms pieces instead of waiting out every timeout.
            const scheduleSlice = (fn) => {
                state.lines.worldIdle = window.setTimeout(() => {
                    fn({ timeRemaining: () => 4, didTimeout: true });
                }, 0);
            };
            if (index < features.length) {
                scheduleSlice(step);
                return;
            }
            scheduleSlice(() => {
                if (state.disposed || state.lines.cancelled) {
                    return;
                }
                this._installLineMesh('world', GD.projectWorldEdges(GD.finalizeWorldEdges(acc)));
            });
        };
        state.lines.worldIdle = this._scheduleIdle(step);
    }

    _lineLevelName(kind) {
        return kind === '10m' ? 'local' : 'regional';
    }

    _lineUrl(kind) {
        return kind === '10m' ? '/data/globe-lines-10m.v1.json' : '/data/globe-lines-50m.v1.json';
    }

    _adm0RuntimeIds() {
        const map = {};
        const byCode = window.countryBoundaries?.byAdm0A3;
        if (!byCode) {
            return map;
        }
        for (const [code, index] of byCode.entries()) {
            map[code] = index + 1;
        }
        return map;
    }

    _applyLineDprScale() {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.lines || !GD) {
            return;
        }
        const dpr = state.renderer?.getPixelRatio?.() || window.devicePixelRatio || 1;
        const scale = dpr < 1.5 ? GD.CONFIG.ALPHA.lowDprScale : 1;
        for (const mesh of Object.values(state.lines.meshes)) {
            if (mesh?.material?.uniforms?.uDprScale) {
                mesh.material.uniforms.uDprScale.value = scale;
            }
        }
    }

    _installLineMesh(level, buffers) {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state || state.disposed || !GD || !buffers?.positions?.length) {
            return;
        }
        if (!state.lines.baseMaterial) {
            state.lines.baseMaterial = GD.createInkMaterial(state.THREE);
        }
        const material = state.lines.baseMaterial.clone();
        const dpr = state.renderer?.getPixelRatio?.() || window.devicePixelRatio || 1;
        GD.applyLevelUniforms(material, level, dpr);
        const geometry = new state.THREE.BufferGeometry();
        geometry.setAttribute('position', new state.THREE.BufferAttribute(buffers.positions, 3));
        geometry.setAttribute('meta', new state.THREE.BufferAttribute(buffers.meta, 4));
        geometry.setIndex(new state.THREE.BufferAttribute(buffers.index, 1));
        const mesh = new state.THREE.LineSegments(geometry, material);
        mesh.renderOrder = 0;
        mesh.visible = false;
        state.group.add(mesh);
        const previous = state.lines.meshes[level];
        if (previous) {
            state.group.remove(previous);
            previous.geometry?.dispose();
            previous.material?.dispose();
        }
        state.lines.meshes[level] = mesh;
        if (level === 'world') {
            state.lines.worldIntro = 0;
            state.lines.worldIntroStart = performance.now();
        }
    }

    _considerLinePrefetch(distance) {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        if (!state?.zoom || !state.lines || !GD || !this.isOpen) {
            return;
        }
        const saveData = Boolean(navigator.connection && navigator.connection.saveData);
        for (const kind of ['50m', '10m']) {
            if (!GD.shouldFetch(kind, distance, state.zoom.hGoal) && state.lines.failed[kind]) {
                state.lines.rearm[kind] = true;
            }
        }
        if (GD.shouldFetch('50m', distance, state.zoom.hGoal)) {
            this._ensureLineLevel('50m');
        }
        if (!saveData && GD.shouldFetch('10m', distance, state.zoom.hGoal)) {
            this._ensureLineLevel('10m');
        }
    }

    _ensureLineLevel(kind) {
        const lines = this.threeState?.lines;
        if (!lines || lines.loaded[kind] || lines.loading[kind]) {
            return;
        }
        if (lines.failed[kind]) {
            if (!lines.rearm[kind] || performance.now() < (lines.cooldown[kind] || 0)) {
                return;
            }
        }
        lines.loading[kind] = true;
        lines.rearm[kind] = false;
        const url = this._lineUrl(kind);
        const begin = () => {
            const current = this.threeState?.lines;
            if (!current || current.cancelled || this.threeState.disposed) {
                return;
            }
            if (current.loaded[kind]) {
                current.loading[kind] = false;
                return;
            }
            const codeToId = this._adm0RuntimeIds();
            if (!this._postLineBuild(url, kind, codeToId)) {
                void this._buildLinesOnMain(url, kind, codeToId);
            }
        };
        const boundaries = window.countryBoundaries;
        if (
            boundaries
            && boundaries.features.length === 0
            && typeof boundaries.ensureLoaded === 'function'
        ) {
            boundaries.ensureLoaded().then(begin, begin);
            return;
        }
        begin();
    }

    _postLineBuild(url, kind, codeToId) {
        const lines = this.threeState?.lines;
        if (!lines || lines.workerFailed || typeof Worker === 'undefined') {
            if (lines) {
                lines.workerFailed = true;
            }
            return false;
        }
        if (!lines.worker) {
            try {
                lines.worker = new Worker('/js/globeLinesWorker.js?v=20261025a');
                lines.worker.onmessage = (event) => this._onLineWorkerMessage(event);
                lines.worker.onerror = () => {
                    const pending = { ...lines.requests };
                    lines.workerFailed = true;
                    try {
                        lines.worker.terminate();
                    } catch (err) {
                        /* ignore */
                    }
                    lines.worker = null;
                    lines.requests = {};
                    for (const requestId of Object.keys(pending)) {
                        const pendingKind = pending[requestId];
                        if (!pendingKind || !lines.loading[pendingKind]) {
                            continue;
                        }
                        lines.loading[pendingKind] = false;
                        void this._buildLinesOnMain(this._lineUrl(pendingKind), pendingKind, this._adm0RuntimeIds());
                    }
                };
            } catch (err) {
                lines.workerFailed = true;
                return false;
            }
        }
        const id = lines.requestSerial + 1;
        lines.requestSerial = id;
        lines.requests[id] = kind;
        lines.worker.postMessage({ type: 'build', id, url, codeToId });
        return true;
    }

    _onLineWorkerMessage(event) {
        const lines = this.threeState?.lines;
        const data = event?.data || {};
        if (!lines) {
            return;
        }
        const kind = lines.requests[data.id];
        delete lines.requests[data.id];
        if (!kind) {
            return;
        }
        lines.loading[kind] = false;
        if (!data.ok) {
            this._failLineLevel(kind, data.error);
            return;
        }
        lines.loaded[kind] = true;
        lines.failed[kind] = false;
        this._installLineMesh(this._lineLevelName(kind), data);
    }

    _failLineLevel(kind, err) {
        const lines = this.threeState?.lines;
        if (!lines) {
            return;
        }
        lines.loading[kind] = false;
        lines.failed[kind] = true;
        lines.cooldown[kind] = performance.now() + 30000;
        lines.rearm[kind] = false;
        if (!lines.warned[kind]) {
            lines.warned[kind] = true;
            console.warn('[GlobeExplorer] globe lines failed', kind, err);
        }
    }

    async _buildLinesOnMain(url, kind, codeToId) {
        const state = this.threeState;
        const GD = window.GlobeDetail;
        const lines = state?.lines;
        if (!lines || !GD) {
            return;
        }
        lines.loading[kind] = true;
        try {
            const res = await fetch(url, { cache: 'force-cache' });
            if (!res.ok) {
                throw new Error(`status ${res.status}`);
            }
            const doc = await res.json();
            const build = GD.createChunkedLineBuild(doc, codeToId);
            const step = (deadline) => {
                if (!this.threeState || this.threeState.disposed || lines.cancelled) {
                    return;
                }
                const start = performance.now();
                let done = false;
                do {
                    done = GD.stepChunkedLineBuild(build, 5000);
                    if (done) {
                        lines.loading[kind] = false;
                        lines.loaded[kind] = true;
                        lines.failed[kind] = false;
                        this._installLineMesh(this._lineLevelName(kind), GD.finishChunkedLineBuild(build));
                        return;
                    }
                } while (
                    (performance.now() - start) < 4
                    && !(deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 1)
                );
                lines.idleId = this._scheduleIdle(step);
            };
            lines.idleId = this._scheduleIdle(step);
        } catch (err) {
            this._failLineLevel(kind, err);
        }
    }

    _disposeLines() {
        const state = this.threeState;
        if (!state?.lines) {
            return;
        }
        const lines = state.lines;
        lines.cancelled = true;
        this._cancelIdle(lines.idleId);
        this._cancelIdle(lines.worldIdle);
        if (lines.worker) {
            lines.worker.terminate();
            lines.worker = null;
        }
        for (const mesh of Object.values(lines.meshes)) {
            if (!mesh) {
                continue;
            }
            state.group?.remove(mesh);
            mesh.geometry?.dispose();
            mesh.material?.dispose();
        }
        lines.baseMaterial?.dispose();
        lines.baseMaterial = null;
    }
}

window.GlobeExplorer = GlobeExplorer;
