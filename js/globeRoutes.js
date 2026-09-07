/**
 * Travel-path arcs for the globe explorer.
 *
 * The routing rules are intentional and must stay stable:
 * - Walk photos in chronological API order (takenAt ASC from /api/photos/geo)
 * - Skip invalid coordinates and same-place repeats
 * - Deduplicate undirected edges so a round-trip does not draw twice
 * - Drop hops shorter than 1 degree so city clusters stay readable
 * - Longer hops are drawn first so short local hops sit on top
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

    buildArcs(THREE, group, locations, locationKeyFor) {
        if (!Array.isArray(locations) || locations.length < 2) {
            return null;
        }

        const radius = 1.01;
        const minArcAngle = THREE.MathUtils.degToRad(1.0);
        const arcMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

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
            const mid = new THREE.Vector3().addVectors(arc.start, arc.end).multiplyScalar(0.5);
            const dist = arc.start.distanceTo(arc.end);
            mid.normalize().multiplyScalar(radius + dist * 0.3);

            const curve = new THREE.QuadraticBezierCurve3(arc.start, mid, arc.end);
            const angleDeg = THREE.MathUtils.radToDeg(arc.angle);
            const segments = Math.max(8, Math.min(32, Math.ceil(angleDeg / 4)));
            const points = curve.getPoints(segments);
            for (let i = 1; i < points.length; i++) {
                segmentPoints.push(points[i - 1], points[i]);
            }
        }

        const lineGeo = new THREE.BufferGeometry().setFromPoints(segmentPoints);
        const arcLines = new THREE.LineSegments(lineGeo, arcMat);
        arcLines.renderOrder = 1;
        group.add(arcLines);
        return arcLines;
    }
}

window.GlobeRoutes = GlobeRoutes;
window.globeRoutes = window.globeRoutes || new GlobeRoutes();
