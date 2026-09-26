// A battle as the client sees it. The server side (the mock for now, Showdown later) speaks Showdown's
// battle protocol: log lines such as `|switch|p1a: Garchomp|Garchomp, L50, M|180/180`, and a
// `|request|` JSON with what the player can choose. These types follow that protocol's shapes.

export type SideId = 'p1' | 'p2';

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
}

export interface BattleSide {
  id: SideId;
  name: string;
  /** The Pokémon in each active slot (a, b); null while it's empty. */
  active: (BattlePokemon | null)[];
  /** Every Pokémon seen on this side, in the order they appeared. */
  pokemon: BattlePokemon[];
}

/** A line of the battle log: a turn header, a message, a minor detail (HP lost) or the result. */
export interface BattleLogEntry {
  id: number;
  kind: 'turn' | 'message' | 'minor' | 'result';
  text: string;
}

/** One slot's choice while the player picks the turn's actions. */
export type SlotChoice =
  | { kind: 'move'; move: number; target?: number; mega?: boolean }
  | { kind: 'switch'; slot: number }
  | { kind: 'pass' };

/** Sends the player's choices and delivers the server's messages (Showdown frames: lines joined with \n). */
export interface BattleConnection {
  start(onMessage: (frame: string) => void): void;
  choose(choice: string): void;
  forfeit(): void;
  stop(): void;
}
