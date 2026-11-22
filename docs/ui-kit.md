# The canvas UI kit

Every screen is drawn on the WebGL stage (see [architecture.md](architecture.md)), so there are no
HTML buttons, lists or inputs. Screens are built from the kit in `src/app/core/gl/` instead. This
guide lists its pieces and then builds a screen step by step.

> **Try it live:** press **R3** on the home menu (or **R** on a keyboard) to open `/gl-kit`, a
> showcase of the widgets, a long list, the on-screen keyboard and a text stress test
> (`features/gl-home/components/gl-kit-screen`).

## Rules of the road

- **No DOM UI.** Don't add templates, HTML controls, CSS for UI or hidden ARIA mirrors. A scene's
  template is `''`.
- **Controller first.** Every action must be reachable with the d-pad, A, B and the shoulder buttons.
  Mouse and touch are extras.
- **Colours come from the palette** (`GlTheme`), never hard-coded, so every theme works. Each of the six
  themes has a light and a dark palette (Settings → Appearance; light is the default), each checked for
  WCAG AA contrast. If you add a colour role, check it in all twelve. Text on a bright fill (teal,
  danger, accentText) uses `contrast`; colours that depend only on light/dark (focus ring, disabled
  controls, logo) are the mode roles in `gl-theme.ts`.
- **Text fields never open the keyboard on their own.** A opens it. Focusing a field automatically
  would open the console's own keyboard.
- **The stage is 1280×720.** Lay screens out in stage pixels; the host scales the canvas to the
  screen.

## Drawing primitives

### `GlRenderer` (`gl-renderer.ts`)

A batched quad renderer with rounded boxes drawn by a shader (SDF), so boxes, borders, pills and soft
shadows are all one call:

| Call | What it draws |
| --- | --- |
| `begin(time, base, band)` | Starts a frame on the backdrop (dots in the band colour) |
| `beginPlain(color)` | Starts a frame on a plain colour |
| `rect(x, y, w, h, style)` | A box: `fill`, `stroke`, `border`, `radius`, `softness` (glow/shadow), `texture`, `angle`, `additive` |
| `image(texture, x, y, scale?, tint?)` | A texture at its size |
| `circle(cx, cy, r, fill)` | A circle |
| `clip(box \| null)` | Draws only inside a box until `clip(null)` |
| `setView(scale, x, y)` | Zooms and pans what follows (the battle camera) |
| `end()` | Flushes the batch. Call it at the end of the frame |

Colours are `Rgba` tuples in 0..1. Use `rgba('#rrggbb')`, `withAlpha(color, a)` and
`mixRgba(a, b, t)` to make them.

### Text: `drawText` (`canvas-ui.ts`)

```ts
drawText(renderer, text, 'Hello', x, cy, { size: 18, bold: true }, palette.ink, { align: 'center', maxWidth: 200 });
```

- Text is positioned by its **vertical middle** (`cy`), and starts at `x`, is centred on it or ends at
  it (`align`).
- `maxWidth` cuts it with an ellipsis.
- Text is rendered once with a 2D canvas and cached on shared atlas pages (`TextTextures`). New texts
  have a **time budget per frame**. A text that doesn't fit in this frame's budget shows a pulsing
  skeleton bar and fades in a frame or two later. You don't have to do anything about that.
- `fast: true` draws from the glyph atlas instead (one quad per letter, no texture per string). Use it
  for text that changes every frame or so: timers, counters, a text field being typed.

Inside a screen you normally call the kit's `label(ctx, ...)`, which is `drawText` with the context's
renderer and cache.

## The kit (`ui/retro-kit.ts`)

Every widget takes a `UiContext`: the frame's resources plus the scene's `focus` and the `palette`.
Build it at the top of `draw`:

```ts
const ctx: UiContext = { ...frame, focus: this.focus, palette: this.theme.palette() };
```

| Widget | Use |
| --- | --- |
| `label(ctx, text, x, cy, style, color, options?)` | Text |
| `paragraph(ctx, text, x, top, maxWidth, lineHeight, style, color, maxLines?)` | Wrapped text |
| `retroBox(ctx, box)` | The Gen 3 style panel (outline, rim, panel) |
| `button(ctx, id, box, text, { accept, primary?, disabled?, shortcut?, skip? })` | A button. `shortcut: 'ZR'` draws the controller button that does the same |
| `pill(ctx, 'ZR', x, cy)` | A controller button's name in a pill (legends, shortcuts) |
| `stepper(ctx, id, box, name, value, step)` | A setting with a few values; left/right or A change it |
| `tabs(ctx, id, box, names, active, select)` | A row of tabs |
| `textField(ctx, id, box, value, { edit, placeholder?, masked? })` | A text field; `edit` opens the keyboard |
| `modal(ctx, box, dim?)` | Dims the page, traps the focus and draws the box. Draw the modal's content after it |
| `focusRing(ctx, box)` | The yellow focus ring, for custom controls |
| `ListView` | A long list shown a page at a time (see below) |

Widgets that can be focused **return whether they have the focus**, so you can draw extra detail for
the focused one.

### Bigger pieces

| Piece | File | Use |
| --- | --- | --- |
| `PageBar` | `ui/page-bar.ts` | The 76 px bar on top of every page: icon, title, Back (click only), crumbs, connection status, challenge notice |
| `OptionPickerView` | `ui/option-picker.ts` | A modal list to pick a format or a team, with category headings and optional sprites |
| `FormatListScreen` | `ui/format-list-screen.ts` | A whole page: a format selector, Previous/Next/Refresh and a paged list (Watch Live, Replays) |
| `CanvasKeyboard` | `ui/canvas-keyboard.ts` | The on-screen keyboard, the **only** way to type text |
| `HoldAction` | `ui/hold-action.ts` | Hold-to-confirm for irreversible actions (a button that fills red) |
| `GlTheme` | `ui/gl-theme.ts` | The palette of the theme and appearance (light/dark) chosen in Settings |
| Pixel icons, masks, category icons | `ui/pixel-icons.ts`, `ui/masks.ts`, `ui/category-icons.ts` | Pixel art and tinted shapes as textures |

## Focus: `CanvasFocus`

A canvas has no DOM focus, so each scene owns a `CanvasFocus`. It works in immediate mode, like the
drawing:

1. `focus.begin()` at the start of the frame.
2. Each control **declares itself** while it's drawn: `focus.control({ id, x, y, w, h, accept })`.
   The kit's widgets do this for you.
3. `focus.end()` at the end of the frame. If the focused control is gone (a list changed, a tab
   switched), the focus moves to the nearest control left.

The d-pad moves **spatially**: `focus.move(direction)` picks the nearest control that way, preferring
controls in line over closer ones off to the side. You don't wire up neighbours by hand.

Useful details:

- **Ids must be stable** across frames (`row-${id}`, not `row-${index}` when the order can change).
  The focus is just the id of a control.
- `focus.focus(id)` sets the focus (when a screen opens, or after an action).
- `skip: true` makes a control click-only: the d-pad never lands on it (the bar's Back button, whose
  controller equivalent is B).
- A control's `move(direction)` handles the d-pad itself before the focus moves (a stepper uses
  left/right, a list row past the edge scrolls the list).
- `focus.trap()` (called by `modal`) makes only the controls declared after it reachable.
- `focusInput(focus, action)` is the standard input handler: directions move the focus, A presses.
  It returns `null` for B and the jumps, which are the scene's to handle.

### Lists: `ListView`

```ts
private readonly list = new ListView('team', /* rowHeight */ 52, /* visible */ 8);

// in draw():
this.list.draw(ctx, x, y, width, teams.length,
  ({ box, index, focused }) => { /* draw row `index` in `box` */ },
  (index) => this.open(teams[index]));
```

Rows are controls `${id}-${index}`. The d-pad walks them and scrolls a row past the edges; call
`list.page(±1, count, focus)` from L/R to move a page, and `list.range(count)` gives
"11–18 of 120".

## Typing text: `CanvasKeyboard`

```ts
textField(ctx, 'name', box, this.name, {
  placeholder: 'Your name',
  edit: () => this.keyboard.open({
    label: 'Name',
    value: this.name,
    maxLength: 18,
    done: (value) => { if (value !== null) this.name = value; },
  }),
});
```

The keyboard is a stage overlay: it draws over the scene and takes the input while open. `done` gets
the text on OK (ZR) or `null` on Cancel (ZL). `masked: true` hides passwords; `hint(text)` shows a
line under the text (search matches). Close it on destroy: `keyboard.close(null)`.

## Build a screen, step by step

A minimal page with the bar, a box, two buttons and B to go back.

**1. The scene component.** Create `features/example/components/example-scene/example-scene.ts`:

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { GlStage, StageFrame } from '@core/gl/gl-stage';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { PageBar } from '@core/gl/ui/page-bar';
import { UiContext, button, label, retroBox } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';

const BOX = { x: 32, y: 100, w: 1216, h: 596 };

@Component({ selector: 'app-example-scene', template: '' })
export class ExampleScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bar = inject(PageBar);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly focus = new CanvasFocus();
  private count = 0;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    // ZR does the main action from anywhere on the page.
    const releaseZr = this.navigation.registerButton('buttonZR', () => (this.count++, true));
    this.focus.focus('add');
    inject(DestroyRef).onDestroy(() => {
      hide();
      releaseZr();
    });
  }

  private onAction(action: CanvasAction): boolean {
    if (action === 'back') {
      void this.router.navigateByUrl('/');
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    frame.renderer.begin(frame.now / 1000, p.bg, p.rim);
    this.focus.begin();

    this.bar.draw(ctx, { title: 'Example', icon: 'settings', back: () => void this.router.navigateByUrl('/') });
    retroBox(ctx, BOX);
    label(ctx, `Pressed ${this.count} times`, BOX.x + 32, BOX.y + 48, { size: 24, bold: true }, p.ink, { fast: true });
    button(ctx, 'add', { x: BOX.x + 32, y: BOX.y + 100, w: 280, h: 56 }, 'Add one', {
      primary: true,
      shortcut: 'ZR',
      accept: () => this.count++,
    });
    button(ctx, 'reset', { x: BOX.x + 332, y: BOX.y + 100, w: 280, h: 56 }, 'Reset', {
      accept: () => (this.count = 0),
    });

    this.focus.end();
    frame.renderer.end();
  }
}
```

**2. The route.** Add it to `app.routes.ts`, lazy-loaded like the others:

```ts
{
  path: 'example',
  loadComponent: () => import('@features/example/components/example-scene/example-scene').then((c) => c.ExampleScene),
},
```

**3. Check it** with `npm start`: the d-pad (arrow keys) moves between the buttons, A (Enter) presses,
ZR (C) adds, B (Escape) goes back. Then try the other themes in Settings, and the L3 HUD (F) to see
its frame time.

As a screen grows, move self-contained parts into classes under the feature's `gl/` folder (a view
that takes the `UiContext` and draws its part), and keep the scene as the glue between state, input
and views. `features/play/gl` and `features/teambuilder/gl` are good examples.

## Patterns used across the app

- **Legends.** Pages list their controller buttons at the bottom with `pill`s ("ZR Search · L Teams").
  If a button does something on the page, say so on screen.
- **Hold to confirm.** Irreversible actions (delete a team, forfeit, disconnect) use `HoldAction`
  instead of a confirmation dialog: call `press()` from the button handler and `step(now)` every
  frame; it returns `true` on the frame the hold completes.
- **Animate with `dt`.** Ease with `1 - Math.exp(-dt * speed)` so animations run the same at any frame
  rate.
- **Leave with a fade.** Pages fade out before navigating (`leaving` in `SettingsScene`), and ignore
  input meanwhile.
- **Diagnostics.** Implement `diagnostics()` on the scene to add your own lines to the L3 HUD.
