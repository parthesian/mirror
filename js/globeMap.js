/**
 * The explorer's MapLibre globe: camera, gestures and the custom layers.
 *
 * MapLibre loads on first open. Its camera uses the old explorer's 45° field
 * of view, so the fit framing and marker sizes carry over unchanged. Pitch
 * and rotation are off. Pinch and trackpad zoom follow the fingers directly;
 * a wheel notch eases over MapLibre's short default.
 *
 * Taps and hovers are reported, not interpreted: GlobeExplorer decides what
 * a place or a country means.
 *
 * Classic script. Sets window.GlobeMap.
 */
(function attachGlobeMap(root) {
    const MAPLIBRE_VERSION = '5.24.1';
    const VENDOR = `/vendor/maplibre-gl-${MAPLIBRE_VERSION}`;
    const FOV = 45;
    /** MapLibre measures the ground on a sphere of the mean Earth radius. */
    const EARTH_CIRCUMFERENCE_KM = 2 * Math.PI * 6371.0088;
    const TILE = 512;
    const MAX_DISTANCE = 8;
    const MAX_ZOOM = 13;
    const SAVE_DATA_MAX_ZOOM = 7;
    const SPIN_DEG_PER_S = 5.1;
    const SPIN_RESUME_MS = 1500;
    const SPIN_RAMP_MS = 600;
    const TAP_SLOP = { touch: 18, pen: 18, mouse: 6 };

    let loading = null;

    function load() {
        if (root.maplibregl) return Promise.resolve(root.maplibregl);
        loading = loading || Promise.all([
            new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = `${VENDOR}/maplibre-gl.js`;
                script.async = true;
                script.onload = resolve;
                script.onerror = () => reject(new Error('MapLibre failed to load'));
                document.head.appendChild(script);
            }),
            new Promise((resolve) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = `${VENDOR}/maplibre-gl.css`;
                link.onload = resolve;
                link.onerror = resolve;
                document.head.appendChild(link);
            })
        ]).then(() => root.maplibregl).catch((err) => {
            loading = null;
            throw err;
        });
        return loading;
    }

    /**
     * Camera distance that keeps the radius-1 globe inside the viewport with
     * a little air on the short side. Portrait phones need it farther back.
     */
    function fitDistance(width, height, fovDeg = FOV, pad = 1.28) {
        const aspect = Math.max(1, Number(width) || 1) / Math.max(1, Number(height) || 1);
        const halfMin = Math.min(1, aspect) * Math.tan(((Number(fovDeg) || FOV) * Math.PI) / 360);
        return Math.min(8, Math.max(2.6, (Number(pad) || 1.28) / Math.max(halfMin, 0.001)));
    }

    /**
     * MapLibre zoom whose globe matches a camera `distance` radii from the
     * centre. MapLibre puts the camera focal-length pixels from the surface
     * and scales the globe by 1 / cos(latitude) to keep zoom levels uniform.
     */
    function zoomForDistance(distance, height, lat) {
        const focal = height / 2 / Math.tan((FOV * Math.PI) / 360);
        const radiusPx = focal / Math.max(distance - 1, 1e-6);
        return Math.log2((radiusPx * 2 * Math.PI * Math.cos((lat * Math.PI) / 180)) / TILE);
    }

    function zoomForKmPerPx(kmPerPx, lat) {
        return Math.log2((EARTH_CIRCUMFERENCE_KM * Math.cos((lat * Math.PI) / 180)) / (TILE * kmPerPx));
    }

    function saveData() {
        return Boolean(root.navigator?.connection?.saveData);
    }

    class GlobeMap {
        /**
         * @param {HTMLElement} container
         * @param {{ image: Promise<HTMLImageElement>, countries: object, onTap: Function, onHover: Function, onSpinChange: Function }} options
         */
        static async create(container, options) {
            const maplibregl = await load();
            const globe = new GlobeMap(maplibregl, container, options);
            await globe.ready;
            return globe;
        }

        constructor(maplibregl, container, options) {
            this.container = container;
            this.options = options;
            this.saveData = saveData();
            this.spin = { enabled: true, pressed: false, lastInteraction: 0, rampStart: 0, frame: 0, last: 0 };
            this.hoverSlot = 'a';
            const { width, height } = container.getBoundingClientRect();
            const center = { lng: 10, lat: 22 };
            this.map = new maplibregl.Map({
                container,
                style: root.GlobeStyle.build({
                    dpr: root.devicePixelRatio || 1,
                    saveData: this.saveData,
                    countries: options.countries
                }),
                center: [center.lng, center.lat],
                zoom: zoomForDistance(fitDistance(width, height), height || 1, center.lat),
                minZoom: -1,
                maxZoom: this.saveData ? SAVE_DATA_MAX_ZOOM : MAX_ZOOM,
                maxPitch: 0,
                pitchWithRotate: false,
                dragRotate: false,
                touchPitch: false,
                doubleClickZoom: false,
                boxZoom: false,
                clickTolerance: TAP_SLOP.mouse,
                renderWorldCopies: false,
                attributionControl: { compact: true },
                maplibreLogo: false,
                fadeDuration: 180,
                canvasContextAttributes: { antialias: true }
            });
            this.map.setVerticalFieldOfView(FOV);
            this.map.touchZoomRotate.disableRotation();
            this.map.keyboard.disableRotation();
            this.map.scrollZoom.setWheelZoomRate(1 / 220);

            this.earth = root.GlobeEarthLayer.create({
                id: 'earth',
                image: options.image,
                soften: root.GlobeStyle.soften,
                base: [0.2, 0.2, 0.2]
            });
            this.routes = root.GlobeRouteLayer.create('routes');
            this.markers = root.GlobeMarkerLayer.create('markers');
            this.ready = new Promise((resolve) => {
                this.map.once('load', () => {
                    this.map.addLayer(this.earth, this.map.getStyle().layers[0]?.id);
                    this.map.addLayer(this.routes);
                    this.map.addLayer(this.markers);
                    resolve();
                });
            });
            this._bindGestures();
        }

        /** Each open re-fits the zoom; the old explorer let you back off to 8 radii. */
        fit(center = this.map.getCenter()) {
            this.map.resize();
            const { width, height } = this.container.getBoundingClientRect();
            const distance = fitDistance(width, height);
            this.map.setMinZoom(zoomForDistance(Math.max(MAX_DISTANCE, distance + 0.35), height, 0));
            this.map.jumpTo({ center, zoom: zoomForDistance(distance, height, center.lat) });
        }

        /** Centre a place at the fit zoom, at any latitude. */
        focus(lng, lat) {
            this.fit({ lng, lat });
        }

        setPlaces(places) {
            this.markers.setPlaces(places);
        }

        setRoutes(segments) {
            this.routes.setArcs(segments);
        }

        setMarkerHover(keys) {
            this.markers.setHover(keys);
        }

        pulse({ lng, lat }) {
            this.routes.pulse(lng, lat);
        }

        markerHits(x, y, radius) {
            return this.markers.hits(x, y, radius);
        }

        /** The globe point under a canvas pixel, or null off the limb. */
        surfaceAt(x, y) {
            const point = new root.maplibregl.Point(x, y);
            if (!this.map.transform.isPointOnMapSurface(point)) return null;
            return this.map.unproject(point);
        }

        /** Crossfade the hover outline: 140 ms in, 220 ms out, like the old ink. */
        setCountryOutline(data) {
            const next = this.hoverSlot === 'a' ? 'b' : 'a';
            const fade = (slot, opacity, duration) => {
                this.map.setPaintProperty(`country-hover-${slot}`, 'line-opacity-transition', { duration, delay: 0 });
                this.map.setPaintProperty(`country-hover-${slot}`, 'line-opacity', opacity);
            };
            fade(this.hoverSlot, 0, 220);
            if (data) {
                this.map.getSource(`country-hover-${next}`).setData(data);
                fade(next, root.GlobeStyle.ALPHA.hover, 140);
                this.hoverSlot = next;
            }
        }

        get spinning() {
            return this.spin.enabled;
        }

        setSpin(enabled) {
            this.spin.enabled = Boolean(enabled);
            this.spin.rampStart = 0;
            this.options.onSpinChange?.(this.spin.enabled);
            this._scheduleSpin();
        }

        /** Pause or resume the idle spin loop while the overlay is hidden. */
        setActive(active) {
            this.active = Boolean(active);
            if (this.active) {
                this.map.resize();
                this._scheduleSpin();
            }
        }

        _scheduleSpin() {
            if (this.spin.frame || !this.spin.enabled || !this.active) return;
            this.spin.last = performance.now();
            this.spin.frame = requestAnimationFrame((now) => this._spinFrame(now));
        }

        /**
         * Spin slows as the camera nears the surface. It holds while a pointer
         * is down because each jumpTo cancels MapLibre's drag.
         */
        _spinFrame(now) {
            this.spin.frame = 0;
            if (!this.spin.enabled || !this.active) return;
            const dt = Math.min(48, now - this.spin.last);
            const idle = !this.spin.pressed && now - this.spin.lastInteraction > SPIN_RESUME_MS && !this.map.isMoving();
            if (!idle) {
                this.spin.rampStart = 0;
            } else {
                this.spin.rampStart = this.spin.rampStart || now;
                const t = Math.min(1, (now - this.spin.rampStart) / SPIN_RAMP_MS);
                const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                const ramp = reduced ? 1 : t * t * (3 - 2 * t);
                const altitude = root.GlobeGl.camera(this.map.transform.modelViewProjectionMatrix).altitude;
                const scale = Math.min(Math.max(altitude / 1.6, 0), 1) ** 1.5;
                const center = this.map.getCenter();
                this.map.jumpTo({ center: [center.lng - (SPIN_DEG_PER_S * scale * ramp * dt) / 1000, center.lat] });
            }
            this._scheduleSpin();
        }

        _bindGestures() {
            const surface = this.map.getCanvasContainer();
            const pointers = new Map();
            let gesture = null;
            let hoverPoint = null;
            let hoverFrame = 0;

            const runHover = () => {
                hoverFrame = 0;
                if (!hoverPoint || this.map.isMoving()) return;
                this.options.onHover(hoverPoint);
            };

            surface.addEventListener('pointerdown', (event) => {
                pointers.set(event.pointerId, true);
                const point = this._point(event);
                gesture = pointers.size > 1 ? null : {
                    ...point,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    pointerType: event.pointerType || 'mouse',
                    moved: false,
                    wheel: false
                };
                this.spin.pressed = true;
                this._userMoved();
            });
            surface.addEventListener('pointermove', (event) => {
                const point = this._point(event);
                if (gesture && pointers.has(event.pointerId)) {
                    const slop = TAP_SLOP[gesture.pointerType] || TAP_SLOP.mouse;
                    if (Math.hypot(point.x - gesture.x, point.y - gesture.y) > slop) {
                        gesture.moved = true;
                        this._userMoved(true);
                    }
                }
                if (event.pointerType !== 'mouse') return;
                hoverPoint = point;
                hoverFrame = hoverFrame || requestAnimationFrame(runHover);
            });
            const release = (event) => {
                if (!pointers.has(event.pointerId)) return;
                const wasTap = event.type === 'pointerup' && pointers.size === 1 && gesture
                    && !gesture.moved && !gesture.wheel
                    && (gesture.pointerType !== 'mouse' || event.button === 0);
                pointers.delete(event.pointerId);
                this.spin.pressed = pointers.size > 0;
                this._userMoved();
                const tap = gesture;
                if (!pointers.size) gesture = null;
                if (wasTap) this.options.onTap(tap);
            };
            root.addEventListener('pointerup', release);
            root.addEventListener('pointercancel', release);
            surface.addEventListener('wheel', () => {
                if (gesture) gesture.wheel = true;
                this._userMoved();
            }, { passive: true });
            surface.addEventListener('mouseleave', () => {
                hoverPoint = null;
                this.options.onHover(null);
            });
            this.map.on('moveend', () => {
                hoverFrame = hoverFrame || requestAnimationFrame(runHover);
            });
            this._bindSafariPinch(surface);
        }

        /** Safari reports a trackpad pinch as gesture events, not as a ctrl-wheel. */
        _bindSafariPinch(surface) {
            if (!('GestureEvent' in root)) return;
            let start = null;
            const onGesture = (event) => {
                event.preventDefault();
                if (event.type === 'gesturestart') {
                    const point = this._point(event);
                    const around = this.surfaceAt(point.x, point.y);
                    start = { zoom: this.map.getZoom(), around: around || this.map.getCenter() };
                    this._userMoved();
                    return;
                }
                if (!start || event.type !== 'gesturechange') return;
                this.map.zoomTo(start.zoom + Math.log2(Number(event.scale) || 1), { duration: 0, around: start.around });
                this._userMoved();
            };
            for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
                surface.addEventListener(type, onGesture, { passive: false });
            }
        }

        /** Map coordinates are relative to the map container, not the canvas container. */
        _point(event) {
            const rect = this.map.getContainer().getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        }

        /** A drag stops the idle spin for good; zooming only pauses it. */
        _userMoved(dragged = false) {
            this.spin.lastInteraction = performance.now();
            if (dragged && this.spin.enabled) this.setSpin(false);
        }
    }

    GlobeMap.MAPLIBRE_VERSION = MAPLIBRE_VERSION;
    GlobeMap.load = load;
    GlobeMap.fitDistance = fitDistance;
    GlobeMap.zoomForDistance = zoomForDistance;
    GlobeMap.zoomForKmPerPx = zoomForKmPerPx;
    root.GlobeMap = GlobeMap;
})(window);
