/**
 * Shared WebGL plumbing for the explorer's MapLibre custom layers.
 *
 * MapLibre's globe draws the unit sphere with lng/lat mapped to
 * (sin lng cos lat, sin lat, cos lng cos lat). Custom layers here place
 * their geometry in that space and use the uncorrected view-projection
 * matrix MapLibre hands to custom layers, the one `map.project` uses.
 *
 * Shaders are written once in GLSL ES 1.00 and promoted to 3.00 on WebGL2.
 *
 * Classic script. Sets window.GlobeGl.
 */
(function attachGlobeGl(root) {
    const DEG = Math.PI / 180;

    function sphere(lng, lat, radius = 1) {
        const lam = lng * DEG;
        const phi = lat * DEG;
        const c = Math.cos(phi) * radius;
        return [Math.sin(lam) * c, Math.sin(phi) * radius, Math.cos(lam) * c];
    }

    function lngLat(x, y, z) {
        const len = Math.hypot(x, y, z) || 1;
        return {
            lng: Math.atan2(x, z) / DEG,
            lat: Math.asin(Math.max(-1, Math.min(1, y / len))) / DEG
        };
    }

    function invert(m) {
        const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;
        const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        const inv = 1 / det;
        return [
            (a11 * b11 - a12 * b10 + a13 * b09) * inv,
            (a02 * b10 - a01 * b11 - a03 * b09) * inv,
            (a31 * b05 - a32 * b04 + a33 * b03) * inv,
            (a22 * b04 - a21 * b05 - a23 * b03) * inv,
            (a12 * b08 - a10 * b11 - a13 * b07) * inv,
            (a00 * b11 - a02 * b08 + a03 * b07) * inv,
            (a32 * b02 - a30 * b05 - a33 * b01) * inv,
            (a20 * b05 - a22 * b02 + a23 * b01) * inv,
            (a10 * b10 - a11 * b08 + a13 * b06) * inv,
            (a01 * b08 - a00 * b10 - a03 * b06) * inv,
            (a30 * b04 - a31 * b02 + a33 * b00) * inv,
            (a21 * b02 - a20 * b04 - a23 * b00) * inv,
            (a11 * b07 - a10 * b09 - a12 * b06) * inv,
            (a00 * b09 - a01 * b07 + a02 * b06) * inv,
            (a31 * b01 - a30 * b03 - a32 * b00) * inv,
            (a20 * b03 - a21 * b01 + a22 * b00) * inv
        ];
    }

    function transform(m, x, y, z, w) {
        return [
            m[0] * x + m[4] * y + m[8] * z + m[12] * w,
            m[1] * x + m[5] * y + m[9] * z + m[13] * w,
            m[2] * x + m[6] * y + m[10] * z + m[14] * w,
            m[3] * x + m[7] * y + m[11] * z + m[15] * w
        ];
    }

    function normalize(v) {
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    /**
     * Camera position and screen axes in sphere space. `altitude` is the
     * camera's height above the surface in Earth radii, the same quantity
     * the old Three.js explorer called h.
     */
    function camera(matrix) {
        const inverse = invert(matrix);
        const c = transform(inverse, 0, 0, 1, 0);
        const position = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
        const toward = (x, y) => {
            const p = transform(inverse, x, y, 1, 1);
            return normalize([
                p[0] / p[3] - position[0],
                p[1] / p[3] - position[1],
                p[2] / p[3] - position[2]
            ]);
        };
        const forward = toward(0, 0);
        const right = normalize(toward(1, 0).map((v, i) => v - toward(-1, 0)[i]));
        const up = normalize(toward(0, 1).map((v, i) => v - toward(0, -1)[i]));
        return {
            inverse,
            position,
            forward,
            right,
            up,
            altitude: Math.hypot(position[0], position[1], position[2]) - 1
        };
    }

    /**
     * Markers, arcs and pulses float above the surface in the far view and
     * ease down onto it between these camera altitudes, in Earth radii.
     * Smoothstep runs over log2 altitude, about 3.3 zoom levels.
     */
    const SURFACE = { full: 0.2, ground: 0.02 };

    /** 1 when overlays keep their full height, 0 once they lie on the surface. */
    function surfaceLift(altitude) {
        const from = Math.log2(SURFACE.ground);
        const t = (Math.log2(Math.max(altitude, 1e-9)) - from) / (Math.log2(SURFACE.full) - from);
        const c = Math.min(Math.max(t, 0), 1);
        return c * c * (3 - 2 * c);
    }

    /**
     * A height above the surface scaled by `lift`, then softly capped at half
     * the camera's altitude so a long arc can never reach the camera. The cap
     * blends over its top quarter, which leaves the far view untouched.
     * LIFT_GLSL is the same function.
     */
    function liftHeight(height, lift, altitude) {
        const h = Math.max(height, 0) * lift;
        const ceiling = altitude / 2;
        const k = ceiling / 4;
        const d = Math.max(k - Math.abs(h - ceiling), 0) / k;
        return Math.min(h, ceiling) - d * d * k / 4;
    }

    const LIFT_GLSL = `
uniform float u_lift;
uniform float u_altitude;
vec3 lifted(vec3 p) {
    float r = length(p);
    float h = max(r - 1.0, 0.0) * u_lift;
    float ceiling = u_altitude * 0.5;
    float k = ceiling * 0.25;
    float d = max(k - abs(h - ceiling), 0.0) / k;
    h = min(h, ceiling) - d * d * k * 0.25;
    return p / r * (1.0 + h);
}
`;

    /**
     * True when the straight line from the camera to `point` enters the
     * unit sphere first. A point below the surface, such as the middle of a
     * chord between two surface points, is tested where it meets the surface.
     * Matches the fragment test in the layer shaders.
     */
    function occluded(cam, point) {
        const [cx, cy, cz] = cam.position;
        const up = Math.max(1, 1 / (Math.hypot(point[0], point[1], point[2]) || 1));
        const dx = point[0] * up - cx;
        const dy = point[1] * up - cy;
        const dz = point[2] * up - cz;
        const a = dx * dx + dy * dy + dz * dz;
        const b = cx * dx + cy * dy + cz * dz;
        const c = cx * cx + cy * cy + cz * cz - 1;
        const disc = b * b - a * c;
        if (disc <= 0) return false;
        const t = (-b - Math.sqrt(disc)) / a;
        return t > 0 && t < 0.999;
    }

    function screen(matrix, point, width, height) {
        const clip = transform(matrix, point[0], point[1], point[2], 1);
        if (clip[3] <= 0) return null;
        return {
            x: (clip[0] / clip[3] * 0.5 + 0.5) * width,
            y: (0.5 - clip[1] / clip[3] * 0.5) * height
        };
    }

    const OCCLUSION_GLSL = `
float globeHidden(vec3 cam, vec3 point) {
    vec3 d = point * max(1.0, 1.0 / length(point)) - cam;
    float a = dot(d, d);
    float b = dot(cam, d);
    float c = dot(cam, cam) - 1.0;
    float disc = b * b - a * c;
    if (disc <= 0.0) return 0.0;
    float t = (-b - sqrt(disc)) / a;
    return (t > 0.0 && t < 0.999) ? 1.0 : 0.0;
}
`;

    function isWebGl2(gl) {
        return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    }

    function dialect(gl, stage, source, derivatives) {
        const defines = derivatives ? '#define GLOBE_DERIVATIVES 1\n' : '';
        if (isWebGl2(gl)) {
            const header = stage === 'vertex'
                ? '#version 300 es\n#define attribute in\n#define varying out\n'
                : '#version 300 es\nout highp vec4 globeFragColor;\n#define varying in\n#define texture2D texture\n#define gl_FragColor globeFragColor\n';
            return `${header}${defines}precision highp float;\n${source}`;
        }
        const extension = derivatives && stage === 'fragment' ? '#extension GL_OES_standard_derivatives : enable\n' : '';
        return `${extension}${defines}precision highp float;\n${source}`;
    }

    function compile(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`[GlobeGl] shader failed: ${log}`);
        }
        return shader;
    }

    /**
     * Link a program and collect its attribute and uniform locations.
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @param {{ vertex: string, fragment: string, attributes: string[], uniforms: string[], derivatives?: boolean }} spec
     */
    function program(gl, spec) {
        const derivatives = Boolean(spec.derivatives)
            && (isWebGl2(gl) || Boolean(gl.getExtension('OES_standard_derivatives')));
        const handle = gl.createProgram();
        const vertex = compile(gl, gl.VERTEX_SHADER, dialect(gl, 'vertex', spec.vertex, derivatives));
        const fragment = compile(gl, gl.FRAGMENT_SHADER, dialect(gl, 'fragment', spec.fragment, derivatives));
        gl.attachShader(handle, vertex);
        gl.attachShader(handle, fragment);
        gl.linkProgram(handle);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
            throw new Error(`[GlobeGl] link failed: ${gl.getProgramInfoLog(handle)}`);
        }
        const attributes = Object.fromEntries(spec.attributes.map((name) => [name, gl.getAttribLocation(handle, name)]));
        const uniforms = Object.fromEntries(spec.uniforms.map((name) => [name, gl.getUniformLocation(handle, name)]));
        return { handle, attributes, uniforms };
    }

    function bindAttribute(gl, buffer, location, size) {
        if (location < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    /** MapLibre leaves vertex array objects bound; ours must not write into them. */
    function unbindVertexArray(gl) {
        if (isWebGl2(gl)) {
            gl.bindVertexArray(null);
            return;
        }
        gl.getExtension('OES_vertex_array_object')?.bindVertexArrayOES(null);
    }

    const GlobeGl = {
        DEG,
        SURFACE,
        OCCLUSION_GLSL,
        LIFT_GLSL,
        surfaceLift,
        liftHeight,
        sphere,
        lngLat,
        invert,
        transform,
        camera,
        occluded,
        screen,
        program,
        bindAttribute,
        unbindVertexArray
    };

    root.GlobeGl = GlobeGl;
    if (typeof module !== 'undefined') {
        module.exports = GlobeGl;
    }
})(typeof window !== 'undefined' ? window : globalThis);
