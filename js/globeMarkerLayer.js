/**
 * Photo waypoints as a MapLibre custom layer.
 *
 * Markers keep the old explorer's look: the 64px ring-and-dot texture on a
 * quad lying flat on the sphere at r = 1.0025, sized 0.06 × min(h / 1.6, 1)
 * where h is the camera's altitude in Earth radii. Inside 1.6 radii that
 * holds a constant on-screen size, and it now keeps holding at every zoom.
 * Hover darkens a marker to 0.3, as the old instance colour did.
 *
 * Markers whose rings would overlap on screen merge into one cluster mark
 * drawn at their mean position, with a second hairline ring around it.
 *
 * Classic script. Sets window.GlobeMarkerLayer.
 */
(function attachGlobeMarkerLayer(root) {
    const RADIUS = 1.0025;
    const SIZE = 0.06;
    const FIT_ALTITUDE = 1.6;
    const HOVER_TINT = 0.3;
    /** The ring's outer edge sits at 27.6 of the texture's 32px half-width. */
    const OVERLAP = 0.86;
    const FLOATS_PER_VERTEX = 7;

    const VERTEX = `
attribute vec3 a_pos;
attribute vec2 a_uv;
attribute vec2 a_style;
uniform mat4 u_matrix;
varying vec3 v_pos;
varying vec2 v_uv;
varying float v_tint;
void main() {
    v_pos = a_pos;
    v_uv = vec2((a_uv.x + a_style.y) * 0.5, a_uv.y);
    v_tint = a_style.x;
    vec4 clip = u_matrix * vec4(a_pos, 1.0);
    gl_Position = vec4(clip.xy, 0.0, clip.w);
}`;

    const FRAGMENT = `
uniform sampler2D u_image;
uniform vec3 u_camera;
varying vec3 v_pos;
varying vec2 v_uv;
varying float v_tint;
${root.GlobeGl.OCCLUSION_GLSL}
void main() {
    if (globeHidden(u_camera, v_pos) > 0.5) discard;
    vec4 texel = texture2D(u_image, v_uv);
    if (texel.a < 0.15) discard;
    gl_FragColor = vec4(texel.rgb * v_tint * texel.a, texel.a);
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

    /**
     * Merge places whose markers overlap on screen. Larger places claim
     * their neighbours first, so a cluster's membership is stable while the
     * camera moves.
     * @param {{ key: string, count: number, point: number[], screen: { x: number, y: number } }[]} visible
     * @param {(place: object) => number} diameterPx
     */
    function cluster(visible, diameterPx) {
        const ordered = [...visible].sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
        const taken = new Set();
        const clusters = [];
        for (const seed of ordered) {
            if (taken.has(seed.key)) continue;
            taken.add(seed.key);
            const reach = diameterPx(seed) * OVERLAP;
            const members = [seed];
            for (const other of ordered) {
                if (taken.has(other.key)) continue;
                if (Math.hypot(other.screen.x - seed.screen.x, other.screen.y - seed.screen.y) < reach) {
                    taken.add(other.key);
                    members.push(other);
                }
            }
            clusters.push(members);
        }
        return clusters;
    }

    function meanPoint(members) {
        const sum = members.reduce((acc, m) => [acc[0] + m.point[0], acc[1] + m.point[1], acc[2] + m.point[2]], [0, 0, 0]);
        const len = Math.hypot(sum[0], sum[1], sum[2]) || 1;
        return [sum[0] / len * RADIUS, sum[1] / len * RADIUS, sum[2] / len * RADIUS];
    }

    function tangents(p) {
        const n = [p[0] / RADIUS, p[1] / RADIUS, p[2] / RADIUS];
        const east = Math.hypot(n[0], n[2]) > 1e-6 ? [n[2], 0, -n[0]] : [1, 0, 0];
        const el = Math.hypot(east[0], east[1], east[2]);
        const e = [east[0] / el, east[1] / el, east[2] / el];
        const north = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
        return { e, north };
    }

    function writeQuad(out, offset, center, half, tint, kind) {
        const { e, north } = tangents(center);
        const corner = (sx, sy) => [
            center[0] + (e[0] * sx + north[0] * sy) * half,
            center[1] + (e[1] * sx + north[1] * sy) * half,
            center[2] + (e[2] * sx + north[2] * sy) * half
        ];
        const corners = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, -1, 0, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
        let at = offset;
        for (const [sx, sy, u, v] of corners) {
            out.set(corner(sx, sy), at);
            out[at + 3] = u;
            out[at + 4] = v;
            out[at + 5] = tint;
            out[at + 6] = kind;
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
            places: [],
            hover: new Set(),
            clusters: [],
            vertices: new Float32Array(0)
        };

        return {
            id,
            type: 'custom',
            renderingMode: '2d',
            /** @param {{ key: string, lng: number, lat: number, count: number }[]} places */
            setPlaces(places) {
                state.places = places.map((place) => ({
                    ...place,
                    point: root.GlobeGl.sphere(place.lng, place.lat, RADIUS)
                }));
                state.map?.triggerRepaint();
            },
            setHover(keys) {
                state.hover = new Set(keys);
                state.map?.triggerRepaint();
            },
            /**
             * Drawn marks within `radius` CSS pixels of (x, y), nearest first.
             * @returns {{ keys: string[], distance: number }[]}
             */
            hits(x, y, radius) {
                return state.clusters
                    .map((c) => ({ keys: c.keys, distance: Math.hypot(c.screen.x - x, c.screen.y - y) }))
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
                const matrix = args.modelViewProjectionMatrix;
                const cam = root.GlobeGl.camera(matrix);
                const canvas = state.map.getCanvas();
                const width = canvas.clientWidth;
                const height = canvas.clientHeight;
                const focal = height / 2 / Math.tan(args.fov / 2);
                const size = markerSize(cam.altitude);
                const visible = [];
                for (const place of state.places) {
                    if (root.GlobeGl.occluded(cam, place.point)) continue;
                    const screen = root.GlobeGl.screen(matrix, place.point, width, height);
                    if (screen) visible.push({ ...place, screen });
                }
                const distanceTo = (p) => Math.hypot(p[0] - cam.position[0], p[1] - cam.position[1], p[2] - cam.position[2]);
                const groups = cluster(visible, (place) => (size * focal) / distanceTo(place.point));
                state.clusters = groups.map((members) => {
                    const point = members.length === 1 ? members[0].point : meanPoint(members);
                    return {
                        keys: members.map((m) => m.key),
                        point,
                        screen: members.length === 1
                            ? members[0].screen
                            : root.GlobeGl.screen(matrix, point, width, height) || members[0].screen
                    };
                });
                const vertices = new Float32Array(state.clusters.length * 6 * FLOATS_PER_VERTEX);
                let offset = 0;
                for (const c of state.clusters) {
                    const tint = c.keys.some((key) => state.hover.has(key)) ? HOVER_TINT : 1;
                    offset = writeQuad(vertices, offset, c.point, size / 2, tint, c.keys.length > 1 ? 1 : 0);
                }
                state.vertices = vertices;
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
                const attributes = [['a_pos', 3, 0], ['a_uv', 2, 3], ['a_style', 2, 5]];
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

    root.GlobeMarkerLayer = { create, cluster, markerSize };
})(window);
