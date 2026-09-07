/**
 * CONTROL — a quarter-circle radial menu anchored to the bottom-right corner.
 *
 * Geometry: every layer is a circle centred exactly on the viewport corner, so
 * only its top-left quadrant is visible and concentric radii read as
 * interlocking arcs. Node placement is polar: an angle of 0° runs left along
 * the bottom edge and 90° runs up the right edge.
 *
 *   hub  → open/close
 *   ring A → sections (filter, layout, order, exposure)
 *   ring B → that section's options
 *   ring C → leaf values, rotatable when the list is longer than the arc
 */

const CM_BASE = {
    hub: 78,
    ringA: 172,
    ringB: 262,
    ringC: 350,
    outer: 410,
    nodeA: 56,
    nodeB: 54,
    // The leaf ring carries place names, so its nodes are sized to hold two
    // short words rather than to pack the arc.
    nodeC: 78
};

/* Leaf arc limits. The paging handles live just outside them at each end. */
const LEAF_TOP = 76;
const LEAF_BOTTOM = 14;

const SECTIONS = [
    { id: 'filter', label: 'FILTER' },
    { id: 'layout', label: 'LAYOUT' },
    { id: 'order', label: 'ORDER' },
    { id: 'exposure', label: 'EXPOSE' }
];

const FILTER_TYPES = [
    { id: 'country', label: 'COUNTRY' },
    { id: 'state', label: 'REGION' },
    { id: 'location', label: 'PLACE' }
];

class ControlMenu {
    constructor({ gallery, viewMode, globeExplorer, imageService }) {
        this.gallery = gallery;
        this.viewMode = viewMode;
        this.globeExplorer = globeExplorer;
        this.imageService = imageService;

        this.root = document.getElementById('control-menu');
        if (!this.root) return;

        this.hub = document.getElementById('cm-hub');
        this.sectorLayer = document.getElementById('cm-sectors');
        this.optionLayer = document.getElementById('cm-options');
        this.leafLayer = document.getElementById('cm-leaf');
        this.readout = document.getElementById('cm-readout');

        this.isOpen = false;
        this.isAnimating = false;
        this.phaseTimer = null;
        this.section = null;
        this.filterType = 'country';
        this.leafOffset = 0;
        this.leafStep = 13;
        this.hoverLabel = '';
        this.scale = 1;
        this.geometry = { ...CM_BASE };

        this.slideMs = 380;
        this.expandMs = 520;

        this.applyGeometry();
        this.bindEvents();
        this.render();
    }

    // ── geometry ──

    /**
     * The menu is sized to the smaller viewport dimension so the outermost
     * ring always stays on screen; every radius and node scales together.
     */
    applyGeometry() {
        const limit = Math.min(
            window.innerWidth * 0.92,
            window.innerHeight * 0.84,
            CM_BASE.outer
        );
        this.scale = Math.max(0.55, limit / CM_BASE.outer);

        const g = {};
        for (const [key, value] of Object.entries(CM_BASE)) {
            g[key] = value * this.scale;
        }
        this.geometry = g;

        this.root.style.setProperty('--cm-r-hub', `${g.hub}px`);
        this.root.style.setProperty('--cm-r-a', `${g.ringA}px`);
        this.root.style.setProperty('--cm-r-b', `${g.ringB}px`);
        this.root.style.setProperty('--cm-r-c', `${g.ringC}px`);
        this.root.style.setProperty('--cm-radius', `${g.outer}px`);
    }

    /**
     * Place a node at polar (radius, angle) measured from the corner.
     */
    place(el, radius, angleDeg, size) {
        const rad = (angleDeg * Math.PI) / 180;
        el.style.right = `${radius * Math.cos(rad) - size / 2}px`;
        el.style.bottom = `${radius * Math.sin(rad) - size / 2}px`;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
    }

    /**
     * Spread n nodes across the quadrant, first item nearest the right edge
     * so the list reads top-to-bottom.
     */
    anglesFor(count, pad = 14) {
        if (count <= 0) return [];
        if (count === 1) return [45];
        const lo = pad;
        const hi = 90 - pad;
        const step = (hi - lo) / (count - 1);
        return Array.from({ length: count }, (_, i) => hi - i * step);
    }

    // ── events ──

    bindEvents() {
        this.hub.addEventListener('click', () => this.toggle());

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isOpen && !this.isAnimating) {
                event.preventDefault();
                this.close();
                this.hub.focus();
            }
        });

        document.addEventListener('pointerdown', (event) => {
            if (!this.isOpen || this.isAnimating) return;
            if (this.root.contains(event.target)) return;
            this.close();
        });

        window.addEventListener('resize', () => {
            this.applyGeometry();
            this.render();
        }, { passive: true });

        // Wheel over the leaf ring rotates it through a long option list.
        this.leafLayer.addEventListener('wheel', (event) => {
            if (!this.leafItems || this.leafItems.length <= this.leafCapacity) return;
            event.preventDefault();
            this.rotateLeaf(event.deltaY > 0 ? 1 : -1);
        }, { passive: false });

        document.addEventListener('exposureChange', () => this.renderOptions());
        document.addEventListener('viewModeChange', () => this.renderOptions());
        document.addEventListener('galleryLayoutChange', () => this.renderOptions());
        document.addEventListener('galleryFilterChange', () => {
            this.syncFilterState();
            this.render();
        });
    }

    toggle() {
        if (this.isAnimating) return;
        if (this.isOpen) this.close();
        else this.open();
    }

    prefersReducedMotion() {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    }

    clearPhase() {
        if (this.phaseTimer != null) {
            window.clearTimeout(this.phaseTimer);
            this.phaseTimer = null;
        }
    }

    after(ms, fn) {
        this.clearPhase();
        if (ms <= 0) {
            fn();
            return;
        }
        this.phaseTimer = window.setTimeout(() => {
            this.phaseTimer = null;
            fn();
        }, ms);
    }

    /**
     * Closed rest is a floating orb. Opening docks it down-right, then the
     * quarter-circle expands. Closing reverses that: shrink, then slide home.
     */
    open() {
        if (this.isOpen || this.isAnimating) return;
        this.isOpen = true;
        this.isAnimating = true;
        this.hub.setAttribute('aria-expanded', 'true');
        this.hub.setAttribute('aria-label', 'Close control menu');

        const instant = this.prefersReducedMotion();
        this.root.classList.add('is-docked');

        this.after(instant ? 0 : this.slideMs, () => {
            this.root.classList.remove('collapsed');
            this.render();
            this.after(instant ? 0 : this.expandMs, () => {
                this.isAnimating = false;
            });
        });
    }

    close() {
        if (!this.isOpen || this.isAnimating) return;
        this.isOpen = false;
        this.isAnimating = true;
        this.section = null;
        this.root.classList.add('collapsed');
        this.root.dataset.section = '';
        this.hub.setAttribute('aria-expanded', 'false');
        this.hub.setAttribute('aria-label', 'Open control menu');
        this.render();

        const instant = this.prefersReducedMotion();
        this.after(instant ? 0 : this.expandMs, () => {
            this.root.classList.remove('is-docked');
            this.after(instant ? 0 : this.slideMs, () => {
                this.isAnimating = false;
            });
        });
    }

    async selectSection(id) {
        this.section = this.section === id ? null : id;
        this.root.dataset.section = this.section || '';
        this.leafOffset = 0;

        if (this.section === 'filter') {
            await this.ensureFilterData();
        }
        this.render();
    }

    async ensureFilterData() {
        if (!this.globeExplorer || this.globeExplorer.hasFilterData) return;
        this.setReadout('LOADING PLACES');
        try {
            await this.globeExplorer.ensureFilterData();
        } catch (error) {
            console.error('ControlMenu: failed to load filter data', error);
        }
        this.render();
    }

    syncFilterState() {
        const filters = this.globeExplorer?.getSelectedFilters?.() || {};
        const active = Boolean(filters.country || filters.state || filters.location);
        this.root.classList.toggle('has-filter', active);
    }

    // ── rendering ──

    render() {
        this.syncFilterState();
        this.renderSections();
        this.renderOptions();
        this.renderReadout();
    }

    /**
     * Type size for a node. A circle only offers its diameter at the middle,
     * so a label is sized to keep its longest *word* on one line — otherwise
     * names like COUNTRY break as "COUNT / RY".
     */
    fitFont(size, label) {
        const longest = String(label || '')
            .split(/\s+/)
            .reduce((max, word) => Math.max(max, word.length), 1);
        // Helvetica caps plus the 0.04em tracking run about 0.78em per glyph.
        const byWord = (size - 10) / (longest * 0.78);
        return Math.max(6.5, Math.min(size * 0.2, 11, byWord));
    }

    node({ label, sub, size, radius, angle, active, open, title, onClick, onHover }) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cm-node';
        btn.style.fontSize = `${this.fitFont(size, label)}px`;

        const text = document.createElement('span');
        text.className = 'cm-sector-label';
        text.textContent = label;
        btn.appendChild(text);

        if (sub) {
            const count = document.createElement('span');
            count.className = 'cm-node-count';
            count.textContent = sub;
            btn.appendChild(count);
            btn.style.flexDirection = 'column';
        }

        if (active) btn.classList.add('is-active');
        if (open) btn.classList.add('is-open');
        if (title) {
            btn.title = title;
            btn.setAttribute('aria-label', title);
        }

        this.place(btn, radius, angle, size);

        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick();
        });
        if (onHover) {
            btn.addEventListener('pointerenter', () => onHover());
            btn.addEventListener('focus', () => onHover());
            btn.addEventListener('pointerleave', () => this.setHover(''));
            btn.addEventListener('blur', () => this.setHover(''));
        }

        return btn;
    }

    renderSections() {
        this.sectorLayer.innerHTML = '';
        if (!this.isOpen) return;

        const angles = this.anglesFor(SECTIONS.length, 12);
        SECTIONS.forEach((section, index) => {
            const node = this.node({
                label: section.label,
                size: this.geometry.nodeA,
                radius: this.geometry.ringA,
                angle: angles[index],
                // Drilled-in sections read as outlined, never filled: the
                // solid fill is reserved for the value actually in effect,
                // so a glance at the menu shows state rather than navigation.
                open: this.section === section.id,
                title: `${section.label} options`,
                onClick: () => this.selectSection(section.id)
            });
            node.setAttribute('role', 'tab');
            node.setAttribute('aria-selected', this.section === section.id ? 'true' : 'false');
            this.sectorLayer.appendChild(node);
        });
    }

    renderOptions() {
        if (!this.optionLayer) return;
        this.optionLayer.innerHTML = '';
        this.leafLayer.innerHTML = '';
        this.leafItems = null;

        if (!this.isOpen || !this.section) {
            this.renderReadout();
            return;
        }

        switch (this.section) {
            case 'filter':
                this.renderFilterOptions();
                break;
            case 'layout':
                this.renderLayoutOptions();
                break;
            case 'order':
                this.renderOrderOptions();
                break;
            case 'exposure':
                this.renderExposureOptions();
                break;
            default:
                break;
        }

        this.renderReadout();
    }

    renderFilterOptions() {
        const filters = this.globeExplorer?.getSelectedFilters?.() || {};
        const entries = [...FILTER_TYPES.map((t) => ({ ...t })), { id: 'clear', label: 'CLEAR' }];
        const angles = this.anglesFor(entries.length, 10);

        entries.forEach((entry, index) => {
            if (entry.id === 'clear') {
                const hasFilter = Boolean(filters.country || filters.state || filters.location);
                const node = this.node({
                    label: 'CLEAR',
                    size: this.geometry.nodeB,
                    radius: this.geometry.ringB,
                    angle: angles[index],
                    title: 'Clear all filters',
                    onClick: () => this.globeExplorer?.clearFilters?.()
                });
                node.disabled = !hasFilter;
                node.style.opacity = hasFilter ? '' : '0.35';
                this.optionLayer.appendChild(node);
                return;
            }

            const selected = filters[entry.id];
            const node = this.node({
                label: entry.label,
                sub: selected ? this.shorten(selected, 12) : '',
                size: this.geometry.nodeB,
                radius: this.geometry.ringB,
                angle: angles[index],
                active: Boolean(selected),
                open: this.filterType === entry.id,
                title: selected ? `${entry.label}: ${selected}` : `Filter by ${entry.label.toLowerCase()}`,
                onClick: () => {
                    this.filterType = entry.id;
                    this.leafOffset = 0;
                    this.renderOptions();
                }
            });
            this.optionLayer.appendChild(node);
        });

        this.renderFilterLeaf();
    }

    renderFilterLeaf() {
        const options = this.globeExplorer?.getFilterOptions?.(this.filterType) || [];
        this.leafItems = options;

        if (!options.length) {
            this.leafLayer.appendChild(this.emptyLeafHint());
            return;
        }

        const size = this.geometry.nodeC;
        const radius = this.geometry.ringC;
        // Angular pitch that keeps neighbouring nodes from touching.
        this.leafStep = Math.max(10, ((size * 1.12) / radius) * (180 / Math.PI));
        // The arc stops short of both edges so the paging handles have room
        // at the ends without clipping against the viewport.
        const top = LEAF_TOP;
        const bottom = LEAF_BOTTOM;
        this.leafCapacity = Math.max(1, Math.floor((top - bottom) / this.leafStep) + 1);
        this.leafOffset = Math.max(0, Math.min(this.leafOffset, Math.max(0, options.length - this.leafCapacity)));

        const filters = this.globeExplorer?.getSelectedFilters?.() || {};

        options.forEach((item, index) => {
            const angle = top - (index - this.leafOffset) * this.leafStep;
            if (angle < bottom - 1 || angle > top + 1) return;

            const isActive = filters[this.filterType] === item.value;
            const node = this.node({
                label: this.shorten(item.label, 16),
                sub: String(item.count),
                size,
                radius,
                angle,
                active: isActive,
                title: `${item.label} — ${item.count} photo${item.count === 1 ? '' : 's'}`,
                onClick: () => {
                    if (isActive) {
                        this.globeExplorer?.clearFilters?.();
                        return;
                    }
                    this.globeExplorer?.applyFilterOption?.(this.filterType, item);
                },
                onHover: () => this.setHover(`${item.label} · ${item.count}`)
            });
            this.leafLayer.appendChild(node);
        });

        if (options.length > this.leafCapacity) {
            const page = Math.max(1, this.leafCapacity - 1);
            this.leafLayer.appendChild(this.rotateHandle(-page, 87.5, this.leafOffset > 0));
            const atEnd = this.leafOffset >= options.length - this.leafCapacity;
            this.leafLayer.appendChild(this.rotateHandle(page, 4.5, !atEnd));
        }
    }

    /**
     * Handles page by a screenful; the wheel still steps one at a time.
     */
    rotateHandle(delta, angle, enabled) {
        const size = Math.max(20, 24 * this.scale);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cm-node cm-node-rotate';
        btn.textContent = delta < 0 ? '\u2191' : '\u2193';
        btn.style.fontSize = `${Math.max(9, 12 * this.scale)}px`;
        btn.title = delta < 0 ? 'Previous options' : 'More options';
        btn.setAttribute('aria-label', btn.title);
        btn.disabled = !enabled;
        if (!enabled) btn.style.opacity = '0.25';
        this.place(btn, this.geometry.ringC, angle, size);
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            this.rotateLeaf(delta);
        });
        return btn;
    }

    rotateLeaf(delta) {
        const total = this.leafItems?.length || 0;
        const max = Math.max(0, total - (this.leafCapacity || 1));
        const next = Math.max(0, Math.min(max, this.leafOffset + delta));
        if (next === this.leafOffset) return;
        this.leafOffset = next;
        this.renderFilterLeafOnly();
    }

    renderFilterLeafOnly() {
        this.leafLayer.innerHTML = '';
        this.renderFilterLeaf();
    }

    emptyLeafHint() {
        const hint = document.createElement('div');
        hint.className = 'cm-leaf-hint';
        hint.textContent = this.globeExplorer?.hasFilterData ? 'NO OPTIONS' : 'LOADING';
        this.place(hint, this.geometry.ringC, 45, this.geometry.nodeC * 1.6);
        return hint;
    }

    renderLayoutOptions() {
        const mode = this.gallery?.layoutMode || 'grid';
        const modes = [
            { id: 'grid', label: 'GRID' },
            { id: 'masonry', label: 'MASONRY' }
        ];
        const angles = this.anglesFor(modes.length, 22);

        modes.forEach((entry, index) => {
            this.optionLayer.appendChild(this.node({
                label: entry.label,
                size: this.geometry.nodeB,
                radius: this.geometry.ringB,
                angle: angles[index],
                active: mode === entry.id,
                title: entry.id === 'masonry'
                    ? 'Masonry: keep each photo\u2019s true proportions'
                    : 'Grid: uniform 4:3 tiles',
                onClick: () => this.gallery?.setLayoutMode(entry.id)
            }));
        });

        this.renderColumnLeaf();
    }

    renderColumnLeaf() {
        if (window.innerWidth <= 768) {
            const hint = document.createElement('div');
            hint.className = 'cm-leaf-hint';
            hint.textContent = 'COLUMNS AUTO';
            this.place(hint, this.geometry.ringC, 45, this.geometry.nodeC * 1.8);
            this.leafLayer.appendChild(hint);
            return;
        }

        const counts = [2, 3, 4, 5, 6];
        const angles = this.anglesFor(counts.length, 12);
        const current = this.gallery?.columns;

        counts.forEach((count, index) => {
            this.leafLayer.appendChild(this.node({
                label: String(count),
                size: this.geometry.nodeC * 0.72,
                radius: this.geometry.ringC,
                angle: angles[index],
                active: current === count,
                title: `${count} columns`,
                onClick: () => this.gallery?.setColumns(count),
                onHover: () => this.setHover(`${count} COLUMNS`)
            }));
        });
    }

    renderOrderOptions() {
        const mode = this.viewMode?.mode || 'chrono';
        const modes = [
            { id: 'chrono', label: 'CHRONO' },
            { id: 'random', label: 'SHUFFLE' }
        ];
        const angles = this.anglesFor(modes.length, 22);

        modes.forEach((entry, index) => {
            this.optionLayer.appendChild(this.node({
                label: entry.label,
                size: this.geometry.nodeB,
                radius: this.geometry.ringB,
                angle: angles[index],
                active: mode === entry.id,
                title: entry.id === 'random' ? 'Shuffle the gallery' : 'Newest first',
                onClick: () => this.viewMode?.setMode(entry.id, { forceRefresh: entry.id === 'random' })
            }));
        });
    }

    renderExposureOptions() {
        const values = [3, 2, 1, 0, -1, -2, -3];
        const angles = this.anglesFor(values.length, 8);
        const current = window.exposureDial?.getExposure?.();

        values.forEach((value, index) => {
            this.optionLayer.appendChild(this.node({
                label: value > 0 ? `+${value}` : String(value),
                size: this.geometry.nodeB * 0.82,
                radius: this.geometry.ringB,
                angle: angles[index],
                active: current === value,
                title: `Exposure ${value > 0 ? `+${value}` : value}`,
                onClick: () => window.exposureDial?.setExposure(value),
                onHover: () => this.setHover(`EV ${value > 0 ? `+${value}` : value}`)
            }));
        });
    }

    // ── readout ──

    setHover(label) {
        this.hoverLabel = label;
        this.renderReadout();
    }

    setReadout(text) {
        if (this.readout) this.readout.textContent = text;
    }

    renderReadout() {
        if (!this.readout) return;

        if (this.hoverLabel) {
            this.readout.textContent = this.hoverLabel;
            return;
        }

        const parts = [];
        const filterLabel = this.globeExplorer?.getActiveFilterLabel?.() || 'ALL';
        parts.push(filterLabel === 'ALL' ? 'ALL PHOTOS' : filterLabel);

        if (this.gallery) {
            const mode = this.gallery.layoutMode === 'masonry' ? 'MASONRY' : 'GRID';
            parts.push(window.innerWidth > 768 ? `${mode} ${this.gallery.columns}` : mode);
        }
        if (this.viewMode?.mode === 'random') {
            parts.push('SHUFFLED');
        }

        this.readout.textContent = parts.join('  ·  ');
    }

    shorten(value, max) {
        const text = String(value || '').toUpperCase();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }
}

window.ControlMenu = ControlMenu;
