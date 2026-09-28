import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleConditions } from '@features/battle/components/battle-conditions/battle-conditions';
import { BattleControls } from '@features/battle/components/battle-controls/battle-controls';
import { BattleField } from '@features/battle/components/battle-field/battle-field';
import { BattleHeader, ForfeitState } from '@features/battle/components/battle-header/battle-header';
import { BattleLog } from '@features/battle/components/battle-log/battle-log';
import { BattleTeamPreview } from '@features/battle/components/battle-team-preview/battle-team-preview';
import { ReplayControls } from '@features/battle/components/replay-controls/replay-controls';
import { ShowdownBattleConnection } from '@features/battle/live/showdown-battle-connection';
import { SpectateBattleConnection } from '@features/battle/live/spectate-battle-connection';
import { SpectatorControls } from '@features/battle/components/spectator-controls/spectator-controls';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleStore } from '@features/battle/state/battle-store';
import { BattleRooms } from '@features/connection/battle-rooms';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { BackAction } from '@shared/directives/back-action';
import { toId } from '@shared/utils/to-id';

/** How long the forfeit confirmation waits for the second press. */
const FORFEIT_CONFIRM_MS = 4000;

/**
 * A battle (doubles, or singles with one Pokémon a side) against a real player on Showdown (a ladder
 * match, a challenge we accepted), a live battle watched as a spectator, or a replay
 * from Showdown's replay server. It takes the whole 1280x720 stage (no app header: a battle can't be
 * left until it's over). Along the top, the match header (players, format, turn, Forfeit, the battle log's button). Below it on the
 * left, framed by a 12px strip, the battle box: the field (third-generation style, 985x500) and the
 * command panel (172px tall). On the right, a 283px column mirroring the field: the opponent's team,
 * its side's conditions, the field's (weather, terrain, rooms… with their turns left), the player's
 * side's and the player's team. The battle log shows over the field's right part only on request
 * (hidden, not removed: see BattleLog). The battle itself lives in root services.
 * Controller: L toggles Mega Evolution (or Terastallization) while choosing a move, R forfeits (pressed twice), ZL
 * turns the battle timer on or off (real battles), ZR shows or hides the battle log (B hides it too). A replay swaps the command panel for playback
 * controls and has nothing to forfeit.
 */
@Component({
  selector: 'app-battle-screen',
  imports: [
    BackAction,
    BattleConditions,
    BattleControls,
    BattleField,
    BattleHeader,
    BattleLog,
    BattleTeamPreview,
    ReplayControls,
    SpectatorControls,
  ],
  host: { class: 'block h-[720px] w-[1280px] bg-header' },
  template: `
    <div class="relative h-[720px] w-[1280px]">
      <app-battle-header
        class="absolute top-0 left-0"
        [forfeitState]="forfeitState()"
        [logOpen]="logOpen()"
        (forfeit)="forfeit()"
        (toggleLog)="toggleLog()"
        (toggleTimer)="toggleTimer()"
      />

      <app-battle-field class="absolute top-[48px] left-[12px]" />

      <div class="absolute top-[548px] left-[12px] h-[172px] w-[985px] bg-[#283040]">
        @if (store.replay()) {
          <app-replay-controls class="absolute top-[12px] left-[12px]" (appBack)="leaveReplay()" (again)="watchAgain()" (leave)="leaveReplay()" />
        } @else if (store.spectating()) {
          <app-spectator-controls class="absolute top-[12px] left-[12px]" (appBack)="leaveLive()" (leave)="leaveLive()" />
        } @else {
          <app-battle-controls
            class="absolute top-[12px] left-[12px]"
            (appBack)="back()"
            [canRematch]="rematchView().can"
            [rematchLabel]="rematchView().label"
            [rematchNote]="rematchView().note"
            (rematch)="rematch()"
            (leave)="leave()"
          />
        }
      </div>

      <!-- From 8px under the header to the bottom of the command buttons (708). -->
      <!-- Watching live, both teams' tiles can be pointed at (see SpectatorControls): B there goes back to its button. -->
      <app-battle-team-preview class="absolute top-[56px] left-[1003px]" side="p2" (appBack)="back()" />
      <app-battle-conditions class="absolute top-[265px] left-[1003px]" of="p2" />
      <app-battle-conditions class="absolute top-[350px] left-[1003px]" of="field" />
      <app-battle-conditions class="absolute top-[435px] left-[1003px]" of="p1" />
      <!-- Our tiles pick switches: B there works as in the command panel. -->
      <app-battle-team-preview class="absolute top-[520px] left-[1003px]" side="p1" (appBack)="back()" />

      <!-- Always mounted and hidden while closed (removing it left its text painted on the console). -->
      <app-battle-log class="absolute top-[48px] left-[582px]" [open]="logOpen()" (appBack)="closeLog()" />
    </div>
  `,
})
export class BattleScreen {
  private readonly router = inject(Router);
  protected readonly store = inject(BattleStore);
  private readonly spectatorControls = viewChild(SpectatorControls);
  protected readonly choices = inject(BattleChoices);
  private readonly session = inject(BattleSession);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly rooms = inject(BattleRooms);
  private readonly login = inject(ShowdownLogin);
  private readonly challenges = inject(ShowdownChallenges);

  /** The real battle's server room (a ladder match or an accepted challenge); null for replays and spectating. */
  private readonly liveRoom = signal<string | null>(null);
  /** A rematch was asked for since this battle started: only then do challenge errors show here. */
  private readonly rematchAsked = signal(false);

  /**
   * The end's Rematch button, in a real battle (random formats only: a challenge can't carry a team
   * yet): a challenge to the same player in the same format, or
   * accepting theirs if they asked first; while ours waits, the button cancels it.
   */
  protected readonly rematchView = computed(() => {
    const room = this.liveRoom();
    if (!room) return { can: false, label: '', note: '' };
    const format = roomFormat(room);
    const opponent = this.store.sides().p2.name;
    if (!format?.includes('random') || !opponent) return { can: false, label: '', note: '' };
    if (this.challenges.outgoing()?.toId === toId(opponent)) {
      return { can: true, label: 'Cancel rematch', note: this.challenges.error() ?? `Waiting for ${opponent} to accept the rematch…` };
    }
    if (this.theirRematch()) return { can: true, label: 'Accept rematch', note: `${opponent} wants a rematch!` };
    const error = this.rematchAsked() ? this.challenges.error() : null;
    return { can: true, label: 'Rematch', note: error ?? '' };
  });

  /** The opponent's challenge to a rematch in this battle's format, if they've sent one. */
  private readonly theirRematch = computed(() => {
    const room = this.liveRoom();
    const opponent = toId(this.store.sides().p2.name);
    const format = room && roomFormat(room);
    return this.challenges.incoming().find((c) => c.fromId === opponent && c.format === format && !c.needsTeam) ?? null;
  });

  protected readonly forfeitState = signal<ForfeitState>('idle');
  private forfeitTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly logOpen = signal(false);
  /** Where focus was when the log opened (the log takes it), to give it back on closing. */
  private focusBeforeLog: HTMLElement | null = null;

  constructor() {
    // After a ladder match or an accepted challenge: the real battle in its server room. From the list
    // of live battles: that battle, as a spectator.
    const request = this.session.takeStartRequest();
    if (request?.kind === 'live') {
      this.startLive(request.roomId);
    } else if (request?.kind === 'spectate') {
      this.store.start(new SpectateBattleConnection(this.rooms, request.roomId));
    }
    // A rematch accepted (theirs or ours) opens its room while this battle is still on screen (App only
    // opens battles when none is): it takes this one's place.
    const rematches = this.rooms.started.subscribe((roomId) => {
      if (this.liveRoom() && this.store.result()) this.startLive(roomId);
    });

    const unregister = [
      this.navigation.registerButton('buttonL', () => this.toggleMegaOrTera()),
      this.navigation.registerButton('buttonR', () => this.forfeit()),
      this.navigation.registerButton('buttonZL', () => this.toggleTimer()),
      this.navigation.registerButton('buttonZR', () => this.toggleLog()),
    ];
    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      rematches.unsubscribe();
      this.cancelForfeit();
    });
  }

  /** The real battle in a server room (an accepted challenge or rematch). */
  private startLive(roomId: string): void {
    this.liveRoom.set(roomId);
    this.rematchAsked.set(false);
    this.cancelForfeit();
    this.store.start(new ShowdownBattleConnection(this.rooms, roomId, this.login.userId()));
  }

  /** The end's Rematch button (see rematchView). */
  protected rematch(): void {
    const room = this.liveRoom();
    if (!room) return;
    const format = roomFormat(room);
    const opponent = this.store.sides().p2.name;
    const theirs = this.theirRematch();
    if (!format || !opponent) return;
    if (this.challenges.outgoing()) this.challenges.cancelChallenge();
    else if (theirs) this.challenges.accept(theirs);
    else {
      this.rematchAsked.set(true);
      this.challenges.challenge(opponent, format);
    }
  }

  /**
   * B: takes back the choices sent while the opponent is still choosing, or steps back while choosing.
   * At the end, it withdraws the rematch waiting for an answer. Watching live, it leaves the team
   * tiles for the way out.
   */
  protected back(): void {
    if (this.store.spectating()) {
      this.spectatorControls()?.focusLeave();
      return;
    }
    if (this.store.result()) this.challenges.cancelChallenge();
    else if (this.store.canUndo()) this.store.undo();
    else this.choices.back();
  }

  /** L: only while the move buttons are shown and this Pokémon can Mega Evolve or Terastallize. */
  private toggleMegaOrTera(): boolean {
    const choosingMove = this.choices.slot() !== null && !this.choices.pendingMove() && !this.choices.forceSwitch();
    if (!choosingMove) return false;
    if (this.choices.canMega()) this.choices.toggleMega();
    else if (this.choices.teraType()) this.choices.toggleTera();
    else return false;
    return true;
  }

  /**
   * The first press (R or a click) asks for confirmation, which lapses after a few seconds; the second
   * forfeits. Further presses do nothing while the server ends the battle.
   */
  protected forfeit(): boolean {
    if (this.store.result() || this.store.watching()) return false;
    if (this.forfeitState() === 'forfeiting') return true;
    if (this.forfeitState() === 'idle') {
      this.forfeitState.set('confirming');
      this.forfeitTimer = setTimeout(() => this.cancelForfeit(), FORFEIT_CONFIRM_MS);
      return true;
    }
    this.cancelForfeit();
    this.forfeitState.set('forfeiting');
    this.store.forfeit();
    return true;
  }

  private cancelForfeit(): void {
    if (this.forfeitTimer !== null) clearTimeout(this.forfeitTimer);
    this.forfeitTimer = null;
    this.forfeitState.set('idle');
  }

  /** ZL or the header's timer button: asks the server for the battle timer on or off (real battles only). */
  protected toggleTimer(): boolean {
    if (!this.store.canToggleTimer() || this.store.result()) return false;
    this.store.toggleTimer();
    return true;
  }

  /** ZR or the button: shows the log (which takes focus) or hides it. */
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

  /** Stops watching the live battle (leaving its room) and goes back to the list of live battles. */
  protected leaveLive(): void {
    this.store.close();
    void this.router.navigateByUrl('/live');
  }

  /** Closes the finished battle (so the page can be left) and goes back to the Battle page; a rematch waiting is withdrawn. */
  protected leave(): void {
    this.challenges.cancelChallenge();
    this.store.close();
    void this.router.navigateByUrl('/play');
  }
}

/** "battle-gen9randombattle-2345678" → "gen9randombattle". */
function roomFormat(roomId: string): string | null {
  return /^battle-([a-z0-9]+)-\d+/.exec(roomId)?.[1] ?? null;
}
