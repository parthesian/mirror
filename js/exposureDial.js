/**
 * Exposure state.
 *
 * Three looks: dark (-1, the old -3 black), gray (0), and light (+1, the
 * old +3 white). The dial itself lives in the radial CONTROL menu.
 */
class ExposureDial {
    constructor() {
        this.exposureValues = [-1, 0, 1];
        this.currentExposure = -1;

        if (!this.loadExposurePreference()) {
            this.setExposure(-1);
        }

        document.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    normalize(value) {
        const next = Number(value);
        if (Number.isNaN(next)) {
            return -1;
        }
        if (next < 0) {
            return -1;
        }
        if (next > 0) {
            return 1;
        }
        return 0;
    }

    handleKeyDown(e) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            return;
        }
        if (window.app?.modal?.isModalOpen()) {
            return;
        }

        let newExposure = this.currentExposure;

        switch (e.key) {
            case 'ArrowRight':
                e.preventDefault();
                newExposure = Math.min(1, this.currentExposure + 1);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                newExposure = Math.max(-1, this.currentExposure - 1);
                break;
            default:
                return;
        }

        if (newExposure !== this.currentExposure) {
            this.setExposure(newExposure);
        }
    }

    setExposure(value) {
        const next = this.normalize(value);

        this.currentExposure = next;
        this.applyTheme(next);
        this.storeExposurePreference(next);
        this.dispatchExposureChangeEvent(next);
    }

    applyTheme(exposure) {
        document.body.classList.remove(
            'exposure--3',
            'exposure--2',
            'exposure--1',
            'exposure-0',
            'exposure-1',
            'exposure-2',
            'exposure-3'
        );
        document.body.classList.add(`exposure-${exposure}`);
    }

    storeExposurePreference(value) {
        try {
            localStorage.setItem('mirror-exposure', value.toString());
        } catch (e) {
            console.warn('Could not store exposure preference:', e);
        }
    }

    loadExposurePreference() {
        try {
            const stored = localStorage.getItem('mirror-exposure');
            if (stored !== null) {
                this.setExposure(stored);
                return true;
            }
        } catch (e) {
            console.warn('Could not load exposure preference:', e);
        }
        return false;
    }

    dispatchExposureChangeEvent(value) {
        document.dispatchEvent(new CustomEvent('exposureChange', {
            detail: { exposure: value }
        }));
    }

    getExposure() {
        return this.currentExposure;
    }

    increaseExposure() {
        this.setExposure(Math.min(1, this.currentExposure + 1));
    }

    decreaseExposure() {
        this.setExposure(Math.max(-1, this.currentExposure - 1));
    }

    resetExposure() {
        this.setExposure(0);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.exposureDial = new ExposureDial();
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExposureDial;
}
