import { Service, signal } from '@angular/core';

/**
 * Whether a battle is open, for the /battle route (which can't be left while one is). Kept
 * apart from BattleStore (which needs the game data) so the router and the lobby stay light: the
 * battle code only loads with the battle page.
 */
@Service()
export class BattleSession {
  private readonly activeSignal = signal(false);
  /** The format of the battle the page should start; null when none was asked for. */
  private startRequested: string | null = null;

  /** A battle is open (in progress or finished but not closed yet). */
  readonly active = this.activeSignal.asReadonly();

  /** Asks the battle page to start a new battle in a format (its ID) when it opens. */
  requestStart(format: string): void {
    this.startRequested = format;
  }

  /** The format of the battle the page should start, if any (used once). */
  takeStartRequest(): string | null {
    const requested = this.startRequested;
    this.startRequested = null;
    return requested;
  }

  /** Whether /battle has anything to show. */
  canOpen(): boolean {
    return this.activeSignal() || this.startRequested !== null;
  }

  setActive(active: boolean): void {
    this.activeSignal.set(active);
  }
}
