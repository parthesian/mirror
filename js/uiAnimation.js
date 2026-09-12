/**
 * Tracks whether a gallery-wide animation is running. Scopes nest, so a
 * randomize that triggers a layout morph only ends once both have finished.
 * The control menu stays under user control while this is active.
 */
const UIAnimation = {
    depth: 0,
    watchdog: null,

    // No gallery animation runs anywhere near this long, so a hung scope
    // is cleared rather than left open.
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
