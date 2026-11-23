import { Service, inject } from '@angular/core';
import { AudioEngine } from '@core/audio/audio-engine';
import { SoundId } from '@core/audio/sfx';
import { GAMEPAD_BUTTONS, InputAction, PageButton, inputAction } from '@core/input/console-keys';
import { ON_CONSOLE } from '@core/runtime/platform';
import { RenderScheduler } from '@core/runtime/render-scheduler';

/**
 * How often the controller is read where there's no requestAnimationFrame. Elsewhere it's read every
 * frame: on the console timers fire only 20–25 times a second (probe N1), frames 60.
 */
const GAMEPAD_POLL_MS = 50;
/**
 * A held direction repeats after GAMEPAD_REPEAT_DELAY_MS, then faster and faster: each repeat comes
 * GAMEPAD_REPEAT_SPEEDUP times sooner than the last, from GAMEPAD_REPEAT_START_MS down to
 * GAMEPAD_REPEAT_MIN_MS (a canvas screen can take a step a frame or two).
 */
const GAMEPAD_REPEAT_DELAY_MS = 350;
const GAMEPAD_REPEAT_START_MS = 120;
const GAMEPAD_REPEAT_SPEEDUP = 0.85;
const GAMEPAD_REPEAT_MIN_MS = 35;
/** How far the left stick must be pushed to count as a d-pad direction. */
const STICK_THRESHOLD = 0.5;
/** The same action from the keyboard and the controller this close together is one press. */
const DUPLICATE_MS = 150;

type Source = 'keyboard' | 'gamepad';

/** Takes a computer keyboard's key while a text entry is open (see registerTextInput); false leaves it to navigation. */
export type TextInput = (event: KeyboardEvent) => boolean;

/** What a canvas screen is given (see KeyboardNavigation.captureInput). */
export type CanvasAction = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back' | 'first' | 'last';
/** Whether the action was used. */
export type CanvasInput = (action: CanvasAction) => boolean;

/** The action a page button sends (ZL and ZR are the tab keys'). */
function buttonAction(button: PageButton): InputAction {
  return button === 'buttonZL' ? 'prevTab' : button === 'buttonZR' ? 'nextTab' : button;
}

/** The sound of a press a screen used: the cursor moving, A, B, or a page button. */
function actionSound(action: InputAction): SoundId {
  return action === 'accept' ? 'accept' : action === 'back' ? 'back' : isCanvasAction(action) ? 'move' : 'page';
}

function isCanvasAction(action: InputAction): action is CanvasAction {
  return action === 'up' || action === 'down' || action === 'left' || action === 'right' || action === 'accept' || action === 'back' || action === 'first' || action === 'last';
}

/**
 * Makes the whole app work with the controller (and the keys that stand for its buttons, see
 * console-keys): the d-pad, A, B and the jumps go to the screen drawn on the stage (captureInput),
 * which moves its own focus inside the canvas; L, R, ZL, ZR, R3 and L3 go to the handlers the screen
 * registered for them. A press a screen uses makes its sound (AudioEngine).
 *
 * Findings from the console (test K1) shape it: A, B, ZL and ZR only reach the page through the
 * Gamepad API, so the controller is polled. The d-pad also sends key events (its arrow and its mapped
 * letter, i.e. twice), so on the console, keys are ignored while a controller is connected.
 */
@Service()
export class KeyboardNavigation {
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly audio = inject(AudioEngine);

  /** L/R/ZL/ZR/R3 handlers by screen, newest last: the newest one that uses the press wins. */
  private readonly pageButtons: { button: PageButton; handler: () => boolean }[] = [];
  private textInput: TextInput | null = null;
  /** Screens drawn on the canvas, newest last: the newest takes the d-pad, A and B (see captureInput). */
  private readonly canvasInputs: CanvasInput[] = [];

  /** B repeats while held, like a direction (the on-screen keyboard deletes with it). */
  repeatBack = false;

  private gamepadConnected = false;
  /** Actions held on the controller: when they started and when they last fired (for repeats). */
  private held = new Map<InputAction, { since: number; fired: number; repeats: number }>();
  private lastAction: { action: InputAction; source: Source; at: number } | null = null;
  /** Actions whose key is down on the computer keyboard (see isHeld). */
  private readonly keysDown = new Set<InputAction>();
  /** Buttons whose hold already did its job (see consume): ignored until they're let go. */
  private readonly consumed = new Set<InputAction>();

  constructor() {
    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    window.addEventListener(
      'keyup',
      (event) => {
        const action = inputAction(event);
        if (!action) return;
        this.keysDown.delete(action);
        this.releaseConsumed();
      },
      true,
    );
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.releaseConsumed();
    });
    if (typeof navigator.getGamepads === 'function') {
      if (typeof requestAnimationFrame === 'function') {
        const poll = () => {
          this.pollGamepads();
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      } else {
        setInterval(() => this.pollGamepads(), GAMEPAD_POLL_MS);
      }
    }
  }

  /**
   * What L, R, ZL, ZR or R3 does on a screen (it registers while it's shown). The handler returns
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

  /** Whether a page button is held down right now, on the controller or the keyboard (hold-to-confirm). */
  isHeld(button: PageButton | 'accept'): boolean {
    const action = button === 'accept' ? 'accept' : buttonAction(button);
    return !this.consumed.has(action) && (this.held.has(action) || this.keysDown.has(action));
  }

  /**
   * The button's hold did its job (it deleted something): until it's let go it isn't held, and its
   * presses (a keyboard's auto-repeat) do nothing, so it can't go on to the next screen's action.
   * It plays the hold's sound (a thud: something was done for good).
   */
  consume(button: PageButton | 'accept'): void {
    this.consumed.add(button === 'accept' ? 'accept' : buttonAction(button));
    this.audio.play('hold');
  }

  /** Forgets the consumed buttons that are up again. */
  private releaseConsumed(): void {
    for (const action of this.consumed) if (!this.held.has(action) && !this.keysDown.has(action)) this.consumed.delete(action);
  }

  /**
   * Gives a computer keyboard's keys to `handler` first (the on-screen keyboard types them), except
   * on the console with a controller, whose d-pad also sends letters. Returns the unregister function.
   */
  registerTextInput(handler: TextInput): () => void {
    this.textInput = handler;
    return () => {
      if (this.textInput === handler) this.textInput = null;
    };
  }

  /**
   * A screen drawn on the canvas: while registered, the d-pad, A, B and the jumps go to `handler`
   * (its focus moves inside the canvas); the page buttons (L, R, ZL, ZR, R3) still go to the handlers
   * registered for them. Returns the unregister function.
   */
  captureInput(handler: CanvasInput): () => void {
    this.canvasInputs.push(handler);
    return () => {
      const index = this.canvasInputs.indexOf(handler);
      if (index >= 0) this.canvasInputs.splice(index, 1);
    };
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.textInput && !(ON_CONSOLE && this.gamepadConnected) && this.textInput(event)) {
      event.preventDefault();
      return;
    }
    const action = inputAction(event);
    if (!action) return;
    this.keysDown.add(action);
    // On the console the controller is read directly; its d-pad's key events would move twice more.
    if (ON_CONSOLE && this.gamepadConnected) {
      event.preventDefault();
      return;
    }
    if (this.dispatch(action, 'keyboard')) event.preventDefault();
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

    const held = new Map<InputAction, { since: number; fired: number; repeats: number }>();
    for (const action of pressed) {
      const previous = this.held.get(action);
      if (!previous) {
        held.set(action, { since: now, fired: now, repeats: 0 });
        this.dispatch(action, 'gamepad');
        continue;
      }
      held.set(action, previous);
      // Only directions repeat while held (and B where it deletes): a held A shouldn't press over and over.
      const isDirection = action === 'up' || action === 'down' || action === 'left' || action === 'right' || (action === 'back' && this.repeatBack);
      const interval = Math.max(GAMEPAD_REPEAT_MIN_MS, GAMEPAD_REPEAT_START_MS * Math.pow(GAMEPAD_REPEAT_SPEEDUP, previous.repeats));
      if (isDirection && now - previous.since >= GAMEPAD_REPEAT_DELAY_MS && now - previous.fired >= interval) {
        previous.fired = now;
        previous.repeats++;
        this.dispatch(action, 'gamepad');
      }
    }
    this.held = held;
    this.releaseConsumed();
  }

  /** Runs an action; returns whether it was used (and the key's default must be prevented). */
  private dispatch(action: InputAction, source: Source): boolean {
    if (this.consumed.has(action)) return true;
    const now = Date.now();
    const last = this.lastAction;
    if (last && last.action === action && last.source !== source && now - last.at < DUPLICATE_MS) return true;
    this.lastAction = { action, source, at: now };
    const used = this.handle(action);
    if (used) {
      this.audio.play(actionSound(action));
      this.renderScheduler.request();
    }
    return used;
  }

  private handle(action: InputAction): boolean {
    if (isCanvasAction(action)) return this.canvasInputs[this.canvasInputs.length - 1]?.(action) ?? false;
    switch (action) {
      case 'prevTab':
        return this.pressPageButton('buttonZL');
      case 'nextTab':
        return this.pressPageButton('buttonZR');
      default:
        return this.pressPageButton(action);
    }
  }

  /** The newest screen handler for the button that uses the press. */
  private pressPageButton(button: PageButton): boolean {
    return this.pageButtons.filter((entry) => entry.button === button).reverse().some((entry) => entry.handler());
  }
}
