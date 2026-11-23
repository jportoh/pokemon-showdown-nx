import { Service, computed, inject, signal } from '@angular/core';
import { BattleMusic } from '@core/audio/battle-music';
import { ChampionsDex } from '@core/dex/champions-dex';
import { moveInfo, moveType } from '@core/dex/moves';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { splitLine } from '@features/connection/showdown-protocol';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import {
  BattleConnection,
  BattleFieldState,
  FieldCondition,
  EffectPopup,
  HpChange,
  StatChange,
  StatusChange,
  FieldEvent,
  GameType,
  MoveAction,
  BattleLogEntry,
  RatingChange,
  BattlePokemon,
  BattleRequest,
  BattleSide,
  BattleTimer,
  Replay,
  RequestActive,
  RequestPokemon,
  SideId,
  Volatile,
} from '@features/battle/models/battle';
import { spriteId, spriteSetOf } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';
import { BattleSession } from './battle-session';
import { batonPassed, dropVolatiles, endVolatile, isTrapping, startVolatile } from './volatiles';
import { ReadyState, SeriesInfo, SeriesScore, parseReadyPrompt, parseSeriesScore, parseSeriesTitle } from './battle-series';
import { parseRatingChange } from './battle-ratings';
import { emptyField, isTerrain, namedCondition, weatherCondition } from './field-conditions';
import {
  BattleNames,
  abilityText,
  activateText,
  boostText,
  cantLabel,
  cantText,
  cureText,
  damageReason,
  effectName,
  endItemText,
  fieldText,
  healReason,
  isProtection,
  isSideGuard,
  itemText,
  perishCount,
  sideText,
  singleTurnText,
  splitArgs,
  statusText,
  volatileText,
  weatherText,
} from './battle-text';

/** Open team sheets offered at team preview: 'offered' to answer, 'accepted' by us while the opponent decides. */
export type SheetOffer = 'none' | 'offered' | 'accepted';

/** How long each step of the log stays on screen before the next one (at normal speed). */
const MESSAGE_MS = 1100;
/** A damage or heal step: long enough to see the HP bar move. */
const HP_MS = 600;
/** A Pokémon being withdrawn, before the next one comes out. */
const WITHDRAW_MS = 600;
/**
 * The "p1 vs p2" title at the start, before the first Pokémon come out: time for their sprites to
 * download (they're fetched from team preview on), as they came out late on the console.
 */
const INTRO_MS = 3000;
/** Log entries kept (a whole battle, usually), to keep memory small on the console. */
const MAX_LOG_ENTRIES = 250;
/** How long a request waits for its log before it's shown anyway (a request may come alone). */
const LOG_WAIT_MS = 1000;
/** A message we said comes back from the server this soon (or a popup saying why it didn't go). */
const CHAT_ANSWER_MS = 4000;
const SLOT_INDEX: Record<string, number> = { a: 0, b: 1 };
/** Lines whose `[from]` ability or item belongs to the `[of]` Pokémon (the one causing the effect). */
const SOURCE_OWNS_EFFECT = ['-weather', '-fieldstart', '-damage', '-item', '-enditem', '-sidestart'];
/**
 * Abilities that act on an ally, named by the line on the ally with `[of]` their owner: Curious
 * Medicine (`|-clearboost|p2b: Incineroar|[from] ability: Curious Medicine|[of] p2a: Slowking`), Hospitality
 * (a `-heal`, whose `[of]` is the attacker for Water Absorb, so it goes by the ability) and Pastel Veil.
 */
const ALLY_EFFECT_ABILITIES = new Set(['Curious Medicine', 'Hospitality', 'Pastel Veil']);
/** Pop-ups kept for the field to pick up (it only shows the ones it hasn't seen). */
const MAX_POPUPS = 8;
/** Lines that start the next action: a move's own damage lines come before any of these. */
const ACTION_BOUNDARIES = new Set(['move', 'switch', 'drag', 'cant', 'turn', 'upkeep', 'win', 'tie']);
/** Lines that aren't the battle itself: chat, joins and leaves, server HTML, timer notices. */
const ROOM_LINES = new Set([
  '', 'c', 'c:', 'chat', 'j', 'J', 'l', 'L', 'n', 'N', 'raw', 'html', 'uhtml', 'uhtmlchange', 'inactive', 'inactiveoff', 'error', 'init', 'title',
  'showteam', 'tempnotify', 'tempnotifyoff',
]);

function isBattleLine(line: string): boolean {
  return line.startsWith('|') && !ROOM_LINES.has(line.slice(1).split('|')[0]);
}

/** A `message-error` box's text, without its HTML: the app never renders HTML from the server. */
function messageError(line: string): string {
  const inner = line.slice(line.indexOf('>') + 1).split('</div>')[0];
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function isChatLine(line: string): boolean {
  return line.startsWith('|c|') || line.startsWith('|c:|') || line.startsWith('|chat|');
}

/**
 * A room's first frame (`|init|battle` and the log so far) for a battle already past its first turn:
 * we're back in one we left (the app closed mid-battle), so the log is caught up, not played again. A
 * new battle's first frame goes no further than turn 1, whose lead-ins still play out.
 */
/** Lines about the present (the timer, refused choices), not the battle: not applied again. */
function isPresentOnly(line: string): boolean {
  return line.startsWith('|inactive|') || line.startsWith('|inactiveoff|') || line.startsWith('|error|') || line.startsWith('|html|<div class="message-error">');
}

/**
 * A replay's log from our battle's frames: the protocol lines a spectator would have seen. Without
 * the requests, the present-only lines or `|init|battle` (which would make the store take it as a
 * rejoin and apply it all at once).
 */
function instantReplayLog(frames: readonly string[]): string {
  return frames
    .flatMap((frame) => frame.split('\n'))
    .filter((line) => line.startsWith('|') && !line.startsWith('|request|') && line !== '|init|battle' && !isPresentOnly(line))
    .join('\n');
}

function isRejoin(frame: string): boolean {
  const lines = frame.split('\n');
  return lines.includes('|init|battle') && lines.some((line) => line.startsWith('|turn|') && Number(line.slice('|turn|'.length)) > 1);
}

/** Seconds left this turn on the timer at `now`; null until the server has told them. */
export function timerSecondsLeft(timer: BattleTimer, now: number): number | null {
  if (timer.turnSeconds === null) return null;
  const elapsed = timer.since === null ? 0 : Math.max(0, Math.floor((now - timer.since) / 1000));
  return Math.max(0, timer.turnSeconds - elapsed);
}

/** "+17", "-17", "±0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `${n}` : '±0';
}

/** Weather Ball's and Terrain Pulse's type in the weather or terrain; they're Normal otherwise. */
const WEATHER_TYPES: Record<string, string> = {
  SunnyDay: 'Fire',
  DesolateLand: 'Fire',
  RainDance: 'Water',
  PrimordialSea: 'Water',
  Sandstorm: 'Rock',
  Snowscape: 'Ice',
  Snow: 'Ice',
  Hail: 'Ice',
};
const TERRAIN_TYPES: Record<string, string> = {
  'Electric Terrain': 'Electric',
  'Grassy Terrain': 'Grass',
  'Misty Terrain': 'Fairy',
  'Psychic Terrain': 'Psychic',
};

/** The type a move takes from the field (Weather Ball in the rain: Water), or null when it doesn't. */
function fieldMoveType(move: string, field: BattleFieldState): string | null {
  const id = toId(move);
  if (id === 'weatherball') return (field.weather && WEATHER_TYPES[field.weather.id]) || null;
  if (id === 'terrainpulse') return (field.terrain && TERRAIN_TYPES[field.terrain.id]) || null;
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const emptySide = (id: SideId): BattleSide => ({
  id,
  name: '',
  active: [null, null],
  pokemon: [],
  preview: [],
  teamSize: 0,
});

/**
 * One battle's state, built from the server's protocol lines (Showdown's battle protocol). Log lines
 * play back one step at a time: each step updates the field and adds its entry to the battle log,
 * then waits. The server's request is held until the log leading up to it has played.
 * A replay is watched from p1's side, with the same playback plus pause, speed and skip to next turn.
 * A root service, so the battle page's components share it; the page can't be left while a battle
 * is open (see app.routes).
 */
@Service()
export class BattleStore {
  private readonly dex = inject(ChampionsDex);
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly session = inject(BattleSession);
  private readonly music = inject(BattleMusic);
  private readonly login = inject(ShowdownLogin);
  /** A chat message we said and haven't seen back yet: a notice if the server neither echoes it nor says why. */
  private chatAnswer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The server turns some messages down outside the battle's room: a popup, or an error as a PM
    // (`|pm|~|Brewser1234|/error Due to spam from your internet provider…`).
    inject(ShowdownConnection).frames.subscribe((frame) => {
      if (this.chatAnswer === null) return;
      for (const line of frame.lines) {
        const [type, text = ''] = splitLine(line, 1);
        if (type === 'popup' && text) this.answerChat(text.replace(/\|\|/g, ' '));
        const pm = type === 'pm' ? (splitLine(line, 3)[3] ?? '') : '';
        if (pm.startsWith('/error ')) this.answerChat(pm.slice('/error '.length));
      }
    });
  }

  private readonly sidesSignal = signal<Record<SideId, BattleSide>>({
    p1: emptySide('p1'),
    p2: emptySide('p2'),
  });
  private readonly logSignal = signal<readonly BattleLogEntry[]>([]);
  private readonly turnSignal = signal(0);
  private readonly requestSignal = signal<BattleRequest | null>(null);
  private readonly resultSignal = signal<'win' | 'loss' | 'tie' | null>(null);
  private readonly winnerSignal = signal('');
  private readonly ratedSignal = signal(false);
  private readonly ratingsSignal = signal<Partial<Record<SideId, RatingChange>>>({});
  private readonly playingSignal = signal(false);
  private readonly teamSignal = signal<readonly RequestPokemon[]>([]);
  private readonly activeMovesSignal = signal<readonly RequestActive[]>([]);
  private readonly battleIdSignal = signal(0);
  private readonly battleRoomSignal = signal<string | null>(null);
  private readonly replaySignal = signal<Replay | null>(null);
  private readonly instantReplaySignal = signal(false);
  private readonly spectatingSignal = signal(false);
  private readonly spectateErrorSignal = signal<string | null>(null);
  private readonly lostSignal = signal<string | null>(null);
  private readonly pausedSignal = signal(false);
  private readonly speedSignal = signal(1);
  private readonly fieldSignal = signal<BattleFieldState>(emptyField());
  private readonly actionSignal = signal<MoveAction | null>(null);
  private readonly fieldEventSignal = signal<FieldEvent | null>(null);
  private readonly popupsSignal = signal<readonly EffectPopup[]>([]);
  private readonly hpChangesSignal = signal<readonly HpChange[]>([]);
  private readonly statusChangesSignal = signal<readonly StatusChange[]>([]);
  private readonly statChangesSignal = signal<readonly StatChange[]>([]);
  private readonly introSignal = signal<{ p1: string; p2: string } | null>(null);
  private readonly startedSignal = signal(false);
  private readonly formatSignal = signal('');
  private readonly gameTypeSignal = signal<GameType>('doubles');
  private readonly genSignal = signal(9);
  private readonly timerSignal = signal<BattleTimer | null>(null);
  private readonly canUndoSignal = signal(false);
  private readonly canToggleTimerSignal = signal(false);
  private readonly timerCooldownUntilSignal = signal<number | null>(null);
  private readonly teamSheetsSignal = signal<Partial<Record<SideId, string>>>({});
  private readonly seriesInfoSignal = signal<SeriesInfo | null>(null);
  private readonly seriesScoreSignal = signal<SeriesScore | null>(null);
  private readonly readySignal = signal<ReadyState>('none');
  private readonly sheetOfferSignal = signal<SheetOffer>('none');
  private readonly chatPopSignal = signal<BattleLogEntry | null>(null);
  private readonly canChatSignal = signal(false);

  readonly sides = this.sidesSignal.asReadonly();
  /** The battle log so far, oldest first. */
  readonly log = this.logSignal.asReadonly();
  /** The latest chat message said while watching or playing (not one caught up on), to pop up over the field. */
  readonly chatPop = this.chatPopSignal.asReadonly();
  /** Whether messages can be said in the battle's chat (live battles, ours or watched; not replays). */
  readonly canChat = this.canChatSignal.asReadonly();
  readonly turn = this.turnSignal.asReadonly();
  /** What the player has to choose now; null while the log plays or the server is thinking. */
  readonly request = this.requestSignal.asReadonly();
  /** Set once the battle is over, from p1's point of view. */
  readonly result = this.resultSignal.asReadonly();
  /** The winner's name once the battle is over ('' for a tie). */
  readonly winner = this.winnerSignal.asReadonly();
  /** A ladder battle (`|rated|`): the players' ratings change when it ends. */
  readonly rated = this.ratedSignal.asReadonly();
  /** Each player's rating change, once the server has worked it out (a moment after the battle ends). */
  readonly ratings = this.ratingsSignal.asReadonly();
  /** Whether log steps are still being shown. */
  readonly playing = this.playingSignal.asReadonly();
  /** The player's whole team as of the last request (it stays while the turn plays). */
  readonly team = this.teamSignal.asReadonly();
  /** Our Pokémon on the field's moves as of the last request that had them (PP, disabled), one entry per slot. */
  readonly activeMoves = this.activeMovesSignal.asReadonly();
  /** Changes with every new battle, so per-battle state elsewhere can start over. */
  readonly battleId = this.battleIdSignal.asReadonly();
  /**
   * Which battle this is on the server: its room, or the replay's id (the room's without "battle-").
   * An instant replay keeps its battle's. It picks the battlefield.
   */
  readonly battleRoom = this.battleRoomSignal.asReadonly();
  /** The replay being watched; null in a battle the player plays. */
  readonly replay = this.replaySignal.asReadonly();
  /** A live battle watched as a spectator. */
  readonly spectating = this.spectatingSignal.asReadonly();
  /** Why the battle to watch couldn't be joined (it has ended, or never existed). */
  readonly spectateError = this.spectateErrorSignal.asReadonly();
  /**
   * Our own battle can't go on from here (its room is gone after a reconnection, or we came back
   * with another name): why. It ends the battle as far as the screen goes.
   */
  readonly lost = this.lostSignal.asReadonly();
  /** The replay being watched is our own battle's, just finished (see watchInstantReplay). */
  readonly instantReplay = this.instantReplaySignal.asReadonly();
  /** Watched rather than played (a replay or a live battle): no "you", both players by name. */
  readonly watching = computed(() => this.replaySignal() !== null || this.spectatingSignal());
  /** Replays only: the playback is paused. */
  readonly paused = this.pausedSignal.asReadonly();
  /** Playback speed: 1 (normal), 2 or 4. */
  readonly speed = this.speedSignal.asReadonly();
  /** Weather, terrain, rooms and each side's conditions in play. */
  readonly field = this.fieldSignal.asReadonly();
  /** The move being used, while its effects play; null between moves. */
  readonly action = this.actionSignal.asReadonly();
  /** The latest hit or faint, for the field to animate. */
  readonly fieldEvent = this.fieldEventSignal.asReadonly();
  /**
   * The latest abilities and items to take effect, newest last, for the field's pop-ups. A list, as
   * lines with nothing to wait for play in one go and may bring several.
   */
  readonly popups = this.popupsSignal.asReadonly();
  /** The latest HP changes (a few), for the field's "-45%" / "+12%" labels. */
  readonly hpChanges = this.hpChangesSignal.asReadonly();
  /** The latest status conditions inflicted (a few), for the field's "Burned!" labels. */
  readonly statusChanges = this.statusChangesSignal.asReadonly();
  /** The latest stat stages raised or lowered (a few), for the field's "Attack +1" labels and arrows. */
  readonly statChanges = this.statChangesSignal.asReadonly();
  /** The players' names while the battle's title shows, at its start; null otherwise. */
  readonly intro = this.introSignal.asReadonly();
  /** The battle has begun and its title has gone: the teams at a glance show from then on. */
  readonly started = this.startedSignal.asReadonly();
  /**
   * Both teams are known (`|poke|`) and the players are picking theirs, until `|start|`. With open team
   * sheets it can last minutes, and a spectator gets nothing else meanwhile.
   */
  readonly teamPreview = computed(
    () => !this.startedSignal() && !this.introSignal() && !this.resultSignal() && this.sidesSignal().p1.preview.length > 0,
  );
  /** The format's name, from the `|tier|` line ("[Gen 9] Champions VGC 2026 Reg M-C"); '' until then. */
  readonly format = this.formatSignal.asReadonly();
  /** The generation played, from the `|gen|` line (9 until then). */
  readonly gen = this.genSignal.asReadonly();
  /** Gen 3 battles show Ruby/Sapphire's sprites; the rest Black/White's. */
  readonly spriteSet = computed(() => spriteSetOf(this.genSignal()));
  /** Singles or doubles, from the `|gametype|` line (before the first Pokémon come out). */
  readonly gameType = this.gameTypeSignal.asReadonly();
  /** Our battle timer while it's on; null while it's off. */
  readonly battleTimer = this.timerSignal.asReadonly();
  /** The choices sent can still be taken back: the opponent hasn't chosen yet (real battles only). */
  readonly canUndo = this.canUndoSignal.asReadonly();
  /** The battle timer can be turned on and off from here (real battles only). */
  readonly canToggleTimer = this.canToggleTimerSignal.asReadonly();
  /** Until when the server won't let us turn the timer back on, once it has refused (asked too soon after turning it off). */
  readonly timerCooldownUntil = this.timerCooldownUntilSignal.asReadonly();
  /**
   * Each side's open team sheet (Open Team Sheets formats): the packed team the server shows at team
   * preview, `|showteam|p2|…`, with everything but stats.
   */
  readonly teamSheets = this.teamSheetsSignal.asReadonly();
  /**
   * The open team sheets offered at team preview in formats where both players have to agree
   * (`|uhtml|otsrequest|…`): still to answer, or accepted by us while the opponent decides. Back to
   * 'none' when the sheets come, the opponent rejects them, or the battle starts.
   */
  readonly sheetOffer = this.sheetOfferSignal.asReadonly();
  /** Between games of a set: whether the server asks if we're ready for the next one. */
  readonly ready = this.readySignal.asReadonly();

  /**
   * The best-of set this battle is a game of, with the score from p1's side: as the game started, and
   * with this game's result once it's over (then `over` when someone has won the set).
   */
  readonly series = computed(() => {
    const info = this.seriesInfoSignal();
    if (!info) return null;
    const score = this.seriesScoreSignal();
    const sides = this.sidesSignal();
    // The table names the set's players; the screen has us as p1 whichever side we are.
    const flipped = !!score && toId(score.names[0]) === toId(sides.p2.name) && toId(score.names[1]) === toId(sides.p1.name);
    const before = score ? (flipped ? { p1: score.wins[1], p2: score.wins[0] } : { p1: score.wins[0], p2: score.wins[1] }) : { p1: 0, p2: 0 };
    const result = this.resultSignal();
    const wins = { p1: before.p1 + (result === 'win' ? 1 : 0), p2: before.p2 + (result === 'loss' ? 1 : 0) };
    const needed = Math.floor(info.bestOf / 2) + 1;
    const over = wins.p1 >= needed || wins.p2 >= needed || (!!result && info.game >= info.bestOf);
    return { ...info, wins, over };
  });

  private connection: BattleConnection | null = null;
  private queue: string[] = [];
  private pendingRequest: BattleRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Watching live: the first frame (the battle so far) is still to come, and is applied at once. */
  private catchingUp = false;
  /** Cancel was pressed and the request shown again; the turn's log may still prove it too late. */
  private undone = false;
  /** The room's `|init|battle` has come: another one means we're back in it after a reconnection. */
  private initialized = false;
  /**
   * User IDs of the players who want the battle timer on: it stays on while anyone does. Only the
   * server's notices tell who they are, and whether `/timer off` from us actually turns it off.
   */
  private readonly timerRequesters = new Set<string>();
  private nextLogId = 0;
  private nextEventId = 0;
  /**
   * Slots ("p1a") whose Pokémon used Baton Pass or Shed Tail this turn: the next one switched in there
   * takes its stat stages and substitute (Shed Tail, only the substitute), as Showdown's client does.
   */
  private readonly passing = new Map<string, 'batonpass' | 'shedtail'>();
  /** The switch line whose withdrawal has just played, so applying it again brings the new Pokémon. */
  private withdrawn: string | null = null;
  /** Set while a request waits for the log that should follow it. */
  private logWait: ReturnType<typeof setTimeout> | null = null;
  /** Set once the turn's end-of-turn effects have run: what starts now counts from the next turn. */
  private afterUpkeep = false;
  /** Who used the last move: the one an Attract started without an `[of]` infatuates its target with. */
  private lastMover = '';
  /** Slots the current move's lunge has already blinked: their first damage line doesn't blink again. */
  private readonly blinkedHits = new Set<string>();
  /** Slots a critical hit is about to land on: their next damage line is labelled with it. */
  private readonly critSlots = new Set<string>();
  /** The last request shown, to show again when the choices are taken back. */
  private lastRequest: BattleRequest | null = null;
  /** Every frame our own battle's room has sent (sides as we see them), for its instant replay. */
  private frames: string[] = [];
  /**
   * While our finished battle's instant replay plays: its connection (its room stays open), the frames
   * it had sent, and those it sends meanwhile.
   */
  private suspended: {
    connection: BattleConnection;
    played: string[];
    frames: string[];
    /** Our team as the last request had it: requests aren't applied again on the way back. */
    team: readonly RequestPokemon[];
    moves: readonly RequestActive[];
    lastRequest: BattleRequest | null;
  } | null = null;

  /** How the log names Pokémon and teams: from p1's side, which is the player's (or the one watched). */
  private readonly names: BattleNames = {
    pokemon: (ident, sentenceStart = true) => this.label(ident, sentenceStart),
    team: (side, sentenceStart = true) => {
      const id = side.slice(0, 2) as SideId;
      if (this.watching()) return `${this.sidesSignal()[id]?.name ?? id}'s team`;
      if (id === 'p1') return sentenceStart ? 'Your team' : 'your team';
      return sentenceStart ? 'The opposing team' : 'the opposing team';
    },
  };

  start(connection: BattleConnection): void {
    this.reset();
    this.frames = [];
    this.battleIdSignal.update((id) => id + 1);
    this.battleRoomSignal.set(connection.roomId ?? connection.replay?.id ?? null);
    this.replaySignal.set(connection.replay ?? null);
    // Only replays have a speed control: a live battle after one at x2 or x4 plays at normal speed.
    if (!connection.replay) this.speedSignal.set(1);
    this.spectatingSignal.set(!!connection.spectating);
    this.catchingUp = !!connection.spectating;
    this.session.setActive(true);
    this.connection = connection;
    this.canToggleTimerSignal.set(!!connection.setTimer && !connection.replay);
    this.canChatSignal.set(!!connection.say && !connection.replay);
    void this.music.start();
    connection.start((frame) => {
      // Our battle's room goes on while its instant replay plays: what it says waits for the way back.
      if (this.suspended?.connection === connection) this.suspended.frames.push(frame);
      else this.receive(frame);
    });
  }

  /** Leaves the battle for good: the battle page can be left again. */
  close(): void {
    this.music.stop();
    this.reset();
    this.replaySignal.set(null);
    this.spectatingSignal.set(false);
    this.session.setActive(false);
  }

  /**
   * The end's Instant replay: our finished battle again from its start, as a replay (play/pause,
   * next turn, speed), from what its room sent us (without the requests, only we saw those). Its room
   * stays open meanwhile, for a rematch or the set's next game; endInstantReplay comes back to the end.
   */
  watchInstantReplay(): void {
    const live = this.connection;
    if (!live || live.replay || this.watching() || !this.resultSignal() || this.suspended) return;
    const { p1, p2 } = this.sidesSignal();
    const replay: Replay = {
      id: 'instant',
      format: this.formatSignal(),
      players: [p1.name, p2.name],
      uploadtime: 0,
      log: instantReplayLog(this.frames),
    };
    this.suspended = { connection: live, frames: [], played: this.frames, team: this.teamSignal(), moves: this.activeMovesSignal(), lastRequest: this.lastRequest };
    this.instantReplaySignal.set(true);
    this.startReplay(replay);
  }

  /** The instant replay again, from the start. */
  restartInstantReplay(): void {
    const replay = this.replaySignal();
    if (this.suspended && replay) this.startReplay(replay);
  }

  /**
   * Leaves the instant replay for the end of our battle: what its room sent is applied again at
   * once, as when coming back to a battle after a reconnection, then what it said meanwhile.
   */
  endInstantReplay(): void {
    const suspended = this.suspended;
    if (!suspended) return;
    this.halt();
    this.clearBattle();
    this.suspended = null;
    this.instantReplaySignal.set(false);
    this.replaySignal.set(null);
    this.speedSignal.set(1);
    this.connection = suspended.connection;
    this.canChatSignal.set(!!suspended.connection.say);
    this.battleIdSignal.update((id) => id + 1);
    this.frames = [];
    for (const frame of [...suspended.played, ...suspended.frames]) {
      this.catchingUp = true;
      this.receive(frame.split('\n').filter((line) => !isPresentOnly(line) && !line.startsWith('|request|')).join('\n'));
    }
    this.catchingUp = false;
    this.teamSignal.set(suspended.team);
    this.activeMovesSignal.set(suspended.moves);
    this.lastRequest = suspended.lastRequest;
    this.renderScheduler.request();
  }

  /** Plays `replay` from the start, in place of what's shown, keeping the music. */
  private startReplay(replay: Replay): void {
    this.halt();
    this.clearBattle();
    this.battleIdSignal.update((id) => id + 1);
    this.replaySignal.set(replay);
    this.canChatSignal.set(false);
    this.answerChat(null);
    const connection = new ReplayBattleConnection(replay);
    this.connection = connection;
    // Its own battle music, as any replay.
    void this.music.start();
    connection.start((frame) => this.receive(frame));
  }

  private reset(): void {
    // An instant replay's battle is left too.
    this.suspended?.connection.stop();
    this.suspended = null;
    this.instantReplaySignal.set(false);
    this.stop();
    this.clearBattle();
  }

  /**
   * The room sent the battle from its start again (`|init|battle`): we're back in it after the
   * connection dropped. What was shown is dropped (keeping the connection, the music and the timer
   * button) and the log is caught up at once, as a new battle, so the screen's leftovers go too.
   */
  private restartForRejoin(): void {
    const canToggleTimer = this.canToggleTimerSignal();
    // The request may have come just before the log (as Showdown sends them): it's the present one.
    const request = this.pendingRequest;
    this.halt();
    this.clearBattle();
    this.pendingRequest = request;
    // The room sends it all again: what came before goes from the instant replay's record.
    this.frames = [];
    this.canToggleTimerSignal.set(canToggleTimer);
    this.battleIdSignal.update((id) => id + 1);
    this.catchingUp = true;
  }

  /** Everything shown of the battle, back to nothing. */
  private clearBattle(): void {
    this.sidesSignal.set({ p1: emptySide('p1'), p2: emptySide('p2') });
    this.logSignal.set([]);
    this.turnSignal.set(0);
    this.resultSignal.set(null);
    this.winnerSignal.set('');
    this.ratedSignal.set(false);
    this.ratingsSignal.set({});
    this.requestSignal.set(null);
    this.teamSignal.set([]);
    this.activeMovesSignal.set([]);
    this.pausedSignal.set(false);
    this.fieldSignal.set(emptyField());
    this.afterUpkeep = false;
    this.lastMover = '';
    this.actionSignal.set(null);
    this.fieldEventSignal.set(null);
    this.popupsSignal.set([]);
    this.hpChangesSignal.set([]);
    this.statusChangesSignal.set([]);
    this.statChangesSignal.set([]);
    this.chatPopSignal.set(null);
    this.introSignal.set(null);
    this.startedSignal.set(false);
    this.formatSignal.set('');
    this.gameTypeSignal.set('doubles');
    this.genSignal.set(9);
    this.withdrawn = null;
    this.passing.clear();
    this.blinkedHits.clear();
    this.critSlots.clear();
    this.timerSignal.set(null);
    this.spectateErrorSignal.set(null);
    this.lostSignal.set(null);
    this.catchingUp = false;
    this.initialized = false;
    this.undone = false;
    this.timerRequesters.clear();
    this.timerCooldownUntilSignal.set(null);
    this.canUndoSignal.set(false);
    this.canToggleTimerSignal.set(false);
    this.lastRequest = null;
    this.teamSheetsSignal.set({});
    this.seriesInfoSignal.set(null);
    this.seriesScoreSignal.set(null);
    this.readySignal.set('none');
    this.sheetOfferSignal.set('none');
  }

  /** Sends the turn's choices ("move 1 2, switch 3"); the request is used up. */
  choose(choice: string): void {
    this.requestSignal.set(null);
    this.canUndoSignal.set(!!this.connection?.undo);
    this.stopTimer();
    this.connection?.choose(choice);
  }

  /**
   * Takes back the choices sent while the opponent is still choosing, as Showdown's Cancel does: the
   * same request comes back to choose again. If the server says it's too late, the turn goes on.
   */
  undo(): void {
    if (!this.canUndoSignal() || !this.lastRequest) return;
    this.canUndoSignal.set(false);
    this.connection?.undo?.();
    this.undone = true;
    this.showRequestAgain();
    this.timerSignal.update((timer) => (timer?.turnSeconds != null ? { ...timer, since: Date.now() } : timer));
    this.renderScheduler.request();
  }

  forfeit(): void {
    this.connection?.forfeit();
  }

  /** Our battle can't go on from here (see `lost`): nothing more to choose, only to leave. */
  markLost(reason: string): void {
    if (this.resultSignal() || this.lostSignal()) return;
    this.lostSignal.set(reason);
    this.requestSignal.set(null);
    this.pendingRequest = null;
    this.canUndoSignal.set(false);
    this.timerSignal.set(null);
    this.renderScheduler.request();
  }

  /**
   * Asks for the battle timer on while it shows off, or off while it shows on; the server's notices
   * update battleTimer. Off goes by what's shown, not by whether we're known to have asked for it: a
   * timer we didn't see being asked for (a set's next game, a battle joined again) was asked "on"
   * again, and kept ticking. The server doesn't always say it's off (not when no clock is ticking at
   * that moment), so once nobody we know of wants it, it's taken as off here; if it's still on there,
   * the next turn's "Time left" shows it again.
   */
  toggleTimer(): void {
    if (!this.canToggleTimerSignal() || this.resultSignal()) return;
    const me = toId(this.sidesSignal().p1.name);
    const on = this.timerSignal() === null;
    this.connection?.setTimer?.(on);
    if (on) return;
    // The server won't let it back on for a while, but that wait isn't shown until it says so (asked
    // too soon): counting down from here, it looked like the timer still running.
    this.timerRequesters.delete(me);
    if (this.timerRequesters.size === 0) this.timerSignal.set(null);
    this.renderScheduler.request();
  }

  /** Agrees to the open team sheets offered: they show once the opponent agrees too. */
  acceptTeamSheets(): void {
    if (this.sheetOfferSignal() !== 'offered' || !this.connection?.acceptTeamSheets) return;
    this.connection.acceptTeamSheets();
    this.sheetOfferSignal.set('accepted');
    this.renderScheduler.request();
  }

  /**
   * Says `text` in the battle's chat: it shows once the server echoes it back. Only `/me` goes as a
   * command; any other leading slash is sent as text (`//`), so nothing typed can act on the battle.
   */
  sendChat(text: string): void {
    let message = text.replace(/\s+/g, ' ').trim();
    if (!message || !this.canChatSignal() || !this.connection?.say) return;
    if (message.startsWith('/') && !message.startsWith('/me ')) message = `/${message}`;
    this.connection.say(message);
    this.answerChat(null);
    this.chatAnswer = setTimeout(() => this.answerChat("The server didn't post your message (no answer from it)."), CHAT_ANSWER_MS);
  }

  /** What we said was answered: echoed back (null), or turned down with this notice. */
  private answerChat(notice: string | null): void {
    if (this.chatAnswer !== null) clearTimeout(this.chatAnswer);
    this.chatAnswer = null;
    if (notice) this.showChat({ id: this.nextLogId++, kind: 'chat', text: notice, author: '' });
  }

  /** Pauses or resumes the playback (replays). */
  togglePause(): void {
    this.pausedSignal.update((paused) => !paused);
    if (!this.pausedSignal() && this.timer === null) this.step();
    this.renderScheduler.request();
  }

  setSpeed(speed: number): void {
    this.speedSignal.set(speed);
  }

  /** Plays everything up to the next turn at once (replays); stays paused if it was. */
  nextTurn(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    while (this.queue.length > 0) {
      const line = this.queue.shift()!;
      this.apply(line);
      if (line.startsWith('|turn|')) break;
    }
    this.step();
  }

  /**
   * Skip to end, as Showdown's button, in our own battles: what's left of the turn being played is
   * applied at once, so the next choice (or the end) shows straight away.
   */
  skipToEnd(): void {
    if (this.watching() || !this.playingSignal()) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.catchUp();
  }

  /**
   * Watching live or back in a battle we left, the battle so far: applied at once with nothing left animating, so the screen shows
   * the battle as it stands and only what happens from now on plays out.
   */
  private catchUp(): void {
    this.catchingUp = false;
    while (this.queue.length > 0) this.apply(this.queue.shift()!);
    this.actionSignal.set(null);
    this.fieldEventSignal.set(null);
    this.popupsSignal.set([]);
    this.hpChangesSignal.set([]);
    this.statusChangesSignal.set([]);
    this.statChangesSignal.set([]);
    // The chat caught up on is in the log; only what's said from now on pops up.
    this.chatPopSignal.set(null);
    this.step();
  }

  private stop(): void {
    this.connection?.stop();
    this.connection = null;
    this.canChatSignal.set(false);
    this.answerChat(null);
    this.halt();
  }

  /** Stops the playback and drops what's waiting to play. */
  private halt(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.stopWaitingForLog();
    this.queue = [];
    this.pendingRequest = null;
    this.playingSignal.set(false);
  }

  private receive(frame: string): void {
    let hasLog = false;
    let hasRequest = false;
    if (frame.split('\n').includes('|init|battle')) {
      if (this.initialized) this.restartForRejoin();
      this.initialized = true;
      this.lostSignal.set(null);
    }
    // Our own battle's frames, for its instant replay.
    if (this.connection && !this.connection.replay && !this.spectatingSignal()) this.frames.push(frame);
    const catching = this.catchingUp || isRejoin(frame);
    for (const line of frame.split('\n')) {
      // A room frame starts with ">battle-…"; this screen shows a single battle. Chat commands' notices
      // come as bare text: the opponent turning down the open team sheets is one.
      if (!line.startsWith('|')) {
        if (line.endsWith(' rejected open team sheets.')) this.setSheetOffer('none');
        continue;
      }
      if (line.startsWith('|request|')) {
        const json = line.slice('|request|'.length);
        if (json) this.pendingRequest = JSON.parse(json) as BattleRequest;
        hasRequest = !!json;
        continue;
      }
      // Timer and choice errors concern the present, not the log being played back: applied at once.
      if (line.startsWith('|inactive|') || line.startsWith('|inactiveoff|')) {
        this.updateTimer(line);
        continue;
      }
      if (line.startsWith('|error|')) {
        this.onChoiceError(line.slice('|error|'.length));
        continue;
      }
      // `|html|<div class="message-error">You must be registered to chat in temporary rooms (like battles).</div>…`:
      // a message we said turned down (guests can't talk in battles).
      if (line.startsWith('|html|<div class="message-error">')) {
        this.answerChat(messageError(line));
        continue;
      }
      if (this.takeRoomNotice(line)) continue;
      // Chat said now shows now, not after the turn being played; what's caught up on keeps its place in the log.
      if (!catching && isChatLine(line)) {
        this.addChat(line);
        continue;
      }
      // `|noinit|nonexistent|The room "battle-…" does not exist.`: the battle to watch is gone, or
      // ours, joined again after a reconnection, has ended and closed meanwhile.
      if (line.startsWith('|noinit|')) {
        const reason = line.split('|')[3] || 'This battle has ended.';
        if (this.spectatingSignal()) this.spectateErrorSignal.set(reason);
        else if (!this.resultSignal()) this.markLost(`Couldn't get back into the battle: ${reason}`);
        continue;
      }
      this.queue.push(line);
      hasLog = true;
    }
    // The opponent has chosen (the turn's log is here) or there's something new to choose. Chat and
    // players joining don't count.
    if (hasRequest || frame.split('\n').some(isBattleLine)) this.canUndoSignal.set(false);
    if (this.undone) this.dropUndoneIfTooLate(frame);
    if (catching && hasLog) {
      this.catchUp();
      return;
    }
    if (hasLog) this.stopWaitingForLog();
    // Showdown sends a request just BEFORE the log that leads up to it: wait for that log first.
    else if (hasRequest) {
      this.stopWaitingForLog();
      this.logWait = setTimeout(() => {
        this.logWait = null;
        if (this.timer === null) this.step();
      }, LOG_WAIT_MS);
    }
    if (this.timer === null) this.step();
  }

  /**
   * Showdown's timer notices (`|inactive|…`, `|inactiveoff|…`). Ours: "Time left: 150 sec this turn |
   * 280 sec total" with each request, and "Brewser1234 has 20 seconds left." as it runs low (also in the
   * log, for either player, watching too). Turning it
   * on or off also goes to the log, with who asked for it ("(requested by Brewser1234)", "X also wants
   * the timer to be on.", "X no longer wants the timer on, but…"). Turned on while we wait, our time
   * only comes with our next request, so until then it shows as on without a time.
   */
  private updateTimer(line: string): void {
    const off = line.startsWith('|inactiveoff|');
    const text = line.slice(line.indexOf('|', 1) + 1);
    // "Brewser1234 has 20 seconds left.": either player's, in the log as on Showdown.
    const secondsLeft = / has \d+ seconds? left/.test(text);
    // Watching: the timer isn't ours to show, only its news for the log.
    if (this.watching()) {
      if (text.startsWith('Battle timer is') || text.includes('OFF') || secondsLeft) this.addEntry('message', text);
      return;
    }
    if (off) {
      const cooldown = /can't be re-enabled so soon.*\((\d+) seconds? remaining\)/.exec(text);
      if (text.includes('OFF')) {
        this.timerRequesters.clear();
        this.timerSignal.set(null);
      } else if (cooldown) {
        this.timerCooldownUntilSignal.set(Date.now() + Number(cooldown[1]) * 1000);
      }
      this.addEntry('message', text);
    } else if (text.startsWith('Battle timer is ON')) {
      const requester = /\(requested by (.+)\)\s*$/.exec(text);
      if (requester) this.timerRequesters.add(toId(requester[1]));
      this.timerSignal.update((timer) => timer ?? { turnSeconds: null, totalSeconds: null, since: null });
      this.addEntry('message', 'The battle timer is on: inactive players will automatically lose when time is up.');
    } else if (/ also wants the timer to be on\.$/.test(text)) {
      this.timerRequesters.add(toId(text.slice(0, text.indexOf(' also wants'))));
    } else if (text.includes(' no longer wants the timer on')) {
      this.timerRequesters.delete(toId(text.slice(0, text.indexOf(' no longer wants'))));
      this.addEntry('message', text);
    } else {
      const own = /^Time left: (\d+) sec this turn \| (\d+) sec total/.exec(text);
      const low = new RegExp(`^${escapeRegExp(this.sidesSignal().p1.name)} has (\\d+) seconds left`).exec(text);
      if (own) this.timerSignal.set({ turnSeconds: Number(own[1]), totalSeconds: Number(own[2]), since: Date.now() });
      else if (low && this.sidesSignal().p1.name) {
        this.timerSignal.update((timer) => ({
          turnSeconds: Number(low[1]),
          totalSeconds: timer?.totalSeconds ?? null,
          // A stopped clock (we've chosen) stays stopped.
          since: timer && timer.since === null ? null : Date.now(),
        }));
      }
      if (secondsLeft) this.addEntry('message', text);
    }
    this.renderScheduler.request();
  }

  /**
   * What the room says beside the battle that's kept here (applied at once, not played back): the open
   * team sheets and, in a best-of set, which game this is, the score and the ready prompt between
   * games. Returns whether the line was one of them.
   */
  private takeRoomNotice(line: string): boolean {
    if (line.startsWith('|showteam|')) {
      const [, , side, ...packed] = line.split('|');
      if (side === 'p1' || side === 'p2') this.teamSheetsSignal.update((sheets) => ({ ...sheets, [side]: packed.join('|') }));
      this.sheetOfferSignal.set('none');
    } else if (line.startsWith('|uhtml|otsrequest|') || line.startsWith('|uhtmlchange|otsrequest|')) {
      // The offer's buttons, then emptied once we've answered (kept as accepted then), someone rejected, or the battle started.
      const offered = line.length > '|uhtml|otsrequest|'.length && line.startsWith('|uhtml|');
      if (offered) this.sheetOfferSignal.set('offered');
      else if (this.sheetOfferSignal() === 'offered') this.sheetOfferSignal.set('none');
    } else if (line.startsWith('|uhtml|bestof|') || line.startsWith('|uhtmlchange|bestof|')) {
      const info = parseSeriesTitle(line);
      if (info) this.seriesInfoSignal.set(info);
    } else if (line.startsWith('|html|<table') && line.includes('fa-circle')) {
      const score = parseSeriesScore(line);
      if (score) this.seriesScoreSignal.set(score);
    } else if (line.startsWith('|c|~|/uhtml controls,')) {
      const ready = parseReadyPrompt(line.slice('|c|~|'.length));
      if (ready) this.readySignal.set(ready);
    } else {
      return line.startsWith('|tempnotify');
    }
    this.renderScheduler.request();
    return true;
  }

  private setSheetOffer(offer: SheetOffer): void {
    this.sheetOfferSignal.set(offer);
    this.renderScheduler.request();
  }

  /** Stops our clock where it is: we've chosen (the server doesn't count the time we wait). */
  private stopTimer(): void {
    this.timerSignal.update((timer) => (timer?.since == null ? timer : { ...timer, turnSeconds: timerSecondsLeft(timer, Date.now()), since: null }));
  }

  /**
   * `|error|[Invalid choice] …`. Too late to cancel (the opponent chose meanwhile) or not allowed to
   * (a trapping move would give information away): the turn goes on as chosen. Any other refused
   * choice: the request comes back to choose again. Other errors answer what we said in the chat
   * (guests can't talk, too fast…): a server notice among the chat.
   */
  private onChoiceError(error: string): void {
    if (!error.startsWith('[Invalid choice]')) {
      if (error) this.answerChat(error);
      return;
    }
    const message = error.slice('[Invalid choice]'.length).trim();
    if (/too late to cancel|Can't undo/.test(message)) {
      // Only the request shown again by undo() goes: a newer one stays.
      if (this.requestSignal()?.rqid === this.lastRequest?.rqid) this.requestSignal.set(null);
      this.stopTimer();
    } else if (!message.includes('nothing to cancel')) {
      this.showRequestAgain();
    }
    this.addEntry('message', message);
    this.renderScheduler.request();
  }

  /**
   * After Cancel, the request is shown again at once, but the opponent may have chosen before our
   * `/undo` reached the server: the turn then goes on with the choices first sent, and its log (or the
   * next request) comes instead of any answer. The request shown again goes, so nothing can be chosen
   * for a turn that's already being played.
   */
  private dropUndoneIfTooLate(frame: string): void {
    const shown = this.lastRequest?.rqid;
    const turnMoved =
      frame.split('\n').some((line) => isBattleLine(line) && !line.startsWith('|request|')) ||
      (this.pendingRequest !== null && this.pendingRequest.rqid !== shown);
    if (!turnMoved) return;
    this.undone = false;
    if (this.requestSignal()?.rqid !== shown) return;
    this.requestSignal.set(null);
    this.stopTimer();
    this.addEntry('message', 'Too late to cancel: the turn goes on with the choices you sent.');
  }

  /** The last request again, as a new object so the choices for it start over. */
  private showRequestAgain(): void {
    if (this.lastRequest) this.requestSignal.set({ ...this.lastRequest });
  }

  private stopWaitingForLog(): void {
    if (this.logWait !== null) clearTimeout(this.logWait);
    this.logWait = null;
  }

  /** Applies log lines until one needs time on screen, then waits; at the end, shows the request. */
  private step(): void {
    this.timer = null;
    while (this.queue.length > 0) {
      if (this.pausedSignal()) {
        this.playingSignal.set(true);
        this.renderScheduler.request();
        return;
      }
      const delay = this.apply(this.queue.shift()!);
      if (delay > 0) {
        this.playingSignal.set(true);
        this.timer = setTimeout(() => this.step(), delay / this.speedSignal());
        this.renderScheduler.request();
        return;
      }
    }
    this.playingSignal.set(false);
    if (this.pendingRequest && this.logWait === null && !this.resultSignal()) {
      this.requestSignal.set(this.pendingRequest);
      this.lastRequest = this.pendingRequest;
      this.undone = false;
      this.teamSignal.set(this.pendingRequest.side.pokemon);
      // A forced switch has no moves: the last ones stay (their PP is as it was).
      if (this.pendingRequest.active) this.activeMovesSignal.set(this.pendingRequest.active);
      this.pendingRequest = null;
    }
    this.renderScheduler.request();
  }

  /** Applies one protocol line; returns how long it stays on screen (0: go straight on). */
  private apply(line: string): number {
    const [command, ...rest] = line.slice(1).split('|');
    const { args, tags } = splitArgs(rest);
    const names = this.names;
    this.announceEffects(command, args, tags);
    // The title stays until the line after the one that starts the battle.
    if (command !== 'start' && this.introSignal()) {
      this.introSignal.set(null);
      this.startedSignal.set(true);
    }
    switch (command) {
      case 'player': {
        const [side, name] = args;
        // A `|player|p2|` with no name (a player leaving, an update) keeps the name already known.
        if ((side === 'p1' || side === 'p2') && name) this.updateSide(side, (s) => ({ ...s, name }));
        return 0;
      }
      case 'gen':
        this.genSignal.set(Number(args[0]) || 9);
        return 0;
      case 'gametype':
        this.gameTypeSignal.set(args[0] === 'singles' ? 'singles' : 'doubles');
        return 0;
      case 'teamsize': {
        const [side, size] = args;
        if (side === 'p1' || side === 'p2') this.updateSide(side, (s) => ({ ...s, teamSize: Number(size) || 0 }));
        return 0;
      }
      case 'tier':
        // The raw text: splitArgs would take "[Gen 9 Champions] …" for a tag like [from].
        this.formatSignal.set(rest.join('|'));
        return 0;
      case 'clearpoke':
        this.updateSide('p1', (s) => ({ ...s, preview: [] }));
        this.updateSide('p2', (s) => ({ ...s, preview: [] }));
        return 0;
      case 'poke': {
        const [side, details] = args;
        const species = details?.split(', ')[0];
        if ((side === 'p1' || side === 'p2') && species)
          this.updateSide(side, (s) => ({ ...s, preview: [...s.preview, species] }));
        return 0;
      }
      case 'teampreview':
        this.music.preview();
        return 0;
      case 'start': {
        const { p1, p2 } = this.sidesSignal();
        this.music.begin();
        this.introSignal.set({ p1: p1.name, p2: p2.name });
        // Too late to agree to the open team sheets now.
        this.sheetOfferSignal.set('none');
        this.say(`Battle started between ${p1.name} and ${p2.name}!`);
        return INTRO_MS;
      }
      case 'switch':
      case 'drag':
      case 'replace': {
        this.actionSignal.set(null);
        if (command !== 'replace' && this.withdrawFirst(args[0], line)) return WITHDRAW_MS;
        const pokemon = this.switchIn(args[0], args[1], args[2], command === 'replace');
        if (!pokemon || command === 'replace') return 0;
        this.emit('send-out', args[0]);
        if (command === 'drag') return this.say(`${this.label(args[0])} was dragged out!`);
        if (pokemon.side === 'p1' && !this.watching()) return this.say(`Go! ${pokemon.name}!`);
        return this.say(`${this.sidesSignal()[pokemon.side].name} sent out ${pokemon.name}!`);
      }
      case 'swap':
        return this.swap(args[0]);
      case 'detailschange':
      case '-formechange':
        this.updatePokemon(args[0], (p) => ({ ...p, ...parseDetails(args[1], this.dex) }));
        return 0;
      case '-mega':
        // |-mega|p1a: Charizard|Charizard|Charizardite Y: its Mega Stone is revealed.
        if (args[2]) this.updatePokemon(args[0], (p) => ({ ...p, item: args[2], lostItem: '' }));
        this.emit('mega', args[0]);
        return this.say(
          `${this.label(args[0])} has Mega Evolved into ${megaName(this.findPokemon(args[0])?.species, args[1])}!`,
        );
      case '-terastallize':
        this.updatePokemon(args[0], (p) => ({ ...p, tera: args[1] }));
        this.emit('tera', args[0]);
        return this.say(`${this.label(args[0])} has Terastallized into the ${args[1]}-type!`);
      case 'move': {
        this.critSlots.clear();
        const move = this.typedMove(args[0], args[1]);
        this.revealMove(args[0], move, tags);
        this.notePass(args[0], move);
        this.noteMove(args[0], move);
        this.actionSignal.set(this.moveAction(args[0], move, args[2], tags));
        return this.say(`${this.label(args[0])} used ${move}!`);
      }
      case 'cant':
        this.actionSignal.set(null);
        if (args[1] === 'recharge') this.updatePokemon(args[0], (p) => ({ ...p, volatiles: endVolatile(p.volatiles, 'mustrecharge') }));
        return this.say(cantText(args[0], args[1], args[2], names));
      case '-damage':
      case '-heal': {
        const before = this.findPokemon(args[0]);
        // A Pokémon brought to 0 HP stays on the field until its |faint| line, which animates it out.
        this.updatePokemon(args[0], (p) => ({ ...p, ...parseCondition(args[1], p.maxHp), fainted: p.fainted }));
        const after = this.findPokemon(args[0]);
        // The move's first hit on each target already blinked with the attacker's lunge; later hits
        // of a multi-hit move blink as their HP drops.
        if (command === '-damage' && !tags['from']) {
          const slot = this.slotOf(args[0]);
          if (slot && this.blinkedHits.has(slot)) this.blinkedHits.delete(slot);
          else this.emit('hit', args[0]);
        }
        if (command === '-damage' && effectName(tags['from']) === 'confusion') this.emit('confusion-hit', args[0]);
        const reason =
          command === '-damage'
            ? damageReason(args[0], tags, names)
            : healReason(args[0], tags, names);
        if (reason) this.addEntry('message', reason);
        if (before && after) this.logHpChange(args[0], before, after);
        return reason ? MESSAGE_MS : HP_MS;
      }
      case '-sethp':
        this.updatePokemon(args[0], (p) => ({ ...p, ...parseCondition(args[1], p.maxHp) }));
        return HP_MS;
      case '-status':
        this.updatePokemon(args[0], (p) => ({ ...p, status: args[1] }));
        this.showStatus(args[0], args[1]);
        return this.say(statusText(args[0], args[1], names));
      case '-curestatus':
        this.updatePokemon(args[0], (p) => ({ ...p, status: '' }));
        return this.say(cureText(args[0], args[1], names));
      case '-boost':
      case '-unboost': {
        const amount = Number(args[2]) || 0;
        this.changeBoost(args[0], args[1], (stage) => stage + (command === '-boost' ? amount : -amount));
        this.showStatChange(args[0], args[1], command === '-boost' ? amount : -amount);
        return this.say(boostText(args[0], args[1], amount, command === '-boost', names));
      }
      case '-setboost':
        this.changeBoost(args[0], args[1], () => Number(args[2]) || 0);
        return 0;
      case '-clearallboost':
        for (const side of ['p1', 'p2'] as const) {
          this.updateSide(side, (s) => ({ ...s, active: s.active.map((p) => (p ? { ...p, boosts: {} } : p)) }));
        }
        return this.say('All stat changes were eliminated!');
      case '-clearboost':
        this.updatePokemon(args[0], (p) => ({ ...p, boosts: {} }));
        return this.say(`${this.label(args[0])}'s stat changes were removed!`);
      case '-clearnegativeboost':
        this.updatePokemon(args[0], (p) => ({
          ...p,
          boosts: Object.fromEntries(Object.entries(p.boosts).filter(([, stage]) => stage > 0)),
        }));
        return 0;
      case '-invertboost':
        this.updatePokemon(args[0], (p) => ({
          ...p,
          boosts: Object.fromEntries(Object.entries(p.boosts).map(([stat, stage]) => [stat, -stage])),
        }));
        return 0;
      case '-copyboost': {
        // |-copyboost|SOURCE|TARGET: the source (Psych Up's user) copies the target's stages.
        const boosts = this.findPokemon(args[1])?.boosts ?? {};
        this.updatePokemon(args[0], (p) => ({ ...p, boosts: { ...boosts } }));
        return 0;
      }
      case '-supereffective':
        return this.say(`It's super effective on ${this.label(args[0], false)}!`);
      case '-resisted':
        return this.say(`It's not very effective on ${this.label(args[0], false)}...`);
      case '-crit': {
        const slot = this.slotOf(args[0]);
        if (slot) this.critSlots.add(slot);
        return this.say(`A critical hit on ${this.label(args[0], false)}!`);
      }
      case '-immune':
        return this.say(`It doesn't affect ${this.label(args[0], false)}...`);
      case '-miss':
        return this.say(`${this.label(args[1] ?? args[0])} avoided the attack!`);
      case '-fail': {
        // A Baton Pass with no one to pass to (or a Shed Tail without the HP) switches no one in.
        const slot = this.slotOf(args[0]);
        if (slot) this.passing.delete(slot);
        return this.say('But it failed!');
      }
      case '-notarget':
        return this.say('But there was no target...');
      case '-ohko':
        return this.say("It's a one-hit KO!");
      case '-hitcount':
        return this.say(`The Pokémon was hit ${args[1]} time${args[1] === '1' ? '' : 's'}!`);
      case '-prepare':
        return this.say(`${this.label(args[0])} is getting ready to use ${args[1]}!`);
      case '-transform': {
        // `|-transform|p1a: Ditto|p2a: Garchomp|[from] ability: Imposter`: it looks like its target
        // until it switches out (switching in takes the sprite from its own species again).
        const sprite = this.findPokemon(args[1])?.sprite;
        if (sprite) this.updatePokemon(args[0], (p) => ({ ...p, sprite }));
        this.addVolatile(args[0], 'Transform', parseIdent(args[1]).name);
        return this.say(`${this.label(args[0])} transformed into ${this.label(args[1], false)}!`);
      }
      case '-singleturn':
        if (isSideGuard(args[1])) this.emit('side-guard', args[0]);
        else if (isProtection(args[1])) this.emit('protect', args[0]);
        this.addVolatile(args[0], args[1], undefined, 'turn');
        return this.sayIf(singleTurnText(args[0], args[1], names, tags));
      case '-activate':
        // Protect (and the like) blocking a move shows its shield again.
        if (isSideGuard(args[1])) this.emit('side-guard', args[0]);
        else if (isProtection(args[1])) this.emit('protect', args[0]);
        // Confused before its move: the stars circle its head again.
        else if (effectName(args[1]) === 'confusion') this.emit('confused', args[0]);
        // A hit taken by the substitute: the doll blinks.
        else if (effectName(args[1]) === 'Substitute') this.emit('hit', args[0]);
        // A binding move (Fire Spin, Wrap…) starting, or Mean Look, Block… holding it in.
        if (isTrapping(args[1]) || args[1] === 'trapped') this.addVolatile(args[0], args[1]);
        return this.sayIf(activateText(args[0], args[1], names));
      case '-start':
      case '-end':
        if (effectName(args[1]) === 'confusion') this.emit(command === '-start' ? 'confused' : 'confusion-end', args[0]);
        if (effectName(args[1]) === 'Substitute') {
          this.updatePokemon(args[0], (p) => ({ ...p, substitute: command === '-start' }));
          this.emit(command === '-start' ? 'substitute' : 'substitute-end', args[0]);
        } else if (command === '-end') {
          this.updatePokemon(args[0], (p) => ({ ...p, volatiles: endVolatile(p.volatiles, args[1]) }));
        } else {
          // Infatuated with whoever caused it: the ability's or item's owner, or the move's user.
          const source = effectName(args[1]) === 'Attract' ? (tags['of'] ?? this.lastMover) : '';
          this.addVolatile(args[0], args[1], source ? parseIdent(source).name : args[2]);
        }
        return this.sayIf(volatileText(args[0], args[1], command === '-end', names, args[2]));
      case '-ability':
        return this.say(abilityText(args[0], args[1], tags, names), 'minor');
      case '-item':
        return this.say(itemText(args[0], args[1], tags, names));
      case '-enditem':
        // A berry eaten: by its holder, or stolen and eaten by the one that hit it (Bug Bite, Pluck).
        if ('eat' in tags) this.emit('berry', args[0], args[1]);
        else if (tags['from'] === 'stealeat' && tags['of']) this.emit('berry', tags['of'], args[1]);
        return this.say(endItemText(args[0], args[1], tags, names));
      case '-weather':
        return this.changeWeather(args[0], tags);
      case '-fieldstart':
      case '-fieldend':
        this.changeFieldCondition(effectName(args[0]), command === '-fieldstart');
        this.abilityFrom(tags);
        return this.say(fieldText(args[0], command === '-fieldend', names, tags));
      case '-sidestart':
      case '-sideend':
        this.changeSideCondition(args[0], effectName(args[1]), command === '-sidestart');
        return this.say(sideText(args[0], args[1], command === '-sideend', names));
      case '-fieldactivate':
        return effectName(args[0]) === 'Perish Song'
          ? this.say('All Pokémon that heard the song will faint in three turns!')
          : 0;
      case '-swapsideconditions':
        this.fieldSignal.update((f) => ({ ...f, sides: { p1: f.sides.p2, p2: f.sides.p1 } }));
        return this.say('The effects on both sides of the field were swapped!');
      case '-singlemove':
        this.addVolatile(args[0], args[1], undefined, 'move');
        return 0;
      case '-mustrecharge':
        this.addVolatile(args[0], 'mustrecharge');
        return 0;
      case 'upkeep':
        this.afterUpkeep = true;
        this.actionSignal.set(null);
        return 0;
      case 'faint':
        this.emit('faint', args[0]);
        this.updatePokemon(args[0], (p) => ({ ...p, hp: 0, fainted: true, substitute: false, volatiles: {} }));
        return this.say(`${this.label(args[0])} fainted!`);
      case 'turn':
        this.afterUpkeep = false;
        this.dropAllVolatiles('turn');
        this.passing.clear();
        this.actionSignal.set(null);
        this.turnSignal.set(Number(args[0]));
        this.addEntry('turn', `Turn ${args[0]}`);
        return 0;
      case 'win':
        this.actionSignal.set(null);
        this.winnerSignal.set(args[0]);
        this.resultSignal.set(args[0] === this.sidesSignal().p1.name ? 'win' : 'loss');
        // Our own battles end on the victory or the defeat theme; watched ones on the victory's.
        this.music.end(this.watching() || this.resultSignal() === 'win');
        return this.say(`${args[0]} won the battle!`, 'result');
      case 'tie':
        this.actionSignal.set(null);
        this.resultSignal.set('tie');
        this.music.end(this.watching());
        return this.say('The battle ended in a tie!', 'result');
      case '-message':
        return this.say(args[0]);
      case 'rated':
        // `|rated|Tournament battle` (with a message) doesn't change anyone's rating.
        this.ratedSignal.set(!rest.join('|'));
        return 0;
      case 'raw':
        this.addRating(rest.join('|'));
        return 0;
      case 'c':
      case 'c:':
      case 'chat':
        // Chat caught up on or in a replay, in its place among the battle's lines.
        this.addChat(line);
        return 0;
      default:
        // Timers, joins, ratings (|t:|, |j|, |inactive|…) and effects with nothing to show.
        return 0;
    }
  }

  /**
   * `|c|☆Jorge|gg`, `|c:|1712345678|+Someone|/me waves`: a chat message in the log, popped up over the
   * field. Commands other than `/me` (server HTML such as `/raw` or `/uhtml`) are skipped: the app never
   * renders HTML from the server.
   */
  private addChat(line: string): void {
    const parts = line.slice(1).split('|');
    const [author, ...words] = parts[0] === 'c:' ? parts.slice(2) : parts.slice(1);
    let text = words.join('|');
    // The rank symbol first (' ' for none), an `@status` after: ` Jorge@!` → Jorge.
    let name = (author ?? '').slice(1).split('@')[0].trim();
    // Ours, back from the server: it went out.
    if (toId(name) === this.login.userId()) this.answerChat(null);
    if (text.startsWith('/me ')) {
      // An action reads as one sentence: "Jorge waves".
      text = `${name} ${text.slice(4)}`;
      name = '';
    } else if (text.startsWith('//')) {
      text = text.slice(1);
    } else if (text.startsWith('/')) {
      return;
    }
    if (text.trim()) this.showChat({ id: this.nextLogId++, kind: 'chat', text, author: name });
  }

  private showChat(entry: BattleLogEntry): void {
    this.logSignal.update((log) => [...log, entry].slice(-MAX_LOG_ENTRIES));
    this.chatPopSignal.set(entry);
    this.renderScheduler.request();
  }

  /** `|raw|X's rating: 1822 &rarr; <strong>1839</strong><br />(+17 for winning)`, for X's side. */
  private addRating(html: string): void {
    const rating = parseRatingChange(html);
    if (!rating) return;
    const { p1, p2 } = this.sidesSignal();
    const side = [p1, p2].find((s) => toId(s.name) === toId(rating.name));
    if (!side) return;
    this.ratingsSignal.update((ratings) => ({ ...ratings, [side.id]: { ...rating, name: side.name } }));
    this.addEntry('message', `${side.name}'s rating: ${rating.before} → ${rating.after} (${signed(rating.change)})`);
  }

  private say(text: string, kind: BattleLogEntry['kind'] = 'message'): number {
    this.addEntry(kind, text);
    return MESSAGE_MS;
  }

  private sayIf(text: string | null): number {
    return text ? this.say(text) : 0;
  }

  private addEntry(kind: BattleLogEntry['kind'], text: string): void {
    const entry = { id: this.nextLogId++, kind, text };
    this.logSignal.update((log) => [...log, entry].slice(-MAX_LOG_ENTRIES));
  }

  /**
   * `|move|p2a: Charizard|Heat Wave|p1b: Farigiraf|[spread] p1a,p1b`: the attacker's slot and every
   * slot it's aimed at (all of them for a spread move; none for [still] moves with no target).
   */
  private moveAction(attacker: string, move: string, target: string | undefined, tags: Record<string, string>): MoveAction | null {
    this.blinkedHits.clear();
    const from = this.slotOf(attacker);
    if (!from) return null;
    let targets: string[];
    if (tags['spread']) targets = tags['spread'].split(',').filter((slot) => /^p[12][ab]$/.test(slot));
    else if ('notarget' in tags || !target) targets = [];
    else targets = [this.slotOf(target)].filter((slot): slot is string => !!slot);
    // The Champions data is Gen 9's: older generations' moves come from their own data.
    const gen = this.genSignal();
    const dexMove = gen === 9 ? this.dex.move(move) : undefined;
    const type = fieldMoveType(move, this.fieldSignal()) ?? dexMove?.type ?? moveType(move, gen);
    const category = dexMove?.category ?? moveInfo(move, gen)?.category ?? '';
    const hits = this.upcomingHits().filter((slot) => slot !== from);
    hits.forEach((slot) => this.blinkedHits.add(slot));
    return { id: this.nextEventId++, attacker: from, targets, hits, move, type, category, effectiveness: this.upcomingEffectiveness() };
  }

  /**
   * The slots a move's own damage lands on: the `|-damage|` lines without a [from] that follow it in
   * the queue, before the next action. A turn's log arrives in one frame, so they're already queued.
   */
  private upcomingHits(): string[] {
    const hits = new Set<string>();
    for (const line of this.queue) {
      const [command, ...rest] = line.slice(1).split('|');
      if (ACTION_BOUNDARIES.has(command)) break;
      if (command !== '-damage') continue;
      const { args, tags } = splitArgs(rest);
      const slot = !tags['from'] && args[0] ? this.slotOf(args[0]) : null;
      if (slot) hits.add(slot);
    }
    return [...hits];
  }

  /**
   * How effective the move is on each slot it hits, from the `|-supereffective|` and `|-resisted|`
   * lines that follow it in the queue (before the next action), for the hits' sounds.
   */
  private upcomingEffectiveness(): MoveAction['effectiveness'] {
    const effectiveness: MoveAction['effectiveness'] = {};
    for (const line of this.queue) {
      const [command, ...rest] = line.slice(1).split('|');
      if (ACTION_BOUNDARIES.has(command)) break;
      if (command !== '-supereffective' && command !== '-resisted') continue;
      const slot = this.slotOf(splitArgs(rest).args[0] ?? '');
      if (slot) effectiveness[slot] = command === '-supereffective' ? 'super' : 'resisted';
    }
    return effectiveness;
  }

  /**
   * Spots abilities and held items taking effect, for the pop-ups over their Pokémon. Whose they
   * are depends on the line: `|-ability|`, `|-enditem|`, `|-item|` and `|-activate|…|ability: X`
   * (or item: X) name the Pokémon first; a `[from] ability:` or `[from] item:` tag belongs to the
   * `[of]` Pokémon for effects it causes on others (weather, terrain, Rough Skin, Rocky Helmet, and
   * ALLY_EFFECT_ABILITIES such as Curious Medicine on its ally) and
   * to the first Pokémon otherwise (Stamina, Leftovers, Life Orb; for Water Absorb's heal `[of]` is
   * the attacker).
   */
  private announceEffects(command: string, args: string[], tags: Record<string, string>): void {
    const from = tags['from'] ?? '';
    const owner = SOURCE_OWNS_EFFECT.includes(command) && tags['of'] ? tags['of'] : args[0];
    if (command === '-ability') {
      // Trace shows as Trace, not as the ability it copied.
      this.announce(args[0], 'ability', from.startsWith('ability: ') ? effectName(from) : args[1]);
    } else if (command === '-activate' && /^(ability|item): /.test(args[1] ?? '')) {
      this.announce(args[0], args[1].startsWith('item: ') ? 'item' : 'ability', effectName(args[1]));
    } else if (from.startsWith('ability: ')) {
      const ability = effectName(from);
      // Curious Medicine and the like act on an ally: theirs is the `[of]` Pokémon, not the one named.
      const ofOwns = SOURCE_OWNS_EFFECT.includes(command) || (ALLY_EFFECT_ABILITIES.has(ability) && !!tags['of']);
      this.announce(ofOwns ? tags['of'] : args[0], 'ability', ability);
    }
    // |-miss|ATTACKER|TARGET: the target avoided it (a miss with no target has nobody to show it on).
    if (command === '-miss' && args[1]) this.popup(args[1], 'notice', 'Missed!');
    // An immunity from an ability (Levitate, Water Absorb…) already pops up as that ability.
    if (command === '-immune' && !from.startsWith('ability: ')) this.popup(args[0], 'notice', 'No effect!');
    // A move whose conditions weren't met (Sucker Punch, Fake Out after the first turn…); an
    // ability stopping it already pops up as that ability.
    if (command === '-fail' && !from.startsWith('ability: ')) this.popup(args[0], 'notice', 'Failed!');
    if (command === '-notarget' && args[0]) this.popup(args[0], 'notice', 'No target!');
    if (command === 'cant') this.popup(args[0], 'notice', cantLabel(args[1] ?? ''));
    if (command === '-start') {
      const perish = perishCount(effectName(args[1]));
      if (perish) this.popup(args[0], 'notice', `Perish in ${perish} turn${perish === 1 ? '' : 's'}`);
    }
    // A Frisk reveal isn't the item doing anything.
    if ((command === '-enditem' || command === '-item') && from !== 'ability: Frisk') {
      this.popup(args[0], 'item', args[1]);
    } else if (from.startsWith('item: ')) {
      this.announce(owner, 'item', effectName(from));
    }
    // What the item lines tell about who holds what: a new item (Trick, Frisk's reveal), one gone.
    if (command === '-item' && args[1]) this.updatePokemon(args[0], (p) => ({ ...p, item: args[1], lostItem: '' }));
    if (command === '-enditem' && args[1]) this.updatePokemon(args[0], (p) => ({ ...p, item: '', lostItem: args[1] }));
  }

  /**
   * An ability or item taking effect: it pops up over its owner, who is known to have it from then on.
   * A berry's effect comes after the line that ate it: that one stays gone.
   */
  private announce(ident: string | undefined, kind: 'ability' | 'item', name: string): void {
    this.popup(ident, kind, name);
    if (!ident || !name) return;
    this.updatePokemon(ident, (p) => {
      if (kind === 'ability') return { ...p, ability: name };
      return p.lostItem === name ? p : { ...p, item: name, lostItem: '' };
    });
  }

  /**
   * A move its user has chosen, one of its own (not one called by another move, bounced back or copied
   * by an ability; a move it's locked into repeats one already known). Struggle isn't one of its moves.
   */
  private revealMove(ident: string, move: string, tags: Record<string, string>): void {
    const from = tags['from'];
    if (!move || move === 'Struggle' || (from !== undefined && from !== 'lockedmove')) return;
    this.updatePokemon(ident, (p) => (p.moves.includes(move) ? p : { ...p, moves: [...p.moves, move] }));
  }

  private popup(ident: string | undefined, kind: EffectPopup['kind'], name: string | undefined): void {
    const slot = ident && this.slotOf(ident);
    if (!slot || !name) return;
    const popup = { id: this.nextEventId++, slot, kind, name };
    this.popupsSignal.update((popups) => [...popups, popup].slice(-MAX_POPUPS));
  }

  private emit(kind: FieldEvent['kind'], ident: string, item?: string): void {
    const slot = this.slotOf(ident);
    if (slot) this.fieldEventSignal.set({ id: this.nextEventId++, kind, slot, ...(item ? { item } : {}) });
  }

  /** "p2a: Charizard" → "p2a"; "p2: Charizard" (no slot) → the slot it's active in, if any. */
  private slotOf(ident: string): string | null {
    const { side, slot } = parseIdent(ident);
    if (!side) return null;
    if (slot !== undefined) return `${side}${'ab'[slot]}`;
    const pokemon = this.findPokemon(ident);
    const index = this.sidesSignal()[side].active.findIndex((p) => !!pokemon && p?.ident === pokemon.ident);
    return index >= 0 ? `${side}${'ab'[index]}` : null;
  }

  /** "[The opposing Charizard's Drought]" before the effect an ability caused. */
  private abilityFrom(tags: Record<string, string>): void {
    if (tags['from']?.startsWith('ability: ') && tags['of']) {
      this.addEntry('minor', `[${this.label(tags['of'])}'s ${effectName(tags['from'])}]`);
    }
  }

  /** `|-weather|RainDance|[from] ability: Drizzle`, `|-weather|none`; the end-of-turn reminders show nothing. */
  private changeWeather(weather: string, tags: Record<string, string>): number {
    if ('upkeep' in tags) return 0;
    if (weather === 'none') {
      const ended = this.fieldSignal().weather;
      this.fieldSignal.update((f) => ({ ...f, weather: null }));
      return ended ? this.say(weatherText(ended.id, true)) : 0;
    }
    this.fieldSignal.update((f) => ({ ...f, weather: weatherCondition(weather, this.startTurn()) }));
    this.abilityFrom(tags);
    return this.say(weatherText(weather, false));
  }

  /**
   * The first turn a condition starting now counts for: this one, or the next once the turn's
   * end-of-turn effects have run (a weather set by a Pokémon switched in after a faint). Before
   * turn 1 (leads' abilities), turn 1.
   */
  private startTurn(): number {
    const turn = this.turnSignal();
    return turn === 0 || this.afterUpkeep ? turn + 1 : turn;
  }

  /** Terrains replace each other; rooms (Trick Room, Gravity…) sit side by side. */
  private changeFieldCondition(id: string, starting: boolean): void {
    this.fieldSignal.update((f) => {
      if (isTerrain(id)) return { ...f, terrain: starting ? namedCondition(id, this.startTurn()) : null };
      const rooms = f.rooms.filter((room) => room.id !== id);
      return { ...f, rooms: starting ? [...rooms, namedCondition(id, this.startTurn())] : rooms };
    });
  }

  /** "p1: Name" + "Tailwind"; a second layer of Spikes stacks on the first. */
  private changeSideCondition(sideArg: string, id: string, starting: boolean): void {
    const side = sideArg.slice(0, 2);
    if (side !== 'p1' && side !== 'p2') return;
    this.fieldSignal.update((f) => {
      const current = f.sides[side];
      const existing = current.find((c) => c.id === id);
      let next: FieldCondition[];
      if (!starting) next = current.filter((c) => c.id !== id);
      else if (existing) next = current.map((c) => (c.id === id ? { ...c, layers: c.layers + 1 } : c));
      else next = [...current, namedCondition(id, this.startTurn())];
      return { ...f, sides: { ...f.sides, [side]: next } };
    });
  }

  /** A stat stage, kept between -6 and +6; stages back at 0 are dropped. */
  private changeBoost(ident: string, stat: string, change: (stage: number) => number): void {
    this.updatePokemon(ident, (p) => {
      const stage = Math.max(-6, Math.min(6, change(p.boosts[stat] ?? 0)));
      const boosts = { ...p.boosts, [stat]: stage };
      if (stage === 0) delete boosts[stat];
      return { ...p, boosts };
    });
  }

  /**
   * Showdown's "(The opposing Garchomp lost 45% of its health!)", as a minor log line, and the same
   * change for the field's label over the Pokémon.
   */
  private logHpChange(ident: string, before: BattlePokemon, after: BattlePokemon): void {
    const percent = (p: BattlePokemon) => (p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0);
    const change = Math.round(percent(after) - percent(before));
    if (change === 0) return;
    const verb = change < 0 ? 'lost' : 'restored';
    this.addEntry('minor', `(${this.label(ident)} ${verb} ${Math.abs(change)}% of its health!)`);
    const slot = this.slotOf(ident);
    if (slot) {
      const crit = change < 0 && this.critSlots.delete(slot);
      const hpChange = { id: this.nextEventId++, slot, change, crit };
      this.hpChangesSignal.update((changes) => [...changes, hpChange].slice(-MAX_POPUPS));
    }
  }

  /** A status just inflicted, for the field's label over the Pokémon ("Burned!"). */
  private showStatus(ident: string, status: string | undefined): void {
    const slot = this.slotOf(ident);
    if (!slot || !status) return;
    const change = { id: this.nextEventId++, slot, status };
    this.statusChangesSignal.update((changes) => [...changes, change].slice(-MAX_POPUPS));
  }

  /** A stat stage raised or lowered, for the field's label and arrows over the Pokémon ("Attack +1"). */
  private showStatChange(ident: string, stat: string | undefined, amount: number): void {
    const slot = this.slotOf(ident);
    if (!slot || !stat || amount === 0) return;
    const change = { id: this.nextEventId++, slot, stat, amount };
    this.statChangesSignal.update((changes) => [...changes, change].slice(-MAX_POPUPS));
  }

  /**
   * Hidden Power as its type's ("Hidden Power Dark") when it's one of ours: the log names it plainly,
   * our request has its type. The opponents' stays plain (the battle never says theirs).
   */
  private typedMove(ident: string, move: string): string {
    if (move !== 'Hidden Power' || this.watching()) return move;
    const { side, name } = parseIdent(ident);
    if (side !== 'p1') return move;
    const own = this.teamSignal().find((p) => p.ident.slice(p.ident.indexOf(': ') + 2) === name);
    const id = own?.moves.find((m) => m.startsWith('hiddenpower') && m !== 'hiddenpower');
    return (id && moveInfo(id, this.genSignal())?.name) || move;
  }

  private findPokemon(ident: string): BattlePokemon | undefined {
    const { side, name } = parseIdent(ident);
    return side
      ? this.sidesSignal()[side].pokemon.find((p) => p.ident === `${side}: ${name}`)
      : undefined;
  }

  /** "Garchomp", or "the opposing Garchomp" (capitalised at the start of a sentence). */
  private label(ident: string, sentenceStart = true): string {
    const { side, name } = parseIdent(ident);
    if (side !== 'p2') return name;
    return `${sentenceStart ? 'The' : 'the'} opposing ${name}`;
  }

  /** `replacing`: Illusion broken (`|replace|`): the one on the field is the same, its conditions stay. */
  private switchIn(ident: string, details: string, condition: string, replacing = false): BattlePokemon | undefined {
    const { side, slot, name } = parseIdent(ident);
    if (!side || slot === undefined) return undefined;
    const key = `${side}: ${name}`;
    const known = this.sidesSignal()[side].pokemon.find((p) => p.ident === key);
    const base: BattlePokemon = known ?? {
      ident: key,
      side,
      name,
      species: '',
      sprite: '',
      level: 100,
      gender: '',
      hp: 0,
      maxHp: 100,
      status: '',
      fainted: false,
      boosts: {},
      moves: [],
      item: '',
      lostItem: '',
      ability: '',
      volatiles: {},
      cameIn: 0,
      lastMove: '',
    };
    // Stat stages, volatile conditions and the substitute go with switching out, unless they're passed on.
    const pass = this.passing.get(`${side}${'ab'[slot]}`);
    this.passing.delete(`${side}${'ab'[slot]}`);
    const leaving = pass ? this.sidesSignal()[side].active[slot] : null;
    const replaced = replacing ? this.sidesSignal()[side].active[slot] : null;
    const pokemon: BattlePokemon = {
      ...base,
      ...parseDetails(details, this.dex),
      ...parseCondition(condition, base.maxHp),
      boosts: leaving && pass === 'batonpass' ? { ...leaving.boosts } : {},
      substitute: !!leaving?.substitute,
      volatiles: leaving && pass === 'batonpass' ? batonPassed(leaving.volatiles) : {},
      // Its first turn out is the next one (leads: turn 1).
      cameIn: this.turnSignal() + 1,
      lastMove: '',
      // Illusion broken: `replace` carries no HP, the one shown for the disguise was already its own.
      ...(replaced
        ? {
            hp: replaced.hp,
            maxHp: replaced.maxHp,
            status: replaced.status,
            fainted: replaced.fainted,
            boosts: replaced.boosts,
            substitute: replaced.substitute,
            volatiles: replaced.volatiles,
            cameIn: replaced.cameIn,
            lastMove: replaced.lastMove,
          }
        : {}),
    };
    this.updateSide(side, (s) => ({
      ...s,
      active: s.active.map((p, i) => (i === slot ? pokemon : p)),
      pokemon: known
        ? s.pokemon.map((p) => (p.ident === key ? pokemon : p))
        : [...s.pokemon, pokemon],
    }));
    return pokemon;
  }

  /** Baton Pass (or Shed Tail) used from a slot: the next Pokémon switched in there takes what it passes. */
  private notePass(ident: string, move: string): void {
    const id = toId(move);
    const kind = id === 'batonpass' || id === 'zbatonpass' ? 'batonpass' : id === 'shedtail' ? 'shedtail' : null;
    const slot = kind && this.slotOf(ident);
    if (kind && slot) this.passing.set(slot, kind);
  }

  /**
   * A move used: it's the Pokémon's last move from now (what Encore holds it to), and what lasted
   * until it moved again (Destiny Bond, Glaive Rush…) is gone.
   */
  private noteMove(ident: string, move: string): void {
    this.lastMover = ident;
    this.updatePokemon(ident, (p) => ({ ...p, lastMove: move, volatiles: dropVolatiles(p.volatiles, 'move') }));
  }

  /** A volatile condition starting on a Pokémon, counted from the turn it first counts for. */
  private addVolatile(ident: string, effect: string, extra?: string, until?: Volatile['until']): void {
    this.updatePokemon(ident, (p) => ({ ...p, volatiles: startVolatile(p.volatiles, effect, this.startTurn(), extra, until) }));
  }

  /** The turn's over: what lasted only for it (Protect, Helping Hand…) is gone from everyone. */
  private dropAllVolatiles(until: Volatile['until']): void {
    const drop = (p: BattlePokemon) => (Object.values(p.volatiles).some((v) => v.until === until) ? { ...p, volatiles: dropVolatiles(p.volatiles, until) } : p);
    for (const side of ['p1', 'p2'] as const) {
      this.updateSide(side, (s) => ({ ...s, active: s.active.map((p) => p && drop(p)), pokemon: s.pokemon.map(drop) }));
    }
  }

  /**
   * A switch into a slot whose Pokémon is still standing plays in two steps: first it's withdrawn
   * ("Garchomp, come back!", animated), then the same line is applied again to bring out the new one.
   * Returns true when it has queued the line again after the withdrawal.
   */
  private withdrawFirst(ident: string, line: string): boolean {
    if (this.withdrawn === line) {
      this.withdrawn = null;
      return false;
    }
    const { side, slot, name } = parseIdent(ident);
    if (!side || slot === undefined) return false;
    const leaving = this.sidesSignal()[side].active[slot];
    if (!leaving || leaving.fainted || leaving.ident === `${side}: ${name}`) return false;
    const player = this.sidesSignal()[side].name;
    this.addEntry(
      'message',
      side === 'p1' && !this.watching() ? `${leaving.name}, come back!` : `${player} withdrew ${leaving.name}!`,
    );
    this.emit('withdraw', ident);
    this.withdrawn = line;
    this.queue.unshift(line);
    return true;
  }

  /** `|swap|p1a: Indeedee|1`: the two active Pokémon trade places (Ally Switch). */
  private swap(ident: string): number {
    const { side } = parseIdent(ident);
    if (!side) return 0;
    const [a, b] = this.sidesSignal()[side].active;
    this.updateSide(side, (s) => ({ ...s, active: [b, a] }));
    if (!a || !b) return 0;
    return this.say(`${this.label(a.ident)} and ${this.label(b.ident, false)} switched places!`);
  }

  /** Updates a Pokémon wherever it appears (its slot and its side's list). */
  private updatePokemon(ident: string, change: (pokemon: BattlePokemon) => BattlePokemon): void {
    const { side, name } = parseIdent(ident);
    if (!side) return;
    const key = `${side}: ${name}`;
    const apply = (p: BattlePokemon | null) => (p && p.ident === key ? change(p) : p);
    this.updateSide(side, (s) => ({
      ...s,
      active: s.active.map(apply),
      pokemon: s.pokemon.map((p) => apply(p)!),
    }));
  }

  private updateSide(id: SideId, change: (side: BattleSide) => BattleSide): void {
    this.sidesSignal.update((sides) => ({ ...sides, [id]: change(sides[id]) }));
  }
}

/** "Charizard-Mega-Y" → "Mega Charizard Y"; the base species' name before the forme is known. */
function megaName(species: string | undefined, base: string): string {
  const match = /^(.+)-Mega(?:-(\w+))?$/.exec(species ?? '');
  if (!match) return `Mega ${base}`;
  return match[2] ? `Mega ${match[1]} ${match[2]}` : `Mega ${match[1]}`;
}

/** "p1a: Garchomp" → side p1, slot 0, name Garchomp ("p1: Garchomp" has no slot). */
export function parseIdent(ident: string): { side?: SideId; slot?: number; name: string } {
  const match = /^(p[12])([ab]?): (.*)$/.exec(ident ?? '');
  if (!match) return { name: ident ?? '' };
  return {
    side: match[1] as SideId,
    slot: match[2] ? SLOT_INDEX[match[2]] : undefined,
    name: match[3],
  };
}

/**
 * "Garchomp-Mega, L50, M" (or "Eiscue-Noice, L88, M, tera:Ground") → species, level, gender, its
 * sprite and its Tera type once Terastallized.
 */
export function parseDetails(
  details: string,
  dex: ChampionsDex,
): Pick<BattlePokemon, 'species' | 'sprite' | 'level' | 'gender' | 'tera'> {
  const [species, ...parts] = details.split(', ');
  const level = parts.find((part) => /^L\d+$/.test(part));
  const gender = parts.find((part) => part === 'M' || part === 'F') ?? '';
  const tera = parts.find((part) => part.startsWith('tera:'))?.slice('tera:'.length);
  const sprite = dex.species(species)?.sprite ?? dex.megaById(species)?.sprite ?? spriteId(species);
  // Details without a Tera type don't undo a Terastallization already seen.
  return { species, sprite, level: level ? Number(level.slice(1)) : 100, gender, ...(tera ? { tera } : {}) };
}

/** "143/180 par" or "0 fnt" → HP, max HP, status and whether it fainted. */
export function parseCondition(
  condition: string,
  maxHp: number,
): Pick<BattlePokemon, 'hp' | 'maxHp' | 'status' | 'fainted'> {
  const [hpPart = '0', status = ''] = (condition ?? '').split(' ');
  if (status === 'fnt' || hpPart === '0') return { hp: 0, maxHp, status: '', fainted: true };
  const [hp, max] = hpPart.split('/').map(Number);
  return { hp, maxHp: max || maxHp, status, fainted: false };
}
