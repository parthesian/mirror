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
 * Each hop is a great-circle ribbon lifted off the sphere. A quadratic bulge
 * used to fall through the globe past about 100 degrees, so a route crossing
 * a bright range (the Himalayas, for example) vanished into the texture when
 * the camera moved in close. The ribbon stays outside the mesh, biases its
 * depth toward the camera, and carries a dark edge so snow cannot swallow it.
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
     * Great-circle samples from `start` to `end`, including both ends.
     * Every sample sits at least ARC_RADIUS above the origin. The peak lift
     * tracks the old short-hop bulge and does not collapse on long hops.
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
        if (omega < 1e-4) {
            return [{ x: ux * radius, y: uy * radius, z: uz * radius }];
        }

        const dist = 2 * Math.sin(omega / 2) * radius;
        const liftScale = Math.max(0.05, 0.148 / (1 + dist * 0.85));
        const maxStep = (1.5 * Math.PI) / 180;
        const segments = Math.max(8, Math.ceil(omega / maxStep));
        const points = [];
        const antipodal = cos < -0.999999;
        let wx = 0;
        let wy = 0;
        let wz = 0;
        if (antipodal) {
            const side = this._perpendicular(ux, uy, uz);
            wx = side.x;
            wy = side.y;
            wz = side.z;
        }
        const sinOmega = Math.sin(omega);

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            let dx;
            let dy;
            let dz;
            if (antipodal) {
                const swing = Math.PI * t;
                dx = Math.cos(swing) * ux + Math.sin(swing) * wx;
                dy = Math.cos(swing) * uy + Math.sin(swing) * wy;
                dz = Math.cos(swing) * uz + Math.sin(swing) * wz;
            } else {
                const s0 = Math.sin((1 - t) * omega) / sinOmega;
                const s1 = Math.sin(t * omega) / sinOmega;
                dx = ux * s0 + vx * s1;
                dy = uy * s0 + vy * s1;
                dz = uz * s0 + vz * s1;
            }
            const mag = Math.hypot(dx, dy, dz) || 1;
            const lift = Math.sin(Math.PI * t) * dist * liftScale;
            const r = radius + lift;
            points.push({ x: (dx / mag) * r, y: (dy / mag) * r, z: (dz / mag) * r });
        }
        return points;
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

    _createRouteMaterial(THREE) {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: false,
            side: THREE.FrontSide,
            toneMapped: false,
            uniforms: {
                uResolution: { value: new THREE.Vector2(1, 1) },
                uHalfWidth: { value: 1.4 },
                uDepthBias: { value: 0.01 }
            },
            vertexShader: [
                'attribute vec3 aOther;',
                'attribute float aSide;',
                'attribute float aT;',
                'uniform vec2 uResolution;',
                'uniform float uHalfWidth;',
                'uniform float uDepthBias;',
                'varying float vSide;',
                'varying float vFade;',
                'varying float vKeep;',
                'void main() {',
                '  vec3 startPos = aT < 0.5 ? position : aOther;',
                '  vec3 endPos = aT < 0.5 ? aOther : position;',
                '  vec4 viewA = modelViewMatrix * vec4(startPos, 1.0);',
                '  vec4 viewB = modelViewMatrix * vec4(endPos, 1.0);',
                '  viewA.z += uDepthBias;',
                '  viewB.z += uDepthBias;',
                '  vec4 clipA = projectionMatrix * viewA;',
                '  vec4 clipB = projectionMatrix * viewB;',
                '  vec4 clip = aT < 0.5 ? clipA : clipB;',
                '  vec2 resolution = max(uResolution, vec2(1.0));',
                '  vec2 dirPx = ((clipB.xy / max(clipB.w, 1e-4)) - (clipA.xy / max(clipA.w, 1e-4))) * resolution * 0.5;',
                '  float lenPx = length(dirPx);',
                '  vec2 normal = lenPx < 0.001 ? vec2(0.0, 1.0) : vec2(-dirPx.y, dirPx.x) / lenPx;',
                '  vec2 offsetNdc = (normal * aSide * uHalfWidth) / (resolution * 0.5);',
                '  clip.xy += offsetNdc * clip.w;',
                '  vec3 radial = normalize(mat3(modelMatrix) * position);',
                '  float horizon = 1.0 / max(length(cameraPosition), 1.05);',
                '  float facing = dot(radial, normalize(cameraPosition));',
                '  float edge0 = horizon - 0.02;',
                '  float edge1 = horizon + 0.05;',
                '  float t = clamp((facing - edge0) / max(edge1 - edge0, 1e-4), 0.0, 1.0);',
                '  vFade = t * t * (3.0 - 2.0 * t);',
                '  vKeep = (clipA.w > 0.02 && clipB.w > 0.02) ? 1.0 : 0.0;',
                '  vSide = aSide;',
                '  gl_Position = clip;',
                '}'
            ].join('\n'),
            fragmentShader: [
                'varying float vSide;',
                'varying float vFade;',
                'varying float vKeep;',
                'void main() {',
                '  if (vKeep < 0.5) discard;',
                '  float dist = abs(vSide);',
                '  float core = 1.0 - smoothstep(0.34, 0.56, dist);',
                '  float ink = 1.0 - smoothstep(0.72, 1.0, dist);',
                '  vec3 groove = vec3(0.07, 0.07, 0.07);',
                '  vec3 paper = vec3(0.93, 0.94, 0.95);',
                '  float alpha = ink * mix(0.86, 0.96, core) * vFade;',
                '  if (alpha < 0.02) discard;',
                '  gl_FragColor = vec4(mix(groove, paper, core), alpha);',
                '  #include <colorspace_fragment>',
                '}'
            ].join('\n')
        });
    }

    _pushRouteVert(buffers, point, other, side, t) {
        buffers.positions.push(point.x, point.y, point.z);
        buffers.others.push(other.x, other.y, other.z);
        buffers.sides.push(side);
        buffers.ts.push(t);
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

        const buffers = { positions: [], others: [], sides: [], ts: [] };
        for (const arc of arcs) {
            const points = this.sampleArc(arc.start, arc.end);
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1];
                const b = points[i];
                // Winding is reversed from the screen-space left normal so the
                // ribbon faces the camera. Front-face culling otherwise drops it.
                this._pushRouteVert(buffers, a, b, 1, 0);
                this._pushRouteVert(buffers, a, b, -1, 0);
                this._pushRouteVert(buffers, b, a, 1, 1);
                this._pushRouteVert(buffers, a, b, 1, 0);
                this._pushRouteVert(buffers, b, a, -1, 1);
                this._pushRouteVert(buffers, b, a, 1, 1);
            }
        }

        if (!buffers.positions.length) {
            return null;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
        geometry.setAttribute('aOther', new THREE.Float32BufferAttribute(buffers.others, 3));
        geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(buffers.sides, 1));
        geometry.setAttribute('aT', new THREE.Float32BufferAttribute(buffers.ts, 1));
        const arcLines = new THREE.Mesh(geometry, this._createRouteMaterial(THREE));
        arcLines.renderOrder = 1;
        arcLines.frustumCulled = false;
        // Screen-space triangles are not a pick target. Dots handle that.
        arcLines.raycast = () => {};
        group.add(arcLines);
        return arcLines;
    }
}

window.GlobeRoutes = GlobeRoutes;
window.globeRoutes = window.globeRoutes || new GlobeRoutes();
