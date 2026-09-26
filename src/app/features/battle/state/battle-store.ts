import { Service, inject, signal } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import {
  BattleConnection,
  BattleFieldState,
  FieldCondition,
  EffectPopup,
  HpChange,
  StatusChange,
  FieldEvent,
  MoveAction,
  BattleLogEntry,
  BattlePokemon,
  BattleRequest,
  BattleSide,
  Replay,
  RequestPokemon,
  SideId,
} from '@features/battle/models/battle';
import { toId } from '@shared/utils/to-id';
import { BattleSession } from './battle-session';
import { emptyField, isTerrain, namedCondition, weatherCondition } from './field-conditions';
import {
  BattleNames,
  abilityText,
  activateText,
  boostText,
  cantText,
  cureText,
  damageReason,
  effectName,
  endItemText,
  fieldText,
  healReason,
  isProtection,
  itemText,
  sideText,
  singleTurnText,
  splitArgs,
  statusText,
  volatileText,
  weatherText,
} from './battle-text';

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
const INTRO_MS = 4000;
/** Log entries kept (a whole battle, usually), to keep the DOM small on the console. */
const MAX_LOG_ENTRIES = 250;
/** How long a request waits for its log before it's shown anyway (a request may come alone). */
const LOG_WAIT_MS = 1000;
const SLOT_INDEX: Record<string, number> = { a: 0, b: 1 };
/** Lines whose `[from]` ability or item belongs to the `[of]` Pokémon (the one causing the effect). */
const SOURCE_OWNS_EFFECT = ['-weather', '-fieldstart', '-damage', '-item', '-enditem', '-sidestart'];
/** Pop-ups kept for the field to pick up (it only shows the ones it hasn't seen). */
const MAX_POPUPS = 8;
/** Lines that start the next action: a move's own damage lines come before any of these. */
const ACTION_BOUNDARIES = new Set(['move', 'switch', 'drag', 'cant', 'turn', 'upkeep', 'win', 'tie']);

const emptySide = (id: SideId): BattleSide => ({
  id,
  name: '',
  active: [null, null],
  pokemon: [],
  preview: [],
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

  private readonly sidesSignal = signal<Record<SideId, BattleSide>>({
    p1: emptySide('p1'),
    p2: emptySide('p2'),
  });
  private readonly logSignal = signal<readonly BattleLogEntry[]>([]);
  private readonly turnSignal = signal(0);
  private readonly requestSignal = signal<BattleRequest | null>(null);
  private readonly resultSignal = signal<'win' | 'loss' | 'tie' | null>(null);
  private readonly winnerSignal = signal('');
  private readonly playingSignal = signal(false);
  private readonly teamSignal = signal<readonly RequestPokemon[]>([]);
  private readonly battleIdSignal = signal(0);
  private readonly replaySignal = signal<Replay | null>(null);
  private readonly pausedSignal = signal(false);
  private readonly speedSignal = signal(1);
  private readonly fieldSignal = signal<BattleFieldState>(emptyField());
  private readonly actionSignal = signal<MoveAction | null>(null);
  private readonly fieldEventSignal = signal<FieldEvent | null>(null);
  private readonly popupsSignal = signal<readonly EffectPopup[]>([]);
  private readonly hpChangesSignal = signal<readonly HpChange[]>([]);
  private readonly statusChangesSignal = signal<readonly StatusChange[]>([]);
  private readonly introSignal = signal<{ p1: string; p2: string } | null>(null);
  private readonly startedSignal = signal(false);

  readonly sides = this.sidesSignal.asReadonly();
  /** The battle log so far, oldest first. */
  readonly log = this.logSignal.asReadonly();
  readonly turn = this.turnSignal.asReadonly();
  /** What the player has to choose now; null while the log plays or the server is thinking. */
  readonly request = this.requestSignal.asReadonly();
  /** Set once the battle is over, from p1's point of view. */
  readonly result = this.resultSignal.asReadonly();
  /** The winner's name once the battle is over ('' for a tie). */
  readonly winner = this.winnerSignal.asReadonly();
  /** Whether log steps are still being shown. */
  readonly playing = this.playingSignal.asReadonly();
  /** The player's whole team as of the last request (it stays while the turn plays). */
  readonly team = this.teamSignal.asReadonly();
  /** Changes with every new battle, so per-battle state elsewhere can start over. */
  readonly battleId = this.battleIdSignal.asReadonly();
  /** The replay being watched; null in a battle the player plays. */
  readonly replay = this.replaySignal.asReadonly();
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
  /** The players' names while the battle's title shows, at its start; null otherwise. */
  readonly intro = this.introSignal.asReadonly();
  /** The battle has begun and its title has gone: the teams at a glance show from then on. */
  readonly started = this.startedSignal.asReadonly();

  private connection: BattleConnection | null = null;
  private queue: string[] = [];
  private pendingRequest: BattleRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextLogId = 0;
  private nextEventId = 0;
  /** The switch line whose withdrawal has just played, so applying it again brings the new Pokémon. */
  private withdrawn: string | null = null;
  /** Set while a request waits for the log that should follow it. */
  private logWait: ReturnType<typeof setTimeout> | null = null;
  /** Set once the turn's end-of-turn effects have run: what starts now counts from the next turn. */
  private afterUpkeep = false;
  /** Slots the current move's lunge has already blinked: their first damage line doesn't blink again. */
  private readonly blinkedHits = new Set<string>();

  /** How the log names Pokémon and teams: from p1's side, which is the player's (or the one watched). */
  private readonly names: BattleNames = {
    pokemon: (ident, sentenceStart = true) => this.label(ident, sentenceStart),
    team: (side, sentenceStart = true) => {
      const id = side.slice(0, 2) as SideId;
      if (this.replaySignal()) return `${this.sidesSignal()[id]?.name ?? id}'s team`;
      if (id === 'p1') return sentenceStart ? 'Your team' : 'your team';
      return sentenceStart ? 'The opposing team' : 'the opposing team';
    },
  };

  start(connection: BattleConnection): void {
    this.reset();
    this.battleIdSignal.update((id) => id + 1);
    this.replaySignal.set(connection.replay ?? null);
    this.session.setActive(true);
    this.connection = connection;
    connection.start((frame) => this.receive(frame));
  }

  /** Leaves the battle for good: the battle page can be left again. */
  close(): void {
    this.reset();
    this.replaySignal.set(null);
    this.session.setActive(false);
  }

  private reset(): void {
    this.stop();
    this.sidesSignal.set({ p1: emptySide('p1'), p2: emptySide('p2') });
    this.logSignal.set([]);
    this.turnSignal.set(0);
    this.resultSignal.set(null);
    this.winnerSignal.set('');
    this.requestSignal.set(null);
    this.teamSignal.set([]);
    this.pausedSignal.set(false);
    this.fieldSignal.set(emptyField());
    this.afterUpkeep = false;
    this.actionSignal.set(null);
    this.fieldEventSignal.set(null);
    this.popupsSignal.set([]);
    this.hpChangesSignal.set([]);
    this.statusChangesSignal.set([]);
    this.introSignal.set(null);
    this.startedSignal.set(false);
    this.withdrawn = null;
    this.blinkedHits.clear();
  }

  /** Sends the turn's choices ("move 1 2, switch 3"); the request is used up. */
  choose(choice: string): void {
    this.requestSignal.set(null);
    this.connection?.choose(choice);
  }

  forfeit(): void {
    this.connection?.forfeit();
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

  private stop(): void {
    this.connection?.stop();
    this.connection = null;
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
    for (const line of frame.split('\n')) {
      // A room frame starts with ">battle-…"; this screen shows a single battle.
      if (!line.startsWith('|')) continue;
      if (line.startsWith('|request|')) {
        const json = line.slice('|request|'.length);
        if (json) this.pendingRequest = JSON.parse(json) as BattleRequest;
        hasRequest = !!json;
        continue;
      }
      this.queue.push(line);
      hasLog = true;
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
      this.teamSignal.set(this.pendingRequest.side.pokemon);
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
        if (side === 'p1' || side === 'p2') this.updateSide(side, (s) => ({ ...s, name }));
        return 0;
      }
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
      case 'start': {
        const { p1, p2 } = this.sidesSignal();
        this.introSignal.set({ p1: p1.name, p2: p2.name });
        this.say(`Battle started between ${p1.name} and ${p2.name}!`);
        return INTRO_MS;
      }
      case 'switch':
      case 'drag':
      case 'replace': {
        this.actionSignal.set(null);
        if (command !== 'replace' && this.withdrawFirst(args[0], line)) return WITHDRAW_MS;
        const pokemon = this.switchIn(args[0], args[1], args[2]);
        if (!pokemon || command === 'replace') return 0;
        this.emit('send-out', args[0]);
        if (command === 'drag') return this.say(`${this.label(args[0])} was dragged out!`);
        if (pokemon.side === 'p1' && !this.replaySignal()) return this.say(`Go! ${pokemon.name}!`);
        return this.say(`${this.sidesSignal()[pokemon.side].name} sent out ${pokemon.name}!`);
      }
      case 'swap':
        return this.swap(args[0]);
      case 'detailschange':
      case '-formechange':
        this.updatePokemon(args[0], (p) => ({ ...p, ...parseDetails(args[1], this.dex) }));
        return 0;
      case '-mega':
        this.emit('mega', args[0]);
        return this.say(
          `${this.label(args[0])} has Mega Evolved into ${megaName(this.findPokemon(args[0])?.species, args[1])}!`,
        );
      case 'move':
        this.actionSignal.set(this.moveAction(args[0], args[1], args[2], tags));
        return this.say(`${this.label(args[0])} used ${args[1]}!`);
      case 'cant':
        this.actionSignal.set(null);
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
      case '-crit':
        return this.say(`A critical hit on ${this.label(args[0], false)}!`);
      case '-immune':
        return this.say(`It doesn't affect ${this.label(args[0], false)}...`);
      case '-miss':
        return this.say(`${this.label(args[1] ?? args[0])} avoided the attack!`);
      case '-fail':
        return this.say('But it failed!');
      case '-notarget':
        return this.say('But there was no target...');
      case '-ohko':
        return this.say("It's a one-hit KO!");
      case '-hitcount':
        return this.say(`The Pokémon was hit ${args[1]} time${args[1] === '1' ? '' : 's'}!`);
      case '-prepare':
        return this.say(`${this.label(args[0])} is getting ready to use ${args[1]}!`);
      case '-transform':
        return this.say(`${this.label(args[0])} transformed into ${this.label(args[1], false)}!`);
      case '-singleturn':
        if (isProtection(args[1])) this.emit('protect', args[0]);
        return this.sayIf(singleTurnText(args[0], args[1], names, tags));
      case '-activate':
        // Protect (and the like) blocking a move shows its shield again.
        if (isProtection(args[1])) this.emit('protect', args[0]);
        return this.sayIf(activateText(args[0], args[1], names));
      case '-start':
      case '-end':
        return this.sayIf(volatileText(args[0], args[1], command === '-end', names, args[2]));
      case '-ability':
        return this.say(abilityText(args[0], args[1], tags, names), 'minor');
      case '-item':
        return this.say(itemText(args[0], args[1], tags, names));
      case '-enditem':
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
      case '-swapsideconditions':
        this.fieldSignal.update((f) => ({ ...f, sides: { p1: f.sides.p2, p2: f.sides.p1 } }));
        return this.say('The effects on both sides of the field were swapped!');
      case 'upkeep':
        this.afterUpkeep = true;
        this.actionSignal.set(null);
        return 0;
      case 'faint':
        this.emit('faint', args[0]);
        this.updatePokemon(args[0], (p) => ({ ...p, hp: 0, fainted: true }));
        return this.say(`${this.label(args[0])} fainted!`);
      case 'turn':
        this.afterUpkeep = false;
        this.actionSignal.set(null);
        this.turnSignal.set(Number(args[0]));
        this.addEntry('turn', `Turn ${args[0]}`);
        return 0;
      case 'win':
        this.actionSignal.set(null);
        this.winnerSignal.set(args[0]);
        this.resultSignal.set(args[0] === this.sidesSignal().p1.name ? 'win' : 'loss');
        return this.say(`${args[0]} won the battle!`, 'result');
      case 'tie':
        this.actionSignal.set(null);
        this.resultSignal.set('tie');
        return this.say('The battle ended in a tie!', 'result');
      case '-message':
        return this.say(args[0]);
      default:
        // Chat, timers, ratings (|c|, |t:|, |raw|, |inactive|…) and effects with nothing to show.
        return 0;
    }
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
    const type = this.dex.move(move)?.type ?? '';
    const hits = this.upcomingHits().filter((slot) => slot !== from);
    hits.forEach((slot) => this.blinkedHits.add(slot));
    return { id: this.nextEventId++, attacker: from, targets, hits, move, type };
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
   * Spots abilities and held items taking effect, for the pop-ups over their Pokémon. Whose they
   * are depends on the line: `|-ability|`, `|-enditem|`, `|-item|` and `|-activate|…|ability: X`
   * (or item: X) name the Pokémon first; a `[from] ability:` or `[from] item:` tag belongs to the
   * `[of]` Pokémon for effects it causes on others (weather, terrain, Rough Skin, Rocky Helmet) and
   * to the first Pokémon otherwise (Stamina, Leftovers, Life Orb; for Water Absorb's heal `[of]` is
   * the attacker).
   */
  private announceEffects(command: string, args: string[], tags: Record<string, string>): void {
    const from = tags['from'] ?? '';
    const owner = SOURCE_OWNS_EFFECT.includes(command) && tags['of'] ? tags['of'] : args[0];
    if (command === '-ability') {
      // Trace shows as Trace, not as the ability it copied.
      this.popup(args[0], 'ability', from.startsWith('ability: ') ? effectName(from) : args[1]);
    } else if (command === '-activate' && /^(ability|item): /.test(args[1] ?? '')) {
      this.popup(args[0], args[1].startsWith('item: ') ? 'item' : 'ability', effectName(args[1]));
    } else if (from.startsWith('ability: ')) {
      this.popup(SOURCE_OWNS_EFFECT.includes(command) ? tags['of'] : args[0], 'ability', effectName(from));
    }
    // |-miss|ATTACKER|TARGET: the target avoided it (a miss with no target has nobody to show it on).
    if (command === '-miss' && args[1]) this.popup(args[1], 'miss', 'Missed!');
    // A Frisk reveal isn't the item doing anything.
    if ((command === '-enditem' || command === '-item') && from !== 'ability: Frisk') {
      this.popup(args[0], 'item', args[1]);
    } else if (from.startsWith('item: ')) {
      this.popup(owner, 'item', effectName(from));
    }
  }

  private popup(ident: string | undefined, kind: EffectPopup['kind'], name: string | undefined): void {
    const slot = ident && this.slotOf(ident);
    if (!slot || !name) return;
    const popup = { id: this.nextEventId++, slot, kind, name };
    this.popupsSignal.update((popups) => [...popups, popup].slice(-MAX_POPUPS));
  }

  private emit(kind: FieldEvent['kind'], ident: string): void {
    const slot = this.slotOf(ident);
    if (slot) this.fieldEventSignal.set({ id: this.nextEventId++, kind, slot });
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
      const hpChange = { id: this.nextEventId++, slot, change };
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

  private switchIn(ident: string, details: string, condition: string): BattlePokemon | undefined {
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
    };
    // Stat stages go with switching out.
    const pokemon = {
      ...base,
      ...parseDetails(details, this.dex),
      ...parseCondition(condition, base.maxHp),
      boosts: {},
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
      side === 'p1' && !this.replaySignal() ? `${leaving.name}, come back!` : `${player} withdrew ${leaving.name}!`,
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

/** "Garchomp-Mega, L50, M" → species, level, gender and its sprite. */
export function parseDetails(
  details: string,
  dex: ChampionsDex,
): Pick<BattlePokemon, 'species' | 'sprite' | 'level' | 'gender'> {
  const [species, ...parts] = details.split(', ');
  const level = parts.find((part) => /^L\d+$/.test(part));
  const gender = parts.find((part) => part === 'M' || part === 'F') ?? '';
  const sprite = dex.species(species)?.sprite ?? dex.megaById(species)?.sprite ?? toId(species);
  return { species, sprite, level: level ? Number(level.slice(1)) : 100, gender };
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
