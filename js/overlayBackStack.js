/**
 * OverlayBackStack — borrow one same-URL history entry while a fullscreen
 * overlay is open so Android/iOS back dismisses it instead of leaving the
 * site. The address bar never changes.
 *
 * Opening another overlay in the same turn (photo → globe) replaces that
 * entry instead of stacking, matching the existing "one overlay at a time"
 * UI. Dismissing via the UI pops the borrowed entry so the next back still
 * leaves the gallery.
 */
class OverlayBackStack {
    constructor(historyApi, locationApi, eventTarget) {
        this._history = historyApi || (typeof history !== 'undefined' ? history : null);
        this._location = locationApi || (typeof location !== 'undefined' ? location : null);
        this._target = eventTarget || (typeof window !== 'undefined' ? window : null);
        this._layer = null;
        this._owned = 0;
        this._ignorePop = 0;
        this._syncQueued = false;
        this._onPop = () => this._handlePop();

        this._target?.addEventListener?.('popstate', this._onPop);
    }

    /**
     * @returns {string|null} Key of the overlay currently occupying history
     */
    get activeKey() {
        return this._layer?.key || null;
    }

    /**
     * Occupy the single borrowed history entry. Claiming the same key again
     * only refreshes the dismiss callback (photo → photo).
     * @param {string} key
     * @param {Function} dismiss
     */
    claim(key, dismiss) {
        if (!key) {
            return;
        }
        if (this._layer?.key === key) {
            this._layer.dismiss = dismiss;
            return;
        }
        this._layer = { key, dismiss };
        this._queueSync();
    }

    /**
     * Overlay closed from the UI. Pops the borrowed entry on the next
     * microtask so a same-turn claim can replace it instead.
     * @param {string} key
     */
    release(key) {
        if (!key || this._layer?.key !== key) {
            return;
        }
        this._layer = null;
        this._queueSync();
    }

    destroy() {
        this._target?.removeEventListener?.('popstate', this._onPop);
        this._layer = null;
        this._owned = 0;
        this._ignorePop = 0;
        this._syncQueued = false;
    }

    _queueSync() {
        if (this._syncQueued) {
            return;
        }
        this._syncQueued = true;
        const run = () => {
            this._syncQueued = false;
            this._sync();
        };
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(run);
        } else {
            Promise.resolve().then(run);
        }
    }

    _sync() {
        if (!this._history) {
            return;
        }
        const want = Boolean(this._layer);
        try {
            if (want && this._owned === 0) {
                this._history.pushState(this._stateFor(this._layer.key), '');
                this._owned = 1;
                return;
            }
            if (want && this._owned === 1) {
                this._history.replaceState(this._stateFor(this._layer.key), '');
                return;
            }
            if (!want && this._owned === 1) {
                this._ignorePop += 1;
                this._owned = 0;
                this._history.back();
            }
        } catch (error) {
            console.warn('OverlayBackStack: history is unavailable', error);
        }
    }

    _stateFor(key) {
        const current = this._history.state && typeof this._history.state === 'object'
            ? this._history.state
            : {};
        return Object.assign({}, current, { __mirrorOverlay: key });
    }

    _handlePop() {
        if (this._ignorePop > 0) {
            this._ignorePop -= 1;
            return;
        }
        this._owned = 0;
        const layer = this._layer;
        this._layer = null;
        if (typeof layer?.dismiss === 'function') {
            layer.dismiss();
        }
    }
}

if (typeof window !== 'undefined') {
    window.OverlayBackStack = OverlayBackStack;
    if (!window.overlayBackStack) {
        window.overlayBackStack = new OverlayBackStack();
    }
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OverlayBackStack;
}
