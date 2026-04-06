/**
 * AmbientParticles - Subtle seasonal particles tied to the photos in view.
 * Winter: slow-falling snow. Spring: rising pollen. Autumn: drifting leaves.
 * Summer: nothing (clean). All monochrome.
 */
class AmbientParticles {
    constructor(gallery) {
        this.gallery = gallery;
        this.canvas = document.getElementById('ambient-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.particles = [];
        this.season = null;
        this.targetSeason = null;
        this.fadeAlpha = 1;
        this.maxParticles = 40;
        this.rafId = null;
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
        this.darkMode = (document.body.className.match(/exposure-([-\d]+)/) || [])[1] < 0;

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

        if (season !== this.season) {
            this.targetSeason = season;
            this.fadeAlpha = 0;
        }
    }

    _seasonConfig(season) {
        const base = this.darkMode ? 255 : 120;
        switch (season) {
            case 'winter': return {
                count: this.maxParticles,
                sizeMin: 2, sizeMax: 4,
                vyMin: 0.3, vyMax: 0.8,
                vxMin: -0.2, vxMax: 0.2,
                opMin: 0.2, opMax: 0.5,
                color: base, drift: true, rise: false, spin: false
            };
            case 'spring': return {
                count: 25,
                sizeMin: 2, sizeMax: 4,
                vyMin: -0.4, vyMax: -0.15,
                vxMin: -0.1, vxMax: 0.1,
                opMin: 0.15, opMax: 0.35,
                color: base, drift: false, rise: true, spin: false
            };
            case 'autumn': return {
                count: 30,
                sizeMin: 3, sizeMax: 6,
                vyMin: 0.2, vyMax: 0.5,
                vxMin: -0.3, vxMax: 0.3,
                opMin: 0.15, opMax: 0.4,
                color: Math.min(base, 160), drift: true, rise: false, spin: true
            };
            default: return null;
        }
    }

    _spawnParticle(cfg) {
        const r = (min, max) => min + Math.random() * (max - min);
        return {
            x: Math.random() * this.width,
            y: cfg.rise ? this.height + 10 : -10,
            vx: r(cfg.vxMin, cfg.vxMax),
            vy: r(cfg.vyMin, cfg.vyMax),
            size: r(cfg.sizeMin, cfg.sizeMax),
            opacity: r(cfg.opMin, cfg.opMax),
            rotation: cfg.spin ? Math.random() * Math.PI * 2 : 0,
            rotSpeed: cfg.spin ? (Math.random() - 0.5) * 0.02 : 0,
            driftPhase: Math.random() * Math.PI * 2
        };
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
        if (this.targetSeason !== this.season) {
            this.fadeAlpha += 0.02;
            if (this.fadeAlpha >= 1) {
                this.season = this.targetSeason;
                this.particles = [];
                this.fadeAlpha = 1;
            }
        }

        const cfg = this._seasonConfig(this.season);
        if (!cfg) {
            this.particles = [];
            return;
        }

        while (this.particles.length < cfg.count) {
            this.particles.push(this._spawnParticle(cfg));
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            if (cfg.drift) {
                p.x += p.vx + Math.sin(p.driftPhase) * 0.15;
                p.driftPhase += 0.01;
            } else {
                p.x += p.vx;
            }
            p.y += p.vy;
            p.rotation += p.rotSpeed;

            const outOfBounds = cfg.rise
                ? p.y < -20
                : p.y > this.height + 20;

            if (outOfBounds || p.x < -20 || p.x > this.width + 20) {
                this.particles[i] = this._spawnParticle(cfg);
            }
        }
    }

    _draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        const cfg = this._seasonConfig(this.season);
        if (!cfg || this.particles.length === 0) return;

        const alpha = this.fadeAlpha;
        for (const p of this.particles) {
            this.ctx.save();
            this.ctx.globalAlpha = p.opacity * alpha;
            this.ctx.translate(p.x, p.y);
            if (p.rotation) this.ctx.rotate(p.rotation);

            if (this.season === 'autumn') {
                this.ctx.beginPath();
                const s = p.size;
                this.ctx.ellipse(0, 0, s, s * 0.6, 0, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgb(${cfg.color}, ${cfg.color}, ${cfg.color})`;
                this.ctx.fill();
            } else {
                this.ctx.beginPath();
                this.ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgb(${cfg.color}, ${cfg.color}, ${cfg.color})`;
                this.ctx.fill();
            }
            this.ctx.restore();
        }
    }
}

window.AmbientParticles = AmbientParticles;
