# Agent guide

This is the photo gallery. The pages are still classic scripts. The API is a Hono app. Shared rules for colors, cursors, and request bodies live in `shared/`.

## Run the checks

From a clean checkout, install dependencies, then run the checks that match your change.

1. `npm install`
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`
5. `npm run test:e2e` when you change a page, a script in `js/`, or the Vite build.

`npm test` runs Vitest and the two Node scripts that already covered gallery order and the color bundle. Node 22.14 or newer is required. The API tests use `node:sqlite` as a stand-in for D1.

`npm run dev` serves the pages with Vite. It does not serve the API. `npm run build` writes the Pages asset directory to `dist/`. `npm run dev:api` serves that directory with Wrangler, including the Functions in `functions/`.

The Cloudflare Pages build command is `npm run build`. The output directory is `dist`. `functions/` stays at the repository root. Wrangler reads it from there, not from `dist`.

## Where code lives

`shared/` is the contract both sides import. Colors, cursor encoding, thumbnail URLs, query parsing, and metadata patches live there. Change a request rule there, then update the Vitest file that locks it.

`server/` is the API. `server/schema.ts` is the Drizzle table. `server/app.ts` is the Hono app. Zod parses a request in `shared/` before a route reads it. Do not parse the same payload again inside a query.

`functions/api/[[route]].ts` is the only Pages Function. It mounts the Hono app at `/api`. Add a route on the Hono app. Do not add a new file under `functions/api/`.

`js/` is the gallery. Scripts stay in document order and talk through `window`. `js/galleryOrder.js` is the first file checked by `tsc` with `checkJs`. The compiler options `allowJs` and `checkJs` are already on. To check another legacy file, add it to `tsconfig.browser.json` and write the JSDoc that file needs. Leave the other scripts alone until you are already editing them.

`shared/browser.ts` is the browser copy of the color helpers, including canvas sampling. `scripts/emit-shared-browser.mjs` writes `js/generated/photo-colors.js`. `npm run dev` and `npm run build` emit that file. The pages load the generated file. Do not hand-edit it.

## Data changes

The SQL files in `migrations/` are the history D1 already applies. Drizzle does not generate those files. When you add a column, add a new SQL migration and the matching column on `photos` in `server/schema.ts`. `tests/unit/schema.test.ts` fails if those two lists differ.

New uploads still store an ordered JSON array of palette ids on `photos.colors`. An unknown `color` query parameter returns 400. An empty color means no color filter.

## What not to do

Do not set `"type": "module"` in `package.json`. The gallery scripts and `build.js` are classic scripts, and a module package would parse them as ESM.

Do not convert a `js/` file to TypeScript, and do not add `type="module"`, unless that conversion is the task. The Vite build leaves those script tags in place and copies `js/` into `dist/js`.

Do not add a second color list. Import `shared/colors.ts`.
