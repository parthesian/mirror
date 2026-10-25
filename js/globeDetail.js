/**
 * Globe detail levels, zoom math, and boundary lines.
 *
 * Classic script. Sets globalThis.GlobeDetail / window.GlobeDetail.
 * The line worker importScripts this file. The explorer reads the same
 * object. No module syntax: the gallery pages are classic scripts.
 *
 * @param {typeof globalThis} root
 */
(function attachGlobeDetail(root) {
    /**
     * @typedef {{ lon: number, lat: number }} LonLat
     * @typedef {{ lon1: number, lat1: number, lon2: number, lat2: number }} RawSegment
     * @typedef {{ L: number, R: number, lon1: number, lat1: number, lon2: number, lat2: number }} OwnedSegment
     * @typedef {{ lon1: number, lat1: number, lon2: number, lat2: number, count: number, owners: number[] }} EdgeRecord
     * @typedef {{ edges: Map<string, EdgeRecord> }} EdgeAccumulator
     * @typedef {{ coast: OwnedSegment[], border: OwnedSegment[] }} WorldEdges
     * @typedef {{ x: number, y: number, z: number }} Vec3
     * @typedef {{ positions: number[], meta: number[], index: number[], vertexBase: number }} BufferBuild
     * @typedef {{
     *   doc: { scale?: number, codes?: string[], layers?: Record<string, number[][]> },
     *   codeToId: Record<string, number>,
     *   kind: number,
     *   lineIndex: number,
     *   positions: number[],
     *   meta: number[],
     *   index: number[],
     *   vertexBase: number,
     *   done: boolean
     * }} ChunkedLineBuild
     * @typedef {{ positions: Float32Array, meta: Uint8Array, index: Uint32Array }} LineBuffers
     */

    const CONFIG = {
        H_MIN: 0.30,
        FIT_ALTITUDE: 1.6,
        TAU_NOTCH_MS: 110,
        TAU_TRACKPAD_MS: 60,
        TAU_PINCH_MS: 45,
        TAU_TOUCH_MS: 30,
        TAU_REDUCED_MS: 40,
        WHEEL_K: 0.0023,
        PINCH_K: 0.010,
        WHEEL_CLAMP_PX: 240,
        SETTLE_LOG_EPS: 5e-4,
        ANCHOR_INCIDENCE_DEG: [62, 78],
        ANCHOR_FADE_ABOVE_FIT: 0.6,
        ROTATE_SPEED: 0.65,
        ROTATE_MIN_SCALE: 0.08,
        AUTO_ROTATE_SPEED: 0.85,
        AUTO_ROTATE_RESUME_MS: 1500,
        AUTO_ROTATE_RAMP_MS: 600,
        NEAR: { k: 0.35, min: 0.02, max: 0.1 },
        FAR_PAD: 1.7,
        LEVEL_D: { regional: 2.05, local: 1.55 },
        HYSTERESIS: 0.04,
        PREFETCH_D: { regional: 2.35, local: 1.80 },
        CROSSFADE_MS: 360,
        CROSSFADE_REDUCED_MS: 120,
        HOVER_IN_MS: 140,
        HOVER_OUT_MS: 220,
        SPHERE_SEGMENTS: [192, 96],
        LINE_RADIUS: 1.0003,
        DOT_RADIUS: 1.0025,
        PULSE_RADIUS: 1.003,
        DENSIFY_DEG: 0.5,
        DOT_SIZE: 0.06,
        DOT_MIN_SCALE: 0.19,
        POINTS_THRESHOLD: 0.034,
        INK: { line: '#E3E8EC', admin1: '#C5CCD3', hover: '#FFFFFF' },
        ALPHA: {
            world: { coast: 0.20, border: 0.36 },
            regional: { coast: 0.26, border: 0.44, lake: 0.18 },
            local: { coast: 0.32, border: 0.52, lake: 0.24, admin1: 0.26 },
            hover: 0.90,
            hoverAdmin1: 0.45,
            lowDprScale: 0.75
        },
        LIMB_FADE: [0.06, 0.30],
        FAR_FADE_D: [3.2, 8.0],
        ADMIN1_FADE_D: [1.56, 1.40]
    };

    const LAYER_NAMES = ['coast', 'border', 'lake', 'admin1'];

    /**
     * @param {number} edge0
     * @param {number} edge1
     * @param {number} x
     * @returns {number}
     */
    function smoothstep(edge0, edge1, x) {
        const span = edge1 - edge0;
        if (span === 0) {
            return x < edge0 ? 0 : 1;
        }
        const t = Math.max(0, Math.min(1, (x - edge0) / span));
        return t * t * (3 - 2 * t);
    }

    /**
     * @param {number} angle
     * @returns {number}
     */
    function wrapPi(angle) {
        const twoPi = Math.PI * 2;
        let wrapped = (angle + Math.PI) % twoPi;
        if (wrapped < 0) {
            wrapped += twoPi;
        }
        return wrapped - Math.PI;
    }

    /**
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * @param {number} value
     * @returns {number}
     */
    function u8(value) {
        const n = value | 0;
        if (n < 0) {
            return 0;
        }
        if (n > 255) {
            return 255;
        }
        return n;
    }

    /**
     * @param {'world' | 'regional' | 'local'} level
     * @returns {0 | 1 | 2}
     */
    function levelIndex(level) {
        if (level === 'local') {
            return 2;
        }
        if (level === 'regional') {
            return 1;
        }
        return 0;
    }

    /**
     * @param {'world' | 'regional' | 'local'} level
     * @param {number} d
     * @returns {'world' | 'regional' | 'local'}
     */
    function stepLevel(level, d) {
        const enterRegional = CONFIG.LEVEL_D.regional - CONFIG.HYSTERESIS;
        const leaveRegional = CONFIG.LEVEL_D.regional + CONFIG.HYSTERESIS;
        const enterLocal = CONFIG.LEVEL_D.local - CONFIG.HYSTERESIS;
        const leaveLocal = CONFIG.LEVEL_D.local + CONFIG.HYSTERESIS;
        if (level === 'local') {
            if (d > leaveRegional) {
                return 'world';
            }
            if (d > leaveLocal) {
                return 'regional';
            }
            return 'local';
        }
        if (level === 'regional') {
            if (d > leaveRegional) {
                return 'world';
            }
            if (d < enterLocal) {
                return 'local';
            }
            return 'regional';
        }
        if (d < enterLocal) {
            return 'local';
        }
        if (d < enterRegional) {
            return 'regional';
        }
        return 'world';
    }

    /**
     * @param {string} kind
     * @param {number} d
     * @param {number} hGoal
     * @returns {boolean}
     */
    function shouldFetch(kind, d, hGoal) {
        const dAhead = Math.min(d, 1 + hGoal);
        if (kind === '50m' || kind === 'regional') {
            return dAhead < CONFIG.PREFETCH_D.regional;
        }
        if (kind === '10m' || kind === 'local') {
            return dAhead < CONFIG.PREFETCH_D.local;
        }
        return false;
    }

    /**
     * @param {{ deltaY?: number, deltaMode?: number, ctrlKey?: boolean, canvasHeight?: number }} event
     * @returns {{ px: number, pinch: boolean, notch: boolean, k: number, tau: number }}
     */
    function normalizeWheel(event) {
        const deltaY = Number(event.deltaY) || 0;
        const deltaMode = Number(event.deltaMode) || 0;
        const canvasHeight = Number(event.canvasHeight) || 0;
        let px = deltaY;
        if (deltaMode === 1) {
            px = deltaY * 16;
        } else if (deltaMode === 2) {
            px = deltaY * canvasHeight;
        }
        px = clamp(px, -CONFIG.WHEEL_CLAMP_PX, CONFIG.WHEEL_CLAMP_PX);
        const pinch = Boolean(event.ctrlKey);
        const notch = !pinch && (deltaMode === 1 || (Math.abs(px) >= 50 && Number.isInteger(px)));
        const k = pinch ? CONFIG.PINCH_K : CONFIG.WHEEL_K;
        const tau = notch ? CONFIG.TAU_NOTCH_MS : pinch ? CONFIG.TAU_PINCH_MS : CONFIG.TAU_TRACKPAD_MS;
        return { px, pinch, notch, k, tau };
    }

    /**
     * @param {number} hGoal
     * @param {number} px
     * @param {number} k
     * @param {number} hMin
     * @param {number} hMax
     * @returns {number}
     */
    function nextAltitudeGoal(hGoal, px, k, hMin, hMax) {
        if (px > 0 && hGoal >= hMax) {
            return hMax;
        }
        if (px < 0 && hGoal <= hMin) {
            return hMin;
        }
        return clamp(hGoal * Math.exp(px * k), hMin, hMax);
    }

    /**
     * @param {number} h
     * @param {number} hGoal
     * @param {number} dt
     * @param {number} tau
     * @returns {{ h: number, settled: boolean }}
     */
    function stepAltitude(h, hGoal, dt, tau) {
        if (!(h > 0) || !(hGoal > 0)) {
            return { h: hGoal > 0 ? hGoal : h, settled: true };
        }
        if (Math.abs(Math.log(h / hGoal)) < CONFIG.SETTLE_LOG_EPS) {
            return { h: hGoal, settled: true };
        }
        const safeTau = tau > 0 ? tau : 1;
        const a = 1 - Math.exp(-dt / safeTau);
        let next = Math.exp(Math.log(h) + (Math.log(hGoal) - Math.log(h)) * a);
        if ((hGoal - h) * (hGoal - next) < 0) {
            next = hGoal;
        }
        if (Math.abs(Math.log(next / hGoal)) < CONFIG.SETTLE_LOG_EPS) {
            return { h: hGoal, settled: true };
        }
        return { h: next, settled: false };
    }

    /**
     * @param {number} h
     * @returns {number}
     */
    function rotateScale(h) {
        const t = (Math.max(h, 0) / CONFIG.FIT_ALTITUDE) ** 1.5;
        return clamp(t, CONFIG.ROTATE_MIN_SCALE, 1);
    }

    /**
     * @param {number} h
     * @returns {number}
     */
    function autoRotateScale(h) {
        const t = (Math.max(h, 0) / CONFIG.FIT_ALTITUDE) ** 1.5;
        return clamp(t, 0, 1);
    }

    /**
     * @param {number} h
     * @returns {number}
     */
    function dotScale(h) {
        return clamp(h / CONFIG.FIT_ALTITUDE, CONFIG.DOT_MIN_SCALE, 1);
    }

    /**
     * @param {number} near
     * @param {number} far
     * @param {number} nextNear
     * @param {number} nextFar
     * @returns {boolean}
     */
    function clipChanged(near, far, nextNear, nextFar) {
        const nearBase = Math.max(Math.abs(near), 1e-6);
        const farBase = Math.max(Math.abs(far), 1e-6);
        return Math.abs(nextNear - near) / nearBase > 0.01
            || Math.abs(nextFar - far) / farBase > 0.01;
    }

    /**
     * @param {number} h
     * @param {number} d
     * @returns {{ near: number, far: number }}
     */
    function clipPlanes(h, d) {
        return {
            near: clamp(CONFIG.NEAR.k * h, CONFIG.NEAR.min, CONFIG.NEAR.max),
            far: d + CONFIG.FAR_PAD
        };
    }

    /**
     * @param {number} px
     * @param {number} py
     * @param {number} pz
     * @param {number} camX
     * @param {number} camY
     * @param {number} camZ
     * @param {number} fit
     * @returns {number}
     */
    function anchorWeight(px, py, pz, camX, camY, camZ, fit) {
        const vx = camX - px;
        const vy = camY - py;
        const vz = camZ - pz;
        const vLen = Math.hypot(vx, vy, vz) || 1;
        const incidence = (px * vx + py * vy + pz * vz) / vLen;
        const cosWide = Math.cos((CONFIG.ANCHOR_INCIDENCE_DEG[1] ?? 78) * Math.PI / 180);
        const cosTight = Math.cos((CONFIG.ANCHOR_INCIDENCE_DEG[0] ?? 62) * Math.PI / 180);
        const face = smoothstep(cosWide, cosTight, incidence);
        const d = Math.hypot(camX, camY, camZ);
        const fade = 1 - smoothstep(fit, fit + CONFIG.ANCHOR_FADE_ABOVE_FIT, d);
        return face * fade;
    }

    /**
     * @param {{
     *   x: number, y: number, z: number,
     *   px: number, py: number, pz: number,
     *   qx: number, qy: number, qz: number,
     *   w: number, phiMin: number, phiMax: number
     * }} input
     * @returns {{ x: number, y: number, z: number, theta: number, phi: number }}
     */
    function adjustSpherical(input) {
        const radius = Math.hypot(input.x, input.y, input.z) || 1;
        let theta = Math.atan2(input.x, input.z);
        let phi = Math.acos(clamp(input.y / radius, -1, 1));
        const dAz = wrapPi(Math.atan2(input.px, input.pz) - Math.atan2(input.qx, input.qz));
        const dEl = Math.asin(clamp(input.py, -1, 1)) - Math.asin(clamp(input.qy, -1, 1));
        theta += input.w * dAz;
        phi -= input.w * dEl;
        phi = clamp(phi, input.phiMin, input.phiMax);
        const sinPhi = Math.sin(phi);
        return {
            x: radius * sinPhi * Math.sin(theta),
            y: radius * Math.cos(phi),
            z: radius * sinPhi * Math.cos(theta),
            theta,
            phi
        };
    }

    /**
     * @param {number} lod
     * @returns {[number, number, number]}
     */
    function crossfadeWeights(lod) {
        /** @type {[number, number, number]} */
        const weights = [0, 0, 0];
        if (lod <= 0) {
            weights[0] = 1;
            return weights;
        }
        if (lod >= 2) {
            weights[2] = 1;
            return weights;
        }
        const i = Math.floor(lod);
        const f = lod - i;
        const coarse = 1 - smoothstep(0.25, 1, f);
        const fine = smoothstep(0, 0.75, f);
        if (i === 0) {
            weights[0] = coarse;
            weights[1] = fine;
        } else {
            weights[1] = coarse;
            weights[2] = fine;
        }
        return weights;
    }

    /**
     * @param {number} lat
     * @param {number} lon
     * @param {number} [radius]
     * @returns {Vec3}
     */
    function latLonToXYZ(lat, lon, radius) {
        const r = radius == null ? 1 : radius;
        const phi = (90 - lat) * Math.PI / 180;
        const theta = (lon + 180) * Math.PI / 180;
        const sinPhi = Math.sin(phi);
        return {
            x: -r * sinPhi * Math.cos(theta),
            y: r * Math.cos(phi),
            z: r * sinPhi * Math.sin(theta)
        };
    }

    /**
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {{ x: number, y: number, z: number, t: number } | null}
     */
    function rayUnitSphere(ox, oy, oz, dx, dy, dz) {
        const len = Math.hypot(dx, dy, dz);
        if (!(len > 0)) {
            return null;
        }
        const inv = 1 / len;
        const dirX = dx * inv;
        const dirY = dy * inv;
        const dirZ = dz * inv;
        const b = ox * dirX + oy * dirY + oz * dirZ;
        const c = ox * ox + oy * oy + oz * oz - 1;
        const disc = b * b - c;
        if (disc < 0) {
            return null;
        }
        const s = Math.sqrt(disc);
        const t0 = -b - s;
        const t1 = -b + s;
        const t = t0 > 1e-6 ? t0 : (t1 > 1e-6 ? t1 : null);
        if (t == null) {
            return null;
        }
        return {
            x: ox + t * dirX,
            y: oy + t * dirY,
            z: oz + t * dirZ,
            t
        };
    }

    /**
     * @param {number} lon1
     * @param {number} lat1
     * @param {number} lon2
     * @param {number} lat2
     * @returns {RawSegment[]}
     */
    function splitSegment(lon1, lat1, lon2, lat2) {
        const sameSide = Math.abs(lon1) >= 179.999
            && Math.abs(lon2) >= 179.999
            && Math.sign(lon1) === Math.sign(lon2);
        if (sameSide) {
            return [];
        }
        if (lat1 <= -89.999 && lat2 <= -89.999) {
            return [];
        }
        const raw = lon2 - lon1;
        if (Math.abs(raw) <= 180) {
            return [{ lon1, lat1, lon2, lat2 }];
        }
        const lonB = raw > 180 ? lon2 - 360 : lon2 + 360;
        const target = lonB > lon1 ? 180 : -180;
        const denom = lonB - lon1;
        const t = denom === 0 ? 0 : (target - lon1) / denom;
        const latStar = lat1 + t * (lat2 - lat1);
        return [
            { lon1, lat1, lon2: target, lat2: latStar },
            { lon1: -target, lat1: latStar, lon2, lat2 }
        ];
    }

    /**
     * @param {LonLat[]} points
     * @param {number} maxDeg
     * @returns {LonLat[]}
     */
    function densifyPoints(points, maxDeg) {
        const first = points[0];
        if (!first) {
            return [];
        }
        /** @type {LonLat[]} */
        const out = [first];
        const limit = maxDeg > 0 ? maxDeg : CONFIG.DENSIFY_DEG;
        for (let i = 1; i < points.length; i++) {
            const b = points[i];
            const a = out[out.length - 1];
            if (!a || !b) {
                continue;
            }
            const dLon = b.lon - a.lon;
            const dLat = b.lat - a.lat;
            const span = Math.max(Math.abs(dLon), Math.abs(dLat));
            const steps = Math.ceil(span / limit);
            const n = steps < 1 ? 1 : steps;
            for (let s = 1; s < n; s++) {
                const t = s / n;
                out.push({ lon: a.lon + dLon * t, lat: a.lat + dLat * t });
            }
            out.push(b);
        }
        return out;
    }

    /**
     * @param {number} value
     * @returns {number}
     */
    function quant(value) {
        return Math.round(value * 1e5);
    }

    /**
     * @param {LonLat} a
     * @param {LonLat} b
     * @returns {string}
     */
    function edgeKey(a, b) {
        const ak = `${quant(a.lon)},${quant(a.lat)}`;
        const bk = `${quant(b.lon)},${quant(b.lat)}`;
        return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
    }

    /**
     * @returns {EdgeAccumulator}
     */
    function createEdgeAccumulator() {
        return { edges: new Map() };
    }

    /**
     * @param {EdgeAccumulator} acc
     * @param {LonLat} a
     * @param {LonLat} b
     * @param {number} runtimeId
     */
    function addEdge(acc, a, b, runtimeId) {
        const key = edgeKey(a, b);
        let rec = acc.edges.get(key);
        if (!rec) {
            rec = {
                lon1: a.lon,
                lat1: a.lat,
                lon2: b.lon,
                lat2: b.lat,
                count: 0,
                owners: []
            };
            acc.edges.set(key, rec);
        }
        rec.count += 1;
        if (rec.owners.length < 2) {
            rec.owners.push(runtimeId);
        }
    }

    /**
     * @param {unknown} coord
     * @returns {LonLat | null}
     */
    function pairLonLat(coord) {
        if (!Array.isArray(coord) || coord.length < 2) {
            return null;
        }
        const lon = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            return null;
        }
        return { lon, lat };
    }

    /**
     * @param {EdgeAccumulator} acc
     * @param {unknown[]} ring
     * @param {number} runtimeId
     */
    function addRing(acc, ring, runtimeId) {
        /** @type {LonLat[]} */
        const pts = [];
        for (const coord of ring) {
            const point = pairLonLat(coord);
            if (point) {
                pts.push(point);
            }
        }
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (!first || !last || pts.length < 2) {
            return;
        }
        const closed = quant(first.lon) === quant(last.lon) && quant(first.lat) === quant(last.lat);
        const limit = closed ? pts.length - 1 : pts.length;
        for (let i = 0; i < limit; i++) {
            const a = pts[i];
            const b = closed ? pts[i + 1] : pts[(i + 1) % pts.length];
            if (!a || !b) {
                continue;
            }
            addEdge(acc, a, b, runtimeId);
        }
    }

    /**
     * @param {any} feature
     * @returns {unknown[][][]}
     */
    function polygonsOf(feature) {
        if (feature && Array.isArray(feature.polygons)) {
            return feature.polygons;
        }
        const geometry = feature && feature.geometry;
        if (!geometry) {
            return [];
        }
        if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
            return [geometry.coordinates];
        }
        if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
            return geometry.coordinates;
        }
        return [];
    }

    /**
     * @param {EdgeAccumulator} acc
     * @param {any} feature
     * @param {number} runtimeId
     */
    function addFeatureEdges(acc, feature, runtimeId) {
        const polygons = polygonsOf(feature);
        for (const polygon of polygons) {
            if (!Array.isArray(polygon)) {
                continue;
            }
            for (const ring of polygon) {
                if (Array.isArray(ring)) {
                    addRing(acc, ring, runtimeId);
                }
            }
        }
    }

    /**
     * @param {EdgeAccumulator} acc
     * @returns {WorldEdges}
     */
    function finalizeWorldEdges(acc) {
        /** @type {OwnedSegment[]} */
        const coast = [];
        /** @type {OwnedSegment[]} */
        const border = [];
        for (const rec of acc.edges.values()) {
            const ownerA = rec.owners[0] ?? 0;
            const ownerB = rec.owners[1] ?? ownerA;
            const parts = splitSegment(rec.lon1, rec.lat1, rec.lon2, rec.lat2);
            const bucket = rec.count >= 2 ? border : coast;
            for (const part of parts) {
                bucket.push({
                    L: ownerA,
                    R: rec.count >= 2 ? ownerB : ownerA,
                    lon1: part.lon1,
                    lat1: part.lat1,
                    lon2: part.lon2,
                    lat2: part.lat2
                });
            }
        }
        return { coast, border };
    }

    /**
     * @param {OwnedSegment[]} segments
     * @returns {number}
     */
    function maxAbsDeltaLon(segments) {
        let maxAbs = 0;
        for (const seg of segments) {
            const dense = densifyPoints([
                { lon: seg.lon1, lat: seg.lat1 },
                { lon: seg.lon2, lat: seg.lat2 }
            ], CONFIG.DENSIFY_DEG);
            for (let i = 1; i < dense.length; i++) {
                const a = dense[i - 1];
                const b = dense[i];
                if (!a || !b) {
                    continue;
                }
                const delta = Math.abs(b.lon - a.lon);
                if (delta > maxAbs) {
                    maxAbs = delta;
                }
            }
        }
        return maxAbs;
    }

    /**
     * @param {any} input
     * @returns {{ coast: number, border: number, maxAbsDeltaLon: number, edges: WorldEdges }}
     */
    function worldEdgeStats(input) {
        const list = Array.isArray(input) ? input : (input && Array.isArray(input.features) ? input.features : []);
        const acc = createEdgeAccumulator();
        for (let i = 0; i < list.length; i++) {
            const feature = list[i];
            if (!feature) {
                continue;
            }
            addFeatureEdges(acc, feature, i + 1);
        }
        const edges = finalizeWorldEdges(acc);
        const maxDelta = Math.max(maxAbsDeltaLon(edges.coast), maxAbsDeltaLon(edges.border));
        return {
            coast: edges.coast.length,
            border: edges.border.length,
            maxAbsDeltaLon: maxDelta,
            edges
        };
    }

    /**
     * @returns {BufferBuild}
     */
    function emptyBufferBuild() {
        return { positions: [], meta: [], index: [], vertexBase: 0 };
    }

    /**
     * @param {BufferBuild} state
     * @param {LonLat[]} points
     * @param {number} kind
     * @param {number} left
     * @param {number} right
     * @returns {number}
     */
    function appendPolyline(state, points, kind, left, right) {
        if (points.length < 2) {
            return 0;
        }
        const base = state.vertexBase;
        const countryL = u8(left);
        const countryR = u8(right);
        const kindId = u8(kind);
        for (const point of points) {
            const xyz = latLonToXYZ(point.lat, point.lon, CONFIG.LINE_RADIUS);
            state.positions.push(xyz.x, xyz.y, xyz.z);
            state.meta.push(kindId, countryL, countryR, 0);
        }
        for (let i = 0; i < points.length - 1; i++) {
            state.index.push(base + i, base + i + 1);
        }
        state.vertexBase += points.length;
        return points.length;
    }

    /**
     * @param {BufferBuild} state
     * @returns {LineBuffers}
     */
    function finishTyped(state) {
        return {
            positions: Float32Array.from(state.positions),
            meta: Uint8Array.from(state.meta),
            index: Uint32Array.from(state.index)
        };
    }

    /**
     * @param {WorldEdges} built
     * @returns {LineBuffers}
     */
    function projectWorldEdges(built) {
        const state = emptyBufferBuild();
        /**
         * @param {OwnedSegment[]} segments
         * @param {number} kind
         */
        const add = (segments, kind) => {
            for (const seg of segments) {
                const dense = densifyPoints([
                    { lon: seg.lon1, lat: seg.lat1 },
                    { lon: seg.lon2, lat: seg.lat2 }
                ], CONFIG.DENSIFY_DEG);
                appendPolyline(state, dense, kind, seg.L, seg.R);
            }
        };
        add(built.coast, 0);
        add(built.border, 1);
        return finishTyped(state);
    }

    /**
     * @param {string[]} codes
     * @param {number} index
     * @param {Record<string, number>} codeToId
     * @returns {number}
     */
    function remapCode(codes, index, codeToId) {
        const code = codes[index];
        if (typeof code !== 'string' || !code) {
            return 0;
        }
        const id = codeToId[code];
        return typeof id === 'number' && Number.isFinite(id) ? id : 0;
    }

    /**
     * @param {BufferBuild} state
     * @param {number[]} line
     * @param {number} scale
     * @param {string[]} codes
     * @param {number} kind
     * @param {Record<string, number>} codeToId
     * @returns {number}
     */
    function appendEncodedLine(state, line, scale, codes, kind, codeToId) {
        const leftIndex = line[0];
        const rightIndex = line[1];
        const x0 = line[2];
        const y0 = line[3];
        if (typeof leftIndex !== 'number' || typeof rightIndex !== 'number') {
            return 0;
        }
        if (typeof x0 !== 'number' || typeof y0 !== 'number' || !(scale > 0)) {
            return 0;
        }
        /** @type {LonLat[]} */
        const points = [{ lon: x0 / scale, lat: y0 / scale }];
        let x = x0;
        let y = y0;
        for (let i = 4; i + 1 < line.length; i += 2) {
            const dx = line[i];
            const dy = line[i + 1];
            if (typeof dx !== 'number' || typeof dy !== 'number') {
                break;
            }
            x += dx;
            y += dy;
            points.push({ lon: x / scale, lat: y / scale });
        }
        const dense = densifyPoints(points, CONFIG.DENSIFY_DEG);
        return appendPolyline(
            state,
            dense,
            kind,
            remapCode(codes, leftIndex, codeToId),
            remapCode(codes, rightIndex, codeToId)
        );
    }

    /**
     * @param {any} doc
     * @param {Record<string, number>} codeToId
     * @returns {ChunkedLineBuild}
     */
    function createChunkedLineBuild(doc, codeToId) {
        return {
            doc: doc || {},
            codeToId: codeToId || {},
            kind: 0,
            lineIndex: 0,
            positions: [],
            meta: [],
            index: [],
            vertexBase: 0,
            done: false
        };
    }

    /**
     * @param {ChunkedLineBuild} state
     * @param {number} vertexBudget
     * @returns {boolean}
     */
    function stepChunkedLineBuild(state, vertexBudget) {
        if (state.done) {
            return true;
        }
        const scale = Number(state.doc.scale) || 1000;
        const codes = Array.isArray(state.doc.codes) ? state.doc.codes : [];
        const layers = state.doc.layers || {};
        let built = 0;
        const budget = vertexBudget > 0 ? vertexBudget : 1;
        while (state.kind < LAYER_NAMES.length && built < budget) {
            const name = LAYER_NAMES[state.kind] ?? 'coast';
            const lines = layers[name];
            const list = Array.isArray(lines) ? lines : [];
            if (state.lineIndex >= list.length) {
                state.kind += 1;
                state.lineIndex = 0;
                continue;
            }
            const line = list[state.lineIndex];
            state.lineIndex += 1;
            if (!Array.isArray(line)) {
                continue;
            }
            built += appendEncodedLine(state, line, scale, codes, state.kind, state.codeToId);
        }
        state.done = state.kind >= LAYER_NAMES.length;
        return state.done;
    }

    /**
     * @param {ChunkedLineBuild} state
     * @returns {LineBuffers}
     */
    function finishChunkedLineBuild(state) {
        return finishTyped(state);
    }

    /**
     * @param {any} doc
     * @param {Record<string, number>} codeToId
     * @returns {LineBuffers}
     */
    function buildLineBuffers(doc, codeToId) {
        const state = createChunkedLineBuild(doc, codeToId);
        while (!stepChunkedLineBuild(state, 1e9)) {
            // The chunk helper returns true once every layer is consumed.
        }
        return finishChunkedLineBuild(state);
    }

    /**
     * @param {'world' | 'regional' | 'local'} level
     * @param {'coast' | 'border' | 'lake' | 'admin1'} key
     * @returns {number}
     */
    function alphaFor(level, key) {
        if (level === 'local') {
            if (key === 'coast') return CONFIG.ALPHA.local.coast;
            if (key === 'border') return CONFIG.ALPHA.local.border;
            if (key === 'lake') return CONFIG.ALPHA.local.lake;
            return CONFIG.ALPHA.local.admin1;
        }
        if (level === 'regional') {
            if (key === 'coast') return CONFIG.ALPHA.regional.coast;
            if (key === 'border') return CONFIG.ALPHA.regional.border;
            if (key === 'lake') return CONFIG.ALPHA.regional.lake;
            return 0;
        }
        if (key === 'coast') return CONFIG.ALPHA.world.coast;
        if (key === 'border') return CONFIG.ALPHA.world.border;
        return 0;
    }

    /**
     * @param {any} material
     * @param {'world' | 'regional' | 'local'} level
     * @param {number} dprScale
     */
    function applyLevelUniforms(material, level, dprScale) {
        const uniforms = material.uniforms;
        uniforms.uCoast.value = alphaFor(level, 'coast');
        uniforms.uBorder.value = alphaFor(level, 'border');
        uniforms.uLake.value = alphaFor(level, 'lake');
        uniforms.uAdmin1.value = alphaFor(level, 'admin1');
        uniforms.uDprScale.value = dprScale < 1.5 ? CONFIG.ALPHA.lowDprScale : 1;
    }

    /**
     * @param {any} THREE
     * @returns {any}
     */
    function createInkMaterial(THREE) {
        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: false,
            uniforms: {
                uLine: { value: new THREE.Color(CONFIG.INK.line) },
                uAdmin: { value: new THREE.Color(CONFIG.INK.admin1) },
                uHover: { value: new THREE.Color(CONFIG.INK.hover) },
                uCoast: { value: CONFIG.ALPHA.world.coast },
                uBorder: { value: CONFIG.ALPHA.world.border },
                uLake: { value: 0 },
                uAdmin1: { value: 0 },
                uHoverAlpha: { value: CONFIG.ALPHA.hover },
                uHoverAdmin1: { value: CONFIG.ALPHA.hoverAdmin1 },
                uLevelWeight: { value: 0 },
                uDistance: { value: 3 },
                uHoverIdA: { value: 0 },
                uHoverWA: { value: 0 },
                uHoverIdB: { value: 0 },
                uHoverWB: { value: 0 },
                uDprScale: { value: 1 },
                uLimb0: { value: CONFIG.LIMB_FADE[0] },
                uLimb1: { value: CONFIG.LIMB_FADE[1] },
                uFar0: { value: CONFIG.FAR_FADE_D[0] },
                uFar1: { value: CONFIG.FAR_FADE_D[1] },
                uAdminIn: { value: CONFIG.ADMIN1_FADE_D[0] },
                uAdminOut: { value: CONFIG.ADMIN1_FADE_D[1] }
            },
            vertexShader: [
                'attribute vec4 meta;',
                'varying vec3 vColor;',
                'varying float vAlpha;',
                'uniform vec3 uLine;',
                'uniform vec3 uAdmin;',
                'uniform vec3 uHover;',
                'uniform float uCoast;',
                'uniform float uBorder;',
                'uniform float uLake;',
                'uniform float uAdmin1;',
                'uniform float uHoverAlpha;',
                'uniform float uHoverAdmin1;',
                'uniform float uLevelWeight;',
                'uniform float uDistance;',
                'uniform float uHoverIdA;',
                'uniform float uHoverWA;',
                'uniform float uHoverIdB;',
                'uniform float uHoverWB;',
                'uniform float uDprScale;',
                'uniform float uLimb0;',
                'uniform float uLimb1;',
                'uniform float uFar0;',
                'uniform float uFar1;',
                'uniform float uAdminIn;',
                'uniform float uAdminOut;',
                'float ramp(float edge0, float edge1, float x) {',
                '  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);',
                '  return t * t * (3.0 - 2.0 * t);',
                '}',
                'float hoverWeight(float id, float weight) {',
                '  if (weight <= 0.0 || id < 0.5) return 0.0;',
                '  if (abs(meta.y - id) < 0.5 || abs(meta.z - id) < 0.5) return weight;',
                '  return 0.0;',
                '}',
                'void main() {',
                '  float kind = meta.x;',
                '  float alpha = uCoast;',
                '  vec3 ink = uLine;',
                '  if (kind > 2.5) {',
                '    alpha = uAdmin1;',
                '    ink = uAdmin;',
                '  } else if (kind > 1.5) {',
                '    alpha = uLake;',
                '  } else if (kind > 0.5) {',
                '    alpha = uBorder;',
                '  }',
                '  float hover = max(hoverWeight(uHoverIdA, uHoverWA), hoverWeight(uHoverIdB, uHoverWB));',
                '  float hoverAlpha = kind > 2.5 ? uHoverAdmin1 : uHoverAlpha;',
                '  alpha = mix(alpha, hoverAlpha, clamp(hover, 0.0, 1.0));',
                '  ink = mix(ink, uHover, clamp(hover, 0.0, 1.0));',
                '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
                '  vec3 viewNormal = normalize(mat3(modelViewMatrix) * normalize(position));',
                '  vec3 viewDir = normalize(-mvPosition.xyz);',
                '  alpha *= ramp(uLimb0, uLimb1, dot(viewNormal, viewDir));',
                '  alpha *= 1.0 - 0.5 * ramp(uFar0, uFar1, uDistance);',
                '  if (kind > 2.5) alpha *= ramp(uAdminIn, uAdminOut, uDistance);',
                '  alpha *= uLevelWeight * uDprScale;',
                '  vColor = ink;',
                '  vAlpha = alpha;',
                '  gl_Position = projectionMatrix * mvPosition;',
                '}'
            ].join('\n'),
            fragmentShader: [
                'varying vec3 vColor;',
                'varying float vAlpha;',
                'void main() {',
                '  gl_FragColor = vec4(vColor, vAlpha);',
                '  #include <colorspace_fragment>',
                '}'
            ].join('\n')
        });
        return material;
    }

    const GlobeDetail = {
        CONFIG,
        smoothstep,
        wrapPi,
        levelIndex,
        stepLevel,
        shouldFetch,
        normalizeWheel,
        nextAltitudeGoal,
        stepAltitude,
        rotateScale,
        autoRotateScale,
        dotScale,
        clipChanged,
        clipPlanes,
        anchorWeight,
        adjustSpherical,
        crossfadeWeights,
        latLonToXYZ,
        rayUnitSphere,
        splitSegment,
        densifyPoints,
        createEdgeAccumulator,
        addFeatureEdges,
        finalizeWorldEdges,
        worldEdgeStats,
        projectWorldEdges,
        createChunkedLineBuild,
        stepChunkedLineBuild,
        finishChunkedLineBuild,
        buildLineBuffers,
        createInkMaterial,
        applyLevelUniforms
    };

    Object.assign(root, { GlobeDetail });
})(/** @type {typeof globalThis} */ (typeof window !== 'undefined' ? window : globalThis));
