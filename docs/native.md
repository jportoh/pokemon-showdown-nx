# The Switch app (.nro)

The app is a standalone Switch homebrew app (`.nro`). This guide records how it is built, what the
engine can and can't do, and how to test on a console. The rest of the docs explain the app itself;
much of its design (one WebGL canvas, files on the SD card, work moved out of the frame loop) follows
from the findings here.

## The engine

The `.nro` runs on [nx.js_extended](https://github.com/natureglass/nx.js_extended) (MIT): V8, Skia
(Canvas 2D), WebGL2 through Mesa, Web Audio (FFmpeg), the Gamepad API, `fetch`, `WebSocket` and the
`Switch.*` file API. It has no DOM and no HTML/CSS layout; the app only needs a canvas anyway, and
`native/app/dom-shim.ts` gives Angular the little DOM it asks for (see phase 1 below).

## Building it

```bash
npm run build:nro            # → dist/nro/pokemon-showdown.nro
```

An nx.js app is the prebuilt engine's code plus a RomFS holding `main.js` and the assets, an icon and
NACP metadata. `npm run build:nro` runs `ng build`, then `scripts/build-nro.mjs` downloads the
engine release once (pinned by version and sha256, cached in `dist/nro-cache/`), bundles the entry
with esbuild and splices everything into `dist/nro/<name>.nro`. No devkitPro or C toolchain is
needed.

## Running it

Copy the `.nro` to `sdmc:/switch/` and open it from the Homebrew Menu **in application mode** (hold
R while launching a game). In applet mode (from the Album) there isn't enough memory for the GL
driver and `getContext('webgl2')` returns null. A forwarder installed on the HOME menu always runs in
application mode (see phase 3).

The app keeps its data (teams, settings, a saved login) as JSON files in
`sdmc:/switch/pokemon-showdown-nx/` (`core/persistence/device-storage.ts`), next to its error log
`native.log`. Earlier versions used `sdmc:/switch/pokemon-showdown-brewser/`: a key with no file in
the new folder yet is read from there and copied over.

## Testing on a console

1. Get a `.nro`:
   - **From CI**: every pull request and every push to `main` uploads
     `pokemon-showdown-<commit>.nro` as a build artifact (see [releases.md](releases.md)). Releases
     attach `pokemon-showdown-vX.Y.Z.nro`.
   - **Locally**: `npm run build:nro`.
2. Copy it to `sdmc:/switch/` and open it in application mode.
3. Check with the controller only, docked and handheld if you can.
4. Press **L3** for the HUD: 60 fps, no long frames when opening the screen you changed. Errors go to
   `native.log` on the SD card.

If you don't have a console, say so in your PR: a maintainer will test it on one. Most work can be
developed and checked in a desktop browser (`npm start`), keeping these limits in mind.

## Developing in a desktop browser

- `npm start` serves the app at `http://localhost:4200`. The keyboard stands in for the controller
  ([input.md](input.md#the-buttons)), and any gamepad works (by position, as on the console: the
  bottom button is B, the right one A).
- **Logging in** to Showdown needs `play.pokemonshowdown.com/api`, which only allows CORS from
  Showdown's own site. To play online from a desktop browser, start one with web security disabled
  (for example Chrome with `--disable-web-security --user-data-dir=<a temp dir>`), and use it only for
  this.
- **Showdown's own sprites** (Random Battle, Gen 3) don't show in a normal desktop browser, for the
  same reason (no CORS headers). The bundled Champions sprites always show.
- In the browser the interface sounds and themes are synthesized at start instead of read from the
  build's files, and private values (a saved password) can't be kept: there is no SD card.
- The browser is far faster than the console: something smooth on a desktop can still drop frames on
  the device. Test there before calling performance work done.

## Phase 0 probe (test-x1, 2026-11-21)

`native/poc/main.ts` checks every engine feature the app relies on and logs to
`sdmc:/switch/pokemon-showdown-nx/native-probe.log`. Results on the console:

- **WebGL2**: `WebGL 2.0 (OpenGL ES 3.2 Mesa 20.1.0-rc3)`, renderer `NV120`, a steady 60 fps.
- **Text**: a full-screen 2D canvas uploaded as a texture costs ~16 ms (the engine reads the pixels
  back on the CPU), and painting it ~10 ms. Keep atlas uploads small and incremental.
- **Fonts**: the system font draws Latin accents, ▶ ◀ ● ★ ♂ ♀ arrows, … · ×, but **not ✓ or ✕**
  (missing-glyph boxes). Text is wider than in Chrome (`Showdown` at 24px: 134.5px vs ≈104px).
- **Network**: `wss://sim3.psim.us` opens in ~1 s and sends `|challstr|`; https images download and
  decode with `createImageBitmap`. No CORS.
- **Audio**: a 24 kHz ogg decodes in ~250 ms and plays; generated buffers play. The engine has
  buffer sources, gain and panner nodes, but no oscillator.
- **Storage**: files on the SD card persist across launches; so does `localStorage`, except on the
  very first launch (keep using the SD files).
- **Controller**: one pad, `standard` mapping, 16 buttons by **position**, so B=0, A=1, Y=2, X=3,
  then L=4, R=5, ZL=6, ZR=7, −=8, +=9, L3=10, R3=11, d-pad 12–15.
  **+ exits the app** by default (the engine's `beforeunload`, which can be cancelled).
- **Missing globals**: `document`, `location`, `history`, `MutationObserver`, `structuredClone`,
  `Intl`. Angular needs a minimal `document` and a location for its router (phase 1).

## Phase 1: the app on the engine

`npm run build:nro` runs `ng build` and bundles Angular's output (one ES module, lazy routes
included) after the native entry, `native/app/main.ts`, which first installs:

- **`native-log.ts`**: errors, unhandled rejections and `console.error` (Angular's error handler)
  go to `sdmc:/switch/pokemon-showdown-nx/native.log`. There are no developer tools, and
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
app it is native (`nx.js/` in the user agent): there, keys are ignored while a controller is
connected and the build's prepared files (audio, sprites) are read.

### The bold font leak (tests x3–x6, 2026-11-21)

The first builds ran out of memory after one or two minutes (`[v8] FATAL JS heap OOM` in
`sdmc:/switch/nxjs-debug.log`, which the engine overwrites on every launch), while the JS heap stayed
around 40 MiB: native memory grew about 2.5 MiB per new text. nx.js registers the system font only
as `sans-serif` at the normal weight, and a canvas font such as `bold 18px sans-serif` matches no
face, so the engine loads another copy of the system font (~2 MiB) into its font set on every such
assignment, never freeing it; each lookup also got slower as the set grew. `bold-font.ts` lets that
happen once at start and marks the copy as the bold face, so later bold fonts find it (it draws the
same regular glyphs as before, see below for real-looking bold). With it, native memory levels off around 600 MiB through a whole
battle, and `fillText` costs a third of what it did.

There is still no real bold face, so bold text is synthesized from the regular one
(`src/app/core/gl/faux-bold.ts`): when bold measures exactly as wide as regular, texts and glyphs
are filled and stroked in the same colour (2.5% of the size, at most 2.4 px: subtle, so letters keep their gaps), as browsers embolden a
missing bold. Advances stay the regular ones, so measures and layouts do not change.

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
- **Showdown's images every session loads, the cries and the Pokémon sprites.** The item sheet
  (already decoded), the trainer avatars the app knows by name (~300), every Pokémon's cry (~1250
  mp3s, ~11 MiB) and the battle sprites outside the Champions sheets: Black/White's for every species
  (`sprites/gen5/` and `gen5-back/`, ~2650 png once the sheets' ones are left out, ~2.5 MiB),
  Red/Blue's for Gen 1 (`sprites/gen1/` and `gen1-back/`, ~310 png), Gold/Silver's for Gen 2 (`gen2/`,
  ~555 png), Ruby/Sapphire's for Gen 3 (`gen3/`, ~845 png) and Diamond/Pearl's for Gen 4 (`gen4/`,
  ~1360 png), under 1 MiB each. The cries
  and the sprites are listed from Showdown's directory indexes. They go under `showdown/`, at their
  paths on Showdown's server.
  `bundled-showdown.ts` redirects `fetch` for those URLs to the RomFS, so the app's cache keys don't
  change. Each https request costs a TLS handshake on the main thread (~65 ms): at start they
  competed with the connection, and the teams' cries, fetched together when a battle starts, held it
  ~0.6–0.7 s (test x13). The build caches them in `dist/nro-cache/showdown`; sprites are refreshed
  weekly, cries and Pokémon sprites are kept once downloaded.
  With the cries local, decoding the twelve together still held it ~200 ms (x16): the console hands
  each decoded sound over on the main thread. `BattleCries` now loads them one at a time, a frame
  apart, a cry about to be played first. In x17 the battle entry's worst block was 122 ms (the
  battle's `|init|` message), down from 708 ms.
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

- **Icon**: `native/icon.jpg`, a 256×256 JPEG: Pokémon Showdown's "o!" logo (its `favicon-256.png`)
  recoloured gold, on the app's dark blue. Replace the file to change it. The NACP has the title
  "Pokémon Showdown", the author, `package.json`'s version and the title id.
- **CI**: the workflow builds the `.nro` for every pull request and push to `main`, uploads it
  as `pokemon-showdown-<commit>.nro` and adds it to tagged releases.
- **HOME menu**: no NSP is built here. Installing a title needs the console's own keys, which can't
  go to CI. sphaira makes a forwarder to the `.nro` on the console itself, and the icon carries over.
  An installed title always runs in application mode (no need to hold R).

## Controls (test x14)

- **Touch**: nx.js turns the touchscreen on only once something listens on `screen`, and dispatches
  touches there, not on the window. `touch-bridge.ts` copies them to the window, where
  `PointerInput` listens.
- **+** no longer exits. `plus-button.ts` cancels nx.js's `beforeunload`; the console's HOME button is
  for leaving. +, −, X and Y are page buttons (`buttonPlus`, `buttonMinus`, `buttonX`, `buttonY` in
  console-keys; nx.js numbers them Y=2, X=3, −=8, +=9). + is OK on the on-screen keyboard, as on the
  console's own keyboard.
- **Button roles** (`ROLE_KEYS` in console-keys): each of these buttons has one meaning across the
  app, and the screens register the role's button and draw its label:
  - **Y searches**: an open list in the teambuilder, Calcs and the rival's editor. R3 still works.
  - **X is the option of what's shown**: the teambuilder grid's favourite (R then only means "next
    team"), editing the Calcs rival and the battle timer, all formerly on R3.
  - **+ confirms or sends**: the keyboard's OK, writing in a chat room, and opens the battle's menu.

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

  The engine gives no notice before sleeping, so the app can't close its socket first. Until the
  engine is fixed: leave the app with HOME before putting the
  console to sleep. **Pending:** report it to natureglass/nx.js_extended, with the minimal repro
  (the `ws` sleep probe), the results by feature and the crash reports, and ask for a "going to
  sleep" event as an alternative: with one, the app could close its socket and reconnect on wake.

## Online updates probe (test u1, 2026-11-23)

Could the `.nro` update its own code instead of everyone copying a new one? `native/poc/update-probe.ts`
(`node scripts/build-nro.mjs --update-probe`) checks what an updater needs and logs to
`sdmc:/switch/pokemon-showdown-nx/update-probe.log`. Results on the console:

- **Loading code**: `import()` works from the RomFS (`'./x.js'`) and from an absolute SD path
  (`sdmc:/…/x.mjs`), but **not with a query string** (`?v=1`: "Cannot find module"), and not from
  `data:` or `blob:` URLs. `new Function` and indirect `eval` work. A 655 KiB ES module (three.js)
  read from the SD card imports in 126 ms with all its exports.
- **Files**: `Switch` has `readDirSync`, `statSync`, `renameSync`, `removeSync` and async versions
  (`writeFile`, `rename`…). Writing 655 KiB takes 20 ms; 26.6 MiB with `writeFileSync`, 1.1 s (it
  blocks the frame loop). `fetch('sdmc:/…')` reads SD files.
- **Network**: a GitHub release download follows the 302 to `release-assets.githubusercontent.com`;
  the GitHub API answers without a token (60 requests an hour per IP). Each new https host costs a
  ~100 ms frame (the TLS handshake on the main thread, see phase 2). A big download streams at
  ~1.85 MiB/s in ~40 KiB chunks.
- **Integrity**: `crypto.subtle` has SHA-256 (67 ms for 655 KiB; a plain JS version takes 222 ms) and
  ECDSA P-256 verification (126 ms). **Ed25519 is not supported** ("Unrecognized algorithm name").

See [updates.md](updates.md) for the loader built on these results.

## In-app .nro update probe (test u4, 2026-11-24)

Could the app download a whole new `.nro` and put it in place of its own? `native/poc/nro-probe.ts`
(`node scripts/build-nro.mjs --nro-probe`) on the console:

- **The running `.nro` can't be renamed** (`I/O error (rename)`): the system keeps it open while the
  app runs (its RomFS is read from it), so the app can't swap its own file, and nothing runs after it
  closes to do it. A new `.nro` still has to be copied by the player (or another homebrew tool).
- **Big downloads work streamed to the SD card**: `Switch.file(path).writable` (it truncates an
  existing file) took 53.8 MiB at 1.70 MiB/s in 4 MiB blocks, each hashed with `crypto.subtle`
  (218 ms in all), writes 1.9 s in all (longest 249 ms, off the frame loop: worst frame 98 ms). JS
  memory peaked ~75 MiB above the start. Reading it back in 4 MiB blocks (`FsFile.stream`) and
  checking every block took 2.9 s. Renaming and removing a 54 MiB file that isn't open is instant.

So assets come through the online updates instead (see [updates.md](updates.md)).

## Update gate probe (test u6, 2026-11-25)

Can a module draw its own screen before the app, use the network, and then let the app start in the
same process (the update gate, applying an update without closing the app)? A copy of the app whose
loader first imported a probe module, which drew ~7 s, fetched the release manifest and let go:

- **WebGL2 works and hands over**: the probe drew with the screen's WebGL2 context (texts from an
  `OffscreenCanvas` uploaded as a texture every frame: ~42 fps, worst frame 122 ms), deleted what it
  made and unbound; the app's `getContext('webgl2')` then returned **the same context**, with no GL
  error, and the app ran normally (menus, teambuilder, Watch Live, a battle).
- **2D doesn't**: after drawing with the screen's 2D context, `getContext('webgl2')` returns null,
  so the app couldn't draw.
- **The network before the app**: the manifest arrived over https in 1.4–1.9 s.

So the gate draws with WebGL2 (`native/loader/gate-screen.ts`).

## .nro handover probe (test u8, 2026-11-25)

Can a new `.nro` reach the path a HOME menu forwarder opens, with no PC? `native/poc/forwarder-probe.ts`
(`node scripts/build-nro.mjs --forwarder-probe`) on the console:

- **`Switch.argv[0]` is the `.nro`'s path**: from the Homebrew Menu, the file opened; from a
  forwarder, the `.nro` it points to (`sdmc:/switch/pokemon-showdown.nro`).
- **The running `.nro` can copy itself**: read in 4 MiB blocks while its RomFS is in use and written
  elsewhere (54 MiB in 4–6 s, checked); the copy opens from the Homebrew Menu. It can't go over its
  own path (`File exists (rename)`: a rename never replaces a file, and the running one can't be
  removed).
- **A 128 MiB `.nro` downloads to `sdmc:/switch/`** at 2.1 MiB/s (61 s, every block checked) and opens
  from the Homebrew Menu; copying one takes 14 s (20 s with the read-back check), and removing a
  `.nro` that isn't running 8 ms.

So the new `.nro` comes next to the old one under a versioned name and, opened once from the Homebrew
Menu, copies itself where the forwarder opens ([updates.md](updates.md#a-new-nro)).
