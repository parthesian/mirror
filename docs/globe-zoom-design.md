# Globe explorer: zoom, detail levels, and borders

Status: design spec, not implemented.
Scope: the full-screen `GlobeExplorer` overlay only. The 160 px modal globe (`js/globeService.js`) does not change and must never load anything described here.

This document is meant to be implemented as written. Every number below is a starting value that has been checked against the current code, the earth texture, and the Natural Earth files. If a number has to move during implementation, change it here too.

Units used throughout:

- `d` is the camera distance from the globe center. The globe radius is 1.
- `h = d - 1` is the camera altitude above the surface.
- "Reference viewport" means 900 CSS px tall. Kilometers per pixel scale with viewport height.
- Pixel values are CSS pixels unless they say device pixels.

## 0. Decisions at a glance

| Topic | Decision |
| --- | --- |
| Zoom input | Own wheel, pinch, and Safari gesture handling. OrbitControls keeps rotation only (`enableZoom = false`). |
| Zoom easing | First-order exponential approach in log-altitude space. A mouse notch uses τ = 110 ms (95% of the way at 330 ms). Trackpad uses τ = 45–60 ms and touch uses τ = 30 ms. No overshoot. |
| Zoom anchor | The place under the pointer stays under the pointer. This is done by adjusting camera azimuth and elevation, never by group pitch or roll. |
| Distance range | `d` from 1.30 to `maxDistance` (today `max(8, fit + 0.35)`). |
| Levels | World when `d ≥ 2.05`, regional from 1.55 to 2.05, local from 1.30 to 1.55, each with a ±0.04 hysteresis band. |
| World data | Derived at runtime from the 110m polygons already in memory. No new file and no new request. |
| Regional data | `public/data/globe-lines-50m.v1.json`, fetched once when `d` or the zoom goal drops below 2.35. |
| Local data | `public/data/globe-lines-10m.v1.json`, fetched once below 1.80. It holds 10m coast and land borders, pre-simplified, plus 50m admin-1 lines. |
| Stroke | Native 1-device-pixel `LineSegments`, one merged mesh per level, in a cool silver ink (`#E3E8EC`) at 0.20–0.52 alpha. The hovered country goes to `#FFFFFF` at 0.90. |
| Sphere | 192 × 96 segments for the explorer, fixed. The modal stays at 24 or 32. |
| Lift | Lines at r = 1.0003. Dots and arc endpoints at r = 1.0025. |
| Hit testing | Unchanged: the 110m polygons through `countryBoundaries`. The globe raycast becomes an analytic ray–sphere test. |

## 1. What the current code actually does

These facts shaped the design. An implementer should know them before touching anything.

1. **The canvas is grayscale-filtered.** `styles.css` sets `.globe-explorer-scene canvas { filter: grayscale(1) contrast(1.05) brightness(0.9); }`. Hue never reaches the screen. The current hover color `0x9ed8ff` shows up as a gray of luminance about 206. That makes a "cool" hairline a matter of luminance and opacity. The hex values below carry a slight cool cast, so they still read correctly if the filter is ever removed, but the design depends on their luminance.
2. **Drag moves the camera, not the group.** OrbitControls changes the camera's azimuth and polar angle on drag. `group.rotation.y` only changes in `_rotateToLocation` through `focusRotation`. The e2e pole test asserts `controls.getAzimuthalAngle()` changes after a drag. Zoom must follow the same rule: any correction for zoom-to-pointer goes into camera azimuth and polar angle. `group.rotation.x` stays 0 and `group.rotation.y` is never touched by zoom.
3. **Idle warmup does not fetch the 110m GeoJSON.** `_warmup()` passes `includeBoundaries: false`. The 110m file loads on globe button hover or focus, and on `open()`. That stays as it is.
4. **Hover rebuilds geometry.** `_setCountryBorderHighlight` allocates a `THREE.Line` and a cloned material per outer ring on every country change. It skips holes, so Lesotho is missing from South Africa. It floats at r = 1.012. This is replaced entirely, see §4.5.
5. **The texture is soft.** `earth_atmos_2048.jpg` is 2048 × 1024, so one texel is 0.176°, about 19.5 km at the equator. It is already magnified about 2× at the fit distance. That caps how close the camera should go, see §2.2.
6. **Natural Earth "boundary lines (land)" contain no coastlines.** Coasts come from the separate `coastline` layers. The 50m and 10m boundary-line files have no left or right country fields, so the build script assigns them (§6.3).
7. **50m admin-1 lines cover only nine countries:** Brazil, Australia, United States, Canada, Russia, India, China, Indonesia, and South Africa. The 10m admin-1 lines layer covers everyone but is 21 MB raw, so it is rejected. State and province lines only appear in those nine countries. That is accepted.

Texture brightness, sampled from the JPEG as sRGB luminance (0–255) over a 9 × 9 texel patch: open ocean 48, North Sea shelf 61, Amazon 45, Europe 70, Siberia 64, US plains 110, India 132, Australia 132, Sahara 228, Greenland 255.

The renderer does not set `useLegacyLights`, so three r160 uses physical light units, which divide diffuse light by π. The globe material (`color 0xcccccc`, ambient 1.0, front light 0.6, key light 0.8) therefore renders the texture at about 0.42× linear at the point under the camera, and darker toward the limb. After the canvas filter, the computed on-screen luminance is about 21 for ocean, 35–80 for forest, plains, India, and Australia, about 140 for the Sahara, and about 157 for Greenland. The globe reads as a dark photograph on a mid-gray page, and that is why a single light ink works (§4.2). These values were computed from the shader math, not captured from a screenshot. §9 includes one manual check to confirm them.

## 2. Zoom feel

### 2.1 Input to camera

OrbitControls keeps rotation and damping, with `dampingFactor` unchanged at 0.16. Set `controls.enableZoom = false` and drive distance from one zoom controller that owns two values: `h` (current altitude) and `hGoal` (target altitude).

Every frame, before `controls.update()`, the controller moves `h` toward `hGoal` in log space:

```text
a      = 1 - exp(-dt / tau)          // dt is the existing frame delta, clamped to 48 ms
ln(h) += (ln(hGoal) - ln(h)) * a
if |ln(h / hGoal)| < 5e-4: h = hGoal and the zoom is settled
```

Working in log space makes every step cover the same fraction of the remaining distance at every scale. Going from orbit to coastline feels like one continuous motion, not a fast start followed by a crawl. A first-order exponential cannot overshoot, so the zoom never oscillates or bounces.

Wheel events, which cover mouse wheels, trackpad scrolling, and trackpad pinch on Chrome, Edge, and Firefox:

```text
px = deltaMode == 1 ? deltaY * 16
   : deltaMode == 2 ? deltaY * canvasHeight
   : deltaY
px = clamp(px, -240, 240)               // one flung wheel event cannot jump the whole range
pinch = event.ctrlKey
notch = !pinch && (deltaMode == 1 || (|px| >= 50 && px is an integer))
k     = pinch ? 0.010 : 0.0023
hGoal = clamp(hGoal * exp(px * k), H_MIN, H_MAX)
tau   = notch ? 110 ms : pinch ? 45 ms : 60 ms
```

| Input | Per event | Feel |
| --- | --- | --- |
| Mouse notch (100 px) | Altitude ÷ 1.259 per notch in, × 1.259 per notch out | Each notch glides. 95% at 330 ms, 99% at 500 ms. Fast spinning adds to `hGoal`, so the camera moves in one continuous glide, not separate steps. About 7 notches from fit (h 1.6) to the closest view (h 0.30), or 8 on a landscape 1280 × 720 viewport where the fit distance is 3.09. |
| Trackpad two-finger scroll | Same k as a notch: 100 px of scroll equals one notch | τ = 60 ms. The OS already supplies inertia, so the controller only smooths event jitter. |
| Trackpad pinch (`ctrlKey` wheel) | k = 0.010. A full pinch of about 150 units zooms about 4.5× | τ = 45 ms. Close to 1:1 with the fingers. |
| Safari `gesturestart` / `gesturechange` | `hGoal = hAtGestureStart / event.scale` | τ = 45 ms. `preventDefault` on all three gesture events. |
| Touch pinch (two pointers on the canvas) | `hGoal = hAtPinchStart * spanAtStart / spanNow` | τ = 30 ms, which reads as direct manipulation. |

Wheel direction follows the platform convention: positive `deltaY` zooms out. Nothing is inverted.

When `hGoal` reaches `H_MIN` or `H_MAX`, further input in that direction is dropped. Nothing accumulates past the limit and there is no rubber-band. The camera eases into the limit and stops.

External distance changes, such as `_fitGlobeInView`, resize, and `_rotateToLocation`, must set `hGoal = h` so the controller does not pull the camera back to a stale goal.

### 2.2 Distance range and clip planes

| Value | Today | New | Why |
| --- | --- | --- | --- |
| `minDistance` | 1.8 | **1.30** (`H_MIN = 0.30`) | At d = 1.30 the screen spans about 1,580 km vertically on the reference viewport (1.76 km/px). Coasts and borders are clearly readable at that scale. A texel is about 11 px there, and going closer only magnifies JPEG blur. |
| `maxDistance` | 8 | Unchanged: `max(8, fit + 0.35)` | The existing fit rule stays. |
| `near` | 0.1 | `clamp(0.35 * h, 0.02, 0.1)` | With `H_MIN = 0.30` the nearest surface is 0.30 away, so `near` stays at 0.1. The rule is there so a later lower `minDistance` cannot clip the surface. |
| `far` | 1000 | `d + 1.7` | 1.7 covers the far side of the globe plus the highest arc (about r 1.62). A tighter far plane improves depth precision. |

Call `camera.updateProjectionMatrix()` only when `near` or `far` changes by more than 1%, not every frame.

Set `controls.minDistance = 1.30` and keep `controls.maxDistance` in sync with `H_MAX + 1`, so OrbitControls' own radius clamp never disagrees with the zoom controller.

Kilometers per pixel at the screen center scale as about `5.86 * h` on the reference viewport:

| d | Screen height | km per px | Texel size | Level |
| --- | --- | --- | --- | --- |
| 3.09 (landscape fit) | whole globe | about 12 | 1.6 px | World |
| 2.60 (minimum fit) | whole globe | about 9.4 | 2.1 px | World |
| 2.05 | about 5,500 km | 6.2 | 3.2 px | World / Regional edge |
| 1.55 | about 2,900 km | 3.2 | 6.1 px | Regional / Local edge |
| 1.30 | about 1,580 km | 1.76 | 11 px | Local, closest |

### 2.3 Zoom toward the pointer

A zoom keeps the geographic point under the pointer fixed on screen, while north stays up.

1. On each wheel or gesture event, cast a ray from the pointer and intersect the unit sphere analytically (§5.4). If it hits, store the hit as a group-local unit vector `A`. Storing it in group-local space keeps it valid if the group yaw changes. If it misses, which happens with the pointer off the globe, set the anchor weight to 0 and zoom toward the screen center.
2. For a touch pinch, capture `A` once at pinch start under the initial midpoint. The target screen position is the current midpoint. The place between the fingers therefore stays between them, and moving both fingers together turns the globe, the way map apps behave.
3. Each frame while the zoom is unsettled:
   - `P = A` transformed by the group's world matrix, then normalized.
   - Move the camera to radius `1 + h` along its current direction.
   - Cast from the pointer (or the current pinch midpoint) and hit the sphere at `Q`.
   - `dAz = wrapPi(atan2(P.x, P.z) - atan2(Q.x, Q.z))` and `dEl = asin(P.y) - asin(Q.y)`.
   - Camera spherical coordinates (OrbitControls uses the same theta convention): `theta += w * dAz`, `phi -= w * dEl`, then clamp `phi` to the existing ±62° band. Call `camera.lookAt(0, 0, 0)`, then `controls.update()`.
4. Anchor weight: `w = smoothstep(cos 78°, cos 62°, dot(P, normalize(camera - P)))` times `1 - smoothstep(fit, fit + 0.6, d)`, where `fit` is `globeFitDistance` for the current viewport. A pointer near the limb gets a weak anchor, so a zoom at a grazing angle does not swing the globe. Zooming out past the fit distance fades the anchor out and the globe re-centers by itself. Tying the fade to `fit` keeps it correct on portrait phones, where the fit distance can be well above 3.

Because the anchor is fixed, any residual error from this one-step linearization gets corrected on the next frame instead of accumulating. A unit test must confirm the signs numerically (§9). The invariant: with `w = 1` and the polar clamp inactive, the anchor's projection ends within 0.5 CSS px of the pointer once the zoom settles. When the polar clamp is active, which happens when zooming toward a point above 62° N or below 62° S, the anchor is allowed to drift vertically. It must not snap.

Do not use `OrbitControls.zoomToCursor`. It moves `controls.target` off the origin, which breaks the orbit about the pole axis.

### 2.4 Rotation speed follows altitude

At close range the current `rotateSpeed` of 0.65 makes the ground race under the cursor. Scale it every frame:

```text
s = clamp((h / 1.6) ^ 1.5, 0.08, 1)
controls.rotateSpeed = 0.65 * s
```

At the fit distance this gives 0.65, the current feel. At h = 1.0 it gives 0.32, at h = 0.55 it gives 0.13, and at h = 0.30 it gives 0.052. At the closest view, a full-height drag turns the globe about 0.33 rad, roughly 1.3× the ground in view. That is close to grabbing the surface.

### 2.5 Auto-rotate while zooming

- Zoom input never changes `autoRotateEnabled` and never changes the rotate toggle's UI. That toggle remains the user's preference. Drag keeps its current behavior of turning auto-rotate off.
- The effective value is `controls.autoRotate = autoRotateEnabled && level === world && zoomSettled && now - lastZoomSettledAt > 1500 ms`.
- Speed: `controls.autoRotateSpeed = 0.85 * clamp((h / 1.6) ^ 1.5, 0, 1) * ramp`, where `ramp` goes from 0 to 1 with a smoothstep over 600 ms after auto-rotate resumes. It never starts at full speed.
- At regional and local levels the globe never auto-rotates.

### 2.6 Settling and the page behind

- Settling: the log-space approach plus the snap at `5e-4` ends every zoom exactly on `hGoal`. The final correction is sub-pixel.
- No stepped jumps: wheel events only change `hGoal`. The camera moves only inside the animation frame.
- Hover raycasts pause while `|ln(h / hGoal)| > 0.002`. The last highlight stays. One hover pass runs on the frame after the zoom settles.
- No layout shift: the overlay is already `position: fixed` with `body { overflow: hidden }`, and the existing `wheel` listener calls `preventDefault` while the overlay is open. Zoom adds no DOM writes and no class toggles. It adds no layout reads per frame either: cache the canvas rect on open and on resize, and use it for the pointer-to-NDC conversion.
- A pinch sets `pointerGesture.dragged = true`, so lifting the fingers never fires a tap-pick. Wheel already sets `hadWheel`.
- Reduced motion (`prefers-reduced-motion: reduce`): τ is 40 ms for every input, the crossfade is 120 ms, and auto-rotate behaves as it does today.

## 3. Detail levels

### 3.1 Thresholds

Levels switch on the actual camera distance `d`, not on `hGoal`. Data prefetch looks ahead using `dAhead = min(d, 1 + hGoal)`.

| Level | Active range | Enter when | Leave when | Fetch when `dAhead` is below |
| --- | --- | --- | --- | --- |
| World | d ≥ 2.05 | d > 2.09 (coming out) | d < 2.01 | — (in memory) |
| Regional | 1.55 ≤ d < 2.05 | d < 2.01 (going in) or d > 1.59 (coming out) | d > 2.09 or d < 1.51 | 2.35 |
| Local | 1.30 ≤ d < 1.55 | d < 1.51 | d > 1.59 | 1.80 |

The 0.04 hysteresis band is 4–7% of altitude at the two edges, more than a slow trackpad drift crosses back and forth. The 2.35 prefetch line is below the smallest possible fit distance (2.6), so **opening the explorer can never request a 50m or 10m file**. Distances are absolute rather than scaled by viewport so that guarantee holds on every screen, and so tests can assert it.

Why these cut points, using Natural Earth segment lengths measured from the files:

| Layer | Median segment | p90 segment |
| --- | --- | --- |
| 110m coastline | 63 km | 121 km |
| 50m coastline | 7.7 km | 19.8 km |
| 50m land borders | 8.5 km | 22.1 km |
| 10m coastline | 1.6 km | 4.5 km |
| 10m land borders | 2.1 km | 7.4 km |

- At d = 2.05 (6.2 km/px), 110m p90 segments are about 20 px long and the corners show. Switching to 50m there brings p90 segments to about 3 px.
- At d = 1.30 (1.76 km/px), 50m p90 segments are about 11 px. That is visibly polygonal against a smooth coast, which justifies the 10m layers at the local level. After simplification at 0.03°, the 10m coast deviates at most about 3.3 km, or 1.9 px at the closest view. That is below one texel of the JPEG.

### 3.2 What each level shows

| Level | Coast | Land borders | Lakes | Admin-1 | Source |
| --- | --- | --- | --- | --- | --- |
| World | 110m | 110m | — | — | Runtime edges of `ne_110m_admin_0_countries` polygons, already loaded (§6.1) |
| Regional | 50m | 50m | 50m | — | `globe-lines-50m.v1.json` |
| Local | 10m, simplified | 10m, simplified | 50m | 50m (9 countries) | `globe-lines-10m.v1.json` |

Admin-1 lines additionally fade in with distance inside the local level: alpha × `smoothstep(1.56, 1.40, d)`. They appear as the camera descends and never switch on in a single frame.

If `navigator.connection?.saveData` is true, never fetch the 10m file. The local level then keeps showing the regional set, with no admin-1 lines.

## 4. Stroke

### 4.1 Line primitive

- Use native `THREE.LineSegments`, which draws `GL_LINES` at 1 device pixel. On DPR 2 that is a 0.5 CSS px hairline, and on DPR 1 a 1 CSS px line. The renderer already has `antialias: true`.
- Do not use fat lines (`LineSegments2` / `LineMaterial`). They cost an instanced quad per segment (about 125k at the local level), an extra CDN import, and they look like a map overlay rather than ink. Hover makes a line brighter, not thicker.
- Weight is controlled with opacity. On DPR < 1.5, where a line is a full CSS pixel, multiply every alpha below by 0.75 so 1× screens do not look heavier.

### 4.2 Ink

All lines use a single small `ShaderMaterial`, the ink material. It reads per-vertex kind and country attributes, applies the alpha table, limb fade, level weight, and hover. It is unlit on purpose, so ink does not shade with the Phong lights.

| Role | Ink | On screen after the canvas filter |
| --- | --- | --- |
| Coast, land borders, lakes | `#E3E8EC` (cool silver) | about 212 |
| Admin-1 | `#C5CCD3` (dimmer silver) | about 186 |
| Hovered country | `#FFFFFF` | about 230 |

Against on-screen ground of about 21 (ocean), 35–80 (most land), and 140–157 (Sahara and ice), silver ink at border alpha 0.36 moves the pixel by about 69 levels over ocean, 48–64 over most land, and 20–26 over desert and ice. Borders across the Sahara are the faintest lines on the globe, but they stay visible. That is the intended hierarchy: the photograph dominates, and the lines annotate it.

Rejected: a texture-sampled light/dark ink switch. At this lighting, dark ink (about 39) would only gain about 10 levels of contrast over the Sahara, in exchange for a texture fetch per line fragment and a mid-gray band that reads as noise at coast transitions. If the §9 screenshot check shows desert brighter than about 175 on screen, revisit this.

Use `THREE.Color` (sRGB hex converted to linear) for the uniforms and end the fragment shader with `#include <colorspace_fragment>`, so output encoding matches the rest of the scene.

### 4.3 Opacity per level

Base alpha values (DPR ≥ 1.5):

| Layer | World | Regional | Local |
| --- | --- | --- | --- |
| Coast | 0.20 | 0.26 | 0.32 |
| Land border | 0.36 | 0.44 | 0.52 |
| Lake shore | — | 0.18 | 0.24 |
| Admin-1 | — | — | 0.26 |
| Hovered country: coast and border | 0.90 | 0.90 | 0.90 |
| Hovered country: admin-1 | — | — | 0.45 |

Borders are stronger than coasts because the coast is already visible in the photo, while a border is information the texture does not carry. Every level's values are low enough that the earth texture remains the image and the lines read as annotation.

Multipliers applied to every line:

- **Limb fade:** × `smoothstep(0.06, 0.30, dot(N, V))`, with N as the surface normal and V the direction to the camera, both in view space. Lines thin out toward the horizon, which also hides the last bit of facet parallax at the limb.
- **Zoomed-out fade:** × `1 - 0.5 * smoothstep(3.2, 8.0, d)`. A small, far globe does not turn into a tangle of lines.
- **Level weight:** the crossfade weight from §4.4.

### 4.4 Crossfade between levels

A scalar `lod` in [0, 2] (0 world, 1 regional, 2 local) moves linearly toward the target level at 1 unit per 360 ms. The target is the active level from §3.1, capped at the finest level whose mesh is built. If the camera reaches the local level before the 10m file arrives, the regional lines stay. When the 10m mesh is ready, `lod` animates up, so a late network response causes a fade, not a pop.

For the pair of levels around `lod` (`i = floor(lod)`, `f = lod - i`):

```text
w_coarse = 1 - smoothstep(0.25, 1.00, f)
w_fine   =     smoothstep(0.00, 0.75, f)
```

The finer level arrives before the coarser one leaves, so the coast is never missing for a frame. Over the middle 50% of the fade both are partially visible. They sit on the same projection and lift, so the overlap reads as one line briefly becoming more detailed. Zooming out runs the same curve backwards. A level reversal mid-fade continues from the current `lod`, with no jump. Set `mesh.visible = false` when a level's weight is 0, so at most two line draw calls run at any time.

### 4.5 Hovered country

- Hit testing is unchanged: `countryBoundaries.findCountryFromDirection` on the 110m polygons already loaded. Polygons are parsed once. Nothing is parsed per hover.
- Delete the per-hover geometry in `_setCountryBorderHighlight`. Every line vertex carries left and right country indices (§6.2). A hover sets a uniform, and the shader brightens segments where `L == hover || R == hover`. That covers every level, holes such as Lesotho, islands, and both sides of a shared border.
- Fade: 140 ms ease-out in (`1 - (1 - t)^2`), 220 ms out. Use two uniform slots, A and B, so moving straight from one country to the next crossfades. No geometry is allocated.
- Hovering a dot still clears the country highlight, as it does today. Click-to-filter, the intersect picker, and the pick confirm card are unchanged.
- Known limitation: at the local level, a pointer on real land just outside a coarse 110m polygon gets no country. Picking accuracy is out of scope for this pass.

## 5. Registration

### 5.1 One mapping

Every object on the globe uses the `GlobeRoutes.latLonToVec3` formula inside `group`, with `group.rotation.y = -π/2` unchanged:

```text
phi = (90 - lat)°, theta = (lon + 180)°
x = -r sin(phi) cos(theta), y = r cos(phi), z = r sin(phi) sin(theta)
```

The worker cannot use `THREE`, so `js/globeDetail.js` holds a THREE-free copy that writes into typed arrays. A unit test proves both give the same result (§9).

The same direction carries `SphereGeometry` UV `((lon + 180) / 360, (lat + 90) / 180)`. In other words, the JPEG texel and the line vertex for a given lat/lon point the same way from the center, and only facet inset (§5.2) and lift (§5.3) separate them.

### 5.2 Sphere tessellation

A faceted sphere draws each texel on a flat triangle inside the true sphere. A line on the true sphere then sees that texel with parallax. The worst inset is `1 - cos(half the facet diagonal)`.

| Segments (width × height) | Facet | Max inset | Shift at 60° incidence, fit view | At d = 1.30 (incidence ≤ 35°) |
| --- | --- | --- | --- | --- |
| 48 × 48 (today) | 7.5° × 3.75° | 17 km | 3.1 px | about 7 px, worse toward the limb |
| **192 × 96 (new)** | 1.875° × 1.875° | 1.7 km | 0.3 px | 0.7 px |

Use `new THREE.SphereGeometry(1, 192, 96)` for the explorer from scene creation, on every device. That is about 36,500 triangles and 18,721 vertices, about 1 MB, built once. It is a trivial load for any GPU that runs the explorer today. There is no runtime geometry swap, so there is no pop. Add `threeLoader.explorerSphereSegments()` returning `[192, 96]`. `sphereSegments('modal')` stays exactly as it is.

The mesh gets denser, so CPU hit testing must stop raycasting triangles (§5.4).

### 5.3 Lift above the surface

| Object | Radius today | New radius |
| --- | --- | --- |
| Globe | 1.0 | 1.0 |
| All border, coast, lake, and admin-1 lines | 1.012 (hover only) | **1.0003** (about 1.9 km) |
| Photo dots | 1.01 | **1.0025** |
| Arc endpoints (`globeRoutes.buildArcs`) | 1.01 | **1.0025** |
| Click pulse rings | 1.018 | **1.003** |

- 1.0003 clears the worst facet inset of the 192 × 96 mesh (2.7e-4) for every line vertex. Lines are densified to 0.5° steps (§5.5), so the sag between vertices is 1.9e-5, far below the lift.
- Depth precision does not limit this. With near 0.1 and a 24-bit depth buffer, depth resolution is about 5e-8 units at the closest view and 1.5e-6 at fit. The 3e-4 gap is 200× to 5,000× larger, so no `polygonOffset` is needed.
- Dots at 1.01 float 64 km and drift up to about 25 px off their place at the closest zoom. At 1.0025 the drift is at most about 6 px at the screen edge, while the sprite still clears the surface. `_pickPrecisePointIndex` and `_collectIntersectingLocationKeys` multiply by 1.01 today. They must use the same new constant.
- Dot size stays constant on screen: `PointsMaterial.size = 0.06 * clamp(h / 1.6, 0.19, 1)`, which keeps dots at about 17 px from fit to the closest view instead of growing to about 90 px. Scale `raycaster.params.Points.threshold` (0.034) by the same factor. Scale the click pulse's `maxAngle` (3.7°) and `minAngle` (0.4°) by it too.
- Line material: `transparent: true`, `depthTest: true`, `depthWrite: false`, `renderOrder = 0`. Lines draw after the opaque globe and before arcs (1), dots (2), and pulses (4).

### 5.4 Analytic globe hit

Replace `raycaster.intersectObject(globe)` in hover, click, and `_getGlobeCenterDirection` with a ray against the unit sphere at the group's origin. Take the nearest positive root of `|o + t·d|² = 1`. It is exact, costs O(1) no matter how many segments the sphere has, and matches the true sphere the lines are drawn on. Dot raycasting stays as it is.

### 5.5 Antimeridian and seams

Applied offline in the build script for the 50m and 10m files, and at runtime for the 110m world edges:

1. **Drop seam edges:** remove any segment with both endpoints at `|lon| ≥ 179.999` on the same side. These are polygon cuts along ±180°, not real coast. There are 9 in the 110m polygons.
2. **Split crossings:** for any segment with `|Δlon| > 180`, unwrap the second longitude by ±360. Find the crossing latitude by linear interpolation at ±180°. End the current line at `(±180, lat*)` and start a new line at `(∓180, lat*)`. There is 1 in the 110m polygons and none in the line layers, but the rule is mandatory.
3. **Drop the polar closure:** remove segments with both endpoints at `lat ≤ -89.999` (Antarctica closing along the bottom edge).
4. **Densify, at runtime:** subdivide every segment linearly in lon/lat so no step exceeds 0.5° in either axis. The interpolation is linear in lon/lat, not a great circle, because Natural Earth lines and the equirectangular JPEG are both straight in lon/lat. For example, the 49th parallel is a parallel, not a great circle. Without this, long 110m segments (up to 355 km) would cut under the sphere as straight chords and disappear behind it.

No chord can cross the Pacific: after step 2 no segment spans more than 180° of longitude, and after step 4 none spans more than 0.5°.

## 6. Data

### 6.1 World level, derived from what is already loaded

When the scene initializes, after `_ensureCountryBoundariesLoaded`, walk every ring of every polygon in `countryBoundaries.features`, including holes:

- Key each edge by its two endpoints rounded to 1e-5°, without direction.
- An edge seen once is a coast. Set `L = R` to the feature's runtime id (§7).
- An edge seen twice is a land border. `L` and `R` are the two features.
- An edge seen three or more times is a degenerate duplicate. Keep the first two owners.
- Apply §5.5.

Measured on the current file: 10,365 edges, which become 5,020 coast edges and 2,663 border edges after dropping 10 seam and crossing edges. Do this in `requestIdleCallback` chunks of at most 4 ms each (`timeout: 500`, falling back to `setTimeout(0)`), with about 20 features per chunk. The world mesh fades in from `lod` weight 0 when it is ready, so first paint of the explorer is never delayed by it. This adds no request and no new file.

### 6.2 File format (`globe-lines-*.v1.json`)

```json
{
  "v": 1,
  "source": "Natural Earth vector v5.1.2",
  "scale": 1000,
  "codes": ["", "AFG", "AGO", "ALB"],
  "layers": {
    "coast":  [[1, 1, -61685, 10834, 12, -40, 7, -19]],
    "border": [],
    "lake":   [],
    "admin1": []
  }
}
```

- Each line is `[L, R, x0, y0, dx1, dy1, ...]`. `x = round(lon * 1000)` and `y = round(lat * 1000)`, which is 111 m resolution (0.06 px at the closest view). The first pair is absolute and the rest are deltas.
- `L` and `R` index `codes`, which are ADM0_A3 codes (not ISO_A3, which is `-99` for France, Norway, and Kosovo). Index 0 means unknown, which covers microstates absent from 110m. Unknown lines are never highlighted.
- Lines are already antimeridian-split and simplified. The runtime only decodes, remaps codes, densifies, and projects.
- Layer kind ids in the vertex attribute: 0 coast, 1 border, 2 lake, 3 admin1.
- Ship it as `.json` so Cloudflare Pages compresses it. A custom binary format would be served uncompressed and would need its own decoder.

### 6.3 Build script (`scripts/build-globe-lines.mjs`)

This runs offline. The output is committed. It is not part of `npm run build` and nothing downloads at build time.

- Input: `--src <dir>` holding Natural Earth v5.1.2 GeoJSON from `nvkelso/natural-earth-vector`, pinned to the tag, plus the committed `public/data/ne_110m_admin_0_countries.geojson`.
- Simplification: Douglas–Peucker in degrees, per line, endpoints kept.
- Country attribution, using the 110m polygons with a bbox prefilter:
  - Border lines: take up to 5 samples at 10%, 30%, 50%, 70%, and 90% of the line's length. Probe ±0.25° along the local normal, with longitude scaled by `cos(lat)`. Each probe resolves to the containing country, or the nearest within 0.5°. Majority vote per side. If both sides resolve to the same country, use the two nearest distinct countries at the midpoint.
  - Coast and lake lines: `L = R` = majority of the containing or nearest country (within 1.0°) over every 10th vertex.
  - Admin-1: `L = R = ADM0_A3`.
- `codes` lists ADM0_A3 in the order of the 110m features, with `""` at index 0, and is the same in every file.
- Output is deterministic: stable ordering, no timestamps, so a re-run produces the same diff.
- The script fails when a file exceeds its cap below.

| File | Contents | Raw cap | Gzip cap | Prototype measured |
| --- | --- | --- | --- | --- |
| `globe-lines-50m.v1.json` | 50m coast at DP 0.02°; 50m land borders at DP 0.02°; 50m lakes at DP 0.02°, dropping lines under 0.1° long | **440 KB** | **175 KB** | 431 KB / 172 KB, about 52k vertices |
| `globe-lines-10m.v1.json` | 10m coast at DP 0.03°, dropping lines under 0.05° long; 10m land borders at DP 0.015°; 50m admin-1 at DP 0.01°; 50m lakes at DP 0.01°, dropping lines under 0.05° | **1,080 KB** | **425 KB** | 1,058 KB / 421 KB, about 122k vertices |

The prototype used random country indices, so real files will compress slightly better. If the 10m file goes over its cap after a data update, raise the coast tolerance in 0.005° steps up to 0.04°. If it is still over, ship the 50m coast in the local file. Never raise a cap without updating this table.

Total new static data: at most 1.52 MB raw and 600 KB gzip, none of which loads before the camera is below d = 2.35. For comparison, the 110m countries file is 820 KB raw and 0 new bytes are added for the world level.

Rejected layers: 10m country polygons (about 20 MB, and 110m stays the picking set); 10m admin-1 lines (21 MB raw); 10m coastline unsimplified (9.9 MB raw, 3.2 MB gzip).

`_headers` gets one rule, so the versioned files are cached for good:

```text
/data/globe-lines-*
  Cache-Control: public, max-age=31536000, immutable
```

A data change gets a new filename (`.v2.json`), never an in-place edit.

## 7. Performance contract

| Situation | Allowed | Not allowed |
| --- | --- | --- |
| Gallery route, explorer never opened | The current idle warmup: Three, OrbitControls, earth JPEG, geo. The 110m file on globe hover, focus, or open, as today | Any `/data/globe-lines-*` request, creating the line worker, building any line geometry |
| Explorer open at world view (`d ≥ 2.35`) | The 110m file (already loaded), world-edge derivation in idle chunks | Any 50m or 10m request, creating the worker |
| First approach to a level | Exactly one request for that level's file per page session, parsed in the worker | A second request after zooming out and back in, or after close and reopen |
| Zooming at any level | At most 2 ms of main-thread JavaScript per frame on a mid laptop (zoom step, two analytic rays, uniforms); at most 2 line draw calls | Rebuilding geometry, `getBoundingClientRect` per frame, hover raycasts while unsettled |
| Detail mesh arrival | One `BufferGeometry` built from transferred typed arrays (no copy); a GPU upload of about 3 MB for the local level | Main-thread JSON parse of 50m or 10m data; any long task over 16 ms caused by line loading |
| Modal globe | Exactly what it does today | Any request or code path from this document |

Worker (`js/globeLinesWorker.js`, a classic worker):

- Created lazily on the first prefetch trigger and reused for both files.
- `importScripts` loads `globeDetail.js` with the same `?v=`. It fetches with `cache: 'force-cache'`, calls `res.json()`, then decodes, remaps file `codes` to runtime ids (passed in the request), densifies, and projects at r = 1.0003. A runtime id is the feature's index in `countryBoundaries.features` plus 1, with 0 meaning unknown. The world level and the hover uniforms use the same ids, and 177 features fit in a `Uint8`.
- It posts `{ positions: Float32Array, meta: Uint8Array (kind, L, R, 0 per vertex), index: Uint32Array }` as transferables.
- GPU memory: about 0.3 MB for world, 1.3 MB for regional, and 3.1 MB for local, using indexed `LineSegments` with 16 bytes per vertex plus 4 bytes per index.

Fallback if `Worker` is unavailable or throws: fetch on the main thread and build in idle chunks of at most 4 ms (about 5k vertices per chunk). A failed fetch keeps the coarser level, logs a single `console.warn`, and retries on the next approach after 30 s.

Meshes stay cached for the life of the scene and are disposed in `_destroyScene`. Closing hides them. Reopening resets to the fit distance (world level), as `open()` already does through `_fitGlobeInView`.

All line levels share one shader program: clone the ink material per level so the program is cached once and only the uniforms differ. That gives a single shader compile, when the world mesh is first shown.

## 8. Motion and chrome to avoid

- No reset of north or heading on zoom. Zoom never changes `group.rotation`, and the camera's up vector stays world +Y.
- No camera flights. A level change, a click on a country, or a click on a dot never moves the camera. Pick confirm works as it does today.
- No FOV zoom. FOV stays at 45°, and zoom only moves the camera along its distance.
- No bounce at the limits, and no inertia beyond the τ smoothing and the OS's own trackpad momentum.
- No double-click or double-tap zoom. Click is pick.
- No tilting the pole: `group.rotation.x` stays 0 and the polar clamp stays ±62°. The existing e2e pole test must pass after a wheel zoom followed by a drag.
- No new UI: no zoom buttons, scale bar, level label, or attribution badge in the overlay. Natural Earth is public domain, so credit goes in `public/data/README-country-boundaries.md`. The toolbar (rotate toggle and close) stays as it is. No hint is needed: wheel and pinch are expected on a globe, and `.globe-explorer-hint` has no element in `index.html` today. Leave it that way.
- No glow, additive blending, or animated dashes on borders. Arcs keep their additive style, and borders are normal-blended ink.
- No CSS changes. The canvas filter, overlay transitions, and exit animation stay as they are.

## 9. Acceptance tests

Vitest, in `tests/unit/globe-detail.test.ts`, loading `js/globeDetail.js` with the same `new Function('window', …)` pattern `globe-focus.test.ts` uses:

1. `GlobeDetail.latLonToXYZ` matches `GlobeRoutes.latLonToVec3` within 1e-12 for 200 seeded random points, including ±90° latitude and ±180° longitude.
2. For 50 points, the direction from `latLonToXYZ` matches the `SphereGeometry(1, 192, 96)` vertex whose UV is `((lon + 180) / 360, (lat + 90) / 180)`, within half a facet.
3. Level hysteresis: a sequence of `d` values oscillating ±0.03 around 2.05 and around 1.55 produces no level change. Crossing each enter or leave value produces exactly one.
4. Prefetch: `shouldFetch('50m', d, hGoal)` is false for every `d ≥ 2.35` when `hGoal + 1 ≥ 2.35`, including the minimum fit of 2.6.
5. Antimeridian: a segment from (179.5, 10) to (-179.5, 12) splits at (±180, 11). Seam edges are dropped. After densifying, no segment exceeds 0.5° in either axis.
6. World edges from the committed 110m file: coast and border counts match 5,020 and 2,663 (±1%), and no output segment has `|Δlon| > 0.5°`.
7. Wheel normalization: a +100 px notch (zoom out) gives altitude × 1.259 and −100 px gives ÷ 1.259; `deltaMode` 1 with 3 lines equals 48 px; values clamp at ±240; `ctrlKey` uses k = 0.010.
8. Zoom anchor, using `three` the way `globe-focus.test.ts` does: run the controller at 60 fps for 600 ms after one notch, aimed at a point 30° off center. The anchor's projection ends within 0.5 px of the pointer, `group.rotation.x === 0`, the world pole stays at (0, 1, 0), and the polar angle stays within ±62°.
9. Smoothing: the per-notch curve reaches 95% at 330 ms ± 1 frame, and `h` never passes `hGoal` (no overshoot).

Playwright, extending `tests/e2e/globe.spec.ts`:

1. Gallery route with `?mock=1`, idle for 5 s, explorer never opened: zero requests matching `/data/globe-lines-`.
2. Open the explorer and wait 2 s: still zero `globe-lines` requests. The existing texture and 110m assertions still pass.
3. Wheel 3 notches toward the globe center: exactly one `globe-lines-50m.v1.json` request with status 200. Wheel back out and in again: still one.
4. Keep zooming until `d < 1.51`: exactly one `globe-lines-10m.v1.json` request. Closing and reopening, then zooming in again, adds no request.
5. Wheel-zoom in, then run the existing drag: `group.rotation.x === 0`, the world pole is (0, 1, 0), and the screen pole skew is 0. The existing assertions are unchanged.
6. Open a photo modal: the modal globe makes no `globe-lines` request, and its sphere segment count is unchanged.
7. `threeState.camera.position.length()` never goes below 1.30, and `camera.near` stays below `length() - 1` throughout tests 3 and 4.

Manual checks, on a trackpad, a mouse, and a phone:

- At d = 1.30 over Italy, Japan, and the US Gulf coast, the coast line sits on the JPEG coast within one texel.
- Take one screenshot at the fit distance over North Africa and Europe. Read the on-screen luminance of open ocean, Europe, and the central Sahara, and compare it with §1 (about 21, 35–80, and 140). Sahara borders must still be visible at world level. If desert is brighter than about 175, revisit the rejected ink switch in §4.2.
- No line crosses the Pacific along ±180°.
- Lifting one finger after a pinch does not jump the globe.
- While a 10m file loads over throttled "Fast 3G", the zoom stays smooth and the detail fades in when it arrives.

## 10. Files

Add:

| File | Purpose |
| --- | --- |
| `js/globeDetail.js` | Classic script that sets `globalThis.GlobeDetail`. Holds the constants (§11), the level and hysteresis function, prefetch rule, wheel normalization, log-space smoothing step, anchor math, THREE-free `latLonToXYZ`, decode, densify, antimeridian split, world-edge derivation, and `createInkMaterial(THREE)`. Add it to `tsconfig.browser.json` `include` with the JSDoc it needs. |
| `js/globeLinesWorker.js` | Classic worker that fetches, parses, and builds typed arrays, then transfers them. `importScripts('globeDetail.js?v=…')`. |
| `scripts/build-globe-lines.mjs` | Offline builder (§6.3). Enforces the byte caps. |
| `public/data/globe-lines-50m.v1.json` | Regional lines (§6.3). |
| `public/data/globe-lines-10m.v1.json` | Local lines (§6.3). |
| `tests/unit/globe-detail.test.ts` | §9 Vitest cases. |

Edit:

| File | Change |
| --- | --- |
| `js/globeExplorer.js` | `enableZoom = false`. Add the zoom controller (wheel, Safari gesture, touch pinch), anchor, `minDistance` 1.30, near/far rule, `rotateSpeed` and `autoRotate` scaling, the line-level manager and `lod` crossfade, hover through uniforms (remove the per-ring `THREE.Line` build), analytic sphere hit, a 192 × 96 sphere, dot, pulse, and pick radius 1.0025 with altitude-scaled size and threshold, and disposal of line meshes and the worker in `_destroyScene`. |
| `js/threeLoader.js` | Add `explorerSphereSegments()` returning `[192, 96]`. Leave `sphereSegments('modal')` alone. |
| `js/countryBoundaries.js` | Store `adm0a3` (`props.ADM0_A3`) on each feature and expose an ADM0_A3 → feature index map for code remapping and hover uniforms. |
| `js/globeRoutes.js` | Arc base radius 1.01 → 1.0025. The explorer is its only caller. |
| `index.html` | Add `<script src="js/globeDetail.js?v=…">` before `js/globeExplorer.js` and bump `globeExplorer.js?v=`. No `type="module"`. |
| `_headers` | Immutable cache rule for `/data/globe-lines-*`. |
| `public/data/README-country-boundaries.md` | Sources, Natural Earth tag, tolerances, caps, and the build command. |
| `docs/performance-audit.md` | Prefetch table row: "Explorer zoom below d 2.35 / 1.80 → globe-lines 50m / 10m, parsed in worker, cached." |
| `tests/e2e/globe.spec.ts` | §9 Playwright cases. |

Do not edit: `js/globeService.js` (modal), `styles.css`, `_warmup()` or `_prefetchAssets()` targets, `package.json` `type`, `public/data/ne_110m_admin_0_countries.geojson`.

## 11. Constants

These are the starting values for `GlobeDetail.CONFIG`. Tune them in one place.

```js
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
    INK: { line: '#E3E8EC', admin1: '#C5CCD3', hover: '#FFFFFF' },
    ALPHA: {
        world:    { coast: 0.20, border: 0.36 },
        regional: { coast: 0.26, border: 0.44, lake: 0.18 },
        local:    { coast: 0.32, border: 0.52, lake: 0.24, admin1: 0.26 },
        hover: 0.90, hoverAdmin1: 0.45, lowDprScale: 0.75
    },
    LIMB_FADE: [0.06, 0.30],
    FAR_FADE_D: [3.2, 8.0],
    ADMIN1_FADE_D: [1.56, 1.40]
};
```
