/**
 * Photo waypoints as a MapLibre custom layer.
 *
 * Markers keep the old explorer's look: the 64px ring-and-dot texture on a
 * quad lying flat on the sphere 0.0025 radii up, sized 0.06 × min(h / 1.6, 1)
 * where h is the camera's altitude in Earth radii. Inside 1.6 radii that
 * holds a constant on-screen size, and it keeps holding at every zoom.
 * Close in, the height eases to zero (GlobeGl.surfaceLift) so the camera
 * never reaches a marker. Hover darkens a marker to 0.3, as the old instance
 * colour did.
 *
 * Markers that would overlap merge into one cluster mark, drawn at their
 * mean position with a second hairline ring. Clusters are built once per
 * altitude level from great-circle distances, so panning never changes
 * them. MapLibre holds the camera's altitude fixed while panning, though
 * not its zoom number. Changing level slides marks between their old and
 * new clusters.
 *
 * Classic script. Sets window.GlobeMarkerLayer.
 */
(function attachGlobeMarkerLayer(root) {
    const HEIGHT = 0.0025;
    const SIZE = 0.06;
    const FIT_ALTITUDE = 1.6;
    const HOVER_TINT = 0.3;
    /** The ring's outer edge sits at 27.6 of the texture's 32px half-width. */
    const OVERLAP = 0.86;
    /** Levels are quarter steps of -log2(altitude), from 8 radii down to street level. */
    const LEVEL = { step: 0.25, hysteresis: 0.08, min: -12, max: 44 };
    const TRANSITION_MS = 260;
    const FLOATS_PER_VERTEX = 8;

    const VERTEX = `
attribute vec3 a_pos;
attribute vec2 a_uv;
attribute vec3 a_style;
uniform mat4 u_matrix;
varying vec3 v_pos;
varying vec2 v_uv;
varying vec3 v_style;
void main() {
    v_pos = a_pos;
    v_uv = a_uv;
    v_style = a_style;
    vec4 clip = u_matrix * vec4(a_pos, 1.0);
    gl_Position = vec4(clip.xy, 0.0, clip.w);
}`;

    const FRAGMENT = `
uniform sampler2D u_image;
uniform vec3 u_camera;
varying vec3 v_pos;
varying vec2 v_uv;
varying vec3 v_style;
${root.GlobeGl.OCCLUSION_GLSL}
void main() {
    if (globeHidden(u_camera, v_pos) > 0.5) discard;
    vec4 single = texture2D(u_image, vec2(v_uv.x * 0.5, v_uv.y));
    vec4 grouped = texture2D(u_image, vec2(v_uv.x * 0.5 + 0.5, v_uv.y));
    vec4 texel = mix(single, grouped, v_style.y);
    if (texel.a < 0.15) discard;
    gl_FragColor = vec4(texel.rgb * v_style.x * texel.a, texel.a) * v_style.z;
}`;

    function markerSize(altitude) {
        return SIZE * Math.min(Math.max(altitude, 0) / FIT_ALTITUDE, 1);
    }

    function drawMarker(ctx, cx) {
        const cy = 32;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(12, 12, 12, 0.92)';
        ctx.lineWidth = 7.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(244, 244, 244, 0.98)';
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.arc(cx, cy, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(12, 12, 12, 0.94)';
        ctx.beginPath();
        ctx.arc(cx, cy, 5.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(248, 248, 248, 0.98)';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
        ctx.fill();
    }

    /** Left cell: a single place. Right cell: the same mark with a cluster ring. */
    function markerAtlas() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        drawMarker(ctx, 32);
        drawMarker(ctx, 96);
        ctx.strokeStyle = 'rgba(12, 12, 12, 0.7)';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(96, 32, 30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(244, 244, 244, 0.8)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(96, 32, 30, 0, Math.PI * 2);
        ctx.stroke();
        return canvas;
    }

    function normalize(v) {
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    /**
     * Two marks merge when their centres are closer than this many radians:
     * the marker's angular size at the middle of the level, within 15% of
     * the screen rule anywhere the level is shown.
     */
    function levelThreshold(level) {
        const altitude = 2 ** -((level + 0.5) * LEVEL.step);
        return markerSize(altitude) * OVERLAP;
    }

    /**
     * Merge clusters whose centres lie within `threshold` radians. Larger
     * clusters claim their neighbours first. A grid of cells one threshold
     * wide keeps the search local.
     */
    function mergeClusters(clusters, threshold) {
        const chord = 2 * Math.sin(threshold / 2);
        const cell = (v) => v.map((x) => Math.floor(x / chord));
        const grid = new Map();
        clusters.forEach((c, index) => {
            const id = cell(c.dir).join(',');
            grid.set(id, [...(grid.get(id) || []), index]);
        });
        const ordered = clusters
            .map((c, index) => ({ c, index }))
            .sort((a, b) => (b.c.count - a.c.count) || a.c.keys[0].localeCompare(b.c.keys[0]));
        const taken = new Set();
        const merged = [];
        for (const { c: seed, index } of ordered) {
            if (taken.has(index)) continue;
            taken.add(index);
            const members = [seed];
            const [cx, cy, cz] = cell(seed.dir);
            for (let x = cx - 1; x <= cx + 1; x++) {
                for (let y = cy - 1; y <= cy + 1; y++) {
                    for (let z = cz - 1; z <= cz + 1; z++) {
                        for (const other of grid.get(`${x},${y},${z}`) || []) {
                            if (taken.has(other)) continue;
                            const d = clusters[other].dir;
                            if (Math.hypot(d[0] - seed.dir[0], d[1] - seed.dir[1], d[2] - seed.dir[2]) < chord) {
                                taken.add(other);
                                members.push(clusters[other]);
                            }
                        }
                    }
                }
            }
            merged.push(members.length === 1 ? seed : {
                keys: members.flatMap((m) => m.keys),
                places: members.flatMap((m) => m.places),
                count: members.reduce((sum, m) => sum + m.count, 0),
                dir: normalize(members.reduce(
                    (sum, m) => [sum[0] + m.dir[0] * m.count, sum[1] + m.dir[1] * m.count, sum[2] + m.dir[2] * m.count],
                    [0, 0, 0]
                ))
            });
        }
        return merged;
    }

    /**
     * Cluster levels from street level out. Each level merges whole clusters
     * of the level below it, so zooming out only merges and zooming in only
     * splits. `of[i]` is the cluster holding place i, whose key is `keys[i]`.
     * @param {{ key: string, lng: number, lat: number, count: number }[]} places
     * @returns {Map<number, { clusters: { keys: string[], count: number, dir: number[] }[], of: Int32Array, keys: string[] }>}
     */
    function clusterLevels(places) {
        const keys = places.map((place) => place.key);
        let clusters = places.map((place, index) => ({
            keys: [place.key],
            places: [index],
            count: place.count,
            dir: root.GlobeGl.sphere(place.lng, place.lat)
        }));
        const levels = new Map();
        for (let level = LEVEL.max; level >= LEVEL.min; level--) {
            clusters = mergeClusters(clusters, levelThreshold(level));
            const of = new Int32Array(places.length);
            clusters.forEach((c, index) => {
                for (const place of c.places) of[place] = index;
            });
            levels.set(level, { clusters, of, keys });
        }
        return levels;
    }

    /** The level for `altitude`, staying on `current` until the camera is clearly past it. */
    function levelFor(altitude, current) {
        const lod = -Math.log2(Math.max(altitude, 1e-9));
        const natural = Math.min(Math.max(Math.floor(lod / LEVEL.step), LEVEL.min), LEVEL.max);
        if (current === null) return natural;
        const low = current * LEVEL.step - LEVEL.hysteresis;
        const high = (current + 1) * LEVEL.step + LEVEL.hysteresis;
        return lod >= low && lod < high ? current : natural;
    }

    function progress(startedAt, now) {
        const raw = Math.min(Math.max((now - startedAt) / TRANSITION_MS, 0), 1);
        return raw * raw * (3 - 2 * raw);
    }

    /** Where a mark is drawn at eased progress `t`. */
    function drawnAt(mark, t) {
        const mix = (a, b) => a + (b - a) * t;
        return {
            dir: normalize(mark.start.dir.map((v, axis) => mix(v, mark.end.dir[axis]))),
            kind: mix(mark.start.kind, mark.end.kind),
            alpha: mix(mark.start.alpha, mark.end.alpha)
        };
    }

    /**
     * Marks that move to `level`'s clusters from wherever `previous` marks
     * are drawn at progress `t`, so a change of level mid-move never jumps.
     * There is one mark per (previous mark, new cluster) pair. The first
     * pair of a previous mark keeps its opacity and the brightest pair of a
     * new cluster stays at the end; the rest fade. With no `previous`, each
     * cluster gets one still mark.
     * @returns {{ marks: { keys: string[], start: object, end: object }[], markOf: Int32Array }}
     */
    function retarget(previous, level, t) {
        const groups = new Map();
        const markOf = new Int32Array(level.of.length);
        level.of.forEach((to, place) => {
            const was = previous ? previous.markOf[place] : -1;
            const id = `${was}:${to}`;
            if (!groups.has(id)) groups.set(id, { index: groups.size, was, to, keys: [] });
            const group = groups.get(id);
            group.keys.push(level.keys[place]);
            markOf[place] = group.index;
        });
        const led = new Set();
        const marks = [...groups.values()].map(({ was, to, keys }) => {
            const cluster = level.clusters[to];
            const end = { dir: cluster.dir, kind: cluster.keys.length > 1 ? 1 : 0, alpha: 0 };
            if (was < 0) return { keys, to, start: { ...end, alpha: 1 }, end };
            const from = drawnAt(previous.marks[was], t);
            const start = { ...from, alpha: led.has(was) ? 0 : from.alpha };
            led.add(was);
            return { keys, to, start, end };
        });
        const brightest = new Map();
        for (const mark of marks) {
            const best = brightest.get(mark.to);
            if (!best || mark.start.alpha > best.start.alpha) brightest.set(mark.to, mark);
        }
        for (const mark of brightest.values()) mark.end.alpha = 1;
        return { marks, markOf };
    }

    function tangents(n) {
        const east = Math.hypot(n[0], n[2]) > 1e-6 ? [n[2], 0, -n[0]] : [1, 0, 0];
        const e = normalize(east);
        const north = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
        return { e, north };
    }

    function writeQuad(out, offset, dir, radius, half, style) {
        const { e, north } = tangents(dir);
        const corners = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, -1, 0, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
        let at = offset;
        for (const [sx, sy, u, v] of corners) {
            for (let axis = 0; axis < 3; axis++) {
                out[at + axis] = dir[axis] * radius + (e[axis] * sx + north[axis] * sy) * half;
            }
            out[at + 3] = u;
            out[at + 4] = v;
            out.set(style, at + 5);
            at += FLOATS_PER_VERTEX;
        }
        return at;
    }

    function create(id) {
        const state = {
            map: null,
            program: null,
            buffer: null,
            texture: null,
            levels: new Map(),
            hover: new Set(),
            shown: { level: null, startedAt: -Infinity, marks: [], markOf: new Int32Array(0) },
            marks: [],
            vertices: new Float32Array(0)
        };

        const reducedMotion = () => Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

        function show(level, now) {
            const { shown } = state;
            if (level === shown.level) {
                if (shown.startedAt > -Infinity && progress(shown.startedAt, now) === 1) {
                    state.shown = { ...retarget(null, state.levels.get(level)), level, startedAt: -Infinity };
                }
                return;
            }
            const first = shown.level === null;
            state.shown = {
                ...retarget(first ? null : shown, state.levels.get(level), progress(shown.startedAt, now)),
                level,
                startedAt: first || reducedMotion() ? -Infinity : now
            };
        }

        return {
            id,
            type: 'custom',
            renderingMode: '2d',
            /** @param {{ key: string, lng: number, lat: number, count: number }[]} places */
            setPlaces(places) {
                state.levels = clusterLevels(places);
                state.shown = { level: null, startedAt: -Infinity, marks: [], markOf: new Int32Array(0) };
                state.map?.triggerRepaint();
            },
            setHover(keys) {
                state.hover = new Set(keys);
                state.map?.triggerRepaint();
            },
            /** The level on screen and its clusters' place keys. */
            get clusters() {
                const level = state.levels.get(state.shown.level);
                return { level: state.shown.level, groups: level ? level.clusters.map((c) => c.keys) : [] };
            },
            /**
             * Drawn marks within `radius` CSS pixels of (x, y), nearest first.
             * @returns {{ keys: string[], distance: number }[]}
             */
            hits(x, y, radius) {
                return state.marks
                    .map((m) => ({ keys: m.keys, distance: Math.hypot(m.screen.x - x, m.screen.y - y) }))
                    .filter((hit) => hit.distance <= radius)
                    .sort((a, b) => a.distance - b.distance);
            },
            onAdd(map, gl) {
                state.map = map;
                state.program = root.GlobeGl.program(gl, {
                    vertex: VERTEX,
                    fragment: FRAGMENT,
                    attributes: ['a_pos', 'a_uv', 'a_style'],
                    uniforms: ['u_matrix', 'u_camera', 'u_image']
                });
                state.buffer = gl.createBuffer();
                state.texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, state.texture);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, markerAtlas());
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            },
            onRemove(_map, gl) {
                gl.deleteProgram(state.program?.handle);
                gl.deleteBuffer(state.buffer);
                gl.deleteTexture(state.texture);
                state.map = null;
            },
            prerender(_gl, args) {
                if (!state.levels.size) return;
                const matrix = args.modelViewProjectionMatrix;
                const cam = root.GlobeGl.camera(matrix);
                const canvas = state.map.getCanvas();
                const now = performance.now();
                show(levelFor(cam.altitude, state.shown.level), now);
                const t = progress(state.shown.startedAt, now);
                if (t < 1) state.map.triggerRepaint();

                const radius = 1 + root.GlobeGl.liftHeight(HEIGHT, root.GlobeGl.surfaceLift(cam.altitude), cam.altitude);
                const half = markerSize(cam.altitude) / 2;
                const vertices = new Float32Array(state.shown.marks.length * 6 * FLOATS_PER_VERTEX);
                const marks = [];
                let offset = 0;
                for (const mark of state.shown.marks) {
                    const { dir, kind, alpha } = drawnAt(mark, t);
                    if (alpha <= 0) continue;
                    const point = dir.map((v) => v * radius);
                    if (root.GlobeGl.occluded(cam, point)) continue;
                    const tint = mark.keys.some((key) => state.hover.has(key)) ? HOVER_TINT : 1;
                    offset = writeQuad(vertices, offset, dir, radius, half, [tint, kind, alpha]);
                    const screen = root.GlobeGl.screen(matrix, point, canvas.clientWidth, canvas.clientHeight);
                    if (screen && alpha >= 0.5) marks.push({ keys: mark.keys, screen });
                }
                state.vertices = vertices.subarray(0, offset);
                state.marks = marks;
            },
            render(gl, args) {
                const { program } = state;
                const count = state.vertices.length / FLOATS_PER_VERTEX;
                if (!count) return;
                const matrix = args.modelViewProjectionMatrix;
                root.GlobeGl.unbindVertexArray(gl);
                gl.useProgram(program.handle);
                gl.uniformMatrix4fv(program.uniforms.u_matrix, false, new Float32Array(matrix));
                gl.uniform3fv(program.uniforms.u_camera, root.GlobeGl.camera(matrix).position);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, state.texture);
                gl.uniform1i(program.uniforms.u_image, 0);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.CULL_FACE);
                gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, state.vertices, gl.DYNAMIC_DRAW);
                const stride = FLOATS_PER_VERTEX * 4;
                const attributes = [['a_pos', 3, 0], ['a_uv', 2, 3], ['a_style', 3, 5]];
                for (const [name, size, at] of attributes) {
                    const location = program.attributes[name];
                    gl.enableVertexAttribArray(location);
                    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, at * 4);
                }
                gl.drawArrays(gl.TRIANGLES, 0, count);
                for (const [name] of attributes) {
                    gl.disableVertexAttribArray(program.attributes[name]);
                }
            }
        };
    }

    root.GlobeMarkerLayer = { create, markerSize, clusterLevels, levelFor, retarget, drawnAt };
})(window);
