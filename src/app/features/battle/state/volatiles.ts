import { Volatile } from '@features/battle/models/battle';
import { toId } from '@shared/utils/to-id';
import { effectName } from './battle-text';

/** Moves that bind their target for 4-5 turns: `|-activate|POKEMON|move: Fire Spin|[of] SOURCE` starts it, `|-end|…|Fire Spin|[partiallytrapped]` ends it. */
const TRAPPING_MOVES = new Set(['Bind', 'Wrap', 'Fire Spin', 'Clamp', 'Whirlpool', 'Sand Tomb', 'Magma Storm', 'Infestation', 'Snap Trap', 'Thunder Cage']);

/** What Baton Pass hands on to the Pokémon coming in (Shed Tail hands on only the substitute, which isn't kept here). */
const BATON_PASSED = new Set([
  'confusion',
  'focusenergy',
  'leechseed',
  'curse',
  'ingrain',
  'aquaring',
  'magnetrise',
  'perish',
  'powertrick',
  'embargo',
  'healblock',
  'gastroacid',
  'lockon',
  'telekinesis',
  'saltcure',
]);

const STAT_NAMES: Record<string, string> = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };

/**
 * A `|-start|`'s (or `|-end|`'s) effect as the key it's kept by, and what it carries: "perish2" is
 * the perish count at 2, "stockpile3" three stockpiles, "protosynthesisspe" Protosynthesis on Speed;
 * a binding move is "partiallytrapped".
 */
function keyOf(effect: string, extra?: string): { key: string; name: string; extra?: string } {
  const name = effectName(effect);
  const counted = /^(perish|stockpile)(\d)$/.exec(name);
  if (counted) return { key: counted[1], name: counted[1] === 'perish' ? 'Perish count' : 'Stockpile', extra: counted[2] };
  const booster = /^(protosynthesis|quarkdrive)(atk|def|spa|spd|spe)$/.exec(toId(name));
  if (booster) return { key: booster[1], name: booster[1] === 'protosynthesis' ? 'Protosynthesis' : 'Quark Drive', extra: booster[2] };
  if (TRAPPING_MOVES.has(name)) return { key: 'partiallytrapped', name, extra: name };
  return { key: toId(name), name, extra };
}

/**
 * A volatile condition starting (`|-start|`, a binding move's `|-activate|`, `|-singleturn|` with
 * `until: 'turn'`, `|-singlemove|` with `until: 'move'`): the record with it in, counted from `since`.
 * The perish count and stockpiles replace their earlier count.
 */
export function startVolatile(volatiles: Readonly<Record<string, Volatile>>, effect: string, since: number, extra?: string, until?: Volatile['until']): Record<string, Volatile> {
  const { key, name, extra: value } = keyOf(effect, extra);
  if (!key) return { ...volatiles };
  const known = volatiles[key];
  // A count going down keeps the turn it started on.
  const start = known && (key === 'perish' || key === 'stockpile') ? known.since : since;
  return { ...volatiles, [key]: { id: key, name, since: start, ...(value ? { extra: value } : {}), ...(until ? { until } : {}) } };
}

/** A volatile condition ending (`|-end|`). */
export function endVolatile(volatiles: Readonly<Record<string, Volatile>>, effect: string): Record<string, Volatile> {
  const { key } = keyOf(effect);
  if (!(key in volatiles)) return volatiles as Record<string, Volatile>;
  const rest = { ...volatiles };
  delete rest[key];
  return rest;
}

/** What's left once the turn ends (Protect, Helping Hand… are gone) or once it moves again (Destiny Bond…). */
export function dropVolatiles(volatiles: Readonly<Record<string, Volatile>>, until: Volatile['until']): Record<string, Volatile> {
  return Object.fromEntries(Object.entries(volatiles).filter(([, v]) => v.until !== until));
}

/** What a Pokémon Baton Passed to takes from the one leaving. */
export function batonPassed(volatiles: Readonly<Record<string, Volatile>>): Record<string, Volatile> {
  return Object.fromEntries(Object.entries(volatiles).filter(([key]) => BATON_PASSED.has(key)));
}

/** A binding move's start, from `|-activate|`'s effect ("move: Fire Spin"). */
export function isTrapping(effect: string): boolean {
  return TRAPPING_MOVES.has(effectName(effect));
}

/** A volatile condition as the Pokémon's sheet shows it. */
export interface VolatileLook {
  name: string;
  color: string;
  /** "2 turns left of 3", "Loses 1/8 of its HP each turn"… */
  detail: string;
  /** Turns left of a known total, for its pips. */
  turns?: { left: number; total: number };
  /** A number shown big (the perish count). */
  count?: string;
}

const HARMFUL = '#f87171';
const HELPFUL = '#4ade80';
const BOOSTING = '#fde047';
const NEUTRAL = '#9ca3af';

/** Conditions that last a known number of turns, counting the one they start on. */
const DURATIONS: Record<string, number> = {
  taunt: 3,
  encore: 3,
  disable: 4,
  healblock: 5,
  embargo: 5,
  magnetrise: 5,
  telekinesis: 3,
  throatchop: 2,
  slowstart: 5,
  syrupbomb: 3,
};

/**
 * How a volatile condition shows on the sheet, as of `turn`: its name, colour and what it does, with
 * the turns it has left when that's known. `lastMove` is the move an Encore holds it to.
 */
export function volatileLook(v: Volatile, turn: number, lastMove = ''): VolatileLook {
  const elapsed = Math.max(0, turn - v.since);
  const total = DURATIONS[v.id];
  const turns = total ? { left: Math.max(1, total - elapsed), total } : undefined;
  const left = turns ? `${turns.left} ${turns.left === 1 ? 'turn' : 'turns'} left` : '';
  if (v.until === 'turn') return { name: v.name, color: NEUTRAL, detail: 'This turn only' };
  if (v.until === 'move') return { name: v.name, color: NEUTRAL, detail: 'Until it moves again' };
  switch (v.id) {
    case 'perish': {
      const count = Number(v.extra ?? 0);
      return { name: 'Perish count', color: '#e5e7eb', detail: count === 0 ? 'Faints now' : 'Faints when it reaches 0', count: v.extra ?? '', turns: { left: count, total: 3 } };
    }
    case 'confusion':
      return { name: 'Confused', color: '#c084fc', detail: `Turn ${elapsed + 1} of 2–5 · may hurt itself` };
    case 'attract':
      return { name: 'Infatuated', color: '#f472b6', detail: v.extra ? `With ${v.extra} · may not move` : 'May not move' };
    case 'taunt':
      return { name: 'Taunted', color: HARMFUL, detail: `${left} · no status moves`, turns };
    case 'encore':
      return { name: 'Encore', color: HARMFUL, detail: `${left} · ${lastMove ? `must use ${lastMove}` : 'must repeat its move'}`, turns };
    case 'disable':
      return { name: 'Disabled', color: HARMFUL, detail: `${left} · ${v.extra ? `${v.extra} can't be used` : "a move can't be used"}`, turns };
    case 'torment':
      return { name: 'Tormented', color: HARMFUL, detail: "Can't use a move twice in a row" };
    case 'healblock':
      return { name: 'Heal Block', color: HARMFUL, detail: `${left} · can't heal`, turns };
    case 'embargo':
      return { name: 'Embargo', color: HARMFUL, detail: `${left} · can't use its item`, turns };
    case 'throatchop':
      return { name: 'Throat Chop', color: HARMFUL, detail: `${left} · no sound moves`, turns };
    case 'yawn':
      return { name: 'Drowsy', color: HARMFUL, detail: elapsed === 0 ? 'Falls asleep at the end of next turn' : 'Falls asleep at the end of this turn' };
    case 'leechseed':
      return { name: 'Leech Seed', color: HARMFUL, detail: 'Loses 1/8 of its HP each turn' };
    case 'curse':
      return { name: 'Cursed', color: HARMFUL, detail: 'Loses 1/4 of its HP each turn' };
    case 'nightmare':
      return { name: 'Nightmare', color: HARMFUL, detail: 'Loses 1/4 of its HP each turn asleep' };
    case 'saltcure':
      return { name: 'Salt Cure', color: HARMFUL, detail: 'Loses 1/8 of its HP each turn (1/4 Water, Steel)' };
    case 'partiallytrapped':
      return { name: v.extra ?? 'Bound', color: HARMFUL, detail: `Turn ${elapsed + 1} of 4–5 · can't switch out` };
    case 'trapped':
      return { name: 'Trapped', color: HARMFUL, detail: "Can't switch out" };
    case 'octolock':
      return { name: 'Octolock', color: HARMFUL, detail: "Can't switch out · Def and SpD fall each turn" };
    case 'syrupbomb':
      return { name: 'Syrup Bomb', color: HARMFUL, detail: `${left} · Speed falls each turn`, turns };
    case 'tarshot':
      return { name: 'Tar Shot', color: HARMFUL, detail: 'Weaker to Fire moves' };
    case 'smackdown':
      return { name: 'Smacked Down', color: HARMFUL, detail: 'On the ground' };
    case 'glaiverush':
      return { name: 'Glaive Rush', color: HARMFUL, detail: 'Takes double damage until it moves again' };
    case 'mustrecharge':
      return { name: 'Must recharge', color: HARMFUL, detail: "Can't move next turn" };
    case 'slowstart':
      return { name: 'Slow Start', color: HARMFUL, detail: `${left} · Attack and Speed halved`, turns };
    case 'ingrain':
      return { name: 'Ingrain', color: HELPFUL, detail: "Heals 1/16 each turn · can't switch out" };
    case 'aquaring':
      return { name: 'Aqua Ring', color: HELPFUL, detail: 'Heals 1/16 of its HP each turn' };
    case 'focusenergy':
      return { name: 'Focus Energy', color: BOOSTING, detail: 'Critical hits more likely' };
    case 'laserfocus':
      return { name: 'Laser Focus', color: BOOSTING, detail: 'Its next move is a critical hit' };
    case 'charge':
      return { name: 'Charged', color: BOOSTING, detail: 'Its next Electric move is stronger' };
    case 'flashfire':
      return { name: 'Flash Fire', color: BOOSTING, detail: 'Its Fire moves are stronger' };
    case 'protosynthesis':
    case 'quarkdrive':
      return { name: v.name, color: BOOSTING, detail: `${STAT_NAMES[v.extra ?? ''] ?? 'A stat'} boosted` };
    case 'stockpile':
      return { name: `Stockpile ${v.extra ?? ''}`.trim(), color: BOOSTING, detail: 'Def and SpD raised' };
    case 'magnetrise':
      return { name: 'Magnet Rise', color: HELPFUL, detail: `${left} · immune to Ground moves`, turns };
    case 'telekinesis':
      return { name: 'Telekinesis', color: NEUTRAL, detail: `${left} · floating, easier to hit`, turns };
    case 'noretreat':
      return { name: 'No Retreat', color: NEUTRAL, detail: "Can't switch out" };
    case 'transform':
      return { name: 'Transformed', color: NEUTRAL, detail: v.extra ? `Into ${v.extra}` : 'Into another Pokémon' };
    case 'typechange':
      return { name: 'Type changed', color: NEUTRAL, detail: v.extra ? `Now ${v.extra.replace('/', ' and ')} type` : '' };
    case 'typeadd':
      return { name: 'Type added', color: NEUTRAL, detail: v.extra ? `Also ${v.extra} type` : '' };
    case 'imprison':
      return { name: 'Imprison', color: NEUTRAL, detail: 'Foes can’t use its moves' };
    default:
      return { name: v.name, color: NEUTRAL, detail: left };
  }
}
