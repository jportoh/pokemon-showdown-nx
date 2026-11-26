import { Rgba, rgba } from '@core/gl/gl-renderer';
import { PageButton } from '@core/input/console-keys';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';

/** How long the button is held to confirm, and how fast the fill drains back when let go. */
const HOLD_MS = 1200;
const DRAIN_MS = 250;
/** Where the screen tells only a finger's lift: how long the first tap waits for the second, half full. */
const ARMED_MS = 2500;
const ARMED_FILL = 0.5;

/** The fill of a button being held: a deep red that keeps white text readable (5.6:1). */
export const HOLD_FILL: Rgba = rgba('#c62828');
/** The fill of a held button that agrees to something for good (accepting open team sheets): green (5.1:1 with white). */
export const ACCEPT_FILL: Rgba = rgba('#2e7d32');

/**
 * A button held down to confirm what can't be undone (deleting a team, removing a Pokémon,
 * forfeiting, disconnecting), instead of asking twice: `progress` fills while it's held and drains
 * back when let go. Once full, the button is swallowed until it's let go, so the same hold can't
 * go on to delete what comes next.
 * The screen calls press() from the button's handler and step() every frame.
 *
 * Pressed with a tap, it fills while the finger stays on the screen. A screen that tells only a
 * finger's lift (no press) can't be held: there the first tap fills it halfway and a second tap
 * within ARMED_MS confirms.
 */
export class HoldAction {
  /** The hold under way: since when it fills, and whether a finger holds it (not the button). */
  private hold: { since: number | null; finger: boolean } | null = null;
  private drain: { from: number; at: number } | null = null;
  private filled = 0;
  /** Lifts only: until when the first tap waits for the second (0: not armed). */
  private armedUntil = 0;
  /** Lifts only: the second tap came, so the next step confirms. */
  private confirmed = false;

  constructor(
    private readonly navigation: KeyboardNavigation,
    /** The button held: a page button, or A (a focused row confirmed by holding A on it). */
    private readonly button: PageButton | 'accept',
  ) {}

  /** How full it is, 0 to 1 (for the button's fill). */
  get progress(): number {
    return this.filled;
  }

  /** The button went down (or a finger on it): it starts filling (from where it is, if it was draining). */
  press(): void {
    const tap = this.navigation.fromTap();
    if (tap && !this.navigation.pointer?.pressing) {
      // A tap already lifted: arm it, or confirm the armed one.
      const now = performance.now();
      if (now < this.armedUntil) this.confirmed = true;
      else this.armedUntil = now + ARMED_MS;
      return;
    }
    this.hold ??= { since: null, finger: tap };
  }

  /** Empty at once (another screen, another team). */
  reset(): void {
    this.hold = null;
    this.drain = null;
    this.filled = 0;
    this.armedUntil = 0;
    this.confirmed = false;
  }

  /**
   * Fills while the button (or the finger) is held and `allowed`, drains otherwise. True on the frame
   * it fills up: the caller runs the action then.
   */
  step(now: number, allowed = true): boolean {
    if (this.armedUntil > 0) return this.stepArmed(now, allowed);
    const hold = this.hold;
    const down = hold !== null && (hold.finger ? this.navigation.pointer?.pressing === true : this.navigation.isHeld(this.button));
    if (hold && allowed && down) {
      hold.since ??= now - this.filled * HOLD_MS;
      this.drain = null;
      this.filled = Math.min(1, (now - hold.since) / HOLD_MS);
      if (this.filled < 1) return false;
      this.reset();
      // Swallows the button until it's let go (a finger's lift makes no tap after a hold) and thuds.
      this.navigation.consume(this.button);
      return true;
    }
    if (hold) {
      this.hold = null;
      if (this.filled > 0) this.drain = { from: this.filled, at: now };
    }
    const drain = this.drain;
    if (drain) {
      this.filled = Math.max(0, drain.from - (now - drain.at) / DRAIN_MS);
      if (this.filled === 0) this.drain = null;
    }
    return false;
  }

  /** Lifts only: half full while it waits for the second tap; it confirms then, or drains when the wait is over. */
  private stepArmed(now: number, allowed: boolean): boolean {
    if (this.confirmed && allowed) {
      this.reset();
      this.navigation.consume(this.button);
      return true;
    }
    if (!allowed || now >= this.armedUntil) {
      this.armedUntil = 0;
      this.confirmed = false;
      this.drain = { from: this.filled, at: now };
      return false;
    }
    this.filled = ARMED_FILL;
    return false;
  }
}
