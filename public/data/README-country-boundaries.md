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
