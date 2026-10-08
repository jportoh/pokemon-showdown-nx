# Running on Brewser

Brewser runs web apps on a games console: a 1280×720 screen (1920×1080 when docked), a controller and
a touchscreen. Its runtime is a **custom engine**, not Chrome, even though its user agent says
`Chrome/120 … Brewser/1.0`. Much of this app's design follows from what that engine can and can't do.
This guide collects those findings, explains the console build and how to test on a device.

## What the engine can and can't do

All of these were measured on a device. When you find a new one, add it here.

### JavaScript

- **No ES modules.** Every `<script>` runs as a classic script (`type="module"` included), so
  Angular's output (modules importing chunks) can't start. The console build re-bundles everything
  into one classic `app.js` (see below). This also means **no lazy chunks** at runtime: the lazy
  routes in `app.routes.ts` all end up in that one file.
- Modern syntax is fine: the bundle targets ES2022 (optional chaining, class fields, async).
  `fetch`, `WebSocket`, `Promise`, `Proxy` and `localStorage` exist.
- **Timers are slow**: `setTimeout` / `setInterval` fire only 20–25 times a second.
  `requestAnimationFrame` runs a steady 60 fps. Anything per frame (animation, polling the controller)
  must run from `requestAnimationFrame`.
- `createImageBitmap` takes ~100 ms per image, which is why PNGs are decoded in JavaScript
  ([rendering.md](rendering.md#images)).
- No DevTools: diagnostics have to be drawn on screen (L3 HUD, the `--diag` build).

### Rendering

- **The DOM and CSS are slow and fragile**: many CSS features are missing or wrong, some property
  combinations blank the whole page, and text and image changes are often not repainted. That's why
  the UI moved to a single WebGL canvas. Don't add DOM UI. `src/styles.css` only lays out the stage
  and uses plain CSS (no layers, nesting or modern colour functions).
- **WebGL works well**, and is what the whole UI is drawn with.
- `@font-face` fonts show as squares: text uses the default font (`Roboto, sans-serif`).
- **No CORS enforcement**: images from Showdown's sprite server can be used as WebGL textures on the
  console, though not in a desktop browser.

### Input

- A, B, ZL and ZR only arrive through the **Gamepad API**; the d-pad comes through it and also as key
  events. **X and Y belong to Brewser** (restart, exit). See [input.md](input.md).
- The touchscreen sends events in bursts, in several event families at once.
- Text fields: focusing a DOM input opens the console's own keyboard. The app never uses DOM inputs;
  `CanvasKeyboard` is the only way to type.

### Audio

- **`<audio>` elements don't work** (`play()` throws). Web Audio works fully: the `AudioContext` runs
  from the start, without a user gesture, and decodes ogg, mp3 and wav. All sound goes through
  `AudioEngine` (`core/audio`).

### Storage

- `localStorage` was lost after a full reload of the engine. The app also writes each key as a JSON
  file on the SD card (`sdmc:/switch/pokemon-showdown-brewser/<key>.json`) through the runtime's
  `Switch` file API, and reads the file first. Use `core/persistence/device-storage.ts` for anything
  that must persist.

### Network

- Every remote origin must be on the app's **allow-list** when the build is submitted to Brewser:

  | Origin | Used for |
  | --- | --- |
  | `wss://sim3.psim.us` | The Showdown server |
  | `https://play.pokemonshowdown.com` | Login, sprites, data, cries |
  | `https://replay.pokemonshowdown.com` | Replays |
  | `https://pokepast.es` | Importing teams from PokePaste |

  If you add a feature that talks to a new origin, say so in your PR: the allow-list has to be
  updated for the next release.

## The console build

```bash
npm run build:brewser        # → dist/pokemon-showdown-brewser/brewser.zip
npm run build:brewser:diag   # the same, with an on-screen boot report
```

It runs `ng build` and then `scripts/build-brewser.mjs`, which:

1. **Re-bundles the JavaScript** with esbuild into one minified classic IIFE, `app.js` (target
   ES2022).
2. **Prepends small polyfills** in plain ES5:
   - `element.style.removeProperty` / `setProperty` / `getPropertyValue`, which Brewser lacks and
     Angular calls.
   - `setTimeout(fn)` without a delay gets an explicit `0`.
3. **Patches Angular's text updates** (`patchTextUpdates`): Brewser doesn't reliably repaint a text
   node's `nodeValue` edit, so the node is removed and reinserted after each edit. The build fails if
   Angular's code no longer matches the pattern (after an Angular update, check it).
4. **Rewrites `index.html`**: drops module scripts, preloads and Angular's stylesheet link, and loads
   `styles.css` and `app.js` classically. It fails if critical CSS was inlined: keep
   `"inlineCritical": false` in `angular.json`.
5. **Copies the static files** from `public/` (sprite sheets, audio, icons).
6. **Zips** `index.html`, `app.js`, `styles.css` and the assets with forward-slash paths.

The same zip is deployed everywhere Brewser runs the app (the console and Brewser's web version), so
there is no console-only variant.

### The `--diag` build

Adds a plain HTML report above the app that shows how far the boot got (the script loaded, the
polyfills, Angular started) and logs errors. Use it when the console shows a blank screen: once the
app is running, the L3 HUD is the better tool.

## Testing on a console

1. Get a zip:
   - **From CI**: every pull request and every push to `main` uploads `brewser-<commit>.zip` as a
     build artifact (see [releases.md](releases.md)). Releases attach `brewser-vX.Y.Z.zip`.
   - **Locally**: `npm run build:brewser`.
2. Upload the zip to Brewser as the app's build (with the network allow-list above).
3. Open it on the console. Check with the controller only, docked and handheld if you can.
4. Press **L3** for the HUD: 60 fps, no long frames when opening the screen you changed.

If you don't have a console, say so in your PR: a maintainer will test it on one. Most work can be
developed and checked in a desktop browser (`npm start`), keeping these limits in mind.

## Developing in a desktop browser

- `npm start` serves the app at `http://localhost:4200`. The keyboard stands in for the controller
  ([input.md](input.md#the-buttons)), and any gamepad works.
- **Logging in** to Showdown needs `play.pokemonshowdown.com/api`, which only allows CORS from
  Showdown's own site. To play online from a desktop browser, start one with web security disabled
  (for example Chrome with `--disable-web-security --user-data-dir=<a temp dir>`), and use it only for
  this.
- **Showdown's own sprites** (Random Battle, Gen 3) don't show in a normal desktop browser, for the
  same reason (no CORS headers). The bundled Champions sprites always show.
- The browser is far faster than the console: something smooth on a desktop can still drop frames on
  the device. Test there before calling performance work done.
