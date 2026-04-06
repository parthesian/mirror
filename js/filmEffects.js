/**
 * FilmEffects - Controls animated light-leak behavior.
 */
class FilmEffects {
    constructor() {
        this.scrollRaf = null;
        this.currentScrollRatio = 0;
        this.targetScrollRatio = 0;
        this.scrollSettleTimeout = null;
        this.isAnimatingScroll = false;
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this._applyLeakSeed();
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

        window.addEventListener('scroll', () => {
            this._updateTargetScrollRatio();
            this._startSmoothScrollLoop();
        }, { passive: true });

        window.addEventListener('resize', () => {
            this._updateTargetScrollRatio();
            this._startSmoothScrollLoop();
        }, { passive: true });

        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            this.reducedMotion = e.matches;
            this._updateTargetScrollRatio();
            if (this.reducedMotion) {
                this.currentScrollRatio = this.targetScrollRatio;
                this._applyScrollRatio(this.currentScrollRatio);
                this._stopSmoothScrollLoop();
            } else {
                this._startSmoothScrollLoop();
            }
        });
    }

    _rand(min, max) {
        return min + Math.random() * (max - min);
    }

    _applyLeakSeed() {
        const style = document.body.style;

        // Seed positions + drift so each page load has a distinct leak layout.
        style.setProperty('--leak-x1', `${this._rand(6, 28).toFixed(2)}%`);
        style.setProperty('--leak-y1', `${this._rand(28, 58).toFixed(2)}%`);
        style.setProperty('--leak-dx1', `${this._rand(52, 84).toFixed(2)}%`);

        style.setProperty('--leak-x2', `${this._rand(68, 94).toFixed(2)}%`);
        style.setProperty('--leak-y2', `${this._rand(44, 76).toFixed(2)}%`);
        style.setProperty('--leak-dx2', `${this._rand(-54, -24).toFixed(2)}%`);

        style.setProperty('--leak-x3', `${this._rand(36, 66).toFixed(2)}%`);
        style.setProperty('--leak-y3', `${this._rand(10, 32).toFixed(2)}%`);
        style.setProperty('--leak-dx3', `${this._rand(-18, 26).toFixed(2)}%`);

        // Subtle multi-color film leak palette (warm + cool accents).
        const palettes = [
            { c1: '255,165,95', c2: '255,95,72', c3: '255,208,136', c4: '116,152,255' },
            { c1: '255,178,110', c2: '236,98,82', c3: '255,220,150', c4: '142,130,255' },
            { c1: '255,156,84', c2: '255,112,96', c3: '255,196,120', c4: '126,184,255' },
            { c1: '255,188,124', c2: '246,110,86', c3: '245,214,162', c4: '98,170,150' }
        ];
        const p = palettes[Math.floor(Math.random() * palettes.length)];
        style.setProperty('--leak-c1', p.c1);
        style.setProperty('--leak-c2', p.c2);
        style.setProperty('--leak-c3', p.c3);
        style.setProperty('--leak-c4', p.c4);
    }

    _applyExposure(exp) {
        document.body.style.setProperty('--film-exposure', exp);
    }

    _computeScrollRatio() {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        return docHeight > 0 ? Math.min(1, window.scrollY / docHeight) : 0;
    }

    _applyScrollRatio(ratio) {
        document.body.style.setProperty('--scroll-ratio', ratio);
    }

    _updateTargetScrollRatio() {
        this.targetScrollRatio = this._computeScrollRatio();
        if (this.scrollSettleTimeout) {
            clearTimeout(this.scrollSettleTimeout);
        }
        this.scrollSettleTimeout = setTimeout(() => {
            this.isAnimatingScroll = false;
        }, 120);
    }

    _startSmoothScrollLoop() {
        this.isAnimatingScroll = true;
        if (this.scrollRaf != null) return;
        const step = () => {
            if (this.reducedMotion) {
                this.currentScrollRatio = this.targetScrollRatio;
            } else {
                const delta = this.targetScrollRatio - this.currentScrollRatio;
                this.currentScrollRatio += delta * 0.16;
                if (Math.abs(delta) < 0.0006) {
                    this.currentScrollRatio = this.targetScrollRatio;
                }
            }

            this._applyScrollRatio(this.currentScrollRatio);

            const stillMoving = Math.abs(this.targetScrollRatio - this.currentScrollRatio) > 0.0006;
            if (this.isAnimatingScroll || stillMoving) {
                this.scrollRaf = requestAnimationFrame(step);
                return;
            }
            this._stopSmoothScrollLoop();
        };
        this.scrollRaf = requestAnimationFrame(step);
    }

    _stopSmoothScrollLoop() {
        if (this.scrollRaf != null) {
            cancelAnimationFrame(this.scrollRaf);
            this.scrollRaf = null;
        }
    }

    _updateScrollRatio() {
        this.targetScrollRatio = this._computeScrollRatio();
        this.currentScrollRatio = this.targetScrollRatio;
        this._applyScrollRatio(this.currentScrollRatio);
    }
}

window.FilmEffects = FilmEffects;
