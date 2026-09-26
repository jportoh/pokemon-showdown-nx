import { Injector, Service, afterNextRender, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { GAMEPAD_BUTTONS, InputAction, PageButton, inputAction, isTypingKey } from '@core/input/console-keys';
import {
  Box,
  Direction,
  boxOf,
  boxesSupported,
  collectCandidates,
  isScrollRegion,
  isTextField,
  nearestInDirection,
  nearestTo,
  regionOf,
  revealInRegion,
  screenBoxOf,
} from '@core/input/spatial-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';

/** Marks the focused control while the buttons are in use; styles.css draws the ring. */
const FOCUS_ATTRIBUTE = 'data-kb-focus';
/** Marks a text field being typed in (see `editing`); styles.css colours its ring differently. */
const EDITING_ATTRIBUTE = 'data-kb-editing';
/** Marks where focus starts on a page reached with ZL/ZR. */
const AUTOFOCUS_ATTRIBUTE = 'data-autofocus';

/** How far (px) the d-pad scrolls a focused scroll region (the chat log, the user list) per press. */
const SCROLL_STEP_PX = 96;
/** When to check whether a pressed control took focus with it (it got disabled or hidden). */
const RECOVER_FOCUS_MS = 500;

/** Brewser lays out late: a focused row is scrolled into view again after this long. */
const REVEAL_AGAIN_MS = 100;

/** How often the controller is read. */
const GAMEPAD_POLL_MS = 50;
/** A held direction repeats after this long, then every GAMEPAD_REPEAT_MS. */
const GAMEPAD_REPEAT_DELAY_MS = 400;
const GAMEPAD_REPEAT_MS = 130;
/** How far the left stick must be pushed to count as a d-pad direction. */
const STICK_THRESHOLD = 0.5;
/** The same action from the keyboard and the controller this close together is one press. */
const DUPLICATE_MS = 150;

/** The console's engine: text is typed with its on-screen keyboard, never with the buttons. */
const ON_BREWSER = /Brewser/.test(navigator.userAgent);

type Source = 'keyboard' | 'gamepad';

/** Up/down step through a paged element; first/last jump to its ends. */
export type PageStep = 'up' | 'down' | 'first' | 'last';

/**
 * Makes the whole app work with the controller (and the keys that stand for its buttons, see
 * console-keys): the d-pad moves focus to the nearest control in that direction, A presses it, B goes
 * back (the nearest `(appBack)` handler around the focused control), ZL/ZR switch the header's tabs.
 *
 * Findings from the console (test K1) shape it:
 * - A, B, ZL and ZR only reach the page through the Gamepad API, so the controller is polled. The
 *   d-pad also sends key events (its arrow and its mapped letter, i.e. twice), so on Brewser, keys
 *   are ignored while a controller is connected.
 * - There is no native focus: `document.activeElement` stays null, `:focus` never matches and no
 *   focus events fire. So focus is VIRTUAL: this service tracks the focused control itself and marks
 *   it with an attribute. `HTMLElement.prototype.focus` is wrapped, so components that call
 *   `element.focus()` move it too. In browsers the native focus follows as well.
 *
 * One listener handles every key, so components don't handle these keys themselves (their handlers
 * would run too: Brewser doesn't report `defaultPrevented`).
 *
 * Text fields have two modes, because keys that stand for buttons are letters. Reached with the
 * d-pad, the buttons keep navigating; A starts typing (`editing`), and while typing the letters type
 * and only arrows, Enter and Escape act. Typing ends when the field changes or loses focus. In a
 * browser, clicking a field, a component focusing one, or typing any other character starts typing too.
 */
@Service()
export class KeyboardNavigation {
  private readonly injector = inject(Injector);
  private readonly renderScheduler = inject(RenderScheduler);

  private readonly backHandlers = new Map<Element, () => void>();
  private readonly pagers = new Map<Element, (step: PageStep) => boolean>();
  private tabSwitcher: ((step: 1 | -1) => void) | null = null;
  /** L/R handlers by page, newest last: the newest one that uses the press wins. */
  private readonly pageButtons: { button: PageButton; handler: () => boolean }[] = [];

  /** The focused control (virtual focus: see the class comment). */
  private current: HTMLElement | null = null;
  /** The element that shows the focus ring. */
  private ringed: Element | null = null;
  private usingButtons = false;
  /** The last control that had focus, and where it was, for when focus is lost (its control vanished). */
  private lastFocused: HTMLElement | null = null;
  private lastBox: Box | null = null;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private focusPageOnNavigation = false;
  /** Whether the focused text field is being typed in. */
  private editing = false;
  /** Set while this service moves focus, which lands on text fields without typing in them. */
  private movingFocus = false;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether element.focus() is wrapped (see wrapNativeFocus). */
  private focusWrapped = false;

  private gamepadConnected = false;
  /** Actions held on the controller: when they started and when they last fired (for repeats). */
  private held = new Map<InputAction, { since: number; fired: number }>();
  private lastAction: { action: InputAction; source: Source; at: number } | null = null;

  constructor() {
    this.wrapNativeFocus();
    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    const onPointer = () => this.setUsingButtons(false);
    window.addEventListener('mousedown', onPointer, true);
    window.addEventListener('touchstart', onPointer, true);
    // Browsers only (Brewser fires no focus events): clicks and Tab move the native focus.
    document.addEventListener('focusin', (event) => this.noteFocus(event.target as HTMLElement | null), true);
    document.addEventListener('focusout', () => this.setEditing(null), true);
    // The value was committed (Enter, or the on-screen keyboard closed): back to navigating.
    document.addEventListener('change', (event) => {
      if (event.target === this.current && isTextField(this.current)) this.setEditing(null);
    }, true);
    if (typeof navigator.getGamepads === 'function') setInterval(() => this.pollGamepads(), GAMEPAD_POLL_MS);

    inject(Router).events.subscribe((event) => {
      if (!(event instanceof NavigationEnd) || !this.focusPageOnNavigation) return;
      this.focusPageOnNavigation = false;
      afterNextRender(() => this.focusPageStart(), { injector: this.injector });
    });
  }

  /** Called by the `(appBack)` directive: B runs the handler of the nearest element around focus. */
  registerBack(element: Element, handler: () => void): () => void {
    this.backHandlers.set(element, handler);
    return () => this.backHandlers.delete(element);
  }

  /**
   * An element that pages its own content while focused, like a scroll region scrolls (the battle
   * log, which can't be a scroll box on Brewser). The pager returns false at that end, letting focus go.
   */
  registerPager(element: Element, pager: (step: PageStep) => boolean): () => void {
    this.pagers.set(element, pager);
    return () => this.pagers.delete(element);
  }

  /** ZL/ZR call this with -1/+1; the layout switches its tabs. */
  registerTabSwitcher(switcher: (step: 1 | -1) => void): void {
    this.tabSwitcher = switcher;
  }

  /**
   * What L, R, ZL or ZR does on a page (its component registers while it's shown). The handler returns
   * whether it used the press. Returns the unregister function.
   */
  registerButton(button: PageButton, handler: () => boolean): () => void {
    const entry = { button, handler };
    this.pageButtons.push(entry);
    return () => {
      const index = this.pageButtons.indexOf(entry);
      if (index !== -1) this.pageButtons.splice(index, 1);
    };
  }

  /** The focused control, or null when focus is lost. */
  focused(): HTMLElement | null {
    return this.activeControl();
  }

  /** Focuses a control, scrolling its region to show it. */
  focus(element: HTMLElement): void {
    this.movingFocus = true;
    try {
      element.focus();
    } finally {
      this.movingFocus = false;
    }
    if (!this.focusWrapped) {
      this.noteFocus(element);
      this.reveal(element);
    }
  }

  // Every element.focus() call (the app's and this service's) also moves the virtual focus and
  // scrolls the control's region to it: Brewser's focus() doesn't scroll (a chooser reopened on a
  // move far down the list stayed at the top).
  private wrapNativeFocus(): void {
    const proto = HTMLElement.prototype;
    const nativeFocus = proto.focus;
    const navigation = this;
    try {
      proto.focus = function (this: HTMLElement, options?: FocusOptions) {
        try {
          nativeFocus.call(this, options);
        } finally {
          navigation.noteFocus(this);
          navigation.reveal(this);
        }
      };
      this.focusWrapped = proto.focus !== nativeFocus;
    } catch {
      // Not patchable: only the service's own moves update the virtual focus.
    }
  }

  /** Scrolls the focused control into view now and once more after layout has caught up. */
  private reveal(element: HTMLElement): void {
    revealInRegion(element);
    if (this.revealTimer !== null) clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      if (this.current === element) revealInRegion(element);
    }, REVEAL_AGAIN_MS);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const action = inputAction(event);
    const active = this.activeControl();
    const field = active && isTextField(active) ? active : null;
    if (field && this.editing) {
      // Typing: letter keys type. Enter reaches the field's own handler and ends typing.
      if (!action || isTypingKey(event)) return;
      if (action === 'accept') {
        this.setEditing(null);
        return;
      }
    } else if (field && !action) {
      // Any other character starts typing (computer keyboards).
      if (isTypingKey(event)) this.setEditing(field);
      return;
    }
    if (!action) return;
    // On the console the controller is read directly; its d-pad's key events would move twice more.
    if (ON_BREWSER && this.gamepadConnected) {
      event.preventDefault();
      return;
    }
    if (this.dispatch(action, 'keyboard', active, field !== null && this.editing)) event.preventDefault();
  }

  private pollGamepads(): void {
    let pads: readonly (Gamepad | null)[];
    try {
      pads = navigator.getGamepads();
    } catch {
      return;
    }
    const now = Date.now();
    const pressed = new Set<InputAction>();
    let connected = false;
    for (const pad of pads) {
      if (!pad) continue;
      connected = true;
      for (const [index, action] of GAMEPAD_BUTTONS) {
        const button = pad.buttons[index];
        if (button && (button.pressed || button.value > 0.5)) pressed.add(action);
      }
      const [x = 0, y = 0] = pad.axes;
      if (y < -STICK_THRESHOLD) pressed.add('up');
      else if (y > STICK_THRESHOLD) pressed.add('down');
      if (x < -STICK_THRESHOLD) pressed.add('left');
      else if (x > STICK_THRESHOLD) pressed.add('right');
    }
    this.gamepadConnected = connected;

    const held = new Map<InputAction, { since: number; fired: number }>();
    for (const action of pressed) {
      const previous = this.held.get(action);
      if (!previous) {
        held.set(action, { since: now, fired: now });
        this.dispatch(action, 'gamepad', this.activeControl(), false);
        continue;
      }
      held.set(action, previous);
      // Only directions repeat while held: a held A shouldn't press over and over.
      const isDirection = action === 'up' || action === 'down' || action === 'left' || action === 'right';
      if (isDirection && now - previous.since >= GAMEPAD_REPEAT_DELAY_MS && now - previous.fired >= GAMEPAD_REPEAT_MS) {
        previous.fired = now;
        this.dispatch(action, 'gamepad', this.activeControl(), false);
      }
    }
    this.held = held;
  }

  /** Runs an action; returns whether it was used (and the key's default must be prevented). */
  private dispatch(action: InputAction, source: Source, active: HTMLElement | null, typing: boolean): boolean {
    const now = Date.now();
    const last = this.lastAction;
    if (last && last.action === action && last.source !== source && now - last.at < DUPLICATE_MS) return true;
    this.lastAction = { action, source, at: now };
    this.setUsingButtons(true);
    const used = this.handle(action, active, typing);
    if (used) this.renderScheduler.request();
    return used;
  }

  private handle(action: InputAction, active: HTMLElement | null, typing: boolean): boolean {
    if (active) this.remember(active);
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        return this.onDirection(action, active, typing);
      case 'accept':
        return this.onAccept(active);
      case 'back':
        return this.onBack(active);
      case 'prevTab':
      case 'nextTab':
        if (this.pressPageButton(action === 'prevTab' ? 'buttonZL' : 'buttonZR')) return true;
        if (!this.tabSwitcher) return false;
        this.focusPageOnNavigation = true;
        this.tabSwitcher(action === 'nextTab' ? 1 : -1);
        return true;
      case 'buttonL':
      case 'buttonR':
        return this.pressPageButton(action);
      case 'first':
      case 'last':
        return this.onJump(action, active);
    }
  }

  /** The newest page handler for the button that uses the press. */
  private pressPageButton(button: PageButton): boolean {
    return this.pageButtons.filter((entry) => entry.button === button).reverse().some((entry) => entry.handler());
  }

  private onDirection(direction: Direction, active: HTMLElement | null, typing: boolean): boolean {
    if (active && typing) {
      // Left/right move the caret; in a textarea, up/down move between lines until its first/last one.
      if (direction === 'left' || direction === 'right') return false;
      if (active.tagName === 'TEXTAREA' && !caretAtEdge(active as HTMLTextAreaElement, direction)) return false;
    }
    if (active?.tagName === 'SELECT' && (direction === 'left' || direction === 'right')) {
      changeOption(active as HTMLSelectElement, direction === 'right' ? 1 : -1, false);
      return true;
    }
    // A focused scroll region (the chat log, the user list) or paged element scrolls first, then lets focus go.
    if (active && (direction === 'up' || direction === 'down')) {
      const pager = this.pagers.get(active);
      if (pager?.(direction)) return true;
      if (isScrollRegion(active) && scrollRegion(active, direction === 'down' ? SCROLL_STEP_PX : -SCROLL_STEP_PX)) return true;
    }
    this.move(direction, active);
    return true;
  }

  private move(direction: Direction, active: HTMLElement | null): void {
    const origin = active ? screenBoxOf(active) : this.lastBox;
    if (!origin && !active) {
      this.focusPageStart();
      return;
    }
    if (!boxesSupported()) {
      this.moveInDocumentOrder(direction, active);
      return;
    }
    const region = active ? regionOf(active) : this.lastFocused && regionOf(this.lastFocused);
    const candidates = collectCandidates(document.body, region).filter((candidate) => candidate.element !== active);
    const next = origin && nearestInDirection(origin, direction, candidates);
    if (next) this.focus(next.element);
  }

  /** Without element boxes: down/right go to the next control in the document, up/left to the previous. */
  private moveInDocumentOrder(direction: Direction, active: HTMLElement | null): void {
    const controls = collectCandidates(document.body, null, false).map((candidate) => candidate.element);
    const index = active ? controls.indexOf(active) : -1;
    const step = direction === 'down' || direction === 'right' ? 1 : -1;
    const next = controls[index === -1 ? 0 : index + step];
    if (next) this.focus(next);
  }

  private onAccept(active: HTMLElement | null): boolean {
    if (!active) {
      this.recoverFocus();
      return true;
    }
    // A on a text field starts typing in it; clicking it may be what opens the on-screen keyboard.
    if (isTextField(active)) {
      this.setEditing(active);
      active.click();
      return true;
    }
    if (active.tagName === 'SELECT') {
      changeOption(active as HTMLSelectElement, 1, true);
      return true;
    }
    if (isScrollRegion(active) || this.pagers.has(active)) return false;
    active.click();
    this.scheduleRecovery();
    return true;
  }

  private onBack(active: HTMLElement | null): boolean {
    for (let node: Element | null = active ?? this.lastFocused; node; node = node.parentElement) {
      const handler = this.backHandlers.get(node);
      if (handler) {
        handler();
        this.scheduleRecovery();
        return true;
      }
    }
    return false;
  }

  /** Home/End: the first or last control of the list the focus is in (or the top/bottom of a focused scroll region). */
  private onJump(action: 'first' | 'last', active: HTMLElement | null): boolean {
    if (!active) return false;
    const pager = this.pagers.get(active);
    if (pager) return pager(action);
    if (isScrollRegion(active)) {
      active.scrollTop = action === 'first' ? 0 : Math.max(0, active.scrollHeight - active.clientHeight);
      return true;
    }
    const region = regionOf(active);
    if (!region) return false;
    const inRegion = collectCandidates(region, region, boxesSupported());
    const target = action === 'first' ? inRegion[0] : inRegion.at(-1);
    if (target) this.focus(target.element);
    return true;
  }

  /** Focus on a page reached with ZL/ZR: its `data-autofocus` control, or its first one. */
  private focusPageStart(): void {
    const main = document.querySelector('main') ?? document.body;
    const candidates = collectCandidates(main, null, boxesSupported());
    const preferred = candidates.find((candidate) => candidate.element.getAttribute(AUTOFOCUS_ATTRIBUTE) !== null);
    const target = preferred ?? candidates[0];
    if (target) this.focus(target.element);
  }

  /** Moves focus to the control nearest to where the lost one was, or to the page's start. */
  private recoverFocus(): void {
    const candidates = this.lastBox && boxesSupported() ? collectCandidates(document.body, null) : [];
    const nearest = this.lastBox && nearestTo(this.lastBox, candidates);
    if (nearest) this.focus(nearest.element);
    else this.focusPageStart();
  }

  // A pressed control may take focus with it (a − button reaching 0 gets disabled, a view closes).
  // Components move focus themselves where it matters; this catches the rest once they've rendered.
  private scheduleRecovery(): void {
    if (this.recoverTimer !== null) clearTimeout(this.recoverTimer);
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      if (this.usingButtons && !this.activeControl()) this.recoverFocus();
    }, RECOVER_FOCUS_MS);
  }

  /** The focused control, or null when focus is lost (its control was removed, hidden or disabled). */
  private activeControl(): HTMLElement | null {
    const active = this.current;
    if (!active || !document.body.contains(active)) return null;
    if ((active as HTMLButtonElement).disabled) return null;
    if (boxesSupported() && !boxOf(active)) return null;
    return active;
  }

  private remember(element: HTMLElement): void {
    this.lastFocused = element;
    this.lastBox = screenBoxOf(element) ?? this.lastBox;
  }

  /** Focus moved to `element` (wrapped focus(), or a browser focus event). */
  private noteFocus(element: HTMLElement | null): void {
    if (!element?.setAttribute || element === document.body || element === document.documentElement) return;
    if (element !== this.current) this.setEditing(null);
    this.current = element;
    this.remember(element);
    this.updateRing();
    // Focus from a click or a component (the rename box) is for typing, except on the console,
    // where the buttons can't type and a letter would be lost.
    const forTyping = !this.movingFocus && (!this.usingButtons || !ON_BREWSER);
    if (forTyping && isTextField(element)) this.setEditing(element);
  }

  /** Starts typing in `field`, or stops (null). */
  private setEditing(field: HTMLElement | null): void {
    const previous = document.querySelector(`[${EDITING_ATTRIBUTE}]`);
    if (previous && previous !== field) previous.removeAttribute(EDITING_ATTRIBUTE);
    this.editing = field !== null;
    field?.setAttribute(EDITING_ATTRIBUTE, '');
  }

  private setUsingButtons(value: boolean): void {
    if (this.usingButtons === value) return;
    this.usingButtons = value;
    this.updateRing();
  }

  /** Puts the ring on the focused control while the buttons are in use, and only there. */
  private updateRing(): void {
    const target = this.usingButtons ? this.current : null;
    if (this.ringed === target) return;
    this.ringed?.removeAttribute(FOCUS_ATTRIBUTE);
    target?.setAttribute(FOCUS_ATTRIBUTE, '');
    this.ringed = target;
  }
}

/** Steps a select to its next/previous enabled option, and tells Angular (and the page) it changed. */
function changeOption(select: HTMLSelectElement, step: 1 | -1, wrap: boolean): void {
  const count = select.options.length;
  for (let offset = 1; offset < count; offset++) {
    let index = select.selectedIndex + step * offset;
    if (wrap) index = ((index % count) + count) % count;
    else if (index < 0 || index >= count) return;
    if (select.options[index].disabled) continue;
    select.selectedIndex = index;
    notify(select, 'input');
    notify(select, 'change');
    return;
  }
}

/** Dispatches a plain bubbling event, with the legacy API as a fallback for engines without `new Event`. */
function notify(target: EventTarget, type: string): void {
  let event: Event;
  try {
    event = new Event(type, { bubbles: true });
  } catch {
    event = document.createEvent('Event');
    event.initEvent(type, true, false);
  }
  target.dispatchEvent(event);
}

/** Scrolls a region by `delta` px; false when it's already at that end. */
function scrollRegion(region: HTMLElement, delta: number): boolean {
  const max = Math.max(0, region.scrollHeight - region.clientHeight);
  const current = region.scrollTop;
  if ((delta > 0 && current >= max - 1) || (delta < 0 && current <= 0)) return false;
  region.scrollTop = Math.max(0, Math.min(max, current + delta));
  return true;
}

/** Whether the caret is on the textarea's first line (for up) or last line (for down). */
function caretAtEdge(textarea: HTMLTextAreaElement, direction: 'up' | 'down'): boolean {
  const caret = textarea.selectionStart ?? 0;
  const text = textarea.value;
  return direction === 'up' ? !text.slice(0, caret).includes('\n') : !text.slice(caret).includes('\n');
}
