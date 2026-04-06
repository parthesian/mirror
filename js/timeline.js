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
        this.groups = [];
        this.activeKey = null;
        this.monthElements = new Map();

        if (!this.container) return;

        this.fetchTimeline();
        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('scroll', () => this.scheduleSync(), { passive: true });
        document.addEventListener('galleryUpdated', () => this.syncActiveFromScroll());
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
        } catch (error) {
            console.error('Timeline: failed to load timeline data:', error);
        }
    }

    render() {
        if (!this.container || this.groups.length === 0) return;

        this.monthElements.clear();
        this.container.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'timeline-list';

        const line = document.createElement('div');
        line.className = 'timeline-line';
        list.appendChild(line);

        let currentYear = null;

        for (const group of this.groups) {
            if (group.year !== currentYear) {
                currentYear = group.year;
                const yearEl = document.createElement('div');
                yearEl.className = 'timeline-year';
                yearEl.textContent = currentYear;
                list.appendChild(yearEl);
            }

            const monthEl = document.createElement('div');
            monthEl.className = 'timeline-month';
            monthEl.textContent = this.monthAbbr(group.month);
            monthEl.dataset.year = group.year;
            monthEl.dataset.month = group.month;

            monthEl.addEventListener('click', () => {
                this.scrollToDate(group.year, group.month);
            });

            const key = `${group.year}-${group.month}`;
            this.monthElements.set(key, monthEl);
            list.appendChild(monthEl);
        }

        this.container.appendChild(list);
        this.syncActiveFromScroll();
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

    syncActiveFromScroll() {
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

        if (key === this.activeKey) return;
        this.activeKey = key;

        this.monthElements.forEach((el, k) => {
            el.classList.toggle('active', k === key);
        });

        const activeEl = this.monthElements.get(key);
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

window.Timeline = Timeline;
