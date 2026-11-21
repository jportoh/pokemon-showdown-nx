# Native app (.nro, work in progress)

Besides the Brewser zip, the app is being made into its own Switch homebrew app (`.nro`) that runs
without Brewser. This guide records how it is built and what the engine can do; it grows with each
phase.

## The engine

The `.nro` runs on [nx.js_extended](https://github.com/natureglass/nx.js_extended) (MIT), the engine
Brewser itself is built on: V8, Skia (Canvas 2D), WebGL2 through Mesa, Web Audio (FFmpeg), the
Gamepad API, `fetch`, `WebSocket` and the `Switch.*` file API. It has no DOM and no HTML/CSS layout.
Brewser's own DOM layer is private, so the app can't reuse it; it only needs a canvas anyway.

An nx.js app is the prebuilt engine's code plus a RomFS holding `main.js` and the assets, an icon and
NACP metadata. `npm run build:nro` (`scripts/build-nro.mjs`) downloads the engine release once
(pinned by version and sha256, cached in `dist/nro-cache/`), bundles the entry with esbuild and
splices everything into `dist/nro/<name>.nro`. No devkitPro or C toolchain is needed.

## Running it

Copy the `.nro` to `sdmc:/switch/` and open it from the Homebrew Menu **in application mode** (hold
R while launching a game). In applet mode (from the Album) there isn't enough memory for the GL
driver and `getContext('webgl2')` returns null.

## Phase 0 probe (test-x1, 2026-11-21)

`native/poc/main.ts` checks every engine feature the app relies on and logs to
`sdmc:/switch/pokemon-showdown-brewser/native-probe.log`. Results on the console:

- **WebGL2**: `WebGL 2.0 (OpenGL ES 3.2 Mesa 20.1.0-rc3)`, renderer `NV120`, a steady 60 fps.
- **Text**: a full-screen 2D canvas uploaded as a texture costs ~16 ms (the engine reads the pixels
  back on the CPU), and painting it ~10 ms. Keep atlas uploads small and incremental.
- **Fonts**: the system font draws Latin accents, ▶ ◀ ● ★ ♂ ♀ arrows, … · ×, but **not ✓ or ✕**
  (missing-glyph boxes). Text is wider than in Chrome (`Showdown` at 24px: 134.5px vs ≈104px).
- **Network**: `wss://sim3.psim.us` opens in ~1 s and sends `|challstr|`; https images download and
  decode with `createImageBitmap`. No allow-list or CORS.
- **Audio**: a 24 kHz ogg decodes in ~250 ms and plays; generated buffers play. The engine has
  buffer sources, gain and panner nodes, but no oscillator.
- **Storage**: files on the SD card persist across launches; so does `localStorage`, except on the
  very first launch (keep using the SD files, as on Brewser).
- **Controller**: one pad, `standard` mapping, 16 buttons by **position**, so B=0, A=1, Y=2, X=3
  (Brewser reports A=0, B=1), then L=4, R=5, ZL=6, ZR=7, −=8, +=9, L3=10, R3=11, d-pad 12–15.
  **+ exits the app** by default (the engine's `beforeunload`, which can be cancelled).
- **Missing globals**: `document`, `location`, `history`, `MutationObserver`, `structuredClone`,
  `Intl`. Angular needs a minimal `document` and a location for its router (phase 1).
