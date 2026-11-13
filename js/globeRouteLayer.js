/**
 * Route arcs and the click pulse, drawn as hairlines above the globe.
 *
 * Both keep the old Three.js look: one-pixel white lines with additive
 * blending, arcs at 0.12 and pulse rings fading out from 0.52. A fragment
 * behind the sphere is dropped, which stands in for the old depth test.
 *
 * Classic script. Sets window.GlobeRouteLayer.
 */
(function attachGlobeRouteLayer(root) {
    const VERTEX = `
attribute vec3 a_pos;
uniform mat4 u_matrix;
varying vec3 v_pos;
void main() {
    v_pos = a_pos;
    vec4 clip = u_matrix * vec4(a_pos, 1.0);
    gl_Position = vec4(clip.xy, 0.0, clip.w);
}`;

    const FRAGMENT = `
uniform vec3 u_camera;
uniform float u_opacity;
varying vec3 v_pos;
${root.GlobeGl.OCCLUSION_GLSL}
void main() {
    if (globeHidden(u_camera, v_pos) > 0.5) discard;
    gl_FragColor = vec4(vec3(u_opacity), u_opacity * u_opacity);
}`;

    const ARC_OPACITY = 0.12;
    const PULSE = {
        rings: 3,
        points: 96,
        radius: 1.003,
        duration: 580,
        delay: 130,
        minAngle: 0.4,
        maxAngle: 3.7,
        opacity: 0.52
    };

    /** The old explorer scaled pulses with altitude and froze them at 1.6 radii. */
    function pulseScale(altitude) {
        return Math.min(Math.max(altitude, 0) / 1.6, 1);
    }

    function pulseRing(center, angle) {
        const [cx, cy, cz] = center;
        const seed = Math.abs(cy) < 0.92 ? [0, 1, 0] : [1, 0, 0];
        const a = normalize(cross(seed, center));
        const b = normalize(cross(center, a));
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const out = new Float32Array(PULSE.points * 3);
        for (let i = 0; i < PULSE.points; i++) {
            const theta = (i / PULSE.points) * Math.PI * 2;
            const x = Math.cos(theta) * sin;
            const y = Math.sin(theta) * sin;
            const p = normalize([
                cx * cos + a[0] * x + b[0] * y,
                cy * cos + a[1] * x + b[1] * y,
                cz * cos + a[2] * x + b[2] * y
            ]);
            out.set([p[0] * PULSE.radius, p[1] * PULSE.radius, p[2] * PULSE.radius], i * 3);
        }
        return out;
    }

    /**
     * Ring angles and opacities for one pulse at `elapsed` milliseconds.
     * @returns {{ angle: number, opacity: number }[] | null} null once every ring is done
     */
    function pulseFrame(elapsed, scale) {
        let running = false;
        const rings = [];
        for (let i = 0; i < PULSE.rings; i++) {
            const progress = (elapsed - i * PULSE.delay) / PULSE.duration;
            if (progress < 1) running = true;
            if (progress <= 0 || progress >= 1) continue;
            const eased = 1 - (1 - progress) ** 3;
            const degrees = PULSE.minAngle + (PULSE.maxAngle - PULSE.minAngle) * eased;
            rings.push({
                angle: degrees * root.GlobeGl.DEG * scale,
                opacity: PULSE.opacity * Math.min(progress / 0.12, 1) * (1 - progress) ** 1.35
            });
        }
        return running ? rings : null;
    }

    function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

    function normalize(v) {
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    function create(id) {
        const state = { map: null, program: null, arcs: null, arcCount: 0, ring: null, pulses: [], segments: null };

        return {
            id,
            type: 'custom',
            renderingMode: '2d',
            setArcs(segments) {
                state.segments = segments;
                state.arcCount = 0;
                state.map?.triggerRepaint();
            },
            pulse(lng, lat) {
                state.pulses.push({ center: root.GlobeGl.sphere(lng, lat), startedAt: performance.now() });
                state.map?.triggerRepaint();
            },
            onAdd(map, gl) {
                state.map = map;
                state.program = root.GlobeGl.program(gl, {
                    vertex: VERTEX,
                    fragment: FRAGMENT,
                    attributes: ['a_pos'],
                    uniforms: ['u_matrix', 'u_camera', 'u_opacity']
                });
                state.arcs = gl.createBuffer();
                state.ring = gl.createBuffer();
            },
            onRemove(_map, gl) {
                gl.deleteProgram(state.program?.handle);
                gl.deleteBuffer(state.arcs);
                gl.deleteBuffer(state.ring);
                state.map = null;
            },
            render(gl, args) {
                const { program } = state;
                const matrix = args.modelViewProjectionMatrix;
                const cam = root.GlobeGl.camera(matrix);
                root.GlobeGl.unbindVertexArray(gl);
                gl.useProgram(program.handle);
                gl.uniformMatrix4fv(program.uniforms.u_matrix, false, new Float32Array(matrix));
                gl.uniform3fv(program.uniforms.u_camera, cam.position);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.CULL_FACE);

                if (state.segments) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, state.arcs);
                    gl.bufferData(gl.ARRAY_BUFFER, state.segments, gl.STATIC_DRAW);
                    state.arcCount = state.segments.length / 3;
                    state.segments = null;
                }
                if (state.arcCount) {
                    gl.uniform1f(program.uniforms.u_opacity, ARC_OPACITY);
                    root.GlobeGl.bindAttribute(gl, state.arcs, program.attributes.a_pos, 3);
                    gl.drawArrays(gl.LINES, 0, state.arcCount);
                }

                const now = performance.now();
                const scale = pulseScale(cam.altitude);
                state.pulses = state.pulses.filter((pulse) => {
                    const rings = pulseFrame(now - pulse.startedAt, scale);
                    for (const ring of rings || []) {
                        gl.bindBuffer(gl.ARRAY_BUFFER, state.ring);
                        gl.bufferData(gl.ARRAY_BUFFER, pulseRing(pulse.center, ring.angle), gl.DYNAMIC_DRAW);
                        gl.uniform1f(program.uniforms.u_opacity, ring.opacity);
                        root.GlobeGl.bindAttribute(gl, state.ring, program.attributes.a_pos, 3);
                        gl.drawArrays(gl.LINE_LOOP, 0, PULSE.points);
                    }
                    return rings !== null;
                });
                gl.disableVertexAttribArray(program.attributes.a_pos);
                if (state.pulses.length) state.map.triggerRepaint();
            }
        };
    }

    root.GlobeRouteLayer = { create, pulseFrame, pulseScale };
})(window);
