# Rendering

How the stage turns a scene's calls into pixels, and the caches and budgets that keep it at 60 fps on
the console. Read [architecture.md](architecture.md) first for the frame loop; this guide is about
what happens inside it.

Everything here lives in `src/app/core/gl/`.

## Why it's built this way

The console is slow at the things browsers usually do for you: layout, decoding images,
rasterizing text. Every rule below comes from a measurement on the console (the comments in the code
name the tests). In short:

- **Draw calls are expensive**: batch everything, and share textures (atlases) so a batch isn't
  broken.
- **Uploading textures stalls frames**: limit how many new textures a frame can make.
- **`createImageBitmap` takes ~100 ms per sprite**: decode PNGs in JavaScript, a few ms per frame.
- **Timers fire only 20–25 times a second**: anything per-frame runs from `requestAnimationFrame`.

When you add drawing code, keep those in mind and check the L3 + R3 HUD on the console.

## `GlRenderer`: one shader, batched quads

`gl-renderer.ts` is a small 2D renderer on WebGL 1 (it also runs on a WebGL 2 context). Everything is
a **quad** drawn by one shader that computes the signed distance to a rounded box, so one call gives
rounded corners, borders, soft edges (glows, shadows) and textures:

```ts
renderer.rect(x, y, w, h, { fill, stroke, border: 2, radius: 6 });
renderer.rect(x, y, w, h, { fill: withAlpha(black, 0.4), radius: 20, softness: 12 }); // soft shadow
renderer.image(texture, x, y, 2); // pixel art at 2x
```

Quads are appended to one vertex buffer (up to 16,000 per batch). A batch is drawn (`flush`) when the
texture changes, when the clip or view changes, and at `end()`. So:

- **Order matters for performance.** Drawing ten texts from the same atlas page in a row is one draw
  call; alternating text and sprites breaks it into many. Group similar things when you can.
- **Untextured quads** (plain boxes) never break a batch: they join whatever batch is open.
- `clip(box)` (scissor) and `setView(scale, x, y)` (the battle camera) flush the batch.
- `begin(time, base, band)` draws the backdrop (a grid of dots in the band colour) with its own shader; `beginPlain(color)`
  just clears.
- `renderer.originX/originY` offsets everything drawn (screen shake).

The HUD shows draw calls per frame and the time spent in `flush`.

Coordinates are always **stage pixels** (1280×720). The canvas itself can be denser (1.5× when
docked at 1920×1080); the renderer maps one to the other.

## Text

Text is the most expensive thing to draw, so there are two caches. `drawText` (in `canvas-ui.ts`)
picks between them.

### `TextTextures`: text atlas pages

Each distinct string and style is rendered **once** with a hidden 2D canvas (white, and tinted when
drawn, so one texture serves every colour) and packed into shared **atlas pages**: six 2048×1024
pages, about 1,800 texts. Texts from the same page batch into one draw call. When the pages are full,
the page drawn from longest ago is cleared.

Text is rendered at the canvas's density (`setScale`), so it stays sharp at 1080p.

**The budget.** Making new text costs time, so each frame may spend at most `TEXT_BUDGET_MS` (4 ms)
on it. A text that doesn't fit shows a **skeleton** (a pulsing bar its size) and fades in a frame or
two later. A screen full of new text therefore appears over a few frames instead of stalling one.

`measure`, `fit` (cut with an ellipsis) and `wrap` (lines for a width) are cached too.

### `GlyphAtlas`: text that changes all the time

For text that changes every frame or so (timers, counters, chat lines, a field being typed),
rendering a texture per string would fill the pages with garbage. The glyph atlas instead draws each
**character** once per style and composes strings glyph by glyph: no upload per string, one draw call
per style. It covers ASCII, Latin-1 and the app's symbols (`… → – — • ♂ ♀ × ★ ▲ ▼ ▶`); anything else
falls back to `TextTextures`.

Ask for it with `fast: true` in `drawText` / `label`. It has no kerning, so it's slightly wider than
the browser's text: use it only where the text really changes.

The diagnostics overlay has its own small text cache (`overlayText`), so the HUD's text never evicts
the scene's.

## Images

### `SpriteBitmaps`: download and decode

A singleton service that downloads and decodes every image once and keeps it for as long as the app
runs:

- Up to 6 downloads at a time, the most wanted first (`ImagePriority`: `Field` < `Screen` < `Ahead`).
- PNGs are decoded **in JavaScript** (`png-decode.ts`, palette and RGB PNGs) with a time budget per
  frame (6 ms, 40 ms on the loading screen). What `decodePng` can't handle goes to the browser.

### `GlSprites`: textures

`frame.images` turns decoded images into WebGL textures:

| Call | Use |
| --- | --- |
| `images.sprite(id, back, priority, set?)` | A Pokémon sprite: from the bundled sheets, or Showdown's server |
| `images.image(url, priority?)` | Any image, smooth |
| `images.pixelArt(url, priority?)` | Any image, nearest sampling (crisp pixels) |
| `images.drawItem(item, x, y, size)` | An item icon from Showdown's item sheet |
| `images.prefetch(url)` | Start downloading ahead of time |

All of them return `null` (or draw nothing) until the image is ready; just keep drawing every frame and
it appears when it arrives. Rules:

- At most **2 new textures per frame** (`UPLOADS_PER_FRAME`), so a screen of new sprites fills in over a
  few frames.
- Textures not drawn for 90 s are deleted, and decoded images nobody used for 5 min are dropped. The
  bundled sprite sheets and the item sheet are kept for good.
- A missing back sprite (some new Megas) falls back to the front one.

### Bundled sprite sheets

The Champions format's sprites are packed into sheets shipped with the app
(`scripts/update-sprite-sheets.mjs` → `public/sprites/`, index in `core/dex/sprite-sheets.json`).
`sheetSprite(id, back)` returns the sheet and the part of it (`uv`) to draw. One texture per sheet
means a whole team draws without switching textures, and the loading screen uploads them all at
launch. Other formats' sprites (Random Battle) come from Showdown one by one.

> In a desktop browser, Showdown's sprite server sends no CORS headers, so WebGL can't use its images.
> The bundled sheets work everywhere; individual Showdown sprites only show on the console, which
> doesn't enforce CORS.

### Small textures of your own

For icons and shapes, make the texture once in `stage.whenReady(...)` and delete it on destroy:

- `iconTexture(renderer, name)`: the menu's 24×24 pixel-art icons (`ui/pixel-icons.ts`).
- `maskTexture(renderer, rows)` / `maskOf(...)`: a white shape from rows like `'..xx'`, drawn tinted
  (arrows, cursors).
- `discTexture`: the shared soft disc (`frame.disc`) for ellipses and shadows.

## Diagnostics (L3 + R3)

Press **L3 and R3** together (or **F** and **R** on a keyboard) on any screen for the performance
HUD (`perf-hud.ts`, fed by
`GlDiagnostics`):

- Frame rate, long frames and what happened before them (an Angular render, a text or sprite upload,
  an image arriving).
- Text cache and image cache use, deferred texts, draw calls, flush time, and a graph of the last
  frames.
- The loading screen's report, the scene's own `diagnostics()` lines, and the last touch events.

On the console, errors and the start-up's `[boot]` marks also go to `native.log` on the SD card
([native.md](native.md#phase-1-the-app-on-the-engine)).

## Checklist for drawing code

- Draw every frame from state; don't cache drawing results yourself.
- Use `fast: true` for text that changes often, normal text for everything else.
- Don't build long strings in `draw` for text that doesn't change (the cache key is the string).
- Avoid allocating in hot loops when drawing many items (the battle screen reuses objects).
- Create your own textures in `whenReady` and delete them on destroy.
- Check the HUD on the console before calling a screen done: 60 fps, no long frames when navigating.
