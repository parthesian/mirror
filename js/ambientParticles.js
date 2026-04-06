/**
 * AmbientEffect - random ripple emitters + interference distortion.
 * Ripples spawn at random points every N seconds and visually distort
 * at intersections (collision zones).
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
        this.darkMode = false;

        this.ripples = [];
        this.maxRipples = 12;
        this.lastSpawnMs = 0;
        this.spawnAccumulator = 0;
        this.nowMs = 0;
        this.rafId = null;

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
        this.maxRadius = Math.hypot(this.width, this.height);
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

    _seasonProfile(season) {
        // User-requested seasonal tint palette:
        // green / red / orange / shiny white.
        switch (season) {
            case 'spring':
                return { color: { r: 100, g: 220, b: 120 }, spawnMs: 1800, speed: 72 };
            case 'summer':
                return { color: { r: 255, g: 175, b: 90 }, spawnMs: 1300, speed: 92 };
            case 'autumn':
                return { color: { r: 220, g: 80, b: 70 }, spawnMs: 1600, speed: 80 };
            case 'winter':
                return { color: { r: 235, g: 240, b: 255 }, spawnMs: 2200, speed: 64 };
            default:
                return { color: { r: 200, g: 200, b: 200 }, spawnMs: 1800, speed: 75 };
        }
    }

    _spawnRipple(profile) {
        const margin = 30;
        this.ripples.push({
            x: margin + Math.random() * (this.width - margin * 2),
            y: margin + Math.random() * (this.height - margin * 2),
            radius: 0,
            speed: profile.speed * (0.85 + Math.random() * 0.35),
            width: 18 + Math.random() * 16,
            strength: 0.7 + Math.random() * 0.6
        });

        if (this.ripples.length > this.maxRipples) {
            this.ripples.shift();
        }
    }

    _startLoop() {
        if (this.rafId) return;
        const tick = (ts) => {
            this._update(ts || performance.now());
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

    _update(nowMs) {
        const profile = this._seasonProfile(this.season || this.targetSeason);
        const dt = this.nowMs ? (nowMs - this.nowMs) / 1000 : 0;
        this.nowMs = nowMs;

        if (this.targetSeason !== this.season) {
            this.blend += dt * 0.7;
            if (this.blend >= 1) {
                this.season = this.targetSeason;
                this.blend = 1;
            }
        }

        // Random emitter point every N seconds
        this.spawnAccumulator += dt * 1000;
        if (this.spawnAccumulator >= profile.spawnMs) {
            this.spawnAccumulator = 0;
            this._spawnRipple(profile);
        }

        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            r.radius += r.speed * dt;
            if (r.radius - r.width > this.maxRadius * 0.7) {
                this.ripples.splice(i, 1);
            }
        }
    }

    _drawRipple(ripple, profile, baseAlpha) {
        const c = profile.color;
        const life = Math.min(1, ripple.radius / (this.maxRadius * 0.55));
        const fade = Math.max(0, 1 - life);
        const ringAlpha = baseAlpha * fade * ripple.strength;
        if (ringAlpha < 0.002) return;

        const inner = Math.max(0, ripple.radius - ripple.width * 0.5);
        const outer = ripple.radius + ripple.width * 0.5;

        const grad = this.ctx.createRadialGradient(
            ripple.x, ripple.y, inner,
            ripple.x, ripple.y, outer
        );
        grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
        grad.addColorStop(0.45, `rgba(${c.r}, ${c.g}, ${c.b}, ${ringAlpha})`);
        grad.addColorStop(0.55, `rgba(${c.r}, ${c.g}, ${c.b}, ${ringAlpha})`);
        grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);

        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    _drawCollisionDistortion(a, b, profile, baseAlpha) {
        // Collision zone: wavefronts intersect -> local "distortion lens".
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const waveGap = Math.abs((a.radius + b.radius) - d);
        const threshold = (a.width + b.width) * 0.9;
        if (waveGap > threshold) return;

        const c = profile.color;
        const t = 1 - (waveGap / Math.max(threshold, 1));
        const alpha = baseAlpha * 0.8 * t;
        if (alpha < 0.003) return;

        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const lensR = 24 + t * 34;

        const lens = this.ctx.createRadialGradient(mx, my, 0, mx, my, lensR);
        lens.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`);
        lens.addColorStop(0.65, `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha * 0.45})`);
        lens.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);

        this.ctx.fillStyle = lens;
        this.ctx.fillRect(mx - lensR, my - lensR, lensR * 2, lensR * 2);

        // Distortion streak connecting colliding fronts.
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const halfLen = 18 + t * 18;
        const x1 = mx - Math.cos(angle) * halfLen;
        const y1 = my - Math.sin(angle) * halfLen;
        const x2 = mx + Math.cos(angle) * halfLen;
        const y2 = my + Math.sin(angle) * halfLen;

        this.ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha * 0.7})`;
        this.ctx.lineWidth = 1.1 + t * 1.2;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.quadraticCurveTo(mx + Math.sin(angle) * 8, my - Math.cos(angle) * 8, x2, y2);
        this.ctx.stroke();
    }

    _draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        const season = this.season || this.targetSeason;
        if (!season) return;
        const profile = this._seasonProfile(season);

        const baseAlpha = (this.darkMode ? 0.07 : 0.045) * this.blend;
        if (baseAlpha < 0.001) return;

        // Rings
        for (let i = 0; i < this.ripples.length; i++) {
            this._drawRipple(this.ripples[i], profile, baseAlpha);
        }

        // Interference/collision distortion
        for (let i = 0; i < this.ripples.length; i++) {
            for (let j = i + 1; j < this.ripples.length; j++) {
                this._drawCollisionDistortion(this.ripples[i], this.ripples[j], profile, baseAlpha);
            }
        }
    }
}

window.AmbientParticles = AmbientParticles;
