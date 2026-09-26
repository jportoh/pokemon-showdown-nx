import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChampionsDex } from '@core/dex/champions-dex';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleConditions } from '@features/battle/components/battle-conditions/battle-conditions';
import { BattleControls } from '@features/battle/components/battle-controls/battle-controls';
import { BattleField } from '@features/battle/components/battle-field/battle-field';
import { BattleHeader } from '@features/battle/components/battle-header/battle-header';
import { BattleLog } from '@features/battle/components/battle-log/battle-log';
import { BattleTeamPreview } from '@features/battle/components/battle-team-preview/battle-team-preview';
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
 * A doubles battle, for now against the mock server, or a replay from Showdown's replay server. It
 * takes the whole 1280x720 stage (no app header: a battle can't be left until it's over). Along the
 * top, the match header (players, format, turn, Forfeit, the battle log's button). Below it on the
 * left, framed by a 12px strip, the battle box: the field (third-generation style, 985x500) and the
 * command panel (172px tall). On the right, a 283px column mirroring the field: the opponent's team,
 * its side's conditions, the field's (weather, terrain, rooms… with their turns left), the player's
 * side's and the player's team. The battle log shows over the field's right part only on request
 * (hidden, not removed: see BattleLog). The battle itself lives in root services.
 * Controller: L toggles Mega Evolution while choosing a move, R forfeits (pressed twice), ZL or ZR
 * shows or hides the battle log (B hides it too). A replay swaps the command panel for playback
 * controls and has nothing to forfeit.
 */
@Component({
  selector: 'app-battle-screen',
  imports: [BackAction, BattleConditions, BattleControls, BattleField, BattleHeader, BattleLog, BattleTeamPreview, ReplayControls],
  host: { class: 'block h-[720px] w-[1280px] bg-header' },
  template: `
    <div class="relative h-[720px] w-[1280px]">
      <app-battle-header
        class="absolute top-0 left-0"
        [confirmingForfeit]="confirmingForfeit()"
        [logOpen]="logOpen()"
        (forfeit)="forfeit()"
        (toggleLog)="toggleLog()"
      />

      <app-battle-field class="absolute top-[48px] left-[12px]" />

      <div class="absolute top-[548px] left-[12px] h-[172px] w-[985px] bg-[#283040]">
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

      <!-- From 8px under the header to the bottom of the command buttons (708). -->
      <app-battle-team-preview class="absolute top-[56px] left-[1003px]" side="p2" />
      <app-battle-conditions class="absolute top-[265px] left-[1003px]" of="p2" />
      <app-battle-conditions class="absolute top-[350px] left-[1003px]" of="field" />
      <app-battle-conditions class="absolute top-[435px] left-[1003px]" of="p1" />
      <app-battle-team-preview class="absolute top-[520px] left-[1003px]" side="p1" />

      <!-- Always mounted and hidden while closed (removing it left its text painted on the console). -->
      <app-battle-log class="absolute top-[48px] left-[582px]" [open]="logOpen()" (appBack)="closeLog()" />
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
  private readonly navigation = inject(KeyboardNavigation);

  protected readonly confirmingForfeit = signal(false);
  private forfeitTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly logOpen = signal(false);
  /** Where focus was when the log opened (the log takes it), to give it back on closing. */
  private focusBeforeLog: HTMLElement | null = null;

  constructor() {
    // Opened from the lobby's Battle! button: a new battle. From the replay list: the replay it started.
    if (this.session.takeStartRequest()) this.start();

    const unregister = [
      this.navigation.registerButton('buttonL', () => this.toggleMega()),
      this.navigation.registerButton('buttonR', () => this.forfeit()),
      this.navigation.registerButton('buttonZL', () => this.toggleLog()),
      this.navigation.registerButton('buttonZR', () => this.toggleLog()),
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

  /** ZL, ZR or the button: shows the log (which takes focus) or hides it. */
  protected toggleLog(): boolean {
    if (this.logOpen()) {
      this.closeLog();
    } else {
      this.focusBeforeLog = this.navigation.focused();
      this.logOpen.set(true);
    }
    return true;
  }

  /** Hides the log, giving focus back to where it was if that control is still there. */
  protected closeLog(): void {
    this.logOpen.set(false);
    const previous = this.focusBeforeLog;
    this.focusBeforeLog = null;
    if (previous?.isConnected) this.navigation.focus(previous);
  }

  /** The same replay again, from the start. */
  protected watchAgain(): void {
    const replay = this.store.replay();
    if (replay) this.store.start(new ReplayBattleConnection(replay));
  }

  /** Closes the replay (so the page can be left) and goes back to the list. */
  protected leaveReplay(): void {
    this.store.close();
    void this.router.navigateByUrl('/replays');
  }

  /** Closes the finished battle (so the page can be left) and goes home. */
  protected leave(): void {
    this.store.close();
    void this.router.navigateByUrl('/');
  }
}
