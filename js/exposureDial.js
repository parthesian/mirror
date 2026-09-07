/**
 * Exposure state.
 *
 * The dial itself now lives in the radial CONTROL menu, so this class owns
 * the value, the persisted preference and the body theme class, and renders
 * nothing. Anything that wants to drive exposure calls setExposure().
 */
class ExposureDial {
    constructor() {
        this.exposureValues = [-3, -2, -1, 0, 1, 2, 3];
        this.currentExposure = -3;

        if (!this.loadExposurePreference()) {
            this.setExposure(-3);
        }

        document.addEventListener('keydown', this.handleKeyDown.bind(this));
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
                newExposure = Math.min(3, this.currentExposure + 1);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                newExposure = Math.max(-3, this.currentExposure - 1);
                break;
            default:
                return;
        }

        if (newExposure !== this.currentExposure) {
            this.setExposure(newExposure);
        }
    }

    setExposure(value) {
        const next = Number(value);
        if (!this.exposureValues.includes(next)) {
            console.warn(`Invalid exposure value: ${value}`);
            return;
        }

        this.currentExposure = next;
        this.applyTheme(next);
        this.storeExposurePreference(next);
        this.dispatchExposureChangeEvent(next);
    }

    applyTheme(exposure) {
        for (const value of this.exposureValues) {
            document.body.classList.remove(`exposure-${value}`);
        }
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
                const value = parseInt(stored, 10);
                if (this.exposureValues.includes(value)) {
                    this.setExposure(value);
                    return true;
                }
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
        this.setExposure(Math.min(3, this.currentExposure + 1));
    }

    decreaseExposure() {
        this.setExposure(Math.max(-3, this.currentExposure - 1));
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
