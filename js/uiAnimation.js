/**
 * Tracks whether a gallery-wide animation is running so chrome can get out
 * of the way. Scopes nest, so a randomize that triggers a layout morph only
 * restores the chrome once both have finished.
 */
const UIAnimation = {
    depth: 0,
    watchdog: null,

    // While a scope is open the chrome is nearly transparent. No gallery
    // animation runs anywhere near this long, so if one never reports back
    // the controls are restored rather than left invisible.
    MAX_MS: 6000,

    begin() {
        this.depth += 1;
        if (this.depth === 1) {
            document.body.classList.add('ui-animating');
            document.dispatchEvent(new CustomEvent('uiAnimationStart'));
            this.watchdog = window.setTimeout(() => this.reset(), this.MAX_MS);
        }
    },

    end() {
        if (this.depth === 0) return;
        this.depth -= 1;
        if (this.depth === 0) this.reset();
    },

    reset() {
        window.clearTimeout(this.watchdog);
        this.watchdog = null;
        if (this.depth === 0 && !document.body.classList.contains('ui-animating')) return;
        this.depth = 0;
        document.body.classList.remove('ui-animating');
        document.dispatchEvent(new CustomEvent('uiAnimationEnd'));
    },

    get isRunning() {
        return this.depth > 0;
    },

    async run(task) {
        this.begin();
        try {
            return await task();
        } finally {
            this.end();
        }
    }
};

window.UIAnimation = UIAnimation;
