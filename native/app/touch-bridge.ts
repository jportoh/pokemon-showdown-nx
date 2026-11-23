// The touchscreen on the native .nro. nx.js only turns the touchscreen on once something listens for
// touches on `screen`, and dispatches them there, not on the window: the app's PointerInput listens
// on the window, so nothing reached it. Each touch event is passed on to
// the window as a copy, with the same touches (in screen pixels, 1280x720 like the stage).

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend'] as const;

const touchScreen = (globalThis as unknown as { screen?: EventTarget }).screen;
if (touchScreen && typeof touchScreen.addEventListener === 'function') {
  for (const type of TOUCH_EVENTS) {
    touchScreen.addEventListener(type, (event) => {
      const touch = event as TouchEvent;
      const copy = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(copy, {
        touches: { value: touch.touches },
        changedTouches: { value: touch.changedTouches },
      });
      globalThis.dispatchEvent(copy);
    });
  }
}
