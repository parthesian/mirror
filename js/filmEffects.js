/**
 * FilmEffects - Controls animated light-leak behavior.
 */
class FilmEffects {
    constructor() {
        this.scrollRaf = null;
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this._bindEvents();
        this._applyExposure(this._currentExposure());
        this._updateScrollRatio();
    }

    _currentExposure() {
        const m = document.body.className.match(/exposure-([-\d]+)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    _bindEvents() {
        document.addEventListener('exposureChange', (e) => {
            this._applyExposure(e.detail.exposure);
        });

        let ticking = false;
        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(() => {
                    this._updateScrollRatio();
                    ticking = false;
                });
            }
        }, { passive: true });

        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            this.reducedMotion = e.matches;
        });
    }

    _applyExposure(exp) {
        document.body.style.setProperty('--film-exposure', exp);
    }

    _updateScrollRatio() {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = docHeight > 0 ? Math.min(1, window.scrollY / docHeight) : 0;
        document.body.style.setProperty('--scroll-ratio', ratio);
    }
}

window.FilmEffects = FilmEffects;
