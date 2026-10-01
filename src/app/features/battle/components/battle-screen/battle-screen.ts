import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { GlBattleScreen } from '@features/battle/components/gl-battle-screen/gl-battle-screen';
import { ShowdownBattleConnection } from '@features/battle/live/showdown-battle-connection';
import { SpectateBattleConnection } from '@features/battle/live/spectate-battle-connection';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import { ForfeitState } from '@features/battle/gl/screen/header-view';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleStore } from '@features/battle/state/battle-store';
import { BattleRooms } from '@features/connection/battle-rooms';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { toId } from '@shared/utils/to-id';

/** How long the forfeit confirmation waits for the second press. */
const FORFEIT_CONFIRM_MS = 4000;

/**
 * A battle (doubles, or singles with one Pokémon a side) against a real player on Showdown (a ladder
 * match, a challenge we accepted), a live battle watched as a spectator, or a replay from Showdown's
 * replay server. It takes the whole 1280x720 stage (no app header: a battle can't be left until it's
 * over), drawn on one WebGL canvas (GlBattleScreen: header, field, the right column with both teams
 * and the conditions, the command panel, and the log, team sheet and team preview over them). This
 * component starts the battle and owns what lies beyond the screen: the forfeit's confirmation, the
 * rematch or the next game of a set, leaving. The battle itself lives in root services.
 * Controller: L toggles Mega Evolution (or Terastallization) while choosing a move, R forfeits (pressed
 * twice), R3 turns the battle timer on or off (real battles); ZL (the opponent's open team sheet) and
 * ZR (the battle log) are the canvas screen's.
 */
@Component({
  selector: 'app-battle-screen',
  imports: [GlBattleScreen],
  template: `
    <app-gl-battle-screen
      [forfeitState]="forfeitState()"
      [canRematch]="rematchView().can"
      [rematchLabel]="rematchView().label"
      [rematchNote]="rematchView().note"
      [joining]="joining()"
      (again)="watchAgain()"
      (leaveReplay)="leaveReplay()"
      (leaveLive)="leaveLive()"
      (rematch)="rematch()"
      (leave)="leave()"
      (back)="back()"
      (forfeit)="forfeit()"
      (toggleTimer)="toggleTimer()"
    />
  `,
})
export class BattleScreen {
  private readonly router = inject(Router);
  protected readonly store = inject(BattleStore);
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
   * B (from the canvas screen, with nothing of its own to close): takes back the choices sent while
   * the opponent is still choosing, or steps back while choosing. At the end, it withdraws the
   * rematch waiting for an answer.
   */
  protected back(): void {
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

  /** R3 or the header's timer button: asks the server for the battle timer on or off (real battles only). */
  protected toggleTimer(): boolean {
    if (!this.store.canToggleTimer() || this.store.result()) return false;
    this.store.toggleTimer();
    return true;
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
