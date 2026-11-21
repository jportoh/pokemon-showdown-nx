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

## Phase 1: the app on the engine

`npm run build:nro` runs `ng build` and bundles Angular's output (one ES module, lazy routes
included) after the native entry, `native/app/main.ts`, which first installs:

- **`native-log.ts`**: errors, unhandled rejections and `console.error` (Angular's error handler)
  go to `sdmc:/switch/pokemon-showdown-brewser/native.log`. There are no developer tools, and
  nothing printed shows once WebGL owns the screen.
- **`dom-shim.ts`**: a minimal DOM for Angular: a node tree (elements, text, comments) with
  attributes, classes, inline styles, events and simple selectors (`tag`, `#id`, `.class`,
  `[attr="value"]`); a document with `<base href="/">` and `<app-root>`; `location` and `history`
  in memory (the router uses hash URLs); and `innerWidth`/`innerHeight` 1280×720,
  `devicePixelRatio` 1, `getComputedStyle` (font `sans-serif`), `matchMedia`, `structuredClone`.
  Nothing in it is drawn.
- **Canvases**: the canvas that asks for WebGL gets the engine's screen context (once). Other
  canvases are 2D surfaces on an `OffscreenCanvas` that only grows: the text caches resize their
  canvas for every glyph, which here clears and resets it instead of allocating a new one.
- **`gl-uploads.ts`**: the engine ignores `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and copies canvas sources
  through a new canvas. The context's upload methods are wrapped to read a canvas's pixels directly,
  premultiply them when asked (the renderer's blending needs it) and pass the engine an array.

The static files (sprites, audio, category icons) go in the RomFS at the same paths: nx.js resolves
a relative `fetch` against `romfs:/main.js`. `PLATFORM` (`core/runtime/platform.ts`) tells the
app it is native (`nx.js/` in the user agent): A and B swap indices, and text is typed with the
on-screen keyboard, as on Brewser.

### The bold font leak (tests x3–x6, 2026-11-21)

The first builds ran out of memory after one or two minutes (`[v8] FATAL JS heap OOM` in
`sdmc:/switch/nxjs-debug.log`, which the engine overwrites on every launch), while the JS heap stayed
around 40 MiB: native memory grew about 2.5 MiB per new text. nx.js registers the system font only
as `sans-serif` at the normal weight, and a canvas font such as `bold 18px sans-serif` matches no
face, so the engine loads another copy of the system font (~2 MiB) into its font set on every such
assignment, never freeing it; each lookup also got slower as the set grew. `bold-font.ts` lets that
happen once at start and marks the copy as the bold face, so later bold fonts find it (it draws the
same regular glyphs as before). With it, native memory levels off around 600 MiB through a whole
battle, and `fillText` costs a third of what it did.

`native-stats.ts` writes the native steps' timings and the engine's memory figures
(`Switch.memoryUsage()`, plus the number of font faces) to `native.log` every 5 seconds.
`build-nro.mjs --engine=beta5` (or `--engine-file=<any nx.js .nro>`) packages the app on another
engine build, to compare.

## Phase 2: start-up and the connection (tests x7–x11)

nx.js runs the TLS handshake (for `wss://` and `https://`) on the **main thread**, a step each time
the event loop is free. Anything that holds the main thread while loading also holds back the
connection: with the loading screen busy, the first WebSocket opened after 8.5 s, while idle
reconnections take about 1 s. `net-diagnostics.ts` logs each attempt (and, after a failure, a DNS
lookup and a bare TLS connection with the engine's own error, which its WebSocket swallows), the
main thread's lag, long frames, long uploads, audio decodes and slow server messages.

What held it, and what changed:

- **The Champions sprite sheets** (1960×1960 and 1960×1470) took seconds to decode in JavaScript.
  `build-nro.mjs` stores them already decoded (`PSBRAW1` header, then premultiplied RGBA) at the
  same paths, and `decodeRaw` (png-decode.ts) hands those pixels straight to the GPU. The `.nro`
  grows to ~84 MiB.
- **`AudioEngine.reduce`** copied each battle track sample by sample (about a second per track on the
  console), although the engine already decodes them mono at 24 kHz: that case is now one copy.
- **The "Who is playing?" picker**: nx.js keeps `localStorage` in a user's save data and shows the
  picker the first time it is used, mid start-up. The app's data lives in files on the SD card
  (device-storage), so dom-shim gives it an in-memory `localStorage`, and the NACP asks for no user
  account or save data.

Result (test x11): no picker, loading ~6 s on the HUD (which counts from the engine's clock, about
0.4 s before the app starts), the first connection open in 3.9 s. Still left: ~1.6 s evaluating the
bundle and starting Angular, and one ~450 ms frame when the home screen first draws.
