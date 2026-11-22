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

### Shipping work done ahead (test x12)

Commercial games ship their assets in the form the hardware uses, so nothing is converted while the
game runs. The `.nro` now does the same for what every session loaded or computed:

- **The synthesized audio.** The interface's sounds, the menu theme and the battle themes are
  synthesized by chip-synth. On the native build, `build-nro.mjs` runs the same code
  (`synth-pieces.ts`) at 48 kHz and stores each piece as raw 16-bit audio (`raw-audio.ts`, a
  `PSBPCM1` header) under `audio/synth/`. `AudioEngine` reads them instead of synthesizing, which took
  ~240 ms of CPU in Node, so seconds on the console, spread over the loading screen and the first
  menu frames. That adds ~10 MiB. If a piece is missing, it synthesizes as before.
- **Showdown's images every session loads.** The item sheet (already decoded) and the trainer
  avatars the app knows by name (~300) go under `showdown/sprites/`. `bundled-sprites.ts` redirects
  `fetch` for those URLs to the RomFS, so the app's cache keys don't change. Each https request
  costs a TLS handshake on the main thread, and at start they competed with the connection. The
  build caches them in `dist/nro-cache/showdown` and refreshes them weekly.
- `after-app.ts` logs `[boot]` marks: when the bundle has been evaluated and the first frames, to
  split the ~1.6 s start-up block.
- **The battle music**, decoded here (`@wasm-audio-decoders/ogg-vorbis`, a dev dependency) into the
  same raw format at the same paths. `AudioEngine.decode` reads it, which avoids the console's
  300–550 ms hand-overs after each decode. That adds ~20 MiB, for a ~112 MiB `.nro`.

Test x12 (synthesized audio and sprites): loading **3 s** on the HUD (was ~6 s), everything drawn and
played right. Its `[boot]` marks: the bundle is evaluated ~170 ms after the app starts, then the main
thread is held ~1.7 s before the first frame and ~1 s before the second, with the connection waiting
behind both (open at 4.5 s). In Node, ~40% of the first block was the loading screen's warm-up of
the teambuilder (`@smogon/calc` builds its data tables), so it now starts when the connection opens,
or once everything else has loaded, and the loading screen waits for it.

## Phase 3: a finished app

- **Icon**: `native/icon.jpg`, a 256×256 JPEG made from the app's pixel-art Poké Ball. Replace the file
  to change it. The NACP has the title "Pokémon Showdown", the author, `package.json`'s version and
  the title id.
- **CI**: the workflow builds the `.nro` after the Brewser zip, from the same `ng build`, uploads it
  as `pokemon-showdown-<commit>.nro` and adds it to tagged releases.
- **HOME menu**: no NSP is built here. Installing a title needs the console's own keys, which can't
  go to CI. sphaira makes a forwarder to the `.nro` on the console itself, and the icon carries over.
  An installed title always runs in application mode (no need to hold R).

## Controls (test x14)

- **Touch**: nx.js turns the touchscreen on only once something listens on `screen`, and dispatches
  touches there, not on the window. `touch-bridge.ts` copies them to the window, where
  `PointerInput` listens, as it does on Brewser.
- **+** no longer exits. `plus-button.ts` cancels nx.js's `beforeunload`; the console's HOME button is
  for leaving. +, X and Y are page buttons on the native build only (`buttonPlus`, `buttonX`,
  `buttonY` in console-keys; nx.js numbers them Y=2, X=3, +=9). On Brewser they stay the browser's.
  + is OK on the on-screen keyboard, as on the console's own keyboard; Brewser keeps ZR.

## Known limitations (tests x14–x15, 2026-11-22)

- **No 1080p when docked.** nx.js makes the screen a 1280×720 canvas, and its GL surface stays
  1280×720 even when the screen is set to 1920×1080 before `getContext` (`native/poc/res-probe.ts`:
  `drawingBuffer 1280x720`). Docked, the console scales that 720p image to the TV. Real 1080p needs a
  change in the engine's C code.
- **Sleep closes the app.** If a socket is open when the console sleeps, the engine dies when it
  wakes, before any JavaScript runs again. The app always has its Showdown WebSocket open, so it
  closes on wake. `native/poc/sleep-probe.ts` isolates the cause: with
  `node scripts/build-nro.mjs --sleep-probe=ws|wsplain|audio|pad`, the WebSocket builds (`wss://` and plain
  `ws://`) are killed on resume, while audio, controller polling and plain rendering survive. In the
  full app the crash reports vary:
  - `2345-0008`: libnx `NotInitialized` in the engine's controller polling (HID shared memory gone).
  - `2168-0002`: a data abort in native code.

  The engine gives no notice before sleeping, so the app can't close its socket first. Brewser, built
  on its own engine, survives. Until the engine is fixed: leave the app with HOME before putting the
  console to sleep. **Pending:** report it to natureglass/nx.js_extended, with the minimal repro
  (the `ws` sleep probe), the results by feature and the crash reports, and ask for a "going to
  sleep" event as an alternative: with one, the app could close its socket and reconnect on wake.
