import { ChampionsDex, DexMega, DexMove, DexSpecies, StatTable } from '@core/dex/champions-dex';
import { STAT_IDS, calcStat } from '@features/teambuilder/data/game-rules';
import { PokemonSet } from '@features/teambuilder/models/team';
import { BattleConnection, BattleRequest, GameType, SideId } from '@features/battle/models/battle';
import { DEFAULT_TEAM_FORMAT, RANDOM_BATTLE_FORMAT, formatName } from '@shared/data/formats';
import { TYPES, effectiveness } from './type-chart';

// A stand-in for Showdown's battle server, to build the battle screen without it, answered in
// Showdown's protocol. Two formats: a VGC doubles battle (the player's team, filled up with random
// Pokémon, against random Pokémon; level 50, team preview, Mega Evolution) and a Gen 9 Random Battle
// (singles, six random Pokémon a side at levels by strength, no team preview, Terastallization). The
// species and moves come from the bundled Champions data, so the random teams draw from those. It
// only simulates what the screen needs to show: damage (a simplified Gen 9 formula, with STAB, types,
// Levitate, spread moves and crits), accuracy, Protect, Mega Evolution, Terastallization, fainting and
// switching. Other status moves do nothing.

/** What differs between the mock's formats. */
export interface MockFormat {
  /** The format's name, for the `|tier|` line. */
  tier: string;
  gameType: GameType;
  /** Pokémon a side. */
  teamSize: number;
  /** Both teams are shown before the battle starts (VGC); without it, only their size. */
  teamPreview: boolean;
  /** Every Pokémon at level 50 (VGC), or at a level by its strength, as Random Battle balances them. */
  randomLevels: boolean;
  /** The player gets a random team too. */
  randomTeams: boolean;
  mega: boolean;
  tera: boolean;
}

const VGC: MockFormat = {
  tier: formatName(DEFAULT_TEAM_FORMAT),
  gameType: 'doubles',
  teamSize: 4,
  teamPreview: true,
  randomLevels: false,
  randomTeams: false,
  mega: true,
  tera: false,
};

const RANDOM_BATTLE: MockFormat = {
  tier: formatName(RANDOM_BATTLE_FORMAT),
  gameType: 'singles',
  teamSize: 6,
  teamPreview: false,
  randomLevels: true,
  randomTeams: true,
  mega: false,
  tera: true,
};

/** The mock's version of a format (VGC unless it's Random Battle). */
export function mockFormat(formatId: string): MockFormat {
  return formatId === RANDOM_BATTLE_FORMAT ? RANDOM_BATTLE : VGC;
}

const VGC_LEVEL = 50;
/** How long the "server" takes to answer, so the screen is built to wait for it. */
const LATENCY_MS = 300;
const PROTECT_MOVES = ['protect', 'detect'];
const SLOT_LETTERS = ['a', 'b'];

interface MockMove {
  move: DexMove;
  pp: number;
}

interface MockPokemon {
  side: SideId;
  name: string;
  species: DexSpecies;
  level: number;
  /** What it becomes when it Mega Evolves (it holds its stone). */
  mega?: DexMega;
  isMega: boolean;
  /** Its Tera type, and whether it has Terastallized into it. */
  teraType: string;
  terastallized: boolean;
  item: string;
  ability: string;
  gender: 'M' | 'F' | '';
  evs: PokemonSet['evs'];
  nature: string;
  stats: StatTable;
  hp: number;
  maxHp: number;
  moves: MockMove[];
  protecting: boolean;
}

interface MockSide {
  id: SideId;
  name: string;
  /** Active Pokémon first, in slot order, as in Showdown's requests. */
  team: MockPokemon[];
  megaUsed: boolean;
  teraUsed: boolean;
}

type Action =
  | { kind: 'switch'; side: MockSide; slot: number; to: number; speed: number }
  | { kind: 'move'; side: MockSide; slot: number; user: MockPokemon; move: MockMove; target: number; mega: boolean; tera: boolean; speed: number };

type ChoicePart = { kind: 'move'; move: number; target: number; mega: boolean; tera: boolean } | { kind: 'switch'; to: number } | { kind: 'pass' };

export class MockBattleConnection implements BattleConnection {
  private readonly player: MockSide;
  private readonly rival: MockSide;
  /** Pokémon on the field per side: 1 in singles, 2 in doubles. */
  private readonly activeSlots: number;
  private listener: ((frame: string) => void) | null = null;
  private turn = 0;
  private rqid = 0;
  private ended = false;
  /** Waiting for the player to replace fainted Pokémon before the next turn. */
  private forcingSwitch = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly dex: ChampionsDex,
    private readonly format: MockFormat,
    playerName: string,
    playerSets: readonly PokemonSet[],
  ) {
    this.activeSlots = format.gameType === 'singles' ? 1 : 2;
    const size = format.teamSize;
    const own = format.randomTeams ? [] : playerSets.map((set) => this.fromSet('p1', set)).filter((pokemon) => !!pokemon);
    const fill = this.randomTeam('p1', size - own.length, own.map((pokemon) => pokemon.species.id));
    this.player = { id: 'p1', name: playerName, team: [...own.slice(0, size), ...fill], megaUsed: false, teraUsed: false };
    this.rival = { id: 'p2', name: 'Rival (mock)', team: this.randomTeam('p2', size, []), megaUsed: false, teraUsed: false };
  }

  start(onMessage: (frame: string) => void): void {
    this.listener = onMessage;
    const lines = [
      '|init|battle',
      `|player|p1|${this.player.name}|`,
      `|player|p2|${this.rival.name}|`,
      `|gametype|${this.format.gameType}`,
      '|gen|9',
      `|tier|${this.format.tier}`,
      ...[this.player, this.rival].map((side) => `|teamsize|${side.id}|${side.team.length}`),
      // Team preview, as Showdown shows it in VGC: both teams' species before the battle starts.
      ...(this.format.teamPreview
        ? [
            '|clearpoke',
            ...[this.player, this.rival].flatMap((side) =>
              side.team.map((pokemon) => `|poke|${side.id}|${this.details(pokemon)}|`),
            ),
          ]
        : []),
      '|start',
    ];
    for (const side of [this.player, this.rival]) {
      for (let slot = 0; slot < this.activeSlots; slot++) lines.push(this.switchLine(side, slot));
    }
    this.nextTurn(lines);
  }

  choose(choice: string): void {
    if (this.ended) return;
    if (this.forcingSwitch) {
      this.forcingSwitch = false;
      const lines: string[] = [];
      this.parseChoice(choice).forEach((part, slot) => {
        if (part.kind === 'switch') this.switchIn(this.player, slot, part.to, lines);
      });
      this.replaceFainted(this.rival, lines);
      this.nextTurn(lines);
      return;
    }
    this.playTurn(choice);
  }

  forfeit(): void {
    if (this.ended) return;
    this.ended = true;
    this.send([`|-message|${this.player.name} forfeited.`, `|win|${this.rival.name}`]);
  }

  stop(): void {
    this.listener = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  // --- Turns ---

  private playTurn(choice: string): void {
    const actions: Action[] = [];
    this.parseChoice(choice).forEach((part, slot) => {
      const user = this.player.team[slot];
      if (!user || user.hp <= 0) return;
      if (part.kind === 'switch') actions.push({ kind: 'switch', side: this.player, slot, to: part.to, speed: user.stats.spe });
      if (part.kind === 'move') {
        const move = user.moves[part.move] ?? user.moves[0];
        actions.push({ kind: 'move', side: this.player, slot, user, move, target: part.target, mega: part.mega, tera: part.tera, speed: user.stats.spe });
      }
    });
    actions.push(...this.rivalActions());

    const lines: string[] = [];
    // Switches, then Mega Evolutions and Terastallizations, then moves by priority and Speed (ties at random).
    const bySpeed = (a: Action, b: Action) => b.speed - a.speed || Math.random() - 0.5;
    for (const action of actions.filter((a) => a.kind === 'switch').sort(bySpeed)) {
      this.switchIn(action.side, action.slot, action.to, lines);
    }
    const moves = actions.filter((a) => a.kind === 'move');
    for (const action of [...moves].sort(bySpeed)) {
      if (action.mega) this.megaEvolve(action.side, action.user, lines);
      if (action.tera) this.terastallize(action.side, action.user, lines);
    }
    moves.sort((a, b) => b.move.move.priority - a.move.move.priority || b.user.stats.spe - a.user.stats.spe || Math.random() - 0.5);
    for (const action of moves) {
      if (action.user.hp <= 0 || action.side.team[action.slot] !== action.user) continue;
      this.useMove(action.side, action.slot, action.move, action.target, lines);
      if (this.checkWinner(lines)) return this.send(lines);
    }

    lines.push('|upkeep');
    for (const pokemon of [...this.player.team, ...this.rival.team]) pokemon.protecting = false;

    if (this.faintedSlots(this.player).length > 0) {
      this.forcingSwitch = true;
      this.send([`|request|${JSON.stringify(this.request(true))}`]);
      this.send(lines);
      return;
    }
    this.replaceFainted(this.rival, lines);
    this.nextTurn(lines);
  }

  private nextTurn(lines: string[]): void {
    this.turn++;
    lines.push(`|turn|${this.turn}`);
    // Like Showdown, the request comes before the log that leads up to it.
    this.send([`|request|${JSON.stringify(this.request(false))}`]);
    this.send(lines);
  }

  /**
   * The rival picks a random usable move for each active Pokémon, at a random target. It Mega Evolves
   * as soon as it can, and Terastallizes at some point (a 1 in 4 chance each turn).
   */
  private rivalActions(): Action[] {
    const actions: Action[] = [];
    this.rival.team.slice(0, this.activeSlots).forEach((user, slot) => {
      if (user.hp <= 0) return;
      const usable = user.moves.filter((move) => move.pp > 0);
      const move = usable[Math.floor(Math.random() * usable.length)] ?? user.moves[0];
      const foes = this.player.team.slice(0, this.activeSlots).flatMap((foe, i) => (foe.hp > 0 ? [i + 1] : []));
      const target = foes[Math.floor(Math.random() * foes.length)] ?? 1;
      const mega = this.canMega(this.rival, user);
      if (mega) this.rival.megaUsed = true;
      const tera = !mega && this.canTera(this.rival, user) && Math.random() < 0.25;
      if (tera) this.rival.teraUsed = true;
      actions.push({ kind: 'move', side: this.rival, slot, user, move, target, mega, tera, speed: user.stats.spe });
    });
    return actions;
  }

  private canMega(side: MockSide, pokemon: MockPokemon): boolean {
    return this.format.mega && !!pokemon.mega && !pokemon.isMega && !side.megaUsed;
  }

  private canTera(side: MockSide, pokemon: MockPokemon): boolean {
    return this.format.tera && !pokemon.terastallized && !side.teraUsed;
  }

  // --- Actions ---

  private switchIn(side: MockSide, slot: number, to: number, lines: string[]): void {
    const incoming = side.team[to];
    if (!incoming || incoming.hp <= 0 || to < this.activeSlots) return;
    [side.team[slot], side.team[to]] = [incoming, side.team[slot]];
    lines.push(this.switchLine(side, slot));
  }

  private megaEvolve(side: MockSide, pokemon: MockPokemon, lines: string[]): void {
    if (!pokemon.mega || pokemon.isMega) return;
    side.megaUsed = true;
    pokemon.isMega = true;
    pokemon.stats = this.stats(pokemon.mega.baseStats, pokemon.evs, pokemon.nature);
    const ident = this.ident(pokemon);
    lines.push(`|detailschange|${ident}|${this.details(pokemon)}`);
    lines.push(`|-mega|${ident}|${pokemon.species.name}|${this.dex.item(pokemon.item)?.name ?? pokemon.item}`);
  }

  /** Its type becomes its Tera type (for STAB and for the moves it takes), once per side. */
  private terastallize(side: MockSide, pokemon: MockPokemon, lines: string[]): void {
    if (pokemon.terastallized) return;
    side.teraUsed = true;
    pokemon.terastallized = true;
    lines.push(`|-terastallize|${this.ident(pokemon)}|${pokemon.teraType}`);
    lines.push(`|detailschange|${this.ident(pokemon)}|${this.details(pokemon)}`);
  }

  private useMove(side: MockSide, slot: number, mockMove: MockMove, target: number, lines: string[]): void {
    const user = side.team[slot];
    const { move } = mockMove;
    mockMove.pp = Math.max(0, mockMove.pp - 1);
    const targets = this.targets(side, slot, move, target);
    lines.push(`|move|${this.ident(user)}|${move.name}|${targets[0] ? this.ident(targets[0]) : ''}`);

    if (PROTECT_MOVES.includes(move.id)) {
      user.protecting = true;
      lines.push(`|-singleturn|${this.ident(user)}|${move.name}`);
      return;
    }
    if (move.category === 'Status') {
      lines.push(`|-message|(The mock battle doesn't simulate ${move.name}.)`);
      return;
    }
    if (targets.length === 0) {
      lines.push('|-notarget|');
      return;
    }
    const spread = targets.length > 1;
    for (const defender of targets) {
      if (defender.protecting) {
        lines.push(`|-activate|${this.ident(defender)}|move: Protect`);
        continue;
      }
      if (move.accuracy > 0 && Math.random() * 100 >= move.accuracy) {
        lines.push(`|-miss|${this.ident(user)}|${this.ident(defender)}`);
        continue;
      }
      const types = this.types(defender);
      const typeMod = move.type === 'Ground' && this.ability(defender) === 'Levitate' ? 0 : effectiveness(move.type, types);
      if (typeMod === 0) {
        lines.push(`|-immune|${this.ident(defender)}`);
        continue;
      }
      const crit = Math.random() < 1 / 24;
      const damage = this.damage(user, defender, move, typeMod, spread, crit);
      defender.hp = Math.max(0, defender.hp - damage);
      if (crit) lines.push(`|-crit|${this.ident(defender)}`);
      if (typeMod > 1) lines.push(`|-supereffective|${this.ident(defender)}`);
      if (typeMod < 1) lines.push(`|-resisted|${this.ident(defender)}`);
      lines.push(`|-damage|${this.ident(defender)}|${this.condition(defender)}`);
    }
    for (const defender of targets) if (defender.hp <= 0) lines.push(`|faint|${this.ident(defender)}`);
  }

  /** Who a move hits: `target` is the chosen one as in Showdown's choices (1, 2 = foes; -1, -2 = allies). */
  private targets(side: MockSide, slot: number, move: DexMove, target: number): MockPokemon[] {
    const foeSide = side === this.player ? this.rival : this.player;
    const foes = foeSide.team.slice(0, this.activeSlots).filter((foe) => foe.hp > 0);
    // Singles: no ally (the other team member is on the bench).
    const ally = this.activeSlots > 1 ? side.team[1 - slot] : undefined;
    const allyAlive = ally && ally.hp > 0 ? [ally] : [];
    switch (move.target) {
      case 'allAdjacentFoes':
        return foes;
      case 'allAdjacent':
        return [...foes, ...allyAlive];
      case 'adjacentAlly':
        return allyAlive;
      case 'self':
      case 'adjacentAllyOrSelf':
      case 'allySide':
      case 'allies':
      case 'allyTeam':
      case 'foeSide':
      case 'all':
      case 'scripted':
        return [side.team[slot]];
      default: {
        const chosen = target < 0 ? side.team[-target - 1] : foeSide.team[target - 1];
        if (chosen && chosen.hp > 0 && chosen !== side.team[slot]) return [chosen];
        // Its target fainted: a move aimed at a foe goes to the other one.
        return foes.slice(0, 1);
      }
    }
  }

  private damage(user: MockPokemon, defender: MockPokemon, move: DexMove, typeMod: number, spread: boolean, crit: boolean): number {
    const physical = move.category === 'Physical';
    const attack = physical ? user.stats.atk : user.stats.spa;
    const defense = physical ? defender.stats.def : defender.stats.spd;
    let damage = Math.floor(Math.floor((Math.floor((2 * user.level) / 5 + 2) * move.basePower * attack) / defense) / 50) + 2;
    if (spread) damage = Math.floor(damage * 0.75);
    if (crit) damage = Math.floor(damage * 1.5);
    damage = Math.floor((damage * (85 + Math.floor(Math.random() * 16))) / 100);
    // Its own types give STAB, and so does its Tera type once Terastallized (the types it had too).
    const stab = this.baseTypes(user).includes(move.type) || (user.terastallized && user.teraType === move.type);
    if (stab) damage = Math.floor(damage * 1.5);
    return Math.max(1, Math.floor(damage * typeMod));
  }

  /** Sends a replacement into each of the side's fainted slots, at random, while it has any left. */
  private replaceFainted(side: MockSide, lines: string[]): void {
    for (const slot of this.faintedSlots(side)) {
      const bench = side.team.flatMap((pokemon, i) => (i >= this.activeSlots && pokemon.hp > 0 ? [i] : []));
      if (bench.length > 0) this.switchIn(side, slot, bench[Math.floor(Math.random() * bench.length)], lines);
    }
  }

  /** Active slots whose Pokémon fainted and that can be refilled from the bench. */
  private faintedSlots(side: MockSide): number[] {
    const bench = side.team.slice(this.activeSlots).filter((pokemon) => pokemon.hp > 0).length;
    const fainted = side.team.slice(0, this.activeSlots).flatMap((pokemon, slot) => (pokemon.hp <= 0 ? [slot] : []));
    return fainted.slice(0, bench);
  }

  private checkWinner(lines: string[]): boolean {
    const lost = (side: MockSide) => side.team.every((pokemon) => pokemon.hp <= 0);
    if (!lost(this.player) && !lost(this.rival)) return false;
    this.ended = true;
    if (lost(this.player) && lost(this.rival)) lines.push('|tie');
    else lines.push(`|win|${lost(this.player) ? this.rival.name : this.player.name}`);
    return true;
  }

  // --- Protocol ---

  private request(forceSwitch: boolean): BattleRequest {
    const side = this.player;
    const actives = side.team.slice(0, this.activeSlots);
    const request: BattleRequest = {
      rqid: ++this.rqid,
      side: {
        name: side.name,
        id: side.id,
        pokemon: side.team.map((pokemon, i) => ({
          ident: `${side.id}: ${pokemon.name}`,
          details: this.details(pokemon),
          condition: this.condition(pokemon),
          active: i < this.activeSlots,
          moves: pokemon.moves.map((move) => move.move.id),
          item: pokemon.item,
        })),
      },
    };
    if (forceSwitch) {
      const fainted = this.faintedSlots(side);
      request.forceSwitch = actives.map((_, slot) => fainted.includes(slot));
    } else {
      request.active = actives.map((pokemon) => ({
        moves: pokemon.moves.map(({ move, pp }) => ({ move: move.name, id: move.id, pp, maxpp: move.pp, target: move.target, disabled: pp <= 0 })),
        canMegaEvo: this.canMega(side, pokemon),
        ...(this.canTera(side, pokemon) ? { canTerastallize: pokemon.teraType } : {}),
      }));
    }
    return request;
  }

  /** "move 1 2 mega, switch 3" or "move 3 terastallize": one part per active slot. */
  private parseChoice(choice: string): ChoicePart[] {
    return choice.split(',').map((part) => {
      const [kind, first, ...rest] = part.trim().split(/\s+/);
      if (kind === 'switch') return { kind: 'switch', to: Number(first) - 1 };
      if (kind === 'move') {
        const target = rest.find((token) => /^-?\d+$/.test(token));
        return { kind: 'move', move: Number(first) - 1, target: target ? Number(target) : 1, mega: rest.includes('mega'), tera: rest.includes('terastallize') };
      }
      return { kind: 'pass' };
    });
  }

  private switchLine(side: MockSide, slot: number): string {
    const pokemon = side.team[slot];
    return `|switch|${this.ident(pokemon, slot)}|${this.details(pokemon)}|${this.condition(pokemon)}`;
  }

  /** "p1a: Garchomp": side and slot while active. */
  private ident(pokemon: MockPokemon, slot?: number): string {
    const side = pokemon.side === 'p1' ? this.player : this.rival;
    const index = slot ?? side.team.indexOf(pokemon);
    return `${pokemon.side}${index < this.activeSlots ? SLOT_LETTERS[index] : ''}: ${pokemon.name}`;
  }

  private details(pokemon: MockPokemon): string {
    const species = pokemon.isMega && pokemon.mega ? pokemon.mega.name : pokemon.species.name;
    const tera = pokemon.terastallized ? `tera:${pokemon.teraType}` : '';
    return [species, `L${pokemon.level}`, pokemon.gender, tera].filter(Boolean).join(', ');
  }

  /** Real HP for the player's own Pokémon; the rival's as a percentage, as Showdown shows them. */
  private condition(pokemon: MockPokemon): string {
    if (pokemon.hp <= 0) return '0 fnt';
    if (pokemon.side === 'p1') return `${pokemon.hp}/${pokemon.maxHp}`;
    return `${Math.max(1, Math.round((pokemon.hp / pokemon.maxHp) * 100))}/100`;
  }

  /** Its types for the moves it takes: only its Tera type once Terastallized. */
  private types(pokemon: MockPokemon): readonly string[] {
    return pokemon.terastallized ? [pokemon.teraType] : this.baseTypes(pokemon);
  }

  private baseTypes(pokemon: MockPokemon): readonly string[] {
    return pokemon.isMega && pokemon.mega ? pokemon.mega.types : pokemon.species.types;
  }

  /** Only Levitate does anything in the mock (Ground immunity). */
  private ability(pokemon: MockPokemon): string {
    return pokemon.isMega && pokemon.mega ? pokemon.mega.ability : pokemon.ability;
  }

  // --- Teams ---

  private fromSet(side: SideId, set: PokemonSet): MockPokemon | undefined {
    const species = this.dex.species(set.species);
    const moves = set.moves.flatMap((name) => this.dex.move(name) ?? []);
    if (!species || moves.length === 0) return undefined;
    return this.pokemon(side, species, VGC_LEVEL, set.name || species.name, set.item, set.ability, set.gender, set.evs, set.nature, moves);
  }

  /**
   * `count` random species (not in `exclude`), each with up to 4 of its attacking moves (Protect among
   * them in doubles, when it learns it). One of a VGC team holds its Mega Stone.
   */
  private randomTeam(side: SideId, count: number, exclude: string[]): MockPokemon[] {
    const pool = this.dex.allSpecies.filter((species) => !exclude.includes(species.id) && attacks(species).length >= 4);
    const team: MockPokemon[] = [];
    let megaGiven = false;
    while (team.length < count && pool.length > 0) {
      const [species] = pool.splice(Math.floor(Math.random() * pool.length), 1);
      const mega: DexMega | undefined = megaGiven || !this.format.mega ? undefined : this.dex.allMegas.find((m) => m.base === species.id);
      megaGiven ||= !!mega;
      const physical = species.baseStats.atk >= species.baseStats.spa;
      const moves = pickMoves(species, physical, this.format.gameType === 'doubles');
      const level = this.format.randomLevels ? randomBattleLevel(species) : VGC_LEVEL;
      const gender = species.gender === 'N' ? '' : species.gender || (Math.random() < 0.5 ? 'M' : 'F');
      const evs = { hp: 32, [physical ? 'atk' : 'spa']: 32, spe: 2 };
      team.push(this.pokemon(side, species, level, species.name, mega?.item ?? '', species.abilities[0] ?? '', gender, evs, 'Serious', moves));
    }
    return team;
  }

  private pokemon(
    side: SideId,
    species: DexSpecies,
    level: number,
    name: string,
    item: string,
    ability: string,
    gender: 'M' | 'F' | '',
    evs: PokemonSet['evs'],
    nature: string,
    moves: DexMove[],
  ): MockPokemon {
    const stats = this.format.randomLevels ? levelStats(species.baseStats, level) : this.stats(species.baseStats, evs, nature);
    return {
      side,
      name,
      species,
      level,
      mega: this.dex.mega(species.id, item),
      isMega: false,
      teraType: randomTeraType(species),
      terastallized: false,
      item,
      ability,
      gender,
      evs,
      nature,
      stats,
      hp: stats.hp,
      maxHp: stats.hp,
      moves: moves.slice(0, 4).map((move) => ({ move, pp: move.pp })),
      protecting: false,
    };
  }

  private stats(base: StatTable, evs: PokemonSet['evs'], nature: string): StatTable {
    const entries = STAT_IDS.map((stat) => [stat, calcStat(stat, base[stat], evs[stat] ?? 0, nature)] as const);
    return Object.fromEntries(entries) as StatTable;
  }

  private send(lines: string[]): void {
    const frame = lines.join('\n');
    this.timers.push(setTimeout(() => this.listener?.(frame), LATENCY_MS));
  }
}

function attacks(species: DexSpecies): DexMove[] {
  return species.moves.filter((move) => move.category !== 'Status' && move.basePower > 0 && move.basePower <= 120);
}

/** Two strong moves of its own types (of its better attacking side) and two others, or one and Protect when wanted and learnt. */
function pickMoves(species: DexSpecies, physical: boolean, withProtect: boolean): DexMove[] {
  const category = physical ? 'Physical' : 'Special';
  const usable = attacks(species).filter((move) => move.category === category);
  const pool = usable.length >= 3 ? usable : attacks(species);
  const stab = pool.filter((move) => species.types.includes(move.type)).sort((a, b) => b.basePower - a.basePower).slice(0, 2);
  const others = shuffle(pool.filter((move) => !stab.includes(move)));
  const protect = withProtect ? species.moves.find((move) => move.id === 'protect') : undefined;
  return [...stab, ...others.slice(0, protect ? 1 : 2), ...(protect ? [protect] : [])];
}

/** Random Battle's idea: the stronger the species (by base stat total), the lower its level. */
function randomBattleLevel(species: DexSpecies): number {
  const total = Object.values(species.baseStats).reduce((sum, stat) => sum + stat, 0);
  return Math.max(70, Math.min(100, Math.round(100 - (total - 350) / 8)));
}

/**
 * Stats at a level, as Random Battle builds its sets: perfect IVs, 84 EVs in every stat and a neutral
 * nature.
 */
function levelStats(base: StatTable, level: number): StatTable {
  const core = (stat: number) => Math.floor(((2 * stat + 31 + 21) * level) / 100);
  return {
    hp: core(base.hp) + level + 10,
    atk: core(base.atk) + 5,
    def: core(base.def) + 5,
    spa: core(base.spa) + 5,
    spd: core(base.spd) + 5,
    spe: core(base.spe) + 5,
  };
}

/** Mostly one of its own types, sometimes any other. */
function randomTeraType(species: DexSpecies): string {
  const pool = Math.random() < 0.7 && species.types.length > 0 ? species.types : TYPES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
