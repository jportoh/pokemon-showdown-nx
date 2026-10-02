import { Rgba, rgba } from '@core/gl/gl-renderer';
import { PageButton } from '@core/input/console-keys';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';

/** How long the button is held to confirm, and how fast the fill drains back when let go. */
const HOLD_MS = 1200;
const DRAIN_MS = 250;

/** The fill of a button being held: a deep red that keeps white text readable (5.6:1). */
export const HOLD_FILL: Rgba = rgba('#c62828');

/**
 * A button held down to confirm what can't be undone (deleting a team, removing a Pokémon,
 * forfeiting, disconnecting), instead of asking twice: `progress` fills while it's held and drains
 * back when let go. Once full, the button is swallowed until it's let go, so the same hold can't
 * go on to delete what comes next.
 * The screen calls press() from the button's handler and step() every frame.
 */
export class HoldAction {
  private hold: { since: number | null } | null = null;
  private drain: { from: number; at: number } | null = null;
  private filled = 0;

  constructor(
    private readonly navigation: KeyboardNavigation,
    private readonly button: PageButton,
  ) {}

  /** How full it is, 0 to 1 (for the button's fill). */
  get progress(): number {
    return this.filled;
  }

  /** The button went down: it starts filling (from where it is, if it was draining). */
  press(): void {
    this.hold ??= { since: null };
  }

  /** Empty at once (another screen, another team). */
  reset(): void {
    this.hold = null;
    this.drain = null;
    this.filled = 0;
  }

  /**
   * Fills while the button is held and `allowed`, drains otherwise. True on the frame it fills up:
   * the caller runs the action then.
   */
  step(now: number, allowed = true): boolean {
    const hold = this.hold;
    if (hold && allowed && this.navigation.isHeld(this.button)) {
      hold.since ??= now - this.filled * HOLD_MS;
      this.drain = null;
      this.filled = Math.min(1, (now - hold.since) / HOLD_MS);
      if (this.filled < 1) return false;
      this.reset();
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
}
