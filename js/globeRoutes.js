/**
 * Travel-path arcs for the globe explorer.
 *
 * The routing rules are intentional and must stay stable:
 * - Walk photos in chronological API order (takenAt ASC from /api/photos/geo)
 * - Skip invalid coordinates and same-place repeats
 * - Deduplicate undirected edges so a round-trip does not draw twice
 * - Drop hops shorter than 1 degree so city clusters stay readable
 * - Longer hops are drawn first so short local hops sit on top
 *
 * The stroke is the original hairline: white, additive, and nearly transparent.
 * The path is the same quadratic bulge, except samples that would pass through
 * the globe are lifted back onto it. That is what made a long route north from
 * India vanish into the Himalayas when the camera moved in close.
 */
class GlobeRoutes {
    latLonToVec3(lat, lon, radius, THREE) {
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const theta = THREE.MathUtils.degToRad(lon + 180);
        return new THREE.Vector3(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }

    /**
     * Quadratic bulge from `start` to `end`, including both ends.
     * Matches the original arc. Any sample or chord that would enter the
     * globe is lifted back to ARC_RADIUS.
     * @param {{ x: number, y: number, z: number }} start
     * @param {{ x: number, y: number, z: number }} end
     * @returns {{ x: number, y: number, z: number }[]}
     */
    sampleArc(start, end) {
        const radius = 1.0025;
        const al = Math.hypot(start.x, start.y, start.z) || 1;
        const bl = Math.hypot(end.x, end.y, end.z) || 1;
        const ux = start.x / al;
        const uy = start.y / al;
        const uz = start.z / al;
        const vx = end.x / bl;
        const vy = end.y / bl;
        const vz = end.z / bl;
        const cos = Math.min(1, Math.max(-1, ux * vx + uy * vy + uz * vz));
        const omega = Math.acos(cos);
        const startP = { x: ux * radius, y: uy * radius, z: uz * radius };
        if (omega < 1e-4) {
            return [startP];
        }

        const endP = { x: vx * radius, y: vy * radius, z: vz * radius };
        const dist = Math.hypot(endP.x - startP.x, endP.y - startP.y, endP.z - startP.z);
        const midLen = Math.hypot(ux + vx, uy + vy, uz + vz);
        let cx;
        let cy;
        let cz;
        if (midLen < 1e-6) {
            const side = this._perpendicular(ux, uy, uz);
            cx = side.x;
            cy = side.y;
            cz = side.z;
        } else {
            cx = (ux + vx) / midLen;
            cy = (uy + vy) / midLen;
            cz = (uz + vz) / midLen;
        }
        const controlR = radius + dist * 0.3;
        const control = { x: cx * controlR, y: cy * controlR, z: cz * controlR };
        const angleDeg = (omega * 180) / Math.PI;
        const segments = Math.max(8, Math.min(32, Math.ceil(angleDeg / 4)));
        const rough = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const omt = 1 - t;
            rough.push(this._liftAbove({
                x: omt * omt * startP.x + 2 * omt * t * control.x + t * t * endP.x,
                y: omt * omt * startP.y + 2 * omt * t * control.y + t * t * endP.y,
                z: omt * omt * startP.z + 2 * omt * t * control.z + t * t * endP.z,
            }, radius));
        }
        return this._splitLowChords(rough, radius);
    }

    _liftAbove(point, radius) {
        const len = Math.hypot(point.x, point.y, point.z) || 1;
        if (len >= radius) {
            return point;
        }
        const scale = radius / len;
        return { x: point.x * scale, y: point.y * scale, z: point.z * scale };
    }

    _closestRadius(a, b) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const ab2 = abx * abx + aby * aby + abz * abz;
        const t = ab2 === 0
            ? 0
            : Math.max(0, Math.min(1, -(a.x * abx + a.y * aby + a.z * abz) / ab2));
        return Math.hypot(a.x + abx * t, a.y + aby * t, a.z + abz * t);
    }

    _splitLowChords(points, radius) {
        const floor = 1.002;
        const out = [points[0]];
        for (let i = 1; i < points.length; i++) {
            this._appendChord(out, points[i - 1], points[i], radius, floor, 0);
        }
        return out;
    }

    _appendChord(out, a, b, radius, floor, depth) {
        if (depth > 8 || this._closestRadius(a, b) >= floor) {
            out.push(b);
            return;
        }
        const mid = this._liftAbove({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            z: (a.z + b.z) / 2,
        }, radius);
        this._appendChord(out, a, mid, radius, floor, depth + 1);
        this._appendChord(out, mid, b, radius, floor, depth + 1);
    }

    _perpendicular(x, y, z) {
        let wx = -z;
        let wy = 0;
        let wz = x;
        let mag = Math.hypot(wx, wy, wz);
        if (mag < 1e-4) {
            wx = 0;
            wy = -z;
            wz = y;
            mag = Math.hypot(wx, wy, wz);
        }
        return { x: wx / mag, y: wy / mag, z: wz / mag };
    }

    buildArcs(THREE, group, locations, locationKeyFor) {
        if (!Array.isArray(locations) || locations.length < 2) {
            return null;
        }

        const radius = 1.0025;
        const minArcAngle = THREE.MathUtils.degToRad(1.0);
        const seenEdges = new Set();
        const arcs = [];
        let prev = null;
        let prevKey = '';
        let sequence = 0;

        for (const loc of locations) {
            const lat = Number(loc?.latitude);
            const lon = Number(loc?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                continue;
            }

            const locKey = locationKeyFor(loc);
            if (!prev) {
                prev = loc;
                prevKey = locKey;
                continue;
            }

            if (locKey === prevKey) {
                continue;
            }

            const edgeKey = [prevKey, locKey].sort().join('->');
            if (!seenEdges.has(edgeKey)) {
                const start = this.latLonToVec3(prev.latitude, prev.longitude, radius, THREE);
                const end = this.latLonToVec3(lat, lon, radius, THREE);
                const angle = start.clone().normalize().angleTo(end.clone().normalize());
                if (angle >= minArcAngle) {
                    seenEdges.add(edgeKey);
                    arcs.push({ start, end, angle, sequence });
                    sequence += 1;
                }
            }

            prev = loc;
            prevKey = locKey;
        }

        if (!arcs.length) {
            return null;
        }

        arcs.sort((a, b) => {
            if (b.angle !== a.angle) {
                return b.angle - a.angle;
            }
            return a.sequence - b.sequence;
        });

        const segmentPoints = [];
        for (const arc of arcs) {
            const points = this.sampleArc(arc.start, arc.end);
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1];
                const b = points[i];
                segmentPoints.push(
                    new THREE.Vector3(a.x, a.y, a.z),
                    new THREE.Vector3(b.x, b.y, b.z),
                );
            }
        }

        if (!segmentPoints.length) {
            return null;
        }

        const arcMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const arcLines = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(segmentPoints),
            arcMat,
        );
        arcLines.renderOrder = 1;
        group.add(arcLines);
        return arcLines;
    }
}

window.GlobeRoutes = GlobeRoutes;
window.globeRoutes = window.globeRoutes || new GlobeRoutes();
