/**
 * OverlayLifecycle owns `hidden`, `active`, `is-exiting`, and body overflow
 * for one overlay. Callers never write those classes.
 *
 * Entering from closed removes `hidden`, reads computed opacity, then adds
 * `active`. A single animation frame is not enough. Chromium and Firefox
 * paint the first frame at opacity 1 unless style is flushed between the
 * two class changes. `focus()` also flushes, which hides the bug.
 */
class OverlayLifecycle {
    static visible = new Set();

    /**
     * @param {HTMLElement} element
     * @param {{ onClosed?: () => void }} [options]
     */
    constructor(element, options = {}) {
        this.element = element;
        this.onClosed = options.onClosed || null;
        this.phase = 'closed';
        this._token = 0;
        this._pending = null;
        this._onEnd = null;
        this._timer = 0;
    }

    /** @returns {boolean} True while the overlay is entering or fully open. */
    get isOpen() {
        return this.phase === 'opening' || this.phase === 'open';
    }

    /** @returns {boolean} True while the exit transition is in flight. */
    get isClosing() {
        return this.phase === 'closing';
    }

    /**
     * Fade in, or reverse an in-flight fade out.
     * Resolves when the opacity transition settles or a later call supersedes it.
     * @returns {Promise<void>}
     */
    open() {
        const el = this.element;
        if (!el) return Promise.resolve();
        if (this.phase === 'opening' || this.phase === 'open') {
            return Promise.resolve();
        }
        const fromClosing = this.phase === 'closing';
        this._supersede();
        this.phase = 'opening';
        OverlayLifecycle.visible.add(this);
        this._syncOverflow();
        if (!fromClosing) {
            el.classList.remove('hidden');
            void getComputedStyle(el).opacity;
        }
        el.classList.remove('is-exiting');
        el.classList.add('active');
        if (this._opacityMs() <= 0) {
            this.phase = 'open';
            return Promise.resolve();
        }
        return this._arm('open');
    }

    /**
     * Fade out. Duration 0 (reduced motion) hides the overlay before the next paint.
     * `onClosed` runs only when this close settles, not when a reopen supersedes it.
     * @returns {Promise<void>}
     */
    close() {
        const el = this.element;
        if (!el || this.phase === 'closed') return Promise.resolve();
        if (this.phase === 'closing') {
            return this._pending ? this._pending.promise : Promise.resolve();
        }
        this._supersede();
        this.phase = 'closing';
        el.classList.remove('active');
        el.classList.add('is-exiting');
        if (this._opacityMs() <= 0) {
            this._finishClose();
            return Promise.resolve();
        }
        return this._arm('close');
    }

    /**
     * @param {'open'|'close'} kind
     * @returns {Promise<void>}
     */
    _arm(kind) {
        const token = ++this._token;
        let resolve;
        const promise = new Promise((done) => {
            resolve = done;
        });
        this._pending = { token, resolve, promise };
        const finish = () => {
            if (!this._pending || this._pending.token !== token) return;
            this._pending = null;
            this._detach();
            try {
                if (kind === 'close') {
                    if (this.phase === 'closing') this._finishClose();
                } else if (this.phase === 'opening') {
                    this.phase = 'open';
                }
            } finally {
                resolve();
            }
        };
        this._onEnd = (event) => {
            if (event.target !== this.element) return;
            if (event.propertyName !== 'opacity') return;
            finish();
        };
        this.element.addEventListener('transitionend', this._onEnd);
        this._timer = setTimeout(finish, this._opacityMs() + 50);
        return promise;
    }

    _supersede() {
        const pending = this._pending;
        this._pending = null;
        this._detach();
        if (pending) pending.resolve();
    }

    _detach() {
        if (this._onEnd && this.element) {
            this.element.removeEventListener('transitionend', this._onEnd);
        }
        this._onEnd = null;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = 0;
        }
    }

    _finishClose() {
        this.phase = 'closed';
        this.element.classList.remove('active', 'is-exiting');
        this.element.classList.add('hidden');
        OverlayLifecycle.visible.delete(this);
        this._syncOverflow();
        if (this.onClosed) this.onClosed();
    }

    _syncOverflow() {
        if (typeof document === 'undefined' || !document.body) return;
        document.body.style.overflow = OverlayLifecycle.visible.size > 0 ? 'hidden' : '';
    }

    /**
     * Opacity transition time in milliseconds. Zero means the change is instant.
     * @returns {number}
     */
    _opacityMs() {
        const style = getComputedStyle(this.element);
        const props = style.transitionProperty.split(',').map((part) => part.trim());
        if (props.length === 1 && (props[0] === 'none' || props[0] === '')) return 0;
        const durations = style.transitionDuration.split(',').map((part) => OverlayLifecycle._cssMs(part));
        let max = 0;
        const count = Math.max(props.length, durations.length);
        for (let i = 0; i < count; i += 1) {
            const prop = props[Math.min(i, props.length - 1)];
            if (prop !== 'opacity' && prop !== 'all') continue;
            const duration = durations[Math.min(i, durations.length - 1)] || 0;
            if (duration > max) max = duration;
        }
        return max;
    }

    /**
     * @param {string} token
     * @returns {number}
     */
    static _cssMs(token) {
        const value = String(token || '').trim();
        if (value.endsWith('ms')) return parseFloat(value) || 0;
        if (value.endsWith('s')) return (parseFloat(value) || 0) * 1000;
        return 0;
    }
}

if (typeof window !== 'undefined') {
    window.OverlayLifecycle = OverlayLifecycle;
}
