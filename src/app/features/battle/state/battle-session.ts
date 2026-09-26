import { Service, signal } from '@angular/core';

/**
 * Whether there's a battle to go back to, for the header's Battle tab and the /battle route. Kept
 * apart from BattleStore (which needs the game data) so the header and the lobby stay light: the
 * battle code only loads with the battle page.
 */
@Service()
export class BattleSession {
  private readonly activeSignal = signal(false);
  private startRequested = false;

  /** A battle is open (in progress or finished but not closed yet). */
  readonly active = this.activeSignal.asReadonly();

  /** Asks the battle page to start a new battle when it opens. */
  requestStart(): void {
    this.startRequested = true;
  }

  /** Whether the page should start a battle (used once). */
  takeStartRequest(): boolean {
    const requested = this.startRequested;
    this.startRequested = false;
    return requested;
  }

  /** Whether /battle has anything to show. */
  canOpen(): boolean {
    return this.activeSignal() || this.startRequested;
  }

  setActive(active: boolean): void {
    this.activeSignal.set(active);
  }
}
