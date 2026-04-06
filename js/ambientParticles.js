/**
 * AmbientEffect - Seasonal heat-distortion ripple on the background.
 * Draws slow expanding concentric rings with a faint seasonal color tint.
 * Winter: icy white shimmer. Spring: soft green. Summer: warm amber.
 * Autumn: burnt orange / red.
 */
class AmbientParticles {
    constructor(gallery) {
        this.gallery = gallery;
        this.canvas = document.getElementById('ambient-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.season = null;
        this.targetSeason = null;
        this.blend = 1;
        this.rafId = null;
        this.time = 0;
        this.darkMode = false;

        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (this.reducedMotion) return;

        this._resize();
        this._bindEvents();
        this._startLoop();
    }

    _bindEvents() {
        window.addEventListener('resize', () => this._resize());

        document.addEventListener('exposureChange', (e) => {
            this.darkMode = e.detail.exposure < 0;
        });
        const m = document.body.className.match(/exposure-([-\d]+)/);
        this.darkMode = m ? parseInt(m[1], 10) < 0 : false;

        let ticking = false;
        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(() => {
                    this._detectSeason();
                    ticking = false;
                });
            }
        }, { passive: true });

        document.addEventListener('galleryUpdated', () => {
            setTimeout(() => this._detectSeason(), 100);
        });

        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            this.reducedMotion = e.matches;
            if (e.matches) this._stopLoop();
            else this._startLoop();
        });
    }

    _resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.cx = this.width / 2;
        this.cy = this.height / 2;
        this.maxRadius = Math.hypot(this.cx, this.cy);
    }

    _detectSeason() {
        if (!this.gallery || !this.gallery.imageService) return;
        const images = this.gallery.imageService.images;
        if (!images || images.length === 0) return;

        const rs = this.gallery.renderState;
        if (rs.startIndex < 0) return;

        const mid = Math.floor((rs.startIndex + rs.endIndex) / 2);
        const img = images[Math.min(mid, images.length - 1)];
        if (!img || !img.timestamp) return;

        const month = new Date(img.timestamp).getMonth();
        let season;
        if (month >= 2 && month <= 4) season = 'spring';
        else if (month >= 5 && month <= 7) season = 'summer';
        else if (month >= 8 && month <= 10) season = 'autumn';
        else season = 'winter';

        if (season !== this.targetSeason) {
            this.targetSeason = season;
            this.blend = 0;
        }
    }

    _seasonColor(season) {
        switch (season) {
            case 'winter': return { r: 200, g: 220, b: 255 };
            case 'spring': return { r: 100, g: 200, b: 120 };
            case 'summer': return { r: 255, g: 190, b: 100 };
            case 'autumn': return { r: 220, g: 120, b: 60 };
            default:       return { r: 180, g: 180, b: 180 };
        }
    }

    _startLoop() {
        if (this.rafId) return;
        const tick = () => {
            this._update();
            this._draw();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    _stopLoop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.width, this.height);
        }
    }

    _update() {
        this.time += 0.004;

        if (this.targetSeason !== this.season) {
            this.blend += 0.008;
            if (this.blend >= 1) {
                this.season = this.targetSeason;
                this.blend = 1;
            }
        }
    }

    _draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        const season = this.season;
        if (!season) return;

        const col = this._seasonColor(season);
        const baseOpacity = this.darkMode ? 0.06 : 0.035;
        const alpha = baseOpacity * this.blend;

        const ringCount = 5;
        const speed = this.time;
        const period = this.maxRadius * 1.2;

        for (let i = 0; i < ringCount; i++) {
            const phase = (i / ringCount) * period;
            const rawRadius = ((speed * 80 + phase) % period);
            const radius = rawRadius;

            const life = radius / period;
            const fadeIn = Math.min(1, life * 4);
            const fadeOut = Math.max(0, 1 - life);
            const ringAlpha = alpha * fadeIn * fadeOut;

            if (ringAlpha < 0.001) continue;

            const wobbleX = Math.sin(speed * 0.7 + i * 1.3) * 30;
            const wobbleY = Math.cos(speed * 0.5 + i * 0.9) * 20;
            const centerX = this.cx + wobbleX;
            const centerY = this.cy + wobbleY;

            const thickness = 40 + radius * 0.15;
            const inner = Math.max(0, radius - thickness / 2);
            const outer = radius + thickness / 2;

            const grad = ctx.createRadialGradient(
                centerX, centerY, inner,
                centerX, centerY, outer
            );
            grad.addColorStop(0, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
            grad.addColorStop(0.4, `rgba(${col.r}, ${col.g}, ${col.b}, ${ringAlpha})`);
            grad.addColorStop(0.6, `rgba(${col.r}, ${col.g}, ${col.b}, ${ringAlpha})`);
            grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);

            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);
        }
    }
}

window.AmbientParticles = AmbientParticles;
