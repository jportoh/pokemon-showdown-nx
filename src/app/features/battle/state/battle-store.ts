import { Service, inject, signal } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { BattleConnection, BattleLogEntry, BattlePokemon, BattleRequest, BattleSide, RequestPokemon, SideId } from '@features/battle/models/battle';
import { toId } from '@shared/utils/to-id';
import { BattleSession } from './battle-session';

/** How long each step of the log stays on screen before the next one. */
const MESSAGE_MS = 1100;
/** A damage or heal step: long enough to see the HP bar move. */
const HP_MS = 600;
/** Log entries kept (a whole battle, usually), to keep the DOM small on the console. */
const MAX_LOG_ENTRIES = 250;
/** How long a request waits for its log before it's shown anyway (a request may come alone). */
const LOG_WAIT_MS = 1000;
const SLOT_INDEX: Record<string, number> = { a: 0, b: 1 };

const emptySide = (id: SideId): BattleSide => ({ id, name: '', active: [null, null], pokemon: [] });

/**
 * One battle's state, built from the server's protocol lines (Showdown's battle protocol). Log lines
 * play back one step at a time: each step updates the field and adds its entry to the battle log,
 * then waits. The server's request is held until the log leading up to it has played.
 * A root service, so the battle carries on (and can be returned to from the header's Battle tab)
 * while the player visits other pages.
 */
@Service()
export class BattleStore {
  private readonly dex = inject(ChampionsDex);
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly session = inject(BattleSession);

  private readonly sidesSignal = signal<Record<SideId, BattleSide>>({ p1: emptySide('p1'), p2: emptySide('p2') });
  private readonly logSignal = signal<readonly BattleLogEntry[]>([]);
  private readonly turnSignal = signal(0);
  private readonly requestSignal = signal<BattleRequest | null>(null);
  private readonly resultSignal = signal<'win' | 'loss' | 'tie' | null>(null);
  private readonly playingSignal = signal(false);
  private readonly teamSignal = signal<readonly RequestPokemon[]>([]);
  private readonly battleIdSignal = signal(0);

  readonly sides = this.sidesSignal.asReadonly();
  /** The battle log so far, oldest first. */
  readonly log = this.logSignal.asReadonly();
  readonly turn = this.turnSignal.asReadonly();
  /** What the player has to choose now; null while the log plays or the server is thinking. */
  readonly request = this.requestSignal.asReadonly();
  /** Set once the battle is over. */
  readonly result = this.resultSignal.asReadonly();
  /** Whether log steps are still being shown. */
  readonly playing = this.playingSignal.asReadonly();
  /** The player's whole team as of the last request (it stays while the turn plays). */
  readonly team = this.teamSignal.asReadonly();
  /** Changes with every new battle, so per-battle state elsewhere can start over. */
  readonly battleId = this.battleIdSignal.asReadonly();

  private connection: BattleConnection | null = null;
  private queue: string[] = [];
  private pendingRequest: BattleRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextLogId = 0;
  /** Set while a request waits for the log that should follow it. */
  private logWait: ReturnType<typeof setTimeout> | null = null;

  start(connection: BattleConnection): void {
    this.reset();
    this.battleIdSignal.update((id) => id + 1);
    this.session.setActive(true);
    this.connection = connection;
    connection.start((frame) => this.receive(frame));
  }

  /** Leaves the battle for good: the Battle tab goes away. */
  close(): void {
    this.reset();
    this.session.setActive(false);
  }

  private reset(): void {
    this.stop();
    this.sidesSignal.set({ p1: emptySide('p1'), p2: emptySide('p2') });
    this.logSignal.set([]);
    this.turnSignal.set(0);
    this.resultSignal.set(null);
    this.requestSignal.set(null);
    this.teamSignal.set([]);
  }

  /** Sends the turn's choices ("move 1 2, switch 3"); the request is used up. */
  choose(choice: string): void {
    this.requestSignal.set(null);
    this.connection?.choose(choice);
  }

  forfeit(): void {
    this.connection?.forfeit();
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
      const delay = this.apply(this.queue.shift()!);
      if (delay > 0) {
        this.playingSignal.set(true);
        this.timer = setTimeout(() => this.step(), delay);
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
    const [, command, ...args] = line.split('|');
    switch (command) {
      case 'player': {
        const [side, name] = args;
        if (side === 'p1' || side === 'p2') this.updateSide(side, (s) => ({ ...s, name }));
        return 0;
      }
      case 'start':
        return this.say(`Battle started between ${this.sidesSignal().p1.name} and ${this.sidesSignal().p2.name}!`);
      case 'switch':
      case 'drag': {
        const pokemon = this.switchIn(args[0], args[1], args[2]);
        if (!pokemon) return 0;
        if (pokemon.side === 'p1') return this.say(`Go! ${pokemon.name}!`);
        return this.say(`${this.sidesSignal().p2.name} sent out ${pokemon.name}!`);
      }
      case 'detailschange':
        this.updatePokemon(args[0], (p) => ({ ...p, ...parseDetails(args[1], this.dex) }));
        return 0;
      case '-mega':
        return this.say(`${this.label(args[0])} has Mega Evolved into Mega ${args[1]}!`);
      case 'move':
        return this.say(`${this.label(args[0])} used ${args[1]}!`);
      case '-damage':
      case '-heal': {
        const before = this.findPokemon(args[0]);
        this.updatePokemon(args[0], (p) => ({ ...p, ...parseCondition(args[1], p.maxHp) }));
        const after = this.findPokemon(args[0]);
        if (before && after) this.logHpChange(args[0], before, after);
        return HP_MS;
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
      case '-notarget':
        return this.say('But there was no target...');
      case '-singleturn':
        return this.say(`${this.label(args[0])} protected itself!`);
      case '-activate':
        return args[1] === 'move: Protect' ? this.say(`${this.label(args[0])} protected itself!`) : 0;
      case 'faint':
        this.updatePokemon(args[0], (p) => ({ ...p, hp: 0, fainted: true }));
        return this.say(`${this.label(args[0])} fainted!`);
      case 'turn':
        this.turnSignal.set(Number(args[0]));
        this.addEntry('turn', `Turn ${args[0]}`);
        return 0;
      case 'win':
        this.resultSignal.set(args[0] === this.sidesSignal().p1.name ? 'win' : 'loss');
        return this.say(`${args[0]} won the battle!`, 'result');
      case 'tie':
        this.resultSignal.set('tie');
        return this.say('The battle ended in a tie!', 'result');
      case '-message':
        return this.say(args[0]);
      default:
        return 0;
    }
  }

  private say(text: string, kind: BattleLogEntry['kind'] = 'message'): number {
    this.addEntry(kind, text);
    return MESSAGE_MS;
  }

  private addEntry(kind: BattleLogEntry['kind'], text: string): void {
    const entry = { id: this.nextLogId++, kind, text };
    this.logSignal.update((log) => [...log, entry].slice(-MAX_LOG_ENTRIES));
  }

  /** Showdown's "(The opposing Garchomp lost 45% of its health!)", as a minor log line. */
  private logHpChange(ident: string, before: BattlePokemon, after: BattlePokemon): void {
    const percent = (p: BattlePokemon) => (p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0);
    const change = Math.round(percent(after) - percent(before));
    if (change === 0) return;
    const verb = change < 0 ? 'lost' : 'restored';
    this.addEntry('minor', `(${this.label(ident)} ${verb} ${Math.abs(change)}% of its health!)`);
  }

  private findPokemon(ident: string): BattlePokemon | undefined {
    const { side, name } = parseIdent(ident);
    return side ? this.sidesSignal()[side].pokemon.find((p) => p.ident === `${side}: ${name}`) : undefined;
  }

  /** "Garchomp", or "the opposing Garchomp" (capitalised at the start of a sentence). */
  private label(ident: string, sentenceStart = true): string {
    const { side, name } = parseIdent(ident);
    if (side === 'p1') return name;
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
    };
    const pokemon = { ...base, ...parseDetails(details, this.dex), ...parseCondition(condition, base.maxHp) };
    this.updateSide(side, (s) => ({
      ...s,
      active: s.active.map((p, i) => (i === slot ? pokemon : p)),
      pokemon: known ? s.pokemon.map((p) => (p.ident === key ? pokemon : p)) : [...s.pokemon, pokemon],
    }));
    return pokemon;
  }

  /** Updates a Pokémon wherever it appears (its slot and its side's list). */
  private updatePokemon(ident: string, change: (pokemon: BattlePokemon) => BattlePokemon): void {
    const { side, name } = parseIdent(ident);
    if (!side) return;
    const key = `${side}: ${name}`;
    const apply = (p: BattlePokemon | null) => (p && p.ident === key ? change(p) : p);
    this.updateSide(side, (s) => ({ ...s, active: s.active.map(apply), pokemon: s.pokemon.map((p) => apply(p)!) }));
  }

  private updateSide(id: SideId, change: (side: BattleSide) => BattleSide): void {
    this.sidesSignal.update((sides) => ({ ...sides, [id]: change(sides[id]) }));
  }
}

/** "p1a: Garchomp" → side p1, slot 0, name Garchomp ("p1: Garchomp" has no slot). */
export function parseIdent(ident: string): { side?: SideId; slot?: number; name: string } {
  const match = /^(p[12])([ab]?): (.*)$/.exec(ident ?? '');
  if (!match) return { name: ident ?? '' };
  return { side: match[1] as SideId, slot: match[2] ? SLOT_INDEX[match[2]] : undefined, name: match[3] };
}

/** "Garchomp-Mega, L50, M" → species, level, gender and its sprite. */
export function parseDetails(details: string, dex: ChampionsDex): Pick<BattlePokemon, 'species' | 'sprite' | 'level' | 'gender'> {
  const [species, ...parts] = details.split(', ');
  const level = parts.find((part) => /^L\d+$/.test(part));
  const gender = parts.find((part) => part === 'M' || part === 'F') ?? '';
  const sprite = dex.species(species)?.sprite ?? dex.megaById(species)?.sprite ?? toId(species);
  return { species, sprite, level: level ? Number(level.slice(1)) : 100, gender };
}

/** "143/180 par" or "0 fnt" → HP, max HP, status and whether it fainted. */
export function parseCondition(condition: string, maxHp: number): Pick<BattlePokemon, 'hp' | 'maxHp' | 'status' | 'fainted'> {
  const [hpPart = '0', status = ''] = (condition ?? '').split(' ');
  if (status === 'fnt' || hpPart === '0') return { hp: 0, maxHp, status: '', fainted: true };
  const [hp, max] = hpPart.split('/').map(Number);
  return { hp, maxHp: max || maxHp, status, fainted: false };
}
