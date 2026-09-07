/**
 * Tracks whether a gallery-wide animation is running so chrome can get out
 * of the way. Scopes nest, so a randomize that triggers a layout morph only
 * restores the chrome once both have finished.
 */
const UIAnimation = {
    depth: 0,

    begin() {
        this.depth += 1;
        if (this.depth === 1) {
            document.body.classList.add('ui-animating');
            document.dispatchEvent(new CustomEvent('uiAnimationStart'));
        }
    },

    end() {
        if (this.depth === 0) return;
        this.depth -= 1;
        if (this.depth === 0) {
            document.body.classList.remove('ui-animating');
            document.dispatchEvent(new CustomEvent('uiAnimationEnd'));
        }
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
