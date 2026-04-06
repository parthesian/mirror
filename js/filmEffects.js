/**
 * FilmEffects - Grain, vignette, and light leak overlays
 * Reacts to the exposure dial: darker = more pronounced film artifacts
 */
class FilmEffects {
    constructor() {
        this.scrollRaf = null;
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this._initDOM();
        this._bindEvents();
        this._applyExposure(this._currentExposure());
        this._updateScrollRatio();
    }

    _currentExposure() {
        const m = document.body.className.match(/exposure-([-\d]+)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    _initDOM() {
        this.grain = document.querySelector('.grain-svg');
        if (this.grain && this.reducedMotion) {
            this.grain.style.animation = 'none';
        }
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
            if (this.grain) {
                this.grain.style.animation = e.matches ? 'none' : '';
            }
        });
    }

    _applyExposure(exp) {
        const grainOpacity = {
            '-3': 0.12, '-2': 0.09, '-1': 0.06,
            '0': 0.04, '1': 0.02, '2': 0.02, '3': 0.02
        };
        if (this.grain) {
            this.grain.style.opacity = grainOpacity[String(exp)] ?? 0.04;
        }
        document.body.style.setProperty('--film-exposure', exp);
    }

    _updateScrollRatio() {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = docHeight > 0 ? Math.min(1, window.scrollY / docHeight) : 0;
        document.body.style.setProperty('--scroll-ratio', ratio);
    }
}

window.FilmEffects = FilmEffects;
