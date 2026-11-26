# Photo frame explorations

Throwaway mockups for embedding photo metadata in the viewer's frame. Nothing here is loaded by the app or included in `npm run build`; Vite only builds `index.html` and `admin/index.html`.

## Run

From the repository root:

```bash
python3 -m http.server 4321
```

- One option, one photo: `http://localhost:4321/design/photo-frame/index.html?o=edge&p=ny-120`
- All aspect ratios for one option at phone size: `http://localhost:4321/design/photo-frame/overview.html?o=edge`

`o` is one of `edge`, `instant`, `placard`, `strip`, `postmark`.
`p` is one of `ny-120`, `istanbul-digital`, `ny-35-portrait`, `ny-35-landscape`, `istanbul-digital-portrait`.

Screenshots: `node design/photo-frame/capture.mjs <outDir> [option...]` (needs `npx playwright install chromium`).

## Notes

- Photos are crops of phone screenshots of the live viewer. `ny-120` and `istanbul-digital` carry real metadata; the other three are crops with stand-in metadata (Nikon FM2, Kodak Portra 400) to exercise 35mm and other aspect ratios.
- The globe is drawn on a canvas from `public/earth_atmos_2048.jpg` with an orthographic projection and a pin at the photo's coordinates.
- Edge Print and Postmark show the film format (120 or 35mm). The photo record has no format field today, so a real build would need a column or a camera-to-format lookup.
