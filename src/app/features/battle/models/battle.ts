// A battle as the client sees it. The server (Showdown) speaks Showdown's
// battle protocol: log lines such as `|switch|p1a: Garchomp|Garchomp, L50, M|180/180`, and a
// `|request|` JSON with what the player can choose. These types follow that protocol's shapes.

export type SideId = 'p1' | 'p2';

/** One Pokémon per side (Random Battle) or two (VGC), from the `|gametype|` line. */
export type GameType = 'singles' | 'doubles';

/** One move in a request, as Showdown sends it. */
export interface RequestMove {
  move: string;
  id: string;
  /** Absent for a move it's locked into (Gen 1's "Fight" while asleep or trapped, a recharge…). */
  pp?: number;
  maxpp?: number;
  /** Showdown's target type: 'normal', 'allAdjacentFoes', 'self'… */
  target: string;
  disabled?: boolean;
}

export interface RequestActive {
  moves: RequestMove[];
  canMegaEvo?: boolean;
  /** The Tera type it can Terastallize into this turn (once per battle, Gen 9). */
  canTerastallize?: string;
  /** It can't switch out (Shadow Tag, Mean Look…). */
  trapped?: boolean;
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
  /** Its item's ID ("leftovers"); '' once it's used up or lost. */
  item: string;
  /** Its ability's ID ("owntempo"), as it is now. Gen 7 on: older gens only send `baseAbility`. */
  ability?: string;
  /** The ability it was brought with ("owntempo"). */
  baseAbility?: string;
  /** Its stats as they are (HP is in the condition). */
  stats?: Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>;
  /** Its Tera type (Gen 9), and whether it has Terastallized. */
  teraType?: string;
  terastallized?: string;
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
  /**
   * Team preview (formats played with our own teams): pick the Pokémon to bring, in order, the first
   * ones leading (`/choose team 3142`).
   */
  teamPreview?: boolean;
  /** How many to bring (VGC: 4 of 6); all of them when absent. */
  maxChosenTeamSize?: number;
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
  /** Stat stages from -6 to +6 ('atk', 'spe', 'accuracy'…); only the changed ones. Reset on switching out, unless Baton Passed. */
  boosts: Record<string, number>;
  /** Behind a substitute (the doll is drawn in its place) until it breaks; Baton Pass and Shed Tail pass it on. */
  substitute?: boolean;
  /** What the battle has revealed of it, as a spectator learns it: the moves it has used, in order. */
  moves: readonly string[];
  /** Its held item's name once revealed (Leftovers healing, Frisk, a Mega Stone…); '' while unknown or gone. */
  item: string;
  /** The item it had and lost (eaten, used up, knocked off); '' when none was lost. */
  lostItem: string;
  /** Its ability's name once revealed (Intimidate, a Trace…); '' while unknown. */
  ability: string;
  /** Volatile conditions on it (confusion, Taunt, the perish count…) by key; they go with switching out, unless Baton Passed. */
  volatiles: Record<string, Volatile>;
  /** The turn its time on the field started counting from (Fake Out works on its first); 0 while it's never been out. */
  cameIn: number;
  /** The last move it used; '' until it moves. */
  lastMove: string;
}

/** A volatile condition on a Pokémon (`|-start|`, `|-singleturn|`…), kept until it ends or the Pokémon leaves. */
export interface Volatile {
  /** Its key: "confusion", "taunt", "perish", "partiallytrapped"… */
  id: string;
  /** As the protocol names it: "confusion", "Taunt", "Fire Spin". */
  name: string;
  /** The first turn it counts for. */
  since: number;
  /** What it carries: the perish count, the disabled move, who it's infatuated with, the new type… */
  extra?: string;
  /** Gone at the end of the turn (Protect, Helping Hand) or once it moves again (Destiny Bond). */
  until?: 'turn' | 'move';
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
  /** Physical, Special or Status, which picks its animation; '' when unknown. */
  category: string;
  /** The slots it's super effective or not very effective on (read ahead in the log), for the hits' sounds. */
  effectiveness: Partial<Record<SlotKey, 'super' | 'resisted'>>;
}

/**
 * An ability (Intimidate, Drizzle, Stamina…) or a held item (Sitrus Berry, Leftovers, Eject Button…)
 * taking effect, shown over the Pokémon it belongs to; or a notice over a Pokémon: a move that
 * missed it or didn't affect it, a move it couldn't use (Taunt, Disable…), its perish count.
 */
export interface EffectPopup {
  id: number;
  slot: SlotKey;
  kind: 'ability' | 'item' | 'notice';
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

/** A stat stage raised or lowered ("atk", +1), shown as "Attack +1" over the Pokémon with arrows of light. */
export interface StatChange {
  id: number;
  slot: SlotKey;
  stat: string;
  /** Stages gained (positive) or lost (negative); never 0. */
  amount: number;
}

/**
 * Something the field animates on a slot: a direct hit (the Pokémon blinks), a faint (it sinks out of
 * sight), a withdrawal (it leaves towards its trainer's side), a send-out (the new one comes in), a
 * Mega Evolution or Terastallization (it flashes), a protection (a shield pulses around it) or one
 * guarding its whole side, Wide Guard and the like (a barrier pulses across the side); confusion
 * starting or holding it before its move (stars circle its head as it wobbles), hurting it (it hits
 * itself) or ending (the stars scatter); a substitute made (the doll takes its place in a puff of
 * smoke) or broken (the doll vanishes and the Pokémon is back); a berry eaten (it appears over its head and
 * goes in a few bites).
 */
export interface FieldEvent {
  id: number;
  kind:
    | 'hit'
    | 'faint'
    | 'withdraw'
    | 'send-out'
    | 'mega'
    | 'tera'
    | 'protect'
    | 'side-guard'
    | 'confused'
    | 'confusion-hit'
    | 'confusion-end'
    | 'substitute'
    | 'substitute-end'
    | 'berry';
  slot: SlotKey;
  /** The berry eaten, for its colour. */
  item?: string;
}

/** A line of the battle log: a turn header, a message, a minor detail (HP lost), the result or a chat message. */
export interface BattleLogEntry {
  id: number;
  kind: 'turn' | 'message' | 'minor' | 'result' | 'chat';
  text: string;
  /** A chat message's author ('' for the server's notices). */
  author?: string;
}

/** A player's ladder rating before and after a rated battle. */
export interface RatingChange {
  name: string;
  before: number;
  after: number;
  /** after - before: positive when won. */
  change: number;
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
  /** The page it was opened from, where leaving it goes (the app's own; the replays when absent). */
  backTo?: string;
}

/** Sends the player's choices and delivers the server's messages (Showdown frames: lines joined with \n). */
export interface BattleConnection {
  /** Set when the battle is a replay: it's watched, with no choices to make. */
  readonly replay?: Replay;
  /**
   * Set when watching a battle live as a spectator: no choices either. Its first frame is the battle
   * so far, applied at once so the screen catches up.
   */
  readonly spectating?: boolean;
  /** The battle's room ("battle-gen9ou-123456"), where there is one (not in a replay). */
  readonly roomId?: string;
  start(onMessage: (frame: string) => void): void;
  choose(choice: string): void;
  forfeit(): void;
  /** Takes back the choices sent while the opponent is still choosing; absent where that can't happen. */
  undo?(): void;
  /** Asks for the battle timer on or off; absent where there's no timer (replays, spectating). */
  setTimer?(on: boolean): void;
  /** Agrees to the open team sheets offered at team preview (Open Team Sheets formats); absent where there's no offer. */
  acceptTeamSheets?(): void;
  /** Says a message in the battle's chat (the server echoes it back as a `|c|` line); absent in replays. */
  say?(text: string): void;
  stop(): void;
}

/**
 * The battle timer while it's on (either player can turn it on): our time left this turn and in total,
 * as of `since`. It only runs while we have something to choose; `since` is null while it's stopped.
 * `turnSeconds` is null when it was turned on while we waited: the server tells our time with our next request.
 */
export interface BattleTimer {
  turnSeconds: number | null;
  totalSeconds: number | null;
  since: number | null;
}
