Country boundary dataset for `GlobeExplorer`

Recommended dataset: Natural Earth `Admin 0 - Countries` at `1:110m`.

Why:
- Small enough for interactive hover hit-testing.
- Global coverage.
- Permissive/public-domain style usage for app distribution.

Expected local file path:
- `public/data/ne_110m_admin_0_countries.geojson`

PowerShell download command (run from repo root):

```powershell
New-Item -ItemType Directory -Path "public/data" -Force | Out-Null
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson" `
  -OutFile "public/data/ne_110m_admin_0_countries.geojson"
```

`GlobeExplorer` first tries local file above, then falls back to remote URL if local is missing.

## Coast and border lines

The full-screen explorer draws extra boundary lines from two committed files. They are built offline from Natural Earth vector **v5.1.2** (`nvkelso/natural-earth-vector` tag `v5.1.2`) plus the 110m countries file above (ADM0_A3 attribution and the `codes` list). Nothing downloads those sources during `npm run build`.

Source files, fetched only into a temp directory:

- `geojson/ne_50m_coastline.geojson`
- `geojson/ne_50m_admin_0_boundary_lines_land.geojson`
- `geojson/ne_50m_lakes.geojson` (shore rings, including holes)
- `geojson/ne_10m_coastline.geojson`
- `geojson/ne_10m_admin_0_boundary_lines_land.geojson`
- `geojson/ne_50m_admin_1_states_provinces_lines.geojson`

Douglas–Peucker tolerances (degrees, endpoints kept, after the antimeridian split):

| Output | Contents |
| --- | --- |
| `globe-lines-50m.v1.json` | 50m coast DP 0.02°; 50m land borders DP 0.02°; 50m lakes DP 0.02°, drop lines under 0.1° |
| `globe-lines-10m.v1.json` | 10m coast DP 0.03° (raise by 0.005° up to 0.04° if over the cap, else substitute 50m coast), drop lines under 0.05°; 10m land borders DP 0.015°; 50m admin-1 DP 0.01°; 50m lakes DP 0.01°, drop lines under 0.05° |

Byte caps, not to be raised here: 50m raw 440 KB and gzip 175 KB; 10m raw 1,080 KB and gzip 425 KB.

```bash
node scripts/build-globe-lines.mjs --src <dir-with-the-geojson>
```
