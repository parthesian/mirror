# Image loading: grid and viewer

How thumbnails and the full-screen viewer load, and why they work this way.

## Grid: thumbnails that stopped loading on desktop

**Symptom.** At 5–6 columns on a laptop or monitor, tiles stopped filling in
until you scrolled, clicked, or refreshed. Phones were mostly fine.

**Cause.** `ImageLoadQueue` limits how many thumbnails load at once (8). It
counted a slot as busy until the `<img>` fired `load` or `error`. Two code paths
removed the `src` of an image that was still downloading, and removing `src`
fires neither event:

- The 1.6s "stuck tile" watchdog removed `src` and assigned it again. That
  restarted the download and leaked one slot.
- Unmounting a tile while scrolling removed `src` before the queue released
  the slot.

Six columns means many more tiles in view and larger Cloudflare transforms.
That meant more loads outlived the 1.6s watchdog, so all 8 slots leaked within
seconds and the queue stopped. Phones show fewer, smaller tiles, which usually
finish in time. Scrolling seemed to help only because the separate prefetcher
filled some tiles without going through the queue.

**Decisions.**

- **One owner per slot.** Each load gets a single release function. It runs on
  load, error, cancel, reassignment, or a 4s timeout, and running it twice does
  nothing. `cancel()` now frees the slot before the gallery removes `src`.
- **A timeout frees the slot, not the download.** A slow thumbnail keeps
  downloading after 4s; it just stops blocking the tiles queued behind it.
- **The watchdog only restarts idle tiles.** These are tiles that never started
  or that ended in an error. It never tears down a download in progress.
  Errored tiles now really do get retried; before, the "already has a src"
  check skipped them.
- **Visible tiles get `fetchpriority="high"`; overscan tiles get `auto`.** The
  browser fetches what you can see first.

## Viewer: white icon, then a small thumbnail, then a size jump

**Symptom.** Clicking a photo sometimes showed an empty white "broken image"
icon, then the photo at thumbnail size, then a jump to full size.

**Cause.**

1. On close the viewer set `src = ''`, which paints the broken-image icon, and
   the icon showed on the next open.
2. The viewer waited for a metadata request before it even opened.
3. The image had no fixed size, so the 320–480px thumbnail rendered at its own
   pixel size, and the box grew when the full image arrived.
4. Metadata returns a 640px thumbnail URL while the grid loads 320/480px. After
   metadata arrived, the viewer pointed at a thumbnail the browser had never
   downloaded.

**Preferred behaviour** (the pattern used by Google Photos and Apple Photos):
the viewer opens on the click, the photo appears at its final size straight
away, and it only gets sharper after that. It never changes size or blinks.

**Decisions.**

- **Open immediately; fill metadata in afterwards.** The date is known from the
  list data. Place, camera, and the globe fill in when the detail record
  arrives. The gallery also prefetches details on hover (the same 250ms hover
  that prefetches the full image), and the viewer prefetches details for its
  neighbours. So in practice the text is usually already there.
- **Reserve the final frame first.** The `<img>` gets an explicit pixel width
  and height from the photo's aspect ratio and the space available. This is
  done on desktop as well as mobile, and photos are never enlarged past their
  stored size.
- **Progressive sources in a fixed box.** The grid's already-decoded thumbnail
  fills the frame at once, stretched and slightly soft. The full image replaces
  it only after `decode()` finishes, so the swap reads as the photo sharpening.
  If the full image is already cached (hover or neighbour prefetch), it is used
  directly.
- **Never an empty `src`.** Before any pixels are ready, the image shows a
  transparent 1×1 GIF over a soft tinted frame. It never shows the browser's
  broken-image icon.
- **Keep the grid's thumbnail URL** when metadata merges. A known aspect ratio
  is also kept, rather than being reset to 4:3 for older photos with no stored
  size.
- **Stale loads are ignored.** Each photo shown gets a token, so fast arrow-key
  navigation never swaps in an image that finishes late for a photo you have
  already left.
