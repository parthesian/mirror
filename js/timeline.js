/**
 * Timeline - Fixed left sidebar showing year/month groups derived from photo dates.
 * Loads all timeline metadata upfront via a lightweight API call, then syncs
 * the active highlight with the gallery scroll position.
 */
class Timeline {
    constructor(imageService, gallery) {
        this.imageService = imageService;
        this.gallery = gallery;
        this.container = document.getElementById('timeline');
        this.mainContent = document.querySelector('.main-content');
        this.exposureDial = document.getElementById('exposure-dial');
        this.revealButton = document.getElementById('timeline-reveal-btn');
        this.groups = [];
        this.activeKey = null;
        this.monthElements = new Map();
        this.yearGroups = new Map();
        this.collapsedYears = new Set();
        this.toggleAllBtn = null;
        this.enabledKeys = new Set();
        this.lockedKey = null;
        this.isAutoHidden = false;
        this.isManualOpen = false;

        if (!this.container) return;

        this.updateSidebarPosition();
        this.fetchTimeline();
        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('scroll', () => this.scheduleSync(), { passive: true });
        window.addEventListener('resize', () => this.updateSidebarPosition(), { passive: true });
        this.revealButton?.addEventListener('click', () => this.toggleAutoHiddenTimeline());
        document.addEventListener('galleryUpdated', async () => {
            await this.refreshEnabledMonths();
            this.syncActiveFromScroll();
            this.updateSidebarPosition();
        });

        const unlock = () => { this.lockedKey = null; };
        window.addEventListener('wheel', unlock, { passive: true });
        window.addEventListener('touchstart', unlock, { passive: true });
        window.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
                unlock();
            }
        }, { passive: true });
    }

    scheduleSync() {
        if (this.syncQueued) return;
        this.syncQueued = true;
        requestAnimationFrame(() => {
            this.syncQueued = false;
            this.syncActiveFromScroll();
        });
    }

    async fetchTimeline() {
        try {
            const baseUrl = this.imageService.apiBaseUrl;
            const url = baseUrl
                ? `${baseUrl}/api/photos/timeline`
                : '/api/photos/timeline';

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors'
            });

            if (!response.ok) return;

            const data = await this.imageService.parseJsonResponse(response);
            this.groups = Array.isArray(data.groups) ? data.groups : [];
            this.render();
            await this.refreshEnabledMonths();
        } catch (error) {
            console.error('Timeline: failed to load timeline data:', error);
        }
    }

    render() {
        if (!this.container || this.groups.length === 0) return;

        this.monthElements.clear();
        this.yearGroups.clear();
        this.container.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'timeline-list';

        const line = document.createElement('div');
        line.className = 'timeline-line';
        list.appendChild(line);

        const toggleAllWrap = document.createElement('div');
        toggleAllWrap.className = 'timeline-toggle-all-wrap';
        const toggleAllBtn = document.createElement('button');
        toggleAllBtn.type = 'button';
        toggleAllBtn.className = 'timeline-toggle-all';
        toggleAllBtn.addEventListener('click', () => this.toggleAllYears());
        toggleAllWrap.appendChild(toggleAllBtn);
        list.appendChild(toggleAllWrap);
        this.toggleAllBtn = toggleAllBtn;

        const byYear = new Map();
        for (const group of this.groups) {
            const year = Number(group.year);
            if (!byYear.has(year)) byYear.set(year, []);
            byYear.get(year).push(group);
        }

        for (const [year, months] of byYear.entries()) {
            const yearGroup = document.createElement('div');
            yearGroup.className = 'timeline-year-group';
            yearGroup.dataset.year = String(year);

            const yearRow = document.createElement('div');
            yearRow.className = 'timeline-year-row';

            const yearBtn = document.createElement('button');
            yearBtn.type = 'button';
            yearBtn.className = 'timeline-year';
            yearBtn.textContent = String(year);
            yearBtn.setAttribute('aria-label', `Jump to earliest photo in ${year}`);
            yearBtn.addEventListener('click', () => {
                this.scrollToYearEarliest(year);
            });

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'timeline-year-toggle';
            toggleBtn.dataset.year = String(year);
            toggleBtn.setAttribute('aria-label', `Collapse ${year}`);
            toggleBtn.textContent = '▾';
            toggleBtn.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            toggleBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const isCollapsed = this.collapsedYears.has(year);
                this.setYearCollapsed(year, !isCollapsed);
            });

            yearRow.appendChild(yearBtn);
            yearRow.appendChild(toggleBtn);
            yearGroup.appendChild(yearRow);

            const monthsWrap = document.createElement('div');
            monthsWrap.className = 'timeline-year-months';
            for (const group of months) {
                const monthEl = document.createElement('div');
                monthEl.className = 'timeline-month';
                monthEl.textContent = this.monthAbbr(group.month);
                monthEl.dataset.year = group.year;
                monthEl.dataset.month = group.month;

                monthEl.addEventListener('click', () => {
                    if (monthEl.classList.contains('disabled')) return;
                    this.scrollToDate(group.year, group.month);
                });

                const key = `${group.year}-${group.month}`;
                this.monthElements.set(key, monthEl);
                monthsWrap.appendChild(monthEl);
            }
            yearGroup.appendChild(monthsWrap);
            this.yearGroups.set(year, { groupEl: yearGroup, monthsWrap, toggleBtn });
            if (this.collapsedYears.has(year)) {
                this.setYearCollapsed(year, true);
            }
            list.appendChild(yearGroup);
        }

        this.container.appendChild(list);
        this.updateToggleAllUI();
        this.syncActiveFromScroll();
        this.updateSidebarPosition();
    }

    toggleAutoHiddenTimeline() {
        if (!this.isAutoHidden) return;
        this.isManualOpen = !this.isManualOpen;
        this.updateSidebarPosition();
    }

    updateRevealButton() {
        if (!this.revealButton) return;

        if (!this.isAutoHidden) {
            this.revealButton.classList.add('hidden');
            this.revealButton.classList.remove('is-active');
            this.revealButton.setAttribute('aria-expanded', 'false');
            this.revealButton.setAttribute('aria-label', 'Show timeline');
            this.revealButton.setAttribute('title', 'Show timeline');
            return;
        }

        this.revealButton.classList.remove('hidden');
        this.revealButton.classList.toggle('is-active', this.isManualOpen);
        this.revealButton.setAttribute('aria-expanded', this.isManualOpen ? 'true' : 'false');
        this.revealButton.setAttribute('aria-label', this.isManualOpen ? 'Hide timeline' : 'Show timeline');
        this.revealButton.setAttribute('title', this.isManualOpen ? 'Hide timeline' : 'Show timeline');
    }

    updateSidebarPosition() {
        if (!this.container) return;

        if (window.innerWidth <= 768) {
            this.isAutoHidden = false;
            this.isManualOpen = false;
            this.container.style.left = '';
            this.container.style.display = '';
            this.container.setAttribute('aria-hidden', 'true');
            this.container.classList.remove('timeline-popout');
            this.updateRevealButton();
            return;
        }

        const timelineWidth = Math.round(
            parseFloat(window.getComputedStyle(this.container).width) || this.container.offsetWidth || 60
        );
        const minimumGap = 16;
        const mainLeft = this.mainContent?.getBoundingClientRect().left ?? 0;
        const maxAllowedLeft = Math.floor(mainLeft - timelineWidth - minimumGap);

        if (maxAllowedLeft < 0) {
            this.isAutoHidden = true;
            this.updateRevealButton();

            if (this.isManualOpen) {
                this.container.classList.add('timeline-popout');
                this.container.style.display = '';
                this.container.style.left = `${this.getAnchoredLeft()}px`;
                this.container.setAttribute('aria-hidden', 'false');
            } else {
                this.container.classList.remove('timeline-popout');
                this.container.style.left = '0px';
                this.container.style.display = 'none';
                this.container.setAttribute('aria-hidden', 'true');
            }
            return;
        }

        this.isAutoHidden = false;
        this.isManualOpen = false;
        this.updateRevealButton();

        let preferredLeft = 0;
        if (this.exposureDial) {
            const dialRect = this.exposureDial.getBoundingClientRect();
            preferredLeft = Math.round((dialRect.left + dialRect.width / 2) - timelineWidth / 2);
        }

        const clampedLeft = Math.max(0, Math.min(preferredLeft, maxAllowedLeft));
        this.container.classList.remove('timeline-popout');
        this.container.style.left = `${clampedLeft}px`;
        this.container.style.display = '';
        this.container.setAttribute('aria-hidden', 'false');
    }

    getAnchoredLeft() {
        const anchor = this.revealButton || this.exposureDial;
        const anchorRect = anchor?.getBoundingClientRect();
        const timelineWidth = Math.round(this.container.offsetWidth || 60);

        if (!anchorRect) return 8;

        const viewportPadding = 8;
        const preferredLeft = Math.round((anchorRect.left + anchorRect.width / 2) - timelineWidth / 2);
        const maxLeft = Math.max(viewportPadding, window.innerWidth - timelineWidth - viewportPadding);

        return Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));
    }

    setYearCollapsed(year, collapsed) {
        const state = this.yearGroups.get(Number(year));
        if (!state) return;
        if (collapsed) this.collapsedYears.add(Number(year));
        else this.collapsedYears.delete(Number(year));
        state.groupEl.classList.toggle('collapsed', collapsed);
        state.toggleBtn.textContent = collapsed ? '▸' : '▾';
        state.toggleBtn.setAttribute('aria-label', collapsed ? `Expand ${year}` : `Collapse ${year}`);
        this.updateToggleAllUI();
    }

    areAllYearsCollapsed() {
        if (!this.yearGroups.size) return false;
        return [...this.yearGroups.keys()].every((year) => this.collapsedYears.has(Number(year)));
    }

    updateToggleAllUI() {
        if (!this.toggleAllBtn) return;
        const allCollapsed = this.areAllYearsCollapsed();
        this.toggleAllBtn.textContent = allCollapsed ? '▸' : '▾';
        this.toggleAllBtn.setAttribute(
            'aria-label',
            allCollapsed ? 'Expand all timeline years' : 'Collapse all timeline years'
        );
        this.toggleAllBtn.setAttribute(
            'title',
            allCollapsed ? 'Expand all' : 'Collapse all'
        );
    }

    toggleAllYears() {
        if (!this.yearGroups.size) return;
        const collapse = !this.areAllYearsCollapsed();
        for (const year of this.yearGroups.keys()) {
            this.setYearCollapsed(Number(year), collapse);
        }
        this.updateToggleAllUI();
    }

    getActiveFilters() {
        return {
            country: this.imageService.countryFilter || '',
            location: this.imageService.locationFilter || '',
            takenFrom: this.imageService.takenFromFilter || '',
            takenTo: this.imageService.takenToFilter || ''
        };
    }

    hasActiveFilters() {
        const f = this.getActiveFilters();
        return Boolean(f.country || f.location || f.takenFrom || f.takenTo);
    }

    async fetchTimelineForFilters() {
        const f = this.getActiveFilters();
        const baseUrl = this.imageService.apiBaseUrl;
        const url = new URL(baseUrl ? `${baseUrl}/api/photos/timeline` : '/api/photos/timeline', window.location.origin);
        if (f.country) url.searchParams.set('country', f.country);
        if (f.location) url.searchParams.set('location', f.location);
        if (f.takenFrom) url.searchParams.set('takenFrom', f.takenFrom);
        if (f.takenTo) url.searchParams.set('takenTo', f.takenTo);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            mode: 'cors'
        });
        if (!response.ok) return [];
        const data = await this.imageService.parseJsonResponse(response);
        return Array.isArray(data.groups) ? data.groups : [];
    }

    applyEnabledState(enabledKeys) {
        this.enabledKeys = enabledKeys;
        this.monthElements.forEach((el, key) => {
            const enabled = enabledKeys.has(key);
            el.classList.toggle('disabled', !enabled);
            el.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        });
    }

    async refreshEnabledMonths() {
        if (!this.monthElements.size) return;

        if (!this.hasActiveFilters()) {
            const allKeys = new Set([...this.monthElements.keys()]);
            this.applyEnabledState(allKeys);
            return;
        }

        try {
            const groups = await this.fetchTimelineForFilters();
            const enabled = new Set(groups.map(g => `${g.year}-${g.month}`));
            this.applyEnabledState(enabled);
        } catch (error) {
            console.error('Timeline: failed to refresh enabled months:', error);
        }
    }

    monthAbbr(month) {
        const names = [
            '', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
            'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
        ];
        return names[month] || '';
    }

    imageYearMonth(img) {
        const d = new Date(img.timestamp);
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    }

    async scrollToDate(year, month) {
        year = Number(year);
        month = Number(month);

        const key = `${year}-${month}`;
        this.lockedKey = key;
        this.setActive(key);

        const findTarget = () => {
            return this.imageService.images.findIndex(img => {
                const ym = this.imageYearMonth(img);
                return ym.year === year && ym.month === month;
            });
        };

        let targetIndex = findTarget();

        if (targetIndex === -1 && this.imageService.hasMore) {
            while (this.imageService.hasMore) {
                const added = await this.imageService.loadMorePhotos();
                if (!added || !added.length) break;
                targetIndex = findTarget();
                if (targetIndex !== -1) break;
            }
            this.gallery.cachedLayout = null;
            this.gallery.scheduleRefresh(true);
        }

        if (targetIndex === -1) return;

        this.gallery.cachedLayout = null;
        const layout = this.gallery.getLayout();
        const row = Math.floor(targetIndex / layout.columns);
        const targetY = layout.contentTop + (row * layout.rowSpan);
        window.scrollTo({ top: Math.max(0, targetY - 80), behavior: 'smooth' });
    }

    async scrollToYearEarliest(year) {
        year = Number(year);
        if (!Number.isFinite(year)) return;

        const findLastIndexInYear = () => {
            let last = -1;
            for (let i = 0; i < this.imageService.images.length; i++) {
                const ym = this.imageYearMonth(this.imageService.images[i]);
                if (ym.year === year) {
                    last = i;
                }
            }
            return last;
        };

        let targetIndex = findLastIndexInYear();
        const oldestLoaded = () => this.imageService.images[this.imageService.images.length - 1] || null;

        while (this.imageService.hasMore) {
            const oldest = oldestLoaded();
            if (!oldest) break;
            const oldestYear = this.imageYearMonth(oldest).year;
            if (oldestYear < year) break;
            if (oldestYear > year && targetIndex === -1) {
                const added = await this.imageService.loadMorePhotos();
                if (!added?.length) break;
                targetIndex = findLastIndexInYear();
                continue;
            }
            if (oldestYear === year || targetIndex === -1) {
                const added = await this.imageService.loadMorePhotos();
                if (!added?.length) break;
                targetIndex = findLastIndexInYear();
                continue;
            }
            break;
        }

        if (targetIndex === -1) return;

        const targetImg = this.imageService.images[targetIndex];
        const ym = this.imageYearMonth(targetImg);
        const key = `${ym.year}-${ym.month}`;
        this.lockedKey = key;
        this.setActive(key);

        this.gallery.cachedLayout = null;
        this.gallery.scheduleRefresh(true);
        const layout = this.gallery.getLayout();
        const row = Math.floor(targetIndex / layout.columns);
        const targetY = layout.contentTop + (row * layout.rowSpan);
        window.scrollTo({ top: Math.max(0, targetY - 80), behavior: 'smooth' });
    }

    setActive(key) {
        if (key === this.activeKey) return;
        if (this.enabledKeys.size && !this.enabledKeys.has(key)) return;
        this.activeKey = key;

        this.monthElements.forEach((el, k) => {
            el.classList.toggle('active', k === key);
        });

        const activeEl = this.monthElements.get(key);
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    syncActiveFromScroll() {
        if (this.lockedKey) return;

        const images = this.imageService.images;
        if (!images || images.length === 0 || this.monthElements.size === 0) return;

        const layout = this.gallery.getLayout();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const viewportCenter = scrollTop + window.innerHeight * 0.3;

        const approxRow = Math.max(0, Math.floor((viewportCenter - layout.contentTop) / layout.rowSpan));
        const approxIndex = Math.min(images.length - 1, Math.max(0, approxRow * layout.columns));

        const img = images[approxIndex];
        if (!img) return;

        const ym = this.imageYearMonth(img);
        const key = `${ym.year}-${ym.month}`;

        this.setActive(key);
    }
}

window.Timeline = Timeline;
