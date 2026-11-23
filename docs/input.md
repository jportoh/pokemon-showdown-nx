# Input: controller, keyboard and touch

The app is played with a controller on the Switch. Everything goes through
`KeyboardNavigation` (`src/app/core/input/keyboard-navigation.ts`), which turns the controller and
the keyboard into a small set of actions and hands them to the screen that's showing.

## The buttons

| Controller | Keyboard | Action | Who gets it |
| --- | --- | --- | --- |
| D-pad, left stick | Arrows, W A S D | `up` `down` `left` `right` | The top scene (`captureInput`) |
| A | Enter, J | `accept` | The top scene |
| B | Escape, K | `back` | The top scene |
| | Home, End | `first`, `last` | The top scene |
| ZL / ZR | Z / C | `buttonZL` / `buttonZR` | Handlers registered with `registerButton` |
| L / R | Q / E | `buttonL` / `buttonR` | Handlers registered with `registerButton` |
| X / Y | X / Y | `buttonX` / `buttonY` | Handlers registered with `registerButton` |
| + / − | + (or =) / - | `buttonPlus` / `buttonMinus` | Handlers registered with `registerButton` |
| R3 | R | `buttonR3` | Handlers registered with `registerButton` |
| L3 | F | `buttonL3` | The performance HUD, on every screen (`GlStage`) |

The mapping lives in `core/input/console-keys.ts`, with the Gamepad API indices by position, as
nx.js reports them (B=0, A=1, Y=2, X=3, L=4, R=5, ZL=6, ZR=7, −=8, +=9, L3=10, R3=11, d-pad 12–15).
+ doesn't exit the app (`native/app/plus-button.ts`): the console's HOME button does. X, Y, + and −
have one meaning across the app (`ROLE_KEYS`): see [native.md](native.md#controls-test-x14).

## Two channels

### The d-pad, A and B: `captureInput`

`GlStage.show` registers the stage with `captureInput`, and the stage forwards each action to the
overlay (the on-screen keyboard) if there is one, else to the **top scene's `input(action)`**. The
scene returns `true` when it used the action.

Most scenes pass directions and A to their `CanvasFocus` with `focusInput` and handle B themselves:

```ts
private onAction(action: CanvasAction): boolean {
  if (action === 'back') {
    this.leave('/');
    return true;
  }
  return focusInput(this.focus, action) ?? false;
}
```

When a modal view is open (a picker, a dialog), the scene sends the actions to it first.

### The shoulder buttons: `registerButton`

L, R, ZL, ZR and R3 mean something different on each screen, so a screen registers handlers while
it's shown:

```ts
const release = [
  this.navigation.registerButton('buttonZL', () => this.switchTab(-1)),
  this.navigation.registerButton('buttonZR', () => this.switchTab(1)),
];
inject(DestroyRef).onDestroy(() => release.forEach((fn) => fn()));
```

Handlers are a stack: the **newest handler that returns `true`** wins, and one returning `false`
passes the press to the older ones. That's how an open picker takes L/R for paging and gives them back
when it closes. Always release your handlers on destroy.

Buttons that only work with the controller (ZR "Search", L "Teams") don't need a focusable control on
screen; draw them in the legend or as a `button` with `shortcut` and `skip: true` (clickable, never
landed on by the d-pad).

## Sounds and repaint

A press that a handler used plays its sound (`move`, `accept`, `back` or `page`) through
`AudioEngine`, and requests an Angular tick (`RenderScheduler`). An unused press is silent, which tells
the player nothing happened.

## How the controller is read

Findings from the console shaped this:

- The buttons reach the app through the Gamepad API, so the controller is **polled every animation
  frame**. The console's timers fire too seldom to poll with.
- On the console, key events are ignored while a controller is connected, so a press doesn't count
  twice. In a desktop browser both
  the keyboard and a gamepad work, and the same action from both within 150 ms counts once.
- Held directions **repeat**: after 350 ms, then faster and faster (120 ms down to 35 ms). A and the
  shoulder buttons never repeat. B repeats only while `repeatBack` is set (the keyboard's Delete).

## Hold to confirm

`isHeld(button)` tells whether a button is down right now, and `consume(button)` marks a hold as done
so the same press can't trigger the next screen's action. `HoldAction` (`core/gl/ui/hold-action.ts`)
wraps both: see [ui-kit.md](ui-kit.md#patterns-used-across-the-app).

## Text entry

Text is typed only with the canvas `CanvasKeyboard`. While it's open it registers a text input
(`registerTextInput`), so on a computer the physical keyboard types into it; on the console the
controller drives it (A types, B deletes (or cancels once empty), L Shift, R space, + OK, ZL cancel).

Never focus a text field automatically: it must open on A.

## Touch and mouse

`PointerInput` (`core/gl/pointer-input.ts`) listens on the window for touch, pointer and mouse events,
maps them to stage coordinates (wherever and however large the canvas is) and calls `GlStage.click`
or `GlStage.hover`. The stage passes them to the top scene, which usually forwards them to
`focus.click(x, y)` / `focus.hover(x, y)`: a click focuses and presses the control under it, exactly
like moving there and pressing A.

The console's touchscreen sends events in **bursts** and in several families at once (touch, pointer
and mouse for one tap); `PointerInput` folds each burst into a single tap. With the L3 HUD open, the
last raw events are listed and a dot marks where the last tap landed.

## Testing without a console

- Keyboard: the table above. `npm start` and play with the keys.
- Any gamepad works in Chrome or Edge through the Gamepad API (standard mapping).
- The console-only paths (`PLATFORM === 'native'`, `nx.js/` in the user agent) only run there; see
  [native.md](native.md#testing-on-a-console) for testing on one.
