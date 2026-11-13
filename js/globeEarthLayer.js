/**
 * The explorer's photographic Earth as a MapLibre custom layer.
 *
 * Each pixel casts a ray at the unit sphere and samples the equirectangular
 * photo, so there is no mesh tessellation and no tile grid. Shading repeats
 * the old Three.js Phong setup: a 0xcccccc base, ambient 1.0 and two
 * directional lights at 0.8 and 0.6 from the default pose. The lights now
 * ride with the camera, so the sphere reads the same from any side and the
 * centre of the view never changes brightness while zooming.
 *
 * Classic script. Sets window.GlobeEarthLayer.
 */
(function attachGlobeEarthLayer(root) {
    const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_ndc;
void main() {
    v_ndc = a_pos;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

    const FRAGMENT = `
uniform mat4 u_inverse;
uniform vec3 u_camera;
uniform vec3 u_light1;
uniform vec3 u_light2;
uniform sampler2D u_image;
uniform float u_ready;
uniform float u_soften;
uniform vec3 u_base;
varying vec2 v_ndc;

const float PI = 3.141592653589793;

vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
    vec4 far = u_inverse * vec4(v_ndc, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - u_camera);
    float b = dot(u_camera, dir);
    float c = dot(u_camera, u_camera) - 1.0;
    float closest = sqrt(max(c + 1.0 - b * b, 0.0));
#ifdef GLOBE_DERIVATIVES
    float coverage = clamp((1.0 - closest) / max(fwidth(closest), 1e-7) + 0.5, 0.0, 1.0);
#else
    float coverage = step(closest, 1.0);
#endif
    if (coverage <= 0.0) discard;
    float t = -b - sqrt(max(b * b - c, 0.0));
    vec3 n = normalize(u_camera + dir * t);

    float u = atan(n.x, n.z) / (2.0 * PI) + 0.5;
    float v = 0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI;
#ifdef GLOBE_DERIVATIVES
    float seam = fract(u + 0.5) - 0.5;
    u = fwidth(u) <= fwidth(seam) + 1e-7 ? u : seam;
#endif
    vec3 albedo = u_ready > 0.5 ? texture2D(u_image, vec2(u, v)).rgb : vec3(0.12);
    float light = 1.0 + 0.8 * max(dot(n, u_light1), 0.0) + 0.6 * max(dot(n, u_light2), 0.0);
    vec3 color = toSrgb(toLinear(albedo) * (0.6038 / PI) * light);
    color = mix(color, u_base, u_soften);
    gl_FragColor = vec4(color * coverage, coverage);
}`;

    /**
     * @param {{ id: string, image: Promise<HTMLImageElement>, soften: (zoom: number) => number, base: number[] }} options
     */
    function create(options) {
        const state = { map: null, program: null, buffer: null, texture: null, image: null };

        options.image.then((image) => {
            state.image = image;
            state.map?.triggerRepaint();
        }).catch(() => {});

        function upload(gl) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.image);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
            if (aniso) {
                const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
                gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
            }
            return texture;
        }

        return {
            id: options.id,
            type: 'custom',
            renderingMode: '2d',
            onAdd(map, gl) {
                state.map = map;
                state.program = root.GlobeGl.program(gl, {
                    vertex: VERTEX,
                    fragment: FRAGMENT,
                    derivatives: true,
                    attributes: ['a_pos'],
                    uniforms: ['u_inverse', 'u_camera', 'u_light1', 'u_light2', 'u_image', 'u_ready', 'u_soften', 'u_base']
                });
                state.buffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            },
            onRemove(_map, gl) {
                gl.deleteProgram(state.program?.handle);
                gl.deleteBuffer(state.buffer);
                if (state.texture) gl.deleteTexture(state.texture);
                state.map = null;
            },
            render(gl, args) {
                const { program } = state;
                const cam = root.GlobeGl.camera(args.modelViewProjectionMatrix);
                const back = cam.forward.map((v) => -v);
                const light1 = [0, 1, 2].map((i) => 3 * cam.right[i] + 2 * cam.up[i] + 4 * back[i]);
                const len = Math.hypot(...light1);
                root.GlobeGl.unbindVertexArray(gl);
                if (state.image && !state.texture) {
                    state.texture = upload(gl);
                }
                gl.useProgram(program.handle);
                gl.uniformMatrix4fv(program.uniforms.u_inverse, false, new Float32Array(cam.inverse));
                gl.uniform3fv(program.uniforms.u_camera, cam.position);
                gl.uniform3fv(program.uniforms.u_light1, light1.map((v) => v / len));
                gl.uniform3fv(program.uniforms.u_light2, back);
                gl.uniform1f(program.uniforms.u_ready, state.texture ? 1 : 0);
                gl.uniform1f(program.uniforms.u_soften, options.soften(state.map.getZoom()));
                gl.uniform3fv(program.uniforms.u_base, options.base);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, state.texture);
                gl.uniform1i(program.uniforms.u_image, 0);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.CULL_FACE);
                root.GlobeGl.bindAttribute(gl, state.buffer, program.attributes.a_pos, 2);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                gl.disableVertexAttribArray(program.attributes.a_pos);
            }
        };
    }

    root.GlobeEarthLayer = { create };
})(window);
