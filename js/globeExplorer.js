/**
 * GlobeExplorer - the full-screen globe of photo places, routes and
 * country filters. GlobeMap draws it; this class owns the data, the pick
 * dialogs and the filter menu.
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

        this.lifecycle = new OverlayLifecycle(this.overlay, {
            onClosed: () => this._onOverlayClosed()
        });
        this.globeMap = null;
        this._globePromise = null;
        this.locations = [];
        this.locationsByCountry = {};
        this.locationsByState = {};
        this.locationsByStateKey = {};
        this.locationsByPlace = {};
        this.locationsByPlaceKey = {};
        this._geoPromise = null;
        this._geoFetchedOnce = false;
        this.locationGroupByKey = new Map();
        this.selectedFilterType = 'country';
        this.selectedFilterValue = '';
        this.selectedFilters = { country: '', state: '', location: '', color: '', camera: '' };
        this.colorOptions = [];
        this._colorsFetchedOnce = false;
        this._colorsFilterKey = '';
        this._colorsPromise = null;
        this.cameraOptions = [];
        this._camerasFetchedOnce = false;
        this._camerasFilterKey = '';
        this._camerasPromise = null;
        this.hoveredCountryKey = '';
        this.isFilterPanelExpanded = false;
        this.countryFilterAliasMap = new Map();
        this.filterOptionCache = new Map();
        this.pendingPick = null;
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
            color: 'COLOR',
            camera: 'CAMERA'
        };
        const base = `${labels[filterType] || 'FILTER'}: ${String(filterValue || '').toUpperCase()}`;
        return label ? `${base} · ${String(label).toUpperCase()}` : base;
    }

    _formatSelectedFiltersLabel() {
        const parts = this._getSelectedFilterLabels();
        return parts.length ? parts.join(' · ') : 'ALL';
    }

    _getSelectedFilterLabels() {
        const filters = this.selectedFilters || {};
        return [
            filters.country ? this._formatFilterLabel('country', filters.country) : '',
            filters.state ? this._formatFilterLabel('state', filters.state) : '',
            filters.location ? this._formatFilterLabel('location', filters.location) : '',
            filters.color ? this._formatFilterLabel('color', filters.color) : '',
            filters.camera ? this._formatFilterLabel('camera', filters.camera) : ''
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

    // ── globe ──

    _ensureGlobe() {
        this._globePromise = this._globePromise || this._createGlobe().catch((err) => {
            this._globePromise = null;
            throw err;
        });
        return this._globePromise;
    }

    async _createGlobe() {
        const boundaries = await window.countryBoundaries.ensureLoaded();
        const globe = await window.GlobeMap.create(this.sceneContainer, {
            image: window.threeLoader.loadEarthImage(),
            countries: boundaries.lines,
            onTap: (tap) => this._onGlobeTap(tap),
            onHover: (point) => this._onGlobeHover(point),
            onSpinChange: () => this._syncRotateToggleUI()
        });
        globe.setPlaces(this._places());
        globe.setRoutes(window.globeRoutes.arcSegments(this.locations, (loc) => this._locationKeyFor(loc)));
        this.globeMap = globe;
        return globe;
    }

    /** One marker per place key, at the mean direction of its photos. */
    _places() {
        const { sphere, lngLat } = window.GlobeGl;
        this.locationGroupByKey = new Map();
        for (const loc of this.locations) {
            const lat = Number(loc?.latitude);
            const lon = Number(loc?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            const key = this._locationKeyFor(loc);
            const group = this.locationGroupByKey.get(key)
                || { key, sample: loc, sum: [0, 0, 0], count: 0 };
            sphere(lon, lat, 1).forEach((value, axis) => { group.sum[axis] += value; });
            group.count += 1;
            this.locationGroupByKey.set(key, group);
        }
        return Array.from(this.locationGroupByKey.values(), (group) => {
            const { lng, lat } = lngLat(...group.sum);
            return { key: group.key, lng, lat, count: group.count };
        });
    }

    _setMarkerHover(keys) {
        this.globeMap?.setMarkerHover(keys);
    }

    _setCountryHover(feature) {
        const key = feature ? window.countryBoundaries.countryFeatureKey(feature) : '';
        if (key === this.hoveredCountryKey) return;
        this.hoveredCountryKey = key;
        this.globeMap?.setCountryOutline(feature ? window.countryBoundaries.outline(feature) : null);
    }

    /** Screen distance picks the marker, so a ring edge-on at the limb still hovers. */
    _onGlobeHover(point) {
        const hit = point && this.globeMap.markerHits(point.x, point.y, 13)[0];
        if (hit) {
            this._setMarkerHover(hit.keys);
            this._setCountryHover(null);
            return;
        }
        this._setMarkerHover([]);
        const surface = point && this.globeMap.surfaceAt(point.x, point.y);
        this._setCountryHover(surface ? window.countryBoundaries.findCountry(surface.lng, surface.lat) : null);
    }

    /**
     * A tap near markers offers their places, plus the country when there
     * is more than one choice. A tap on bare land offers the country. The
     * radius is in screen pixels, so an empty country never snaps to a
     * marker that is visibly elsewhere.
     */
    _onGlobeTap(tap) {
        if (this.isExiting) return;
        const surface = this.globeMap.surfaceAt(tap.x, tap.y);
        if (!surface) return;
        this.globeMap.pulse(surface);
        const country = window.countryBoundaries.findCountry(surface.lng, surface.lat);
        const radius = tap.pointerType === 'mouse' ? 18 : 26;
        const keys = [...new Set(this.globeMap.markerHits(tap.x, tap.y, radius).flatMap((hit) => hit.keys))];
        const options = keys
            .map((key) => this.locationGroupByKey.get(key)?.sample)
            .filter(Boolean)
            .map((sample) => ({
                key: this._locationKeyFor(sample),
                label: sample.location || sample.country || 'Unknown',
                country: sample.country || '',
                state: sample.state || '',
                sample
            }));
        if (options.length > 1 && country) {
            options.unshift({ key: '__country__', kind: 'country', label: country.name, country: '', feature: country });
        }
        const pick = (option) => this._proposeGlobePick(
            option.kind === 'country' ? { kind: 'country', feature: option.feature } : { sample: option.sample }
        );

        if (options.length > 1) {
            this._showIntersectPicker(options, pick, { x: tap.clientX, y: tap.clientY });
            return;
        }
        this._hideIntersectPicker();
        if (options.length === 1) {
            pick(options[0]);
            return;
        }
        if (!country) {
            this._hidePickConfirm();
            return;
        }
        pick({ kind: 'country', feature: country });
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

    get isOpen() {
        return this.lifecycle.isOpen;
    }

    get isExiting() {
        return this.lifecycle.isClosing;
    }

    /** MapLibre loads here, never on idle or menu intent. */
    async open(focusLocation = null) {
        if (this.isOpen) {
            if (focusLocation) {
                this._focusLocation(focusLocation);
            }
            return;
        }
        this._hidePickConfirm();
        const shown = this.lifecycle.open();
        this.backStack?.claim('globe', () => this.close());

        try {
            this.prefetch();
            await this._fetchLocations();
            if (this.lifecycle.phase === 'closed') return;
            const globe = await this._ensureGlobe();
            if (this.lifecycle.phase === 'closed') return;
            globe.fit();
            if (focusLocation) {
                this._focusLocation(focusLocation);
            }
            globe.setActive(true);
            this._syncRotateToggleUI();
        } catch (err) {
            console.error('[GlobeExplorer] failed to initialize', err);
        }
        await shown;
    }

    close() {
        if (this.isExiting) return this.lifecycle.close();
        if (!this.isOpen) return Promise.resolve();
        this._hidePickConfirm();
        this._hideIntersectPicker();
        this._suppressGhostClick();
        this.backStack?.release('globe');
        return this.lifecycle.close();
    }

    _onOverlayClosed() {
        this._setMarkerHover([]);
        this._setCountryHover(null);
        this._hideIntersectPicker();
        this._hidePickConfirm();
        this.globeMap?.setActive(false);
    }

    /** A focused photo faces the camera at the fit zoom, at any latitude, and the spin stops. */
    _focusLocation(location) {
        const globe = this.globeMap;
        const match = location && (this._findLocationMatch(location) || location);
        const lat = Number(match?.latitude);
        const lon = Number(match?.longitude);
        if (!globe || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

        globe.setSpin(false);
        globe.focus(lon, lat);
        const key = this._locationKeyFor(match);
        if (this.locationGroupByKey.has(key)) {
            this._setMarkerHover([key]);
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

    /** Data, borders and the earth photo: everything the globe needs except MapLibre. */
    prefetch() {
        this._prefetchGeo();
        window.countryBoundaries?.ensureLoaded();
        window.threeLoader?.prefetchEarthImage();
    }

    _bindPrefetchIntent() {
        this.openBtn?.addEventListener('pointerenter', () => this.prefetch());
        this.openBtn?.addEventListener('focus', () => this.prefetch());
    }

    _prefetchGeo() {
        this._fetchLocations().catch(() => {});
        this._fetchColors().catch(() => {});
        this._fetchCameras().catch(() => {});
    }

    _warmup() {
        // Idle warmup must not race first-viewport thumbnails, and fetches
        // only the filter data. Opening the CONTROL menu adds borders and
        // the earth photo.
        const start = () => this._prefetchGeo();
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(start, { timeout: 3500 });
        } else {
            window.setTimeout(start, 1400);
        }
    }

    _toggleRotation() {
        this.globeMap?.setSpin(!this.globeMap.spinning);
    }

    _syncRotateToggleUI() {
        if (!this.rotateToggleBtn) return;
        const spinning = this.globeMap ? this.globeMap.spinning : true;
        this.rotateToggleBtn.classList.toggle('paused', !spinning);
        this.rotateToggleBtn.setAttribute(
            'aria-label',
            spinning ? 'Pause globe rotation' : 'Resume globe rotation'
        );
        this.rotateToggleBtn.setAttribute(
            'title',
            spinning ? 'Pause rotation' : 'Resume rotation'
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
            filters.camera || '',
            this.imageService?.takenFromFilter || '',
            this.imageService?.takenToFilter || ''
        ].join('\u0001');
    }

    _cameraFacetKey() {
        const filters = this.selectedFilters || {};
        return [
            filters.country || '',
            filters.state || '',
            filters.location || '',
            filters.color || '',
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
            this._appendFacetParams(url, { camera: true });

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

    _appendFacetParams(url, include) {
        const filters = this.selectedFilters || {};
        if (filters.country) url.searchParams.set('country', filters.country);
        if (filters.state) url.searchParams.set('state', filters.state);
        if (filters.location) url.searchParams.set('location', filters.location);
        if (include.color && filters.color) url.searchParams.set('color', filters.color);
        if (include.camera && filters.camera) url.searchParams.set('camera', filters.camera);
        if (this.imageService?.takenFromFilter) {
            url.searchParams.set('takenFrom', this.imageService.takenFromFilter);
        }
        if (this.imageService?.takenToFilter) {
            url.searchParams.set('takenTo', this.imageService.takenToFilter);
        }
    }

    async _fetchCameras() {
        const key = this._cameraFacetKey();
        if (this._camerasFetchedOnce && this._camerasFilterKey === key && !this._camerasPromise) {
            return;
        }
        if (this._camerasPromise && this._camerasFilterKey === key) {
            return this._camerasPromise;
        }

        this._camerasFilterKey = key;
        const request = this._fetchCamerasInternal(key);
        this._camerasPromise = request;
        try {
            await request;
        } finally {
            if (this._camerasPromise === request) {
                this._camerasPromise = null;
            }
        }
    }

    async _fetchCamerasInternal(key) {
        try {
            const base = (window.CONFIG?.API_BASE_URL || '').replace(/\/$/, '');
            const url = new URL(base ? `${base}/api/photos/cameras` : '/api/photos/cameras', window.location.origin);
            this._appendFacetParams(url, { color: true });

            const res = await fetch(url.toString());
            const data = await res.json();
            if (this._cameraFacetKey() !== key) {
                return;
            }
            this.cameraOptions = Array.isArray(data.cameras) ? data.cameras : [];
        } catch (err) {
            if (this._cameraFacetKey() !== key) {
                return;
            }
            console.error('[GlobeExplorer] failed to fetch camera facets', err);
            this.cameraOptions = [];
        } finally {
            if (this._cameraFacetKey() === key) {
                this._camerasFetchedOnce = true;
                this._renderFilterMenu();
            }
        }
    }


    // ── filtering: public API for the radial control menu ──

    /**
     * The geo feed backs both the globe and the filter lists. Callers await
     * this before reading options; repeat calls are free once it has landed.
     */
    async ensureFilterData() {
        await Promise.all([this._fetchLocations(), this._fetchColors(), this._fetchCameras()]);
        return this.locations;
    }

    get hasFilterData() {
        return this._geoFetchedOnce || this._colorsFetchedOnce || this._camerasFetchedOnce;
    }

    get hasColorFilterData() {
        return this._colorsFetchedOnce;
    }

    get hasCameraFilterData() {
        return this._camerasFetchedOnce;
    }

    get hasPlaceFilterData() {
        return this._geoFetchedOnce;
    }

    getFilterOptions(type) {
        if (type === 'color') {
            return this.colorOptions;
        }
        if (type === 'camera') {
            return this.cameraOptions;
        }
        if (!this._geoFetchedOnce) return [];
        return this._getOptionsForType(type);
    }

    getSelectedFilters() {
        return { ...this._emptyFilters(), ...(this.selectedFilters || {}) };
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
            { type: 'color', label: 'color' },
            { type: 'camera', label: 'camera' }
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
                color: 'colors',
                camera: 'cameras'
            };
            this.filterScopeTitle.textContent = titles[this.selectedFilterType] || 'options';
        }
        if (this.filterActive) {
            this._renderActiveFilterLabel();
        }
    }

    _getOptionsForType(type) {
        if (type === 'color') {
            return this.colorOptions || [];
        }
        if (type === 'camera') {
            return this.cameraOptions || [];
        }

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
            this.selectedFilters = this._emptyFilters();
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
        if (this._camerasFetchedOnce && this.selectedFilters.camera && !this._isOptionValid('camera', this.selectedFilters.camera)) {
            this.selectedFilters.camera = '';
        }
        this._syncSelectedFilterValue();
    }

    _setFilterSelection(type, value, render = true) {
        if (!this.selectedFilters) {
            this.selectedFilters = this._emptyFilters();
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
            this.selectedFilters = this._emptyFilters();
        }
        if (type === 'color' || type === 'camera') {
            this.selectedFilters[type] = item?.value || '';
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
            this.selectedFilters = this._emptyFilters();
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
        } else if (type === 'camera') {
            this.selectedFilters.camera = '';
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
        if (filters.camera) return { type: 'camera', value: filters.camera };
        return null;
    }

    _hasAnySelectedFilter() {
        const filters = this.selectedFilters || {};
        return Boolean(filters.country || filters.state || filters.location || filters.color || filters.camera);
    }

    _emptyFilters() {
        return { country: '', state: '', location: '', color: '', camera: '' };
    }

    _syncImageServiceFilters(takenFrom = null, takenTo = null) {
        const filters = this.selectedFilters || {};
        this.imageService.countryFilter = filters.country || null;
        this.imageService.stateFilter = filters.state || null;
        this.imageService.locationFilter = filters.location || null;
        this.imageService.colorFilter = filters.color || null;
        this.imageService.cameraFilter = filters.camera || null;
        this.imageService.takenFromFilter = takenFrom || null;
        this.imageService.takenToFilter = takenTo || null;
    }

    async _applyCurrentFilters(takenFrom = null, takenTo = null) {
        if (this.isOpen || this.isExiting) {
            await this.close();
        }
        this._syncImageServiceFilters(takenFrom, takenTo);
        await Promise.all([this._fetchColors(), this._fetchCameras()]);
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
        await Promise.all([this._fetchColors(), this._fetchCameras()]);
        this._renderFilterMenu();
        this._emitFilterChange();
        if (window.gallery) {
            await window.gallery.loadImages();
        }
    }
}

window.GlobeExplorer = GlobeExplorer;
