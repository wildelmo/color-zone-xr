# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**The Curio Cabinet** (`sw.js` only exists to retire the offline service worker of an earlier app that lived at this address). It has two halves:

- `library/`: a reusable library of procedurally built, animated 3D assets for VR (a music-box carousel, a snow globe). Every asset is code, with no model, texture or audio files.
- `src/`: a WebXR gallery viewer for Meta Quest that shows one asset at a time at full detail on a display table.

This is plain three.js, **not Meta's IWSDK**. If the repo sits inside a harness whose instructions mention IWSDK tooling (`iwsdk dev up`, an IWSDK check-work skill), use this project's own emulated-Quest tools described below instead.

There is **no build step and no bundler**. The app is native ES modules served as static files. three.js (r185) is vendored in `vendor/three/` and resolved through the `<script type="importmap">` in `index.html` (the `dev/*.html` pages have their own import maps). The npm dependencies are dev tooling only: eslint, playwright, and `iwer` (Meta's WebXR emulator).

## Commands

```bash
npm install
npm start                                  # http://localhost:8080 (desktop); https://<LAN-ip>:8443 for a Quest (self-signed cert via openssl)
npm run lint                               # eslint src library tools
npm test                                   # full e2e in headless Chromium; also rewrites docs/screenshots/*.png
npm run test:quick                         # skips the detail screenshots and the globe-desktop section
node tools/test/run.mjs --only=iwer        # one section: desktop | quest | globe-desktop | globe | exit | iwer
node tools/xr/budget.mjs --shots           # triangles and draw calls per view on the emulated Quest, with pictures (npm run budget)
node tools/build-pages.mjs                 # GitHub Pages build into _site/ (what the deploy workflow runs)
```

Notes on the test runner (`tools/test/run.mjs`):
- It is a single script made of sequential sections that log `✓`/`✗` from `check()`. It is not a test framework, so to add a test you add a `check()` in the right section. The horse-mane geometry check at the top runs in Node with no browser and runs even with `--only`.
- Chromium runs on SwiftShader software GL (`launchArgs` in `tools/test/pw.mjs`), so frames can take seconds. That's why waits are condition-based with long timeouts, and why `snap()` sets `window.__cc.paused` while it takes a screenshot. `pw.mjs` falls back to `/opt/pw-browsers/chromium` (or `$CHROMIUM_PATH`) if Playwright's own browser isn't installed.
- Any console error or page error fails the run (apart from GPU stall / ReadPixels warnings).
- `docs/screenshots/` is tracked in git, and the README embeds those images. Every test run overwrites them, so check `git status` and don't commit screenshot changes you didn't mean to make. In history, screenshot updates are their own commits.

CI (`.github/workflows/test.yml`) runs `npm run lint` and `npm test` on ubuntu-24.04 with Node 22. A push to `main` deploys to GitHub Pages.

### Driving an emulated Quest by hand

`tools/xr/quest.mjs` runs the gallery on IWER as a Quest 3 and takes one JSON command at a time. Use it to look at a change in VR:

```bash
node tools/xr/quest.mjs serve --query "?instant&asset=globe" --out shots &
curl -s localhost:9555 -d '{"cmd":"enter"}'
curl -s localhost:9555 -d '{"cmd":"aim","hand":"right","at":"button:life"}'
curl -s localhost:9555 -d '{"cmd":"press","hand":"right","button":"trigger"}'
curl -s localhost:9555 -d '{"cmd":"shot","file":"look.png"}'
```

The full command list is in the header of `tools/xr/quest.mjs`. `node tools/xr/tour.mjs --out shots/before [--only gate,house-0]` takes a fixed set of screenshots of the globe's Up close view and prints triangle counts, draw-call counts and build time, so you can compare before and after a change.

`node tools/xr/budget.mjs --out budget/after --shots --compare budget/before/budget.json` is the frame budget: triangles and draw calls per frame in each view (on the table, held close at 3x, the big view), the shadow pass's share, and where the triangles are (room, each shelf preview, the hero). The emulator draws both eyes, so its totals are whole frames. They are counts, not timings: only a headset can measure frame time. Run it before and after any change to geometry, level of detail or shadows, and look at the pictures it saves.

For sculpting, `dev/horse.html?yaw=0`, `dev/dragon.html` and `dev/asset.html?asset=globe` render one model or asset with no gallery around it.

URL params: `?instant` skips the assembly animation (and pre-winds), `?asset=carousel|globe` picks the first hero, `?empty` loads none.

## Architecture

### The asset contract (`library/core/asset.js`, `library/index.js`)

`library/index.js` is the catalogue. Each entry lazy-loads `library/<name>/index.js`, which exports:
- `info`: `id`, `name`, `maker`, `blurb`, `scale` (life size → toy size on the table, e.g. carousel `1/22`, globe `1/240`), `bounds` (bounding sphere in life-size units), and an optional `life` big view (`label`, `scale`, `floor`, `viewer`, `yaw`, `focus`, `hideHall`, `walkway`).
- `async create<Name>(ctx, { lod })`, where `lod` is `'shelf'` (a cheap pedestal preview) or `'hero'` (full detail). It returns `{ root, update(dt, view), interactions, events, dispose, assemble?, skipAssembly?, wind?, shake?, setView?, state, debug? }`.

The desktop W key and the *Hold to wind* button look for the interaction with `id: 'wind'`. Assets are built in **life-size metres**, and the viewer applies `info.scale`. Assets never touch the viewer directly. They emit `sfx` / `note` / `haptic` / `assembled` on their `events` Emitter, and `Stage` routes those to `AudioEngine` (all sound is synthesised with Web Audio) and to controller haptics. Assembly animations are `Timeline`s, and `finish()` still fires cues marked essential.

### The viewer (`src/`)

- `App.js` owns the renderer, the camera `rig` (moved to recentre and walk in XR) and the render loop (`renderer.setAnimationLoop`). It is exposed as `window.__cc`, which the tests and the Quest driver read and poke. Test hooks on it include `paused`, `hidePanel` and `recenter()`.
- `Stage.js` holds the **one hero at a time**. Loading runs `create(ctx, {lod:'hero'})`, then `App.prepare()` (uploads textures and compiles shaders before anything is visible), then the assembly show. Before the next hero loads, `unload()` calls `asset.dispose()`, and the test asserts that the GPU geometry count drops. Stage also handles `toy` ↔ `life` mode, tweening the holder's pose and scale.
- `Shelf.js` builds `lod:'shelf'` previews on pedestals. `Hall.js` is the room and exports `LAYOUT`, the table position used everywhere.
- Input: `XRInput`/`HandState` (controllers), `Interaction` (rays, grab, two-hand scale, buttons, asset `interactions` proxies) and `DesktopControls` (OrbitControls and keys W/S/R/L/M). `ui/Panel.js` has the in-world 3D buttons.
- Scene object names are an API. The tests and `quest.mjs` find objects by name: `pedestal:<id>`, `button:<id>`, `proxy:hero`, `walkway`, `floor`, and inside the globe `island` and `glass:sphere`. Renaming one breaks the tests.

### Performance rules (the Quest is a mobile GPU)

- **Time-slice heavy work.** Builders call `await ctx.step()` between expensive pieces. `src/app/Frames.js` yields once about 6 ms of the frame has been used and resumes after the next render. It is driven from the render loop because `window.requestAnimationFrame` stops inside a WebXR session, so don't pace builds with rAF or `setTimeout`.
- **Few draw calls.** Use `GeoBag` (`library/core/geometry.js`) to merge static parts into one mesh per material key, and `InstancedMesh` for anything repeated. The whole hero is about 75 draw calls, and the test fails outside 30–260.
- **Everything must be disposable.** Create materials and textures through `MaterialKit` (`library/core/materials.js`), which tracks them so `dispose()` frees them. An untracked resource is a leak that shows up when switching assets.
- No real-time lights besides the one shadow-casting spotlight that follows the hero, and no post-processing. Glows are additive billboards (`core/bulbs.js`, `core/glowPoints.js`). Details are often painted in shaders instead of modelled (e.g. the saddle blankets).

### SDF sculpting pipeline

Organic shapes (horses, dragons, the island) are signed distance fields meshed with Surface Nets in a module Worker:
- Model modules (`carousel/horseModel.js`, `globe/dragonModel.js`, `globe/islandModel.js`) export `layers` (`{ sdf(x,y,z), bounds, color?, attributes? }` per layer) and a `details()` function for anchor points and ornament curves.
- They are loaded by URL with `meshLayer(new URL('./xModel.js', import.meta.url).href, layer, cell)` / `modelDetails(url)` from `core/sdfClient.js`. The worker imports them directly, and the Node tests import them too.
- So model modules, and everything they import (`core/sdf.js`, `terrain.js`, `dimensions.js`), **must be pure JS with no `three` import**. The import map doesn't apply inside the worker.
- `cell` is the voxel size and sets the level of detail. Per-LOD cell sizes live in each asset's `dimensions.js` (e.g. `HORSE_CELLS`). The mane test meshes the horse at every `HORSE_CELLS` level.

### Other conventions

- Every mechanical or layout dimension of an asset goes in its `dimensions.js` (`carousel/dimensions.js`, the globe's `G`). `globe/terrain.js` is shared by the island mesher and the town generator, so roads, terraces and buildings line up.
- Procedural geometry uses the seeded `mulberry32` from `core/random.js`, so every load is identical. The tests depend on a fixed town layout, perches and lantern positions. `Math.random` is only used for runtime effects such as snow, water and spark particles.
- The globe exposes `asset.debug` for tests: `simulateDragons(seconds)`, `freezeDragons`, `freezeTown`, `town`, `perches`, `heightAt`. `tools/test/floaters.js` checks that the town's small things are attached to something, and it runs in the page.
- `eslint.config.js` has an explicit globals list. A new browser global (e.g. `Image`, `Blob`) has to be added there or lint fails with `no-undef`.
- `tools/build-pages.mjs` copies `src`, `library`, `vendor` and `dev` under `_site/v/<sha>/` for cache busting, and rewrites the paths in `index.html`. If you change the import map or the `main.js` script tag, or add a new top-level runtime directory, update that script too (it throws if the paths it rewrites aren't found).

### Adding a curio

Create `library/<name>/index.js` following the contract above and add an entry to `CATALOG` in `library/index.js`. The shelf, loader, grab, scale, audio and spotlight then work with no viewer changes. Entries with `comingSoon: true` appear on the shelf under dust cloths.
