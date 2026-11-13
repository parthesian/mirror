Country boundaries for `GlobeExplorer`

`globe-countries-50m.v1.json` is a TopoJSON of Natural Earth `Admin 0 - Countries` at 1:50m. The full-screen explorer uses it for three things: finding the country under a tap or the pointer, the hover outline, and the coast and border lines in the far view, before the vector tiles take over at zoom 3.5.

The file is committed. Nothing downloads Natural Earth during `npm run build`. To rebuild it, fetch the source GeoJSON into a temp directory and run the builder from the repo root:

```bash
curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
node scripts/build-globe-countries.mjs --src ne_50m_admin_0_countries.geojson
```

The builder quantizes to 1e4 steps across the globe, about 4 km, and keeps the quarter of vertices that carry the most area. It fails if the output exceeds 280 KB raw or 85 KB gzip. Today it is 259 KB raw and 79 KB gzip.

Bump the `v1` in the file name when the contents change. `_headers` serves `/data/globe-countries-*` as immutable.
