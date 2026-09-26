import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChampionsDex } from '@core/dex/champions-dex';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleConditions } from '@features/battle/components/battle-conditions/battle-conditions';
import { BattleControls } from '@features/battle/components/battle-controls/battle-controls';
import { BattleField } from '@features/battle/components/battle-field/battle-field';
import { BattleLog } from '@features/battle/components/battle-log/battle-log';
import { ReplayControls } from '@features/battle/components/replay-controls/replay-controls';
import { MockBattleConnection } from '@features/battle/mock/mock-battle-connection';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleStore } from '@features/battle/state/battle-store';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { BackAction } from '@shared/directives/back-action';

/** How long the forfeit confirmation waits for the second press. */
const FORFEIT_CONFIRM_MS = 4000;

/**
 * A doubles battle, for now against the mock server, or a replay from Showdown's replay server. The
 * left two thirds (853px) hold the field (third-generation style) with the command panel below it;
 * the right third (427px) holds a bar with the turn and Forfeit, the field conditions (weather,
 * terrain, Tailwind… with their turns left) and the battle log, Showdown style. Fills the layout's
 * 1280x644 content area. The battle itself lives in root services, so leaving this page doesn't end it.
 * Controller: L toggles Mega Evolution while choosing a move, R forfeits (pressed twice). A replay
 * swaps the command panel for playback controls and has nothing to forfeit.
 */
@Component({
  selector: 'app-battle-screen',
  imports: [BackAction, BattleConditions, BattleControls, BattleField, BattleLog, ReplayControls],
  host: { class: 'block h-[644px] w-[1280px]' },
  template: `
    <div class="relative h-[644px] w-[1280px]">
      <app-battle-field class="absolute top-0 left-0" />

      <div class="absolute top-[404px] left-0 h-[240px] w-[853px] bg-[#283040]">
        @if (store.replay()) {
          <app-replay-controls class="absolute top-[12px] left-[12px]" (appBack)="leaveReplay()" (again)="watchAgain()" (leave)="leaveReplay()" />
        } @else {
          <app-battle-controls
            class="absolute top-[12px] left-[12px]"
            (appBack)="choices.back()"
            (rematch)="start()"
            (leave)="leave()"
          />
        }
      </div>

      <div class="absolute top-0 left-[853px] h-[48px] w-[427px] bg-header">
        <span class="absolute top-[6px] left-[12px] block h-9 w-[160px] text-lg leading-9 font-bold text-white">
          {{ store.turn() > 0 ? 'Turn ' + store.turn() : 'Starting…' }}
        </span>
        @if (store.replay()) {
          <span class="absolute top-[12px] left-[315px] block h-6 w-[100px] rounded-sm bg-tab text-center text-sm leading-6 font-bold text-white">Replay</span>
        } @else if (!store.result()) {
          <!-- R does this on the controller, so the d-pad skips it (data-kb-skip); it's for clicks. -->
          <button
            type="button"
            data-kb-skip
            class="absolute top-[6px] left-[195px] h-9 w-[220px] rounded-md border text-sm font-bold text-white"
            [class]="confirmingForfeit() ? 'border-red-300 bg-red-800 hover:bg-red-700' : 'border-gray-400 bg-tab hover:bg-tab-hover'"
            (click)="forfeit()"
          >
            <span class="block h-[34px] text-center leading-[34px]"
              ><span class="rounded-sm bg-header p-[2px_6px] font-bold text-white">R</span>{{ confirmingForfeit() ? ' Again to forfeit' : ' Forfeit' }}</span
            >
          </button>
        }
      </div>
      <app-battle-conditions class="absolute top-[48px] left-[853px]" />
      <app-battle-log class="absolute top-[144px] left-[853px]" />
    </div>
  `,
})
export class BattleScreen {
  private readonly dex = inject(ChampionsDex);
  private readonly teams = inject(TeamStore);
  private readonly router = inject(Router);
  protected readonly store = inject(BattleStore);
  protected readonly choices = inject(BattleChoices);
  private readonly session = inject(BattleSession);

  protected readonly confirmingForfeit = signal(false);
  private forfeitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Opened from the lobby's Battle! button: a new battle. From the Battle tab: the one in progress.
    if (this.session.takeStartRequest()) this.start();

    const navigation = inject(KeyboardNavigation);
    const unregister = [
      navigation.registerButton('buttonL', () => this.toggleMega()),
      navigation.registerButton('buttonR', () => this.forfeit()),
    ];
    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      this.cancelForfeit();
    });
  }

  /** A new battle with the first team that has Pokémon (random Pokémon fill the rest). */
  protected start(): void {
    const team = this.teams.teams().find((t) => t.sets.length > 0);
    this.cancelForfeit();
    this.store.start(new MockBattleConnection(this.dex, 'Player', team?.sets ?? []));
  }

  /** L: only while the move buttons are shown and this Pokémon can Mega Evolve. */
  private toggleMega(): boolean {
    const choosingMove = this.choices.slot() !== null && !this.choices.pendingMove() && !this.choices.forceSwitch();
    if (!choosingMove || !this.choices.canMega()) return false;
    this.choices.toggleMega();
    return true;
  }

  /** The first press (R or a click) asks for confirmation, which lapses after a few seconds; the second forfeits. */
  protected forfeit(): boolean {
    if (this.store.result() || this.store.replay()) return false;
    if (!this.confirmingForfeit()) {
      this.confirmingForfeit.set(true);
      this.forfeitTimer = setTimeout(() => this.cancelForfeit(), FORFEIT_CONFIRM_MS);
      return true;
    }
    this.cancelForfeit();
    this.store.forfeit();
    return true;
  }

  private cancelForfeit(): void {
    if (this.forfeitTimer !== null) clearTimeout(this.forfeitTimer);
    this.forfeitTimer = null;
    this.confirmingForfeit.set(false);
  }

  /** The same replay again, from the start. */
  protected watchAgain(): void {
    const replay = this.store.replay();
    if (replay) this.store.start(new ReplayBattleConnection(replay));
  }

  /** Closes the replay (its tab goes away) and goes back to the list. */
  protected leaveReplay(): void {
    this.store.close();
    void this.router.navigateByUrl('/replays');
  }

  /** Closes the finished battle (its tab goes away) and goes home. */
  protected leave(): void {
    this.store.close();
    void this.router.navigateByUrl('/');
  }
}
