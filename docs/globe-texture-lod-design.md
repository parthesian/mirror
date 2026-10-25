# Globe explorer: texture level of detail

Status: design. Not implemented.
Scope: the full-screen `GlobeExplorer` overlay only. The 160 px modal globe (`js/globeService.js`) keeps `/earth_atmos_2048.jpg` and must not load anything described here.

This document is meant to be implemented as written. Distances use the units already implemented from `docs/globe-zoom-design.md`:

- `d` is the camera distance from the globe center. The globe radius is 1.
- `h = d - 1` is the altitude above the surface.
- The closest camera is `d = 1.30` (`H_MIN = 0.30`). The fit distance is at least 2.6.
- Line levels: world when `d ≥ 2.05`, regional from 1.55 to 2.05, local from 1.30 to 1.55, hysteresis ±0.04. Enter local when `d < 1.51`. Leave local when `d > 1.59`.
- Line prefetch: `dAhead = min(d, 1 + hGoal)` below 2.35 (regional) and 1.80 (local). Opening the explorer at the fit distance fetches neither file.
- Crossfade: `CROSSFADE_MS = 360`, `CROSSFADE_REDUCED_MS = 120`.
- Lines sit at r = 1.0003. Dots and arc endpoints sit at r = 1.0025. The pulse sits at r = 1.003.
- Sphere UV for a longitude/latitude is `((lon + 180) / 360, (lat + 90) / 180)`, with `group.rotation.y = -π/2`. `GlobeDetail.latLonToXYZ` and `GlobeRoutes.latLonToVec3` already match that registration.

Pixel values are CSS pixels unless they say device pixels. The explorer caps the renderer at `min(devicePixelRatio, 2)`.

## 0. Decisions at a glance

| Topic | Decision |
| --- | --- |
| Source | One plate: Natural Earth I with Shaded Relief, 1:50m, package 3.2.0, `NE1_50M_SR.tif`, 10,800 × 5,400. |
| Why one level | The 10m plates cost 2.25× and 4× the texels for a gain from 2.11 CSS px/texel to 1.41 or 1.05 at `d = 1.30`. Section 1 has the byte math. |
| Which zoom band | The existing local band. Prefetch uses `PREFETCH_D.local` (1.80). Opacity uses `stepLevel === 'local'` (±0.04 around 1.55). No third distance system. |
| Tiles | 450 × 450 JPEG, 15° × 15°, 24 columns × 12 rows = 288 files. Quality 80, hard cap 80,000 bytes per tile. |
| One view | At most 16 tiles (visible samples plus a 1-tile margin, then a cap). Hard ceiling 16 × 80,000 = 1,280,000 bytes on the wire. |
| GPU | LRU of 16 uploaded textures (about 17 MB with mipmaps). In-flight fetches capped at 4. |
| Base mesh | The 2048 JPEG stays on the existing sphere for the life of the scene. Detail is a transparent overlay at r = 1.0002, `renderOrder = -1`. |
| Modal and warmup | Unchanged. No tile URL in `_warmup`, `_prefetchAssets`, `ThreeLoader`, or `GlobeService`. |
| Builder | `scripts/build-globe-tiles.mjs`, run by hand. Not part of `npm run build`. The source TIFF and ZIP are not committed. |

## 1. Source choice

The base photograph is `public/earth_atmos_2048.jpg` (2,048 × 1,024, 466,610 bytes, about 0.222 bytes/pixel), served as `/earth_atmos_2048.jpg`. At `d = 1.30` on the 900 px reference viewport (1.76 km per CSS px) one texel is about 11 CSS px, which is why coasts look soft. The detail plate has to be the same kind of image: one equirectangular earth, west edge −180, north edge +90, so a tile can share the sphere UV the boundary lines already use.

That plate is Natural Earth I with Shaded Relief at 1:50m. It is satellite-derived land cover plus shaded relief, the photographic raster on the same site as the vectors already in `public/data/`. Checked against the CDN on 2026-10-25:

| Plate | Page | CDN URL | HTTP size | Pixels | World-file edges |
| --- | --- | --- | --- | --- | --- |
| 1:50m Natural Earth I with Shaded Relief, page label version 3.2.0 | https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-1/ | https://naciscdn.org/naturalearth/50m/raster/NE1_50M_SR.zip | 40,889,620 bytes | 10,800 × 5,400 | west −180, north +90 |
| 1:10m large, page label version 3.2.0 | https://www.naturalearthdata.com/downloads/10m-raster-data/10m-natural-earth-1/ | https://naciscdn.org/naturalearth/10m/raster/NE1_HR_LC_SR.zip | 200,619,235 bytes (191.32 MiB) | 21,600 × 10,800 | west −180, north +90 |
| 1:10m medium, page label version 3.2.0 | same 10m page | https://naciscdn.org/naturalearth/10m/raster/NE1_LR_LC_SR.zip | 115,782,554 bytes (110.42 MiB) | 16,200 × 8,100 | west −180, north +90 |

The download buttons on naturalearthdata.com point at a broken doubled host (`https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/...`). The naciscdn.org URLs above are the ones that return 200. Last-Modified on the 50m zip is Wed, 08 Sep 2021. The 50m zip contains `NE1_50M_SR/NE1_50M_SR.tif` (deflated, uncompressed TIFF 175,039,298 bytes), `NE1_50M_SR.tfw`, and a two-line `Read_me.txt` ("Geographic projection", "WGS84 datum"). It has no `VERSION.txt`. The manifest records the page label `3.2.0`. The 10m zips do contain `VERSION.txt`, and that file says `2.0.0`; that string is the older Natural Earth I content tag inside the zip, not the package label, and this spec does not use those zips.

The 50m world file, read from the zip, is:

```text
 0.03333333333333
 0.00000000000000
 0.00000000000000
-0.03333333333333
-179.98333333333333
 89.98333333333333
```

Pixel size 0.03333333333333° is 1/30 degree at the printed precision. `round(360 / 0.03333333333333) = 10800` and `round(180 / 0.03333333333333) = 5400`. The upper-left pixel center is half a pixel in from the corner, so the raster edges are exactly longitude −180 and latitude +90. Slicing on those pixel edges preserves the registration. The builder must refuse any other width or height.

The shaded-relief-and-water companion (`NE1_50M_SR_W.zip`, 88,413,091 bytes) is a different plate. This spec uses `NE1_50M_SR` only.

### 1.1 Why the 10m plates stay out

Equatorial circumference 40,075 km. CSS px per texel at `d = 1.30` on the reference viewport is `(40075 / width) / 1.76`. Device px uses the renderer cap of 2.

| Plate | km / texel | CSS px / texel at d = 1.30 | Device px at the cap of 2 |
| --- | --- | --- | --- |
| 2,048 (base, stays) | 19.57 | 11.1 | 22.2 |
| 10,800 (50m, ship this) | 3.711 | 2.11 | 4.22 |
| 16,200 (10m medium) | 2.474 | 1.41 | 2.81 |
| 21,600 (10m large) | 1.855 | 1.05 | 2.11 |

A 15° tile (the grid in §2) is 450 × 450 on the 50m plate. The same geographic tile is 675 × 675 on the 10m medium plate and 900 × 900 on the 10m large plate.

| | 50m 450² | 10m medium 675² | 10m large 900² |
| --- | --- | --- | --- |
| RGBA upload, one tile | 810,000 bytes | 1,822,500 (2.25×) | 3,240,000 (4×) |
| 16 tiles, RGBA only | 12,960,000 | 29.2 MB | 51.8 MB |
| 16 tiles, mip chain × 4/3 | 17,280,000 | 38.9 MB | 69.1 MB |
| 16 tiles at the JPEG cap below, scaled by area | ≤ 1,280,000 | ≤ 2.9 MB | ≤ 5.1 MB |

The boundary work already accepted about 1.9 CSS px of coastline error at `d = 1.30` (10m lines simplified at 0.03°). A 2.11 CSS px texel is the same order. The 10m large plate would spend about 4× the GPU memory and about 4× the JPEG bytes to move from 2.11 CSS px to 1.05. That is the wrong trade for a second zoom system. Ship one detail level, from the 50m plate, on the local line band.

At the regional edge (`d = 2.05`) the 2048 plate is already about 3.2 CSS px/texel, and a footprint that wide pulls in the limb ring (tens of extra tiles). The overlay therefore waits for the local band, where the 11 px softness is the one the product named.

### 1.2 What the crossfade has to hide

The explorer canvas is `grayscale(1) contrast(1.05) brightness(0.9)`, so a land-cover palette shift against the NASA JPEG is muted. Land and ocean structure still changes: Natural Earth I has shaded relief and a flatter ocean, and the NASA JPEG has cloud and bathymetry texture. The overlay fades with the existing 360 ms / 120 ms crossfade. A late tile feathers its open edges so the structure change cannot arrive as a hard rectangle or a sliding seam.

## 2. Tile scheme

The 10,800 × 5,400 plate divides evenly into 450 × 450 squares. 450 divides both dimensions (`10800 / 450 = 24`, `5400 / 450 = 12`). Square pixels on this plate are square degrees (30 px per degree on both axes), so each tile is 15° × 15°.

| | Value |
| --- | --- |
| Tile pixels | 450 × 450 |
| Tile degrees | 15 × 15 |
| Columns | 24, column 0 is longitude [−180, −165] |
| Rows | 12, row 0 is latitude (75, 90] at the north edge of the file |
| Tile count | 288 |
| JPEG | quality 80 to start, 4:2:0, mozjpeg |
| Max bytes, one tile | 80,000 (builder fails a tile that cannot get under this) |
| Max tiles in one request set | 16 |
| Max bytes, one view | 1,280,000 |
| Decoded RGBA, one tile | 810,000 bytes; 1,080,000 with the mip chain |
| Uploaded cap | 16 textures, 17,280,000 bytes including mipmaps |

Column `c` covers longitude `[-180 + 15c, -180 + 15(c + 1)]`. Row `r` covers latitude `[90 - 15(r + 1), 90 - 15r]`. The file's row 0 is the northern strip (TIFF/JPEG y = 0). No tile crosses ±180. A view that crosses the antimeridian includes column 23 and column 0 as two meshes. Each mesh uses its own longitude span. Nothing is stretched across the seam.

`tileIndex(lat, lon)` assigns a sample to a half-open cell. Longitude 180 and −180 both wrap to −180 and land in column 0. Latitude 90 is nudged just under 90 so the north pole lands in row 0. Latitude −90 lands in row 11 by the clamp.

```text
wrapLon(lon) = ((lon + 180) mod 360) mapped into [0, 360), then minus 180
               so the result is [-180, 180), and 180 becomes -180
lat' = min(lat, 90)            then if lat' is 90, replace with nextafter(90, 0)
col  = clamp(floor((wrapLon(lon) + 180) / 15), 0, 23)
row  = clamp(floor((90 - clamp(lat', -90, 90)) / 15), 0, 11)
```

Normative edge samples:

| lat | lon | row | col |
| --- | --- | --- | --- |
| 90 | 0 | 0 | 12 |
| 90 | 179 | 0 | 23 |
| 89.9 | −180 | 0 | 0 |
| −90 | 10 | 11 | 12 |
| −90 | 180 | 11 | 0 |
| 0 | 180 | 6 | 0 |
| 0 | −180 | 6 | 0 |
| 0 | −165 | 6 | 1 |
| 0 | −165.0001 | 6 | 0 |
| 75 | 0 | 1 | 12 |
| 62 | 179.9 | 1 | 23 |

The shared edge between column 0 and column 1 is longitude −165. A sample exactly on −165 is indexed into column 1. The meshes still share that edge (§4.2), so the index of one boundary sample does not open a gap.

Expected JPEG size, using the base photo's 0.222 bytes/pixel as the planning rate: 450 × 450 × 0.222 ≈ 45 KB. The full tree at that rate is about 13 MB. The builder's hard ceiling on the tree is 20,000,000 bytes (§3). Oceans on this plate are flatter than the NASA JPEG, so the mean should land at or under that rate. A detailed land tile that would pass 80,000 bytes is re-encoded down the quality ladder instead of raising the cap.

## 3. What is committed

The operator downloads `NE1_50M_SR.zip` once, on a machine that is not the Pages build, and points the script at the TIFF and the world file. The script does not download. `npm run build`, `npm run dev`, and `npm test` do not run it. `package.json` gains no script entry and stays without `"type": "module"`. `sharp` is not added to `package.json`. The operator installs it for the one-shot run with `npm install --no-save sharp`.

```text
node scripts/build-globe-tiles.mjs \
  --src /tmp/NE1_50M_SR/NE1_50M_SR.tif \
  --tfw /tmp/NE1_50M_SR/NE1_50M_SR.tfw \
  --out public/data/globe-tiles/v1
```

`scripts/build-globe-tiles.mjs` is ESM, same as `scripts/build-globe-lines.mjs`. It dynamically `import()`s `sharp` and, if that fails, prints the `npm install --no-save sharp` line and exits 1.

Checks, all of them fatal:

- TIFF width 10800, height 5400, three 8-bit channels. Decode as sRGB. A fourth channel, a different size, or a different bit depth exits 1.
- World file present. Pixel size x within 1e-9 of `0.03333333333333`, pixel size y within 1e-9 of `-0.03333333333333`, upper-left center within 1e-6 of `(-179.98333333333333, 89.98333333333333)`.
- Each tile is an extract, not a resize: left `c * 450`, top `r * 450`, size 450 × 450. Row 0 is the top of the file.
- Encode JPEG quality 80, chroma 4:2:0, mozjpeg. If the buffer is over 80,000 bytes, repeat at 74, then 68, then 62. If it is still over, exit 1 and name the `r`/`c`.
- Sum of the 288 buffers ≤ 20,000,000 bytes. Over the ceiling, delete the temp output and exit 1. Write the temp directory first and rename it into `--out` only after both checks pass, so a failed run leaves no partial tree under `public/data/globe-tiles/`.

Output layout:

```text
public/data/globe-tiles/v1/manifest.json
public/data/globe-tiles/v1/r00-c00.jpg
...
public/data/globe-tiles/v1/r11-c23.jpg
```

Row and column are two digits. `r00-c00.jpg` is the northwest tile (latitude up to +90, longitude from −180). The manifest is the only JSON:

```json
{
  "version": 1,
  "source": "NE1_50M_SR",
  "sourceVersion": "3.2.0",
  "width": 10800,
  "height": 5400,
  "tileSize": 450,
  "cols": 24,
  "rows": 12,
  "tileDeg": 15,
  "jpegQuality": 80,
  "maxTileBytes": 80000
}
```

Commit the manifest and the 288 JPEGs. Do not commit the ZIP, the TIFF, or the world file.

The runtime fetches the manifest only after the prefetch predicate in §5 goes true. It checks `width`, `height`, `tileSize`, `cols`, `rows`, and `tileDeg` against the constants in §11. Any mismatch is a manifest failure (§6).

## 4. Runtime

### 4.1 Base mesh

`js/globeExplorer.js` keeps loading `/earth_atmos_2048.jpg` through `threeLoader.createEarthTexture` and keeps it on the existing `MeshPhongMaterial` (`color 0xcccccc`, `shininess 1`). `threeState.tex` remains that texture so the current e2e assertion (width 2048, src contains `/earth_atmos_2048.jpg`) still passes after a zoom in and back out. The detail overlay never replaces `threeState.tex`.

`js/threeLoader.js` stays on that one URL. `js/globeService.js` stays as it is. The modal path, `_warmup()`, and `_prefetchAssets()` do not gain a tile or manifest URL.

### 4.2 Overlay

One mesh per uploaded tile, parented to the same `group` as the base sphere. No extra yaw. `group.rotation.y = -π/2` moves the base photograph, the tiles, and the lines together.

```text
radius 1.0002
widthSegments 8, heightSegments 8
phiStart   = c * 15° in radians
phiLength  = 15° in radians
thetaStart = r * 15° in radians
thetaLength = 15° in radians
```

`phiStart = 0` is longitude −180, which is column 0, matching `SphereGeometry` UV and `latLonToXYZ`. `thetaStart = 0` is the north pole, which is row 0. Three.js puts `uv.y = 1` at `thetaStart`. The JPEG is stored north-up, and `Texture.flipY` stays at its default `true`, so the top of the JPEG meets latitude +90. Leave `flipY` on. Turning it off slides every coast relative to the lines.

Material, cloned per tile:

```text
MeshPhongMaterial
  map = the tile texture
  color 0xcccccc
  shininess 1
  transparent true
  opacity 0
  depthWrite false
  depthTest true
  side FrontSide
```

The Phong terms match the base mesh, so the fade is a change of imagery under the same lights. The canvas filter then grayscales both.

Texture:

```text
colorSpace = SRGBColorSpace
wrapS = wrapT = ClampToEdgeWrapping
minFilter = LinearMipmapLinearFilter
magFilter = LinearFilter
generateMipmaps = true
anisotropy = min(4, renderer.capabilities.getMaxAnisotropy())
```

`renderOrder = -1`. Border lines are `renderOrder` 0 with `depthWrite: false`, arcs are 1, dots are 2, pulses are 4. A negative order draws the overlay in the transparent pass before those objects, which is what keeps a coastline on top of a tile. Leave the line, arc, dot, and pulse orders as they are. Radius 1.0002 still sits above the base sphere (r = 1) and below the lines (r = 1.0003), so a depth test against the opaque globe passes and a later depth test against a line would fail if a line ever wrote depth.

Stack:

```text
1.0000  base sphere, earth_atmos_2048.jpg
1.0002  detail tiles
1.0003  boundary lines
1.0025  dots and arc endpoints
1.0030  pulse
```

### 4.3 Opacity, hysteresis, feather

The level latch is the one `GlobeDetail.stepLevel` already runs inside `_stepZoom`. The overlay target is 1 when that latch is `'local'` and the session is allowed to show tiles (§5: no `saveData`, manifest loaded and valid). Otherwise the target is 0. Crossing both line thresholds in one frame is fine: opacity still eases, it does not snap.

Each frame, from the same `dt` `_stepZoom` already clamped to 48 ms:

```text
fadeMs = prefers-reduced-motion ? CROSSFADE_REDUCED_MS : CROSSFADE_MS   // 120 or 360
step   = fadeMs > 0 ? dt / fadeMs : 1
levelOpacity += clamp(target - levelOpacity, -step, step)
```

Reduced motion reuses `_prefersReducedMotion()`. There is no separate texture duration.

Each tile has its own opacity, starting at 0 on the frame its mesh is added, eased to 1 with the same `step`. The fragment multiplies `diffuseColor.a` by `levelOpacity * tileOpacity * edge`. A tile that finishes decoding while the camera is already in the local band fades in over 360 ms (120 ms reduced) instead of appearing on one frame.

Edge feather, only on a side whose neighbor is not currently uploaded. Neighbors wrap in longitude: column 0's west neighbor is column 23, and column 23's east neighbor is column 0. Row 0 has no north neighbor and row 11 has no south neighbor; those two outer sides stay at feather 1, because the outer edge is the pole. Feather width is 8 texels (`8 / 450`).

Inject with `onBeforeCompile` on the tile material (three r160, map uv varying `vMapUv`). Set `customProgramCacheKey` to a stable string so every tile shares one program. Uniform `uMissing` is a `Vector4` in order north, east, south, west, 1 when that neighbor is absent:

```text
feather = 8 / 450
edge = 1
if north missing: edge = min(edge, smoothstep(0, feather, 1 - vMapUv.y))
if east  missing: edge = min(edge, smoothstep(0, feather, 1 - vMapUv.x))
if south missing: edge = min(edge, smoothstep(0, feather, vMapUv.y))
if west  missing: edge = min(edge, smoothstep(0, feather, vMapUv.x))
diffuseColor.a *= edge
```

Uploaded neighbors make `edge` 1 on the shared side, so two loaded tiles meet on the same source pixel with no darkened seam and no overlap. A missing neighbor fades those 8 texels into the base photograph, which is the hard-rectangle case the feather is there to remove.

When `levelOpacity` reaches 0, dispose every overlay mesh, geometry, material, and GPU texture, and `close()` every `ImageBitmap`. Do that after the fade, not at the moment the target flips to 0, so the photograph does not hole out mid-fade. Keep the session blob map and the requested-URL set (§5). The next descent rebuilds meshes from those blobs and does not call `fetch` again.

### 4.4 Where it runs

Add `_stepTiles(dt, now)` and call it from the existing animation frame, after `controls.update()` and `_stepLines`, so the aim includes damping. It runs only while the explorer is open. It does no DOM work. Aspect is `state.zoom.viewWidth / state.zoom.viewHeight`, the pair `_fitGlobeInView` and the resize handler already store. If either is 0, skip the frame.

Recompute the wanted id list when `d` has moved by more than 0.01 or the group-local camera direction has left a 0.5° cone around the previous aim (`dot < cos(0.5°)`). While a drag is moving the aim, the 9×9 ray test still has to stay inside the 2 ms frame budget in §6. Upload at most one texture per frame, and start at most one `createImageBitmap` per frame.

## 5. Which tiles to request

### 5.1 Predicate

```text
shouldFetchTexture(d, hGoal, saveData):
  if saveData: return false
  dAhead = min(d, 1 + hGoal)
  return dAhead < CONFIG.PREFETCH_D.local
```

`PREFETCH_D.local` is 1.80. The fit distance is at least 2.6, and 1.80 is under that floor, so an explorer that opens and stays at the fit distance never fetches the manifest or a tile. `saveData` skips this level the same way it skips the 10m line file: the local line level can still latch, and the overlay target stays 0.

Settled distances at or above the fit floor fail the predicate because `dAhead = d ≥ 2.6 > 1.80`. A zoom that has already pulled `hGoal` down while the camera is still at `d = 2.6` does fetch: `dAhead = min(2.6, 1.30) = 1.30`. That is the same ahead rule the line files use, and it is why the tiles can be in flight during the glide instead of after it.

Normative predicate samples:

| d | hGoal | saveData | result |
| --- | --- | --- | --- |
| 2.6 | 1.6 | false | false |
| 3.09 | 2.09 | false | false |
| 8 | 7 | false | false |
| 2.6 | 0.30 | false | true |
| 1.90 | 0.90 | false | false |
| 1.90 | 0.70 | false | true |
| 1.40 | 0.40 | true | false |
| 1.40 | 0.40 | false | true |

The gallery route never calls this. The call site sits next to `_considerLinePrefetch`, gated by `this.isOpen`.

### 5.2 Id list

`tilesForView` is a pure function on `GlobeDetail`. It does not touch THREE, the DOM, or the network. The explorer passes a group-local aim: take the camera world position through `group.worldToLocal`, then the inverse of `latLonToXYZ` (`lat = asin(y)`, `lon = atan2(z, -x)` in degrees minus 180, wrapped). When `hypot(x, z) < 1e-8`, longitude is 0. The explorer's polar clamp is still ±62°; the function itself accepts a polar aim so the tests can.

The distance used for the rays is

```text
dSelect = clamp(dAhead, 1 + H_MIN, LEVEL_D.local) = clamp(dAhead, 1.30, 1.55)
```

clamped by the caller before `tilesForView`. A prefetch that fires while the camera is still far casts rays at the arrival distance, not at the wide orbit, so the request set is the close view. `tilesForView` then uses the `d` it was given and does not clamp a second time.

Algorithm, normative. Tests in §8 lock the output.

1. Camera position `C = latLonToXYZ(lat, lon, d)`. `forward = -normalize(C)`. `worldUp = (0, 1, 0)`. `right = normalize(cross(forward, worldUp))`, or `(1, 0, 0)` when that cross has length under 1e-8. `up = normalize(cross(right, forward))`.
2. Vertical FOV 45°. `tanHalf = tan(fovDeg × π / 360)`. Aspect is width/height. For each of a 9×9 grid, `nx = -1 + 2·ix/8`, `ny = -1 + 2·iy/8`, `ix` and `iy` from 0 through 8:
   - Direction `right · (nx · aspect · tanHalf) + up · (ny · tanHalf) + forward`.
   - Hit with the existing `rayUnitSphere`. On a miss, binary-search a scale `s` in `(0, 1]` on `(nx·s, ny·s)` for 12 iterations and keep the last hit. That hit is the limb along that screen ray.
3. Keep a hit whose incidence `dot(normalize(hit), normalize(C - hit))` is at least 0.30. That is `LIMB_FADE[1]`, the point where boundary lines are at full alpha. Grazing samples inside the line fade do not add tiles.
4. `core` = the set of `tileIndex` of the kept hits.
5. `pool` = `core` expanded by Chebyshev margin 1. For each `(r, c)` add `(r + dr, (c + dc) mod 24)` for `dr, dc` in `{-1, 0, 1}`, and drop a row outside `0..11`. Longitude wraps. The poles do not.
6. Sort the pool by the tuple `(core ? 0 : 1, distanceDegrees rounded to 1e-6, row, col)`. Distance is the great-circle angle between `(lat, lon)` and the tile center `lat = 90 - (row + 0.5)·15`, `lon = wrapLon(-180 + (col + 0.5)·15)`. Rounding happens before the compare so equal rings stay in row/col order on every engine.
7. Return the first 16. The explorer's ±62° clamp never puts the whole polar row on screen; a synthetic aim at latitude 89 can, and the cap keeps 16 of that row, nearest the aim, including both antimeridian columns when the aim is on the date line.

Wanted ids are exactly that list. The explorer requests those ids and no others. When the list changes, ids that dropped out leave the fetch queue. A fetch already in flight is allowed to finish and store its blob; it is not aborted on a pan. Abort the controller only when the page is going away with the explorer object. Closing the overlay disposes GPU resources and leaves the session cache in place so reopen does not refetch.

### 5.3 Fetch

Session state lives on the `GlobeExplorer` instance (`this._tileSession`), not on `threeState`, so `_destroyScene` does not drop it.

- `manifest`: parsed object or null.
- `manifestFailed`: boolean.
- `warnedManifest`, `warnedTile`: booleans. Warnings fire once per page (§6).
- `requested`: `Set` of URL strings. A URL in the set is never passed to `fetch` again.
- `blobs`: `Map` from URL to `Blob`. Every successful body is kept for the page session. 288 tiles at the 80,000-byte cap is 23,040,000 bytes and the builder ceiling keeps the tree under 20 MB, so the map does not need its own eviction.
- `inflight`: count, ceiling 4.
- `queue`: wanted ids waiting for a slot, in the §5.2 order.

First request, when the predicate becomes true and `manifest` is null and `manifestFailed` is false:

```text
GET /data/globe-tiles/v1/manifest.json
cache: 'force-cache'
```

Then tiles:

```text
GET /data/globe-tiles/v1/rRR-cCC.jpg
cache: 'force-cache'
```

`RR` and `CC` are two digits. At most four tile fetches are in flight. When one settles, start the next queued id. Decode with `createImageBitmap(blob)` and upload on a later frame (§4.4). `createImageBitmap` is the decode path; do not decode the 10,800 × 5,400 file, and do not draw a tile onto a full-plate canvas.

One `fetch` per tile URL per page session. A second descent uses the blob already in the map. `cache: 'force-cache'` is what the browser uses if the blob map were ever bypassed; the set is what makes the second call not happen.

## 6. Performance and failure

- No `getBoundingClientRect` on the tile path. Zoom already caches the canvas rect and the view size; read those.
- No full-image decode. Each bitmap is one 450 × 450 JPEG.
- Main thread under 2 ms on a frame where a tile arrives: the ray test is at most 81 sphere tests, one bitmap is created, one texture is uploaded. Further arrivals wait for later frames.
- The gallery route and an explorer opened at the fit distance make zero requests under `/data/globe-tiles/`. Same guarantee as the line files, from the same `dAhead < 1.80` gate, which is under the 2.6 fit floor.
- `saveData` fetches neither the manifest nor a tile.
- The modal globe is unchanged: same 2048 texture, same segment count, no `/data/globe-tiles/` request.

Failure:

- Manifest HTTP failure, JSON parse failure, or a constant mismatch: set `manifestFailed`, do not request tiles, keep the 2048 photograph. `console.warn('[GlobeExplorer] globe tile manifest unavailable')` once.
- A tile HTTP failure or a `createImageBitmap` rejection: drop that id for the session (it stays in `requested`), keep the 2048 photograph under that hole, feather the neighbors. `console.warn('[GlobeExplorer] globe tile failed')` once, on the first tile failure. Later tile failures increment a counter and do not log again.

`_headers` gains an immutable rule so `force-cache` has a cache that matches the versioned path:

```text
/data/globe-tiles/*
  Cache-Control: public, max-age=31536000, immutable
```

## 7. Constants

Add this object to `GlobeDetail.CONFIG` immediately after `PREFETCH_D`. Prefetch and the level latch are the existing fields, so the texture numbers cannot drift from the line numbers.

```js
LEVEL_D: { regional: 2.05, local: 1.55 },
HYSTERESIS: 0.04,
PREFETCH_D: { regional: 2.35, local: 1.80 },
TEXTURE: {
    radius: 1.0002,
    minIncidence: 0.30,
    grid: 9,
    margin: 1,
    viewCap: 16,
    lru: 16,
    inflight: 4,
    featherTexels: 8,
    tileDeg: 15,
    cols: 24,
    rows: 12,
    tileSize: 450,
    maxTileBytes: 80000,
    manifest: '/data/globe-tiles/v1/manifest.json'
},
```

`dSelect` clamps to `[1 + H_MIN, LEVEL_D.local]`. The prefetch compare reads `PREFETCH_D.local`. The opacity latch reads `stepLevel`. `TEXTURE` does not copy those three numbers.

Export next to the existing pure helpers, with JSDoc in the same style as the file. The line worker `importScripts` this file and must not execute a fetch because of the new code. The new functions are pure and run only when called.

- `tileIndex(lat, lon) -> { row, col }`
- `tilesForView({ lat, lon, d, aspect, fovDeg }) -> { row, col }[]` using `CONFIG.TEXTURE` for the grid, incidence, margin, and cap. Default `fovDeg` is 45.
- `shouldFetchTexture(d, hGoal, saveData) -> boolean`

## 8. Tests

### 8.1 Unit

New file `tests/unit/globe-tiles.test.ts`. Load `js/globeDetail.js` with the classic-script loader `tests/unit/globe-detail.test.ts` already uses. No WebGL.

`tileIndex` matches the table in §2, including both poles and both antimeridian longitudes.

`shouldFetchTexture` matches the table in §5.1. The fit-distance rows are the "no fetch when `d ≥ 2.6`" case: settled `hGoal = d - 1` at `d` of 2.6, 3.09, and 8 returns false. The row `d = 2.6`, `hGoal = 0.30` returns true, so the test locks the ahead behavior instead of a bare `d < 2.6` compare. The `saveData` row returns false at a local distance.

`tilesForView` ordered lists, `fovDeg` 45, `d = 1.30`. Each list is the full return value, priority order:

Equator, lat 0, lon 0, aspect 16/9. Core 4, pool 16, cap does not drop any:

```text
r05c11 r05c12 r06c11 r06c12 r04c11 r04c12 r05c10 r05c13
r06c10 r06c13 r07c11 r07c12 r04c10 r04c13 r07c10 r07c13
```

Antimeridian, lat 0, lon 179.5, aspect 1. Columns 23 and 0 are both present. Column 12 is absent:

```text
r05c23 r06c23 r05c00 r06c00 r05c22 r06c22 r04c23 r07c23
r04c00 r07c00 r05c01 r06c01 r04c22 r07c22 r04c01 r07c01
```

The same call with lon −179.5 returns:

```text
r05c00 r06c00 r05c23 r06c23 r05c01 r06c01 r04c00 r07c00
r04c23 r07c23 r05c22 r06c22 r04c01 r07c01 r04c22 r07c22
```

North pole on the date line, lat 89, lon 179.5, aspect 1. The uncapped pool is larger than 16; the return is the 16 nearest, and it includes column 0 and column 23:

```text
r00c23 r00c00 r00c22 r00c01 r00c21 r00c02 r00c20 r00c03
r00c19 r00c04 r00c18 r00c05 r00c17 r00c06 r00c16 r00c07
```

North pole, lat 89, lon 0, aspect 1:

```text
r00c11 r00c12 r00c10 r00c13 r00c09 r00c14 r00c08 r00c15
r00c07 r00c16 r00c06 r00c17 r00c05 r00c18 r00c04 r00c19
```

South pole, lat −89, lon 40, aspect 1:

```text
r11c14 r11c15 r11c13 r11c16 r11c12 r11c17 r11c11 r11c18
r11c10 r11c19 r11c09 r11c20 r11c08 r11c21 r11c07 r11c22
```

Date line at the polar clamp, lat 62, lon 180, aspect 16/9. The same list is returned for lon −180:

```text
r01c00 r01c23 r02c00 r02c23 r01c01 r01c22 r02c01 r02c22
r01c02 r01c21 r00c00 r00c23 r00c01 r00c22 r02c02 r02c21
```

One more equality: `tilesForView` at lat 0, lon 0, aspect 16/9, `d = 8` equals the call at `d = 1.55` only when the caller has already clamped. The function does not clamp. The unit test calls it with `d = 1.30` for the lists above and does not pass a raw fit distance. The explorer is what applies `dSelect`.

### 8.2 Playwright

One new test in `tests/e2e/globe.spec.ts`, next to the line-file tests, using the same `/?mock=1`, `openExplorer`, and `wheelNotches` helpers.

1. Record responses whose URL contains `/data/globe-tiles/`. Record `pageerror`.
2. Open the gallery, open the explorer, wait 2 seconds. The recorded tile list is empty. The camera is still at the fit distance (`≥ 2.6` on a 1280 × 720 viewport, where `globeFitDistance` is about 3.09).
3. Wheel in with the existing helper (`deltaY` −100, eight notches is what the local-line test already uses from this fit distance) and poll until `camera.position.length() < 1.51`.
4. At least one response whose URL matches `/data/globe-tiles/v1/r` and ends in `.jpg` has status 200.
5. Wheel back out until `camera.position.length() > 2.2`.
6. `pageerror` is empty. `threeState.tex.image` still has `naturalWidth` 2048 and a src that contains `/earth_atmos_2048.jpg`.

The manifest request is allowed in step 4. The assertion that matters for the photograph is a JPEG tile status. The existing modal test and the gallery-idle test stay as they are. This case is the one that guards the fit-distance gate and the base texture.

## 9. Files

Add:

| File | Purpose |
| --- | --- |
| `scripts/build-globe-tiles.mjs` | Offline slicer (§3). Not referenced from `package.json`. |
| `public/data/globe-tiles/v1/manifest.json` | The manifest in §3. |
| `public/data/globe-tiles/v1/rRR-cCC.jpg` | 288 tiles. |
| `tests/unit/globe-tiles.test.ts` | §8.1. |

Edit:

| File | Change |
| --- | --- |
| `js/globeDetail.js` | `CONFIG.TEXTURE` and the three pure functions (§7). JSDoc so `checkJs` stays clean. |
| `js/globeExplorer.js` | Overlay meshes, `_stepTiles`, session cache, fetch queue. Bump nothing in the line or zoom math. |
| `index.html` | Bump the `?v=` query on `js/globeDetail.js` and `js/globeExplorer.js`. No new script tag. No `type="module"`. |
| `_headers` | The `/data/globe-tiles/*` immutable rule (§6). |
| `tests/e2e/globe.spec.ts` | The one case in §8.2. |
| `docs/performance-audit.md` | One prefetch row: "Explorer zoom below d 1.80 → globe tile manifest and up to 16 JPEG tiles, `force-cache`, 4 in flight, once per tile per session. None at the fit distance. `saveData` skips them." |
| `public/data/README-country-boundaries.md` | A short source note: 50m Natural Earth I with Shaded Relief 3.2.0, the naciscdn zip URL, the world-file registration, the build command, the 80,000-byte tile cap, and the 20,000,000-byte tree cap. |

Leave these alone:

- `styles.css`. The overlay is inside the same canvas, so `.globe-explorer-scene canvas { filter: grayscale(1) contrast(1.05) brightness(0.9) }` already covers it.
- `js/globeService.js`. The modal globe keeps the 2048 file and its current segment count.
- `js/threeLoader.js`. The shared earth texture stays `/earth_atmos_2048.jpg`. A tile fetch from this loader would run during warmup.
- `js/globeRoutes.js`. Arc radius and arc `renderOrder` stay 1.0025 and 1.
- `package.json`. No `"type": "module"`, no new script, no `sharp` dependency.
- The source ZIP and TIFF. They are operator inputs, not repo files.
