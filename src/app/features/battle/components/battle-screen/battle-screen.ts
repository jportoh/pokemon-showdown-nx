import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleConditions } from '@features/battle/components/battle-conditions/battle-conditions';
import { BattleControls } from '@features/battle/components/battle-controls/battle-controls';
import { BattleField } from '@features/battle/components/battle-field/battle-field';
import { BattleHeader, ForfeitState } from '@features/battle/components/battle-header/battle-header';
import { BattleLog } from '@features/battle/components/battle-log/battle-log';
import { BattleTeamPreview, SheetButton } from '@features/battle/components/battle-team-preview/battle-team-preview';
import { BattleTeamSelect } from '@features/battle/components/battle-team-select/battle-team-select';
import { BattleTeamsOverview } from '@features/battle/components/battle-team-select/battle-teams-overview';
import { BattleTeamSheet } from '@features/battle/components/battle-team-sheet/battle-team-sheet';
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
 * shows or hides the opponent's open team sheet (formats that have one; where both players must agree to them,
 * the first press agrees), ZR shows or hides the battle log (B hides
 * either too), R3 turns the battle timer on or off (real battles). A replay swaps the command panel for playback
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
    BattleTeamSelect,
    BattleTeamsOverview,
    BattleTeamSheet,
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
      <!-- Its tiles can be pointed at, to see what's known of them: B there goes back to the command panel (to its button, watching live). -->
      <app-battle-team-preview class="absolute top-[56px] left-[1003px]" side="p2" [sheet]="sheetButton()" [sheetOpen]="sheetOpen()" (toggleSheet)="pressSheet()" (appBack)="leaveOpponentTeam()" />
      <app-battle-conditions class="absolute top-[265px] left-[1003px]" of="p2" />
      <app-battle-conditions class="absolute top-[350px] left-[1003px]" of="field" />
      <app-battle-conditions class="absolute top-[435px] left-[1003px]" of="p1" />
      <!-- Our tiles pick switches: B there works as in the command panel. -->
      <app-battle-team-preview #ownTeam class="absolute top-[520px] left-[1003px]" side="p1" (appBack)="back()" />

      <!-- Team preview: picking the Pokémon to bring, over everything under the header while the server asks. -->
      <app-battle-team-select
        #teamSelect
        class="absolute top-[48px] left-0"
        [sheet]="sheetButton()"
        (sheetPressed)="pressSheet()"
        (appBack)="teamSelect.undo()"
      />

      <!-- Watching live: both teams while the players pick theirs, over the field and the side column. -->
      <app-battle-teams-overview class="absolute top-[48px] left-0" />

      <!-- Always mounted and hidden while closed (removing it left its text painted on the console). -->
      <app-battle-log class="absolute top-[48px] left-[582px]" [open]="logOpen()" (appBack)="closeLog()" />
      <!-- The opponent's open team sheet over the whole field, likewise always mounted. -->
      <app-battle-team-sheet class="absolute top-[48px] left-[12px]" [open]="sheetOpen()" (appBack)="closeSheet()" />

      <!--
        Until the server has the battle going (team preview, or its start), in place of an empty field. Battles
        normally open once they have something to show (see BattleRooms): this covers one slow to.
      -->
      @if (joining()) {
        <div role="status" class="absolute top-0 left-0 block h-[720px] w-[1280px] bg-header">
          <p class="absolute top-[330px] left-0 block h-[60px] w-[1280px] text-center text-4xl leading-[60px] font-bold">Joining battle…</p>
        </div>
      }
    </div>
  `,
})
export class BattleScreen {
  private readonly router = inject(Router);
  protected readonly store = inject(BattleStore);
  private readonly spectatorControls = viewChild(SpectatorControls);
  private readonly controls = viewChild(BattleControls);
  private readonly ownTeam = viewChild<BattleTeamPreview>('ownTeam');
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
    // The next battle is on its way: it takes this one's place once it has something to show.
    if (this.nextJoining()) return { can: true, label: 'Joining battle…', note: '' };
    // A game of a best-of set: its place goes to getting ready for the next game, until the set is over.
    const series = this.store.series();
    if (series) {
      if (series.over) return { can: false, label: '', note: '' };
      const next = series.game + 1;
      return this.store.ready() === 'waiting'
        ? { can: true, label: 'Waiting for opponent…', note: `You're ready for game ${next}. It starts once both are, or in 40 seconds.` }
        : { can: true, label: `Ready for game ${next}`, note: 'The next game starts by itself in 40 seconds.' };
    }
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

  /** Over, with the next battle (a rematch, the set's next game) accepted or opening. */
  private readonly nextJoining = computed(() => !!this.store.result() && (!!this.challenges.accepted() || this.rooms.joining()));

  /** The opponent's challenge to a rematch in this battle's format, if they've sent one. */
  private readonly theirRematch = computed(() => {
    const room = this.liveRoom();
    const opponent = toId(this.store.sides().p2.name);
    const format = room && roomFormat(room);
    return this.challenges.incoming().find((c) => c.fromId === opponent && c.format === format && !c.needsTeam) ?? null;
  });

  /**
   * Our battle's room is open but nothing has come to show yet: no team preview (its teams, even once
   * we've picked and the request is gone), no start, no request.
   */
  protected readonly joining = computed(
    () =>
      !!this.liveRoom() &&
      !this.store.teamPreview() &&
      !this.store.intro() &&
      !this.store.started() &&
      !this.store.request() &&
      !this.store.result(),
  );

  protected readonly forfeitState = signal<ForfeitState>('idle');
  private forfeitTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly logOpen = signal(false);
  /** Where focus was when the log or the team sheet opened (they take it), to give it back on closing. */
  private focusBeforeLog: HTMLElement | null = null;

  protected readonly sheetOpen = signal(false);
  /** What ZL does: shows the opponent's open team sheet once it's here, or agrees to them while offered. */
  protected readonly sheetButton = computed((): SheetButton | null => {
    if (this.store.teamSheets().p2) return 'sheet';
    const offer = this.store.sheetOffer();
    return offer === 'offered' ? 'accept' : offer === 'accepted' ? 'waiting' : null;
  });

  constructor() {
    // After a ladder match or an accepted challenge: the real battle in its server room. From the list
    // of live battles: that battle, as a spectator.
    const request = this.session.takeStartRequest();
    if (request?.kind === 'live') {
      this.startLive(request.roomId);
    } else if (request?.kind === 'spectate') {
      this.store.start(new SpectateBattleConnection(this.rooms, request.roomId));
    }
    // A rematch accepted (theirs or ours), or the next game of a best-of set, opens its room while this
    // battle is still on screen (App only opens battles when none is): it takes this one's place.
    const rematches = this.rooms.started.subscribe((roomId) => {
      if (this.liveRoom() && this.store.result()) this.startLive(roomId);
    });

    const unregister = [
      this.navigation.registerButton('buttonL', () => this.toggleMegaOrTera()),
      this.navigation.registerButton('buttonR', () => this.forfeit()),
      this.navigation.registerButton('buttonZL', () => this.pressSheet()),
      this.navigation.registerButton('buttonZR', () => this.toggleLog()),
      this.navigation.registerButton('buttonR3', () => this.toggleTimer()),
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
    // A new game (a rematch, the next of a set) brings its own team sheet.
    if (this.sheetOpen()) this.closeSheet();
    this.store.start(new ShowdownBattleConnection(this.rooms, roomId, this.login.userId()));
  }

  /** The end's Rematch button (see rematchView), or Ready between the games of a set. */
  protected rematch(): void {
    const room = this.liveRoom();
    if (!room || this.nextJoining()) return;
    const series = this.store.series();
    if (series) {
      // As the server's own button does, from the game's room to the set's.
      if (!series.over && this.store.ready() !== 'waiting') this.rooms.send(room, `/msgroom ${series.roomId},/confirmready`);
      return;
    }
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

  /**
   * B on the opponent's tiles: back to the command panel's first choice (the first move), or to the
   * first Pokémon that can come in on a forced switch. Watching live, to the way out.
   */
  protected leaveOpponentTeam(): void {
    if (this.store.spectating()) {
      this.spectatorControls()?.focusLeave();
      return;
    }
    if (!this.controls()?.focusFirst()) this.ownTeam()?.focusFirstSwitch();
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

  /** R3 or the header's timer button: asks the server for the battle timer on or off (real battles only). */
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
      if (this.sheetOpen()) this.closeSheet();
      this.focusBeforeLog = this.navigation.focused();
      this.logOpen.set(true);
    }
    return true;
  }

  /** ZL or the opponent's card's button: agrees to open team sheets, or shows or hides the opponent's. */
  protected pressSheet(): boolean {
    const button = this.sheetButton();
    if (button === 'accept') this.store.acceptTeamSheets();
    else if (button === 'sheet') this.toggleSheet();
    return button !== null;
  }

  /** Shows the opponent's team sheet (which takes focus) or hides it. */
  private toggleSheet(): boolean {
    if (this.sheetOpen()) {
      this.closeSheet();
    } else {
      if (this.logOpen()) this.closeLog();
      this.focusBeforeLog = this.navigation.focused();
      this.sheetOpen.set(true);
    }
    return true;
  }

  /** Hides the team sheet, giving focus back to where it was if that control is still there. */
  protected closeSheet(): void {
    this.sheetOpen.set(false);
    const previous = this.focusBeforeLog;
    this.focusBeforeLog = null;
    if (previous?.isConnected) this.navigation.focus(previous);
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
