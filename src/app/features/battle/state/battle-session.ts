import { Service, signal } from '@angular/core';

/** What the battle page should open: a battle against the mock server, or a real one in a server room. */
export type BattleStart = { kind: 'mock'; format: string } | { kind: 'live'; roomId: string };

/**
 * Whether a battle is open, for the /battle route (which can't be left while one is). Kept
 * apart from BattleStore (which needs the game data) so the router and the lobby stay light: the
 * battle code only loads with the battle page.
 */
@Service()
export class BattleSession {
  private readonly activeSignal = signal(false);
  /** The battle the page should start; null when none was asked for. */
  private startRequested: BattleStart | null = null;

  /** A battle is open (in progress or finished but not closed yet). */
  readonly active = this.activeSignal.asReadonly();

  /** Asks the battle page to start a new battle against the mock in a format (its ID) when it opens. */
  requestStart(format: string): void {
    this.startRequested = { kind: 'mock', format };
  }

  /** Asks the battle page to show the real battle in a server room when it opens. */
  requestLive(roomId: string): void {
    this.startRequested = { kind: 'live', roomId };
  }

  /** The battle the page should start, if any (used once). */
  takeStartRequest(): BattleStart | null {
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
