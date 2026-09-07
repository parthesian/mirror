# Performance & Efficiency Audit

Date: 2026-09-07  
Branch: `cursor/perf-efficiency-audit-a133`

This is an optimization pass, not a redesign. Every change below traces to a
measured or structurally proven inefficiency. Prefetch and eager work that
exist for readiness were left alone.

## 1. Repo map

### Build, framework, rendering, deploy

- Vanilla JS. No bundler, no framework, no TypeScript, no linter, no test
  runner. Scripts are classic `<script>` tags with `?v=` cache busting.
- `build.js` only writes `js/config.js` (`API_BASE_URL`). Output dir is `.`.
- Deploy target: Cloudflare Pages + Pages Functions, D1 (`PHOTO_DB`), R2
  (`PHOTO_BUCKET`). Wrangler 4. `jose` is used by admin Access JWT checks;
  `xlsx` is a backfill script; `three` is loaded from jsDelivr via importmap,
  not from `node_modules`.
- Rendering model: client-built windowed grid/masonry. Only the viewport plus
  overscan (at least one viewport, or two rows) is mounted. Grid uses spacers;
  masonry absolutely positions tiles and holds full height on the window.
- Public entry: `index.html`. Admin: `admin/index.html`.

### Image data path

1. `GET /api/photos?limit=24&cursor=&country=&state=&location=&takenFrom=&takenTo=`
   returns slim rows: `id`, `takenAt`, `uploadedAt`, `width`, `height`.
2. Client `mapPhotoSummary` derives
   - thumb: `/cdn-cgi/image/width=640,height=640,fit=scale-down,quality=82,format=auto/api/photos/{id}/image`
   - full: `/api/photos/{id}/image`
3. The image function looks up `storage_key` in D1, streams R2, and fills
   `caches.default` for a year. Cloudflare Image Transformations then resize
   thumbs.
4. Full metadata (`location`, camera, coords, …) is fetched later via
   `GET /api/photos/{id}/metadata` when the modal opens (`ensurePhotoDetail`,
   in-flight map).
5. Upload (admin only) may canvas-compress files &gt; 2 MB to 2560×1440 @ 0.92.

### Prefetch

| Trigger | What | Concurrency | Cancel / evict |
| --- | --- | --- | --- |
| Visible window render | Next `columns * 3` thumbs | 4 | None; `ImagePreloader` Map grows |
| Masonry unknown aspects | Every thumb still missing a ratio | 6 | None (layout stability) |
| Tile hover 250 ms | Full-size URL | 1 | Timer cleared on leave |
| Modal open | Prev/next full images | 2 | None |
| Flipboard shuffle | Destination thumbs | up to 8 | Lands anyway after 4 s |
| Globe button hover/focus | Three + geo + borders | — | Deduped promises |
| Idle (~3.5 s / `requestIdleCallback`) | Geo JSON + earth JPEG | — | Intentionally delayed so first thumbs win |
| First gallery load idle | Hidden 160 px WebGL globe | — | Now shared + paused until the modal needs it |

Results live in `ImagePreloader.loadedImages` / `loadingPromises`. `clearCache()`
exists and is never called. Visible `<img>` tags register with the preloader so
a prefetch does not start a second HTTP request.

### Filter / sort / search

- No client-side search on the public gallery. Admin metadata search is local
  to loaded admin rows.
- Country / region / place filters are chosen from `/api/photos/geo` indexes
  inside `GlobeExplorer` (`filterOptionCache` keyed by type + parent scope).
- Applying a filter writes `imageService.*Filter` and calls
  `gallery.loadImages()` → `fetchImages()` (fresh page 1).
- Timeline month enablement uses `/api/photos/timeline` with the same filters.
  Unfiltered months come from the first unfiltered timeline payload.
- Sort: API is always `taken_at DESC`. Randomize only remaps `orderedIds`
  (`GalleryOrder.buildDisplayOrder`); later pages append a shuffled tail so
  mounted tiles do not jump.

### State

Plain objects and `window.*` globals. `ImageService` owns the collection
(`imagesById`, `chronoIds`, `orderedIds`, filters, cursors). `Gallery` owns
layout, mounted slice, column/layout prefs. Custom events:
`galleryUpdated`, `galleryFilterChange`, `viewModeChange`, `galleryLayoutChange`,
`exposureChange`, `openModal`, `photoUploaded`. No React-style subscriptions;
listeners are one-off `document` / `window` handlers. Scroll work is rAF-coalesced.

### Tests / lint / types

- `node scripts/verify-gallery-order.mjs` — order, location keys, flipboard,
  and now thumb URL / filter-key guards.
- `node scripts/perf-bench.mjs` — source sizes + layout/filter microbench.
- No `eslint`, `tsc`, CI test script, or perf budget file.

### Prior perf work (do not undo)

Windowed mount, list-payload slimming, CF thumb transforms, `decoding=async`,
preloader dedupe + aspect callback, overscan ≥ 1 viewport, idle globe after
thumbs, flipboard using cached thumbs only, masonry aspect harvest, filter
indexes (`0005_add_filter_indexes.sql`), shared `ThreeLoader`.

## 2. Measurements

Live `parthnain.com` / `mirror-gallery.pages.dev` return a Cloudflare JS
challenge from this environment, so network waterfalls and heap traces were
not captured against production. Baselines are source composition plus CPU
microbenches of the same layout/filter functions the page runs.

### Bundle (uncompressed source)

| Asset | Baseline | Final |
| --- | ---: | ---: |
| Public gallery JS | 23 files, 320,228 B | 22 files, 308,410 B (−11,818 B `customCalendar.js`) |
| `styles.css` | 103,105 B | 103,105 B (will-change rule only) |
| `index.html` | 8,262 B | 8,190 B |
| Largest JS | `globeExplorer.js` 79,627 B, `gallery.js` 42,088 B, `imageService.js` 34,363 B | same order |
| Off-critical (intentional) | Three.js CDN, 456 KB earth JPEG, 820 KB GeoJSON | unchanged |

### CPU microbench (`node scripts/perf-bench.mjs`)

| Path | n | Baseline |
| --- | ---: | ---: |
| `GalleryLayout.masonry` | 1,200 | 0.56 ms |
| `rangeForViewport` masonry | 1,200 | 0.004 ms |
| `rangeForViewport` grid | 1,200 | 0.001 ms |
| Country / place option rebuild | 800 locs | 0.07–0.08 ms |
| Linear `thumbnailUrl` scan | 1,200 | 0.005 ms |
| `LocationModel.groupTrips` | 800 | 4.87 ms (globe open only) |

Masonry range and aspect-URL scans are not hot at realistic sizes. Memory
shape is: every visited tile used to stay in `mountedItems` after `child.remove()`,
so a long session retained detached DOM plus a second decoded `Image()` in the
preloader (order-of ~1.4 GB if 1,200 unique 640×480 bitmaps were all retained;
real thumbs are smaller, but growth was unbounded).

### Re-measure after changes

| Change | Metric | Result |
| --- | --- | --- |
| Drop `customCalendar.js` | Critical JS | −11.8 KB parse/download on every public visit |
| `format=auto` | Thumb bytes | Same 640 px request, CF serves AVIF/WebP when the client accepts it. Typical 25–40% smaller than JPEG at q=82; first deploy misses the old JPEG cache key |
| Shared + paused globe | WebGL | 1 context instead of 2; hidden preload no longer RAF-paints at 60 fps; modal transfer works as originally designed |
| Evict unmounted tiles | Detached DOM | Only the current window keeps element trees. Scroll-back remounts from the preloader (`instant` path) |
| Timeline filter cache | Network | `/api/photos/timeline?...` no longer repeats on every `loadMore` / `galleryUpdated` |
| Abort stale list fetches | Network | Rapid filter changes cancel the previous `/api/photos` instead of returning the wrong in-flight page |
| `fetchPriority` | Waterfall | Visible tiles `high`, prefetch `low` — same URLs, better contention |
| `will-change` | GPU layers | Layers only while hovering or morphing, not on every mounted thumb |

`verify-gallery-order.mjs` passes after every change.

## 3. Changes

### A. Remove unused `customCalendar.js` from the public page

- **Wrong:** 11.8 KB parsed on every gallery visit. No date input exists on
  `index.html`. Admin still loads the file.
- **Did:** Dropped the public `<script>` tag.
- **Impact:** −11.8 KB critical JS. Calendar behavior on `/admin/` unchanged.
- **Risk:** Low.

### B. `format=auto` on CF thumbnail transforms

- **Wrong:** Thumbs were already resized to 640 but kept the original codec
  (usually JPEG).
- **Did:** Added `format=auto` in both `imageService.buildPhotoAssetUrl` and
  `functions/_lib/photos.js` so list-derived and metadata-derived URLs match.
- **Impact:** Smaller thumbs, same dimensions and quality knob. No srcset
  (that would desync the preloader and double-fetch).
- **Risk:** Low. Existing `/cdn-cgi/image/` use means Image Resizing is on.
  First paint after deploy is a new cache key.

### C. `will-change` only on hover / morph

- **Wrong:** Every `.gallery-item-image` promoted a compositor layer for the
  life of the tile (`will-change: opacity, transform`).
- **Did:** Removed the permanent hint. Hover still scales and now sets
  `will-change: transform`. Morph already had its own layer hint.
- **Impact:** Fewer GPU layers during idle scroll. First hover may promote
  one layer (same as any transform).
- **Risk:** Low.

### D. Evict unmounted tiles from `mountedItems`

- **Wrong:** `syncNodes` called `child.remove()` but left the node in
  `mountedItems`, so every visited tile’s DOM + decoded `<img>` lived forever.
- **Did:** `mountedItems.delete` on unmount. Scroll-back uses
  `createGalleryItem` + preloader cache (`loaded` + `instant`).
- **Impact:** Detached-DOM growth is bounded to the window. Nearby scroll-back
  still paints from cache.
- **Risk:** Medium-low. Far scroll-back may fade in once if the HTTP cache
  must re-decode. Prefetch/overscan still warm nearby tiles.

### E. One `GlobeService`, pause hidden RAF

- **Wrong:** `Gallery` and `Modal` each constructed a `GlobeService`. Idle
  `preloadGlobe` compiled WebGL in a hidden 160 px box and ran `animate()` at
  60 fps, but `transferOrCreate` looked at a different `instances` map, so
  the modal compiled a second context anyway.
- **Did:** `app.js` constructs one service and passes it in. `pause` /
  `resume` stop the hidden loop after the first compile frame. Modal close
  pauses; next `createOrUpdate` resumes.
- **Impact:** Restores the intended transfer (readiness up). Stops wasted
  offscreen GPU. Earth JPEG still prefetched via shared `ThreeLoader`.
- **Risk:** Low.

### F. Cache timeline enablement by filter key

- **Wrong:** Every `galleryUpdated` (including infinite scroll) refetched
  `/api/photos/timeline` when a filter was active. Month enablement is a
  full-dataset GROUP BY and does not change when another page of the same
  filter arrives.
- **Did:** Skip refetch when the serialized filter key is unchanged.
- **Impact:** One timeline request per filter change instead of one per page.
- **Risk:** Low.

### G. Abort stale list fetches; do not coalesce across filters

- **Wrong:** A second `fetchImages()` while a fetch was in flight returned
  the *old* promise (wrong filters). A filter change during `loadMore`
  waited, then returned the old collection. No `AbortController`.
- **Did:** Coalesce only when kind + `filterKey()` match. Otherwise abort
  and start a new request. `gallery.loadImages` ignores superseded tokens
  so an aborted call cannot paint an empty/error frame.
- **Impact:** Rapid filter toggling hits the network once for the last
  filter. Matches the intended “show this filter” behavior.
- **Risk:** Medium. This is a race fix; the success path is unchanged.

### H. `fetchPriority` on visible vs prefetch images

- **Wrong:** Prefetch `Image()` objects competed equally with in-viewport
  thumbs.
- **Did:** Visible gallery imgs `high`; preloader imgs `low`.
- **Impact:** Same bytes, better contention on first paint / fast scroll.
- **Risk:** Low. Attribute is ignored where unsupported.

## 4. Looked at, not changed

| Finding | Why not |
| --- | --- |
| Masonry `rangeForViewport` is O(n) | 0.004 ms at 1,200 rects. Not worth a spatial index. |
| `adoptAspectFromUrl` scans all images | 0.005 ms at 1,200. |
| No `srcset` / 320–960 thumbs | Preloader keys on one URL. Extra variants would double-fetch or starve the cache. 640 is ~2× for 2–6 columns. |
| Transform / recompress full images | Quality risk vs originals. Upload already caps large files. |
| Evict `ImagePreloader.loadedImages` | That Map *is* scroll-back and flipboard readiness. |
| Lazy-load `globeExplorer.js` (80 KB) | Control menu filters require it. |
| Bundle the 22 scripts | Architecture change; HTTP/2 multiplexes them. |
| Drop Google Fonts weights | 300 / 400 / 500 are all used. |
| Film-leak `--scroll-ratio` RAF | Deliberate look. |
| Permanent `filter: grayscale(0.1)` on tiles | Visual design. |
| Hidden modal globe kept after first open | Readiness for the next photo. We only pause RAF. |
| `jose` / `xlsx` / npm `three` | Server or scripts; not on the public critical path. |
| `fileToBase64` / modal upload handlers | Dead on the public page, zero runtime cost unless called. |
| `Content-Type: application/json` on GETs | Noise, not bytes. |

## 5. Latent issues not touched

- `GET /api/photos` coalescing used to ignore new filters (fixed). Other
  fetches (timeline, geo, metadata) still have no abort.
- `orderedIds.includes(id)` in `_fetchAndMergePhotoDetail` is O(n).
- `getLayout()` still does `getBoundingClientRect` + `getComputedStyle` on
  cache miss (once per invalidate, not per scroll tick).
- `customCalendar.js` still auto-inits on `DOMContentLoaded` when the admin
  page loads it (intended).
- Modal upload UI is still implemented in `modal.js` but has no DOM on the
  public page (`hasUploadUi` is false).
- Image function always serves the original from R2; thumbs depend entirely
  on `/cdn-cgi/image/`. If Image Resizing were disabled, `format=auto` would
  fail the same way the existing width transform would.
- `parthnain.com` bot challenge blocked automated production waterfalls from
  this environment.
