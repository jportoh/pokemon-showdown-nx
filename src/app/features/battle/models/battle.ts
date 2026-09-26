// A battle as the client sees it. The server side (the mock for now, Showdown later) speaks Showdown's
// battle protocol: log lines such as `|switch|p1a: Garchomp|Garchomp, L50, M|180/180`, and a
// `|request|` JSON with what the player can choose. These types follow that protocol's shapes.

export type SideId = 'p1' | 'p2';

/** One Pokémon per side (Random Battle) or two (VGC), from the `|gametype|` line. */
export type GameType = 'singles' | 'doubles';

/** One move in a request, as Showdown sends it. */
export interface RequestMove {
  move: string;
  id: string;
  pp: number;
  maxpp: number;
  /** Showdown's target type: 'normal', 'allAdjacentFoes', 'self'… */
  target: string;
  disabled?: boolean;
}

export interface RequestActive {
  moves: RequestMove[];
  canMegaEvo?: boolean;
  /** The Tera type it can Terastallize into this turn (once per battle, Gen 9). */
  canTerastallize?: string;
}

/** One of the player's Pokémon in a request. */
export interface RequestPokemon {
  /** "p1: Garchomp" */
  ident: string;
  /** "Garchomp, L50, M" */
  details: string;
  /** "143/180", "143/180 par" or "0 fnt". */
  condition: string;
  active: boolean;
  moves: string[];
  item: string;
}

/** What the player has to choose now: `|request|` in Showdown's protocol. */
export interface BattleRequest {
  rqid: number;
  /** One entry per active slot: a move or a switch for each. */
  active?: RequestActive[];
  /** Fainted slots that must be replaced (true) before the next turn. */
  forceSwitch?: boolean[];
  /** Nothing to choose: the opponent is choosing. */
  wait?: boolean;
  side: { name: string; id: SideId; pokemon: RequestPokemon[] };
}

/** A Pokémon on the field or in a team, as the log has shown it so far. */
export interface BattlePokemon {
  /** "p1: Garchomp": the Pokémon's identity for the whole battle. */
  ident: string;
  side: SideId;
  name: string;
  species: string;
  /** Showdown's sprite file name, from the species (or its Mega). */
  sprite: string;
  level: number;
  gender: 'M' | 'F' | '';
  hp: number;
  /** The player's own Pokémon show real HP; the opponent's are out of 100. */
  maxHp: number;
  status: string;
  fainted: boolean;
  /** The type it has Terastallized into, if it has. */
  tera?: string;
  /** Stat stages from -6 to +6 ('atk', 'spe', 'accuracy'…); only the changed ones. Reset on switching out. */
  boosts: Record<string, number>;
}

/** A weather, terrain, room (Trick Room…) or side condition (Tailwind, Reflect…) in play. */
export interface FieldCondition {
  /** Showdown's name: "RainDance", "Grassy Terrain", "Tailwind". */
  id: string;
  /** How it's shown: "Rain", "Grassy Terrain", "Tailwind". */
  name: string;
  /** The first turn it counts for. */
  start: number;
  /** How many turns it lasts; none for the ones that stay (hazards, primal weather). */
  duration?: number;
  /** An item can make it last 3 turns more (Light Clay, Damp Rock, Terrain Extender…). */
  extendable?: boolean;
  /** Spikes and Toxic Spikes stack. */
  layers: number;
}

export interface BattleFieldState {
  weather: FieldCondition | null;
  terrain: FieldCondition | null;
  /** Trick Room, Gravity, Magic Room, Wonder Room. */
  rooms: FieldCondition[];
  sides: Record<SideId, FieldCondition[]>;
}

export interface BattleSide {
  id: SideId;
  name: string;
  /** The Pokémon in each active slot (a, b); null while it's empty. */
  active: (BattlePokemon | null)[];
  /** Every Pokémon seen on this side, in the order they appeared. */
  pokemon: BattlePokemon[];
  /** The species shown at team preview (`|poke|`), in order. */
  preview: string[];
  /** How many Pokémon it brought (`|teamsize|`); 0 until known. Without a team preview, the unseen ones count too. */
  teamSize: number;
}

/** "p1a", "p2b": an active slot, as the protocol names it. */
export type SlotKey = string;

/** A move being used, for the field's animations and highlights: who used it on whom. */
export interface MoveAction {
  /** Changes with every move, so the same move twice still animates. */
  id: number;
  attacker: SlotKey;
  /** Where it's aimed: the target, both foes for a spread move, none for a move with no target. */
  targets: SlotKey[];
  /**
   * The slots its damage lands on (read ahead in the log), which blink as the attacker's lunge
   * reaches them rather than a step later when their HP drops.
   */
  hits: SlotKey[];
  move: string;
  /** The move's type, for its colour; '' when unknown. */
  type: string;
}

/**
 * An ability (Intimidate, Drizzle, Stamina…) or a held item (Sitrus Berry, Leftovers, Eject Button…)
 * taking effect, shown over the Pokémon it belongs to; or a move missing, over the Pokémon that
 * avoided it.
 */
export interface EffectPopup {
  id: number;
  slot: SlotKey;
  kind: 'ability' | 'item' | 'miss';
  name: string;
}

/** HP lost or restored, shown as "-45%" or "+12%" by the Pokémon's status box as its bar moves. */
export interface HpChange {
  id: number;
  slot: SlotKey;
  /** Percentage points of its HP, negative when lost. */
  change: number;
  /** The move landed a critical hit (the `|-crit|` line before the damage), shown beside the change. */
  crit?: boolean;
}

/** A status condition just inflicted ("brn", "par"…), shown as "Burned!" over the Pokémon. */
export interface StatusChange {
  id: number;
  slot: SlotKey;
  status: string;
}

/**
 * Something the field animates on a slot: a direct hit (the Pokémon blinks), a faint (it sinks out of
 * sight), a withdrawal (it leaves towards its trainer's side), a send-out (the new one comes in), a
 * Mega Evolution or Terastallization (it flashes) or a protection (a shield pulses around it).
 */
export interface FieldEvent {
  id: number;
  kind: 'hit' | 'faint' | 'withdraw' | 'send-out' | 'mega' | 'tera' | 'protect';
  slot: SlotKey;
}

/** A line of the battle log: a turn header, a message, a minor detail (HP lost) or the result. */
export interface BattleLogEntry {
  id: number;
  kind: 'turn' | 'message' | 'minor' | 'result';
  text: string;
}

/** One slot's choice while the player picks the turn's actions. */
export type SlotChoice =
  | { kind: 'move'; move: number; target?: number; mega?: boolean; tera?: boolean }
  | { kind: 'switch'; slot: number }
  | { kind: 'pass' };

/** A battle saved on Showdown's replay server, as its search lists it. */
export interface ReplaySummary {
  /** "gen9championsvgc2026regmc-2687994581" */
  id: string;
  format: string;
  players: [string, string];
  /** Seconds since the epoch. */
  uploadtime: number;
  rating?: number;
}

/** A replay with its log: the protocol lines a spectator saw, with no requests. */
export interface Replay extends ReplaySummary {
  log: string;
}

/** Sends the player's choices and delivers the server's messages (Showdown frames: lines joined with \n). */
export interface BattleConnection {
  /** Set when the battle is a replay: it's watched, with no choices to make. */
  readonly replay?: Replay;
  start(onMessage: (frame: string) => void): void;
  choose(choice: string): void;
  forfeit(): void;
  /** Takes back the choices sent while the opponent is still choosing; absent where that can't happen. */
  undo?(): void;
  stop(): void;
}

/**
 * The battle timer while it's on (either player can turn it on): our time left this turn and in total,
 * as of `since`. It only runs while we have something to choose; `since` is null while it's stopped.
 */
export interface BattleTimer {
  turnSeconds: number;
  totalSeconds: number | null;
  since: number | null;
}
