import { moveInfo } from '@core/dex/moves';
import { hasAbilities, hasItems, statRows } from '@core/dex/generations';
import { abilityName, itemName } from '@core/dex/names';
import { speciesInfo } from '@core/dex/species';
import { BattleFieldState, BattlePokemon, RequestMove, RequestPokemon, SideId } from '@features/battle/models/battle';
import { STATUS } from '@features/battle/state/status-conditions';
import { typeColor } from '@shared/data/type-colors';
import { toId } from '@shared/utils/to-id';
import { parseCondition } from './battle-store';
import { InspectedMember } from './pokemon-inspection';
import { VolatileLook, volatileLook } from './volatiles';

/** A stat stage's multiplier as shown beside it: "×1.5", "×2/3"… (⅓ and ⅔ aren't in the font) */
const MULTIPLIERS: Record<number, string> = {
  [-6]: '×¼',
  [-5]: '×2/7',
  [-4]: '×1/3',
  [-3]: '×0.4',
  [-2]: '×½',
  [-1]: '×2/3',
  0: '',
  1: '×1.5',
  2: '×2',
  3: '×2.5',
  4: '×3',
  5: '×3.5',
  6: '×4',
};

/** A stat stage's effect on its stat (Attack to Speed): +1 is ×1.5, −1 ×⅔. */
export function stageFactor(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

/** "+2", "−1" (a real minus sign), "±0". */
export function stageText(stage: number): string {
  return stage > 0 ? `+${stage}` : stage < 0 ? `−${-stage}` : '±0';
}

/**
 * The lowest and highest Speed a species can have in the format, as Showdown's tooltips show it:
 * Champions (level 50, no IVs) from no stat points and a hindering nature to 32 points and a helping
 * one; other formats from 0 IVs, 0 EVs and a hindering nature to 31 IVs, 252 EVs and a helping one.
 */
export function speedRange(base: number, level: number, champions: boolean): [number, number] {
  if (champions) return [Math.floor(((base + 20) * 90) / 100), Math.floor(((base + 32 + 20) * 110) / 100)];
  const stat = (iv: number, ev: number, nature: number) => Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * nature);
  return [stat(0, 0, 0.9), stat(31, 252, 1.1)];
}

export interface SheetStat {
  label: string;
  base: number;
  /** Ours: the stat as it is (HP: the max). */
  value?: number;
  stage: number;
  /** HP as "170/202"; another stat with its stage applied; '' when unknown or unchanged. */
  now: string;
  multiplier: string;
}

export interface SheetMove {
  name: string;
  color: string;
  known: boolean;
  /** "8/10", ours on the field; '' otherwise. */
  pp: string;
  /** "Fire · Physical · 120"; "Not revealed". */
  meta: string;
  /** It can't be chosen now (Taunt, Disable, no PP). */
  dim: boolean;
}

/** A foe on the field against our Speed: their range and who's faster. */
export interface SpeedRival {
  name: string;
  range: string;
  verdict: 'faster' | 'slower' | 'maybe';
}

export type SheetSpeed =
  | { kind: 'range'; now: string; base: string; /** How the stage, Tailwind or paralysis change it: up (1), down (-1) or not (0). */ change: number; /** What changes it: "Spe −1 · Tailwind". */ reasons: string }
  | { kind: 'versus'; own: number; rivals: SpeedRival[]; note: string };

/** Everything the Pokémon's sheet (Battle info, A on a team card) shows. */
export interface PokemonSheet {
  side: SideId;
  /** Ours, from the server's request: exact stats, PP. */
  own: boolean;
  sprite: string;
  name: string;
  subtitle: string;
  types: { text: string; color: string; tera: boolean }[];
  /** Ours, not Terastallized yet: the type it can turn into. */
  teraType: string;
  hp: { fraction: number; text: string } | null;
  status: { text: string; color: string } | null;
  itemId: string;
  item: string;
  itemKnown: boolean;
  ability: string;
  abilityKnown: boolean;
  /** Where it is ("On the field · left · 2nd turn in"), then what it did last. */
  context: string[];
  stats: SheetStat[];
  /** Accuracy and evasion stages. */
  otherStages: string;
  speed: SheetSpeed | null;
  conditions: VolatileLook[];
  movesTitle: string;
  moves: SheetMove[];
  fainted: boolean;
}

/** What the sheet needs from the battle besides the Pokémon. */
export interface SheetContext {
  gen: number;
  format: string;
  turn: number;
  field: BattleFieldState;
  /** Each side's Pokémon on the field (slot a, b). */
  active: Record<SideId, readonly (BattlePokemon | null)[]>;
  doubles: boolean;
}

/** Ours, in our own battle: the request's entry, its moves' PP when it's on the field, and what the log shows of it. */
export interface OwnMember {
  request: RequestPokemon;
  activeMoves?: readonly RequestMove[];
  seen?: BattlePokemon;
}

const ORDINALS = ['1st', '2nd', '3rd'];

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/**
 * A Pokémon's Speed on the field as far as it goes here: its stage, its side's Tailwind and paralysis
 * (no items or abilities).
 */
function speedNow(speed: number, pokemon: BattlePokemon | undefined, side: SideId, ctx: SheetContext): number {
  let value = Math.floor(speed * stageFactor(pokemon?.boosts['spe'] ?? 0));
  if (ctx.field.sides[side].some((c) => c.name === 'Tailwind')) value *= 2;
  if (pokemon?.status === 'par') value = Math.floor(value * (ctx.gen >= 7 ? 0.5 : 0.25));
  return value;
}

/** What changes a Pokémon's Speed here: "Spe −1 · Tailwind · paralysis". */
function speedReasons(pokemon: BattlePokemon, side: SideId, ctx: SheetContext): string {
  const stage = pokemon.boosts['spe'] ?? 0;
  return [stage ? `Spe ${stageText(stage)}` : '', ctx.field.sides[side].some((c) => c.name === 'Tailwind') ? 'Tailwind' : '', pokemon.status === 'par' ? 'paralysis' : '']
    .filter(Boolean)
    .join(' · ');
}

function isChampions(format: string): boolean {
  return /champions/i.test(format);
}

/** "On the field · left · 2nd turn in" / "In the back" / "Fainted" / "Not sent out yet". */
function whereText(pokemon: BattlePokemon | undefined, side: SideId, ctx: SheetContext): string {
  if (!pokemon) return 'Not sent out yet';
  if (pokemon.fainted) return 'Fainted';
  const slot = ctx.active[side].findIndex((p) => p?.ident === pokemon.ident);
  if (slot < 0) return 'In the back';
  const parts = ['On the field'];
  if (ctx.doubles) parts.push(slot === 0 ? 'left' : 'right');
  const turns = ctx.turn - pokemon.cameIn + 1;
  parts.push(turns >= 1 ? `${ordinal(turns)} turn in` : 'just came in');
  return parts.join(' · ');
}

function conditionsOf(pokemon: BattlePokemon | undefined, turn: number): VolatileLook[] {
  if (!pokemon || pokemon.fainted) return [];
  const looks = Object.values(pokemon.volatiles).map((v) => volatileLook(v, turn, pokemon.lastMove));
  if (pokemon.substitute) looks.unshift({ name: 'Substitute', color: '#4ade80', detail: 'A doll takes the hits for it' });
  // Lasting ones first, this turn's last.
  return looks.sort((a, b) => Number(a.detail === 'This turn only') - Number(b.detail === 'This turn only'));
}

function moveMeta(move: string, gen: number): { name: string; color: string; meta: string } {
  const info = moveInfo(move, gen);
  if (!info) return { name: move, color: '#4b5563', meta: '' };
  const power = info.basePower > 0 ? ` · ${info.basePower}` : '';
  return { name: info.name, color: typeColor(info.type) || '#4b5563', meta: `${info.type} · ${info.category}${power}` };
}

function statusOf(status: string | undefined): PokemonSheet['status'] {
  const known = status ? STATUS[status] : undefined;
  return known ? { text: known.text, color: known.color } : null;
}

/** Our own Pokémon: exact stats and PP from the request, conditions and stages from the log. */
export function ownSheet(member: OwnMember, sprite: string, ctx: SheetContext): PokemonSheet {
  const { request, seen } = member;
  const [species, ...details] = request.details.split(', ');
  const info = speciesInfo(species, ctx.gen);
  const { hp, maxHp, status, fainted } = parseCondition(request.condition, 100);
  const tera = request.terastallized ?? '';
  const level = Number(details.find((d) => /^L\d+$/.test(d))?.slice(1) ?? 100);
  const gender = details.find((d) => d === 'M' || d === 'F');
  const name = request.ident.slice(request.ident.indexOf(': ') + 2);
  // Stages and conditions only count on the field (they go with switching out).
  const onField = request.active && !fainted;
  const boosts = onField ? (seen?.boosts ?? {}) : {};

  const stats = statRows(ctx.gen).map(({ id, label }) => {
    const base = info?.baseStats[id] ?? 0;
    if (id === 'hp') return { label, base, value: maxHp, stage: 0, now: fainted ? '0' : `${hp}`, multiplier: '' };
    const value = request.stats?.[id] ?? 0;
    const stage = boosts[id] ?? 0;
    return { label, base, value, stage, now: stage ? `${Math.floor(value * stageFactor(stage))}` : `${value}`, multiplier: MULTIPLIERS[stage] ?? '' };
  });

  const ownSpeed = request.stats?.spe ?? 0;
  const foes = ctx.active.p2.filter((p): p is BattlePokemon => !!p && !p.fainted);
  const mine = speedNow(ownSpeed, seen, 'p1', ctx);
  const rivals = foes.map((foe) => {
    const base = speciesInfo(foe.species, ctx.gen)?.baseStats.spe ?? 0;
    const [low, high] = speedRange(base, foe.level, isChampions(ctx.format)).map((v) => speedNow(v, foe, 'p2', ctx));
    const verdict: SpeedRival['verdict'] = mine > high ? 'slower' : mine < low ? 'faster' : 'maybe';
    return { name: foe.name, range: `${low}–${high}`, verdict };
  });
  const trickRoom = ctx.field.rooms.some((r) => r.name === 'Trick Room');
  const speed: SheetSpeed | null = fainted
    ? null
    : { kind: 'versus', own: mine, rivals, note: trickRoom ? 'Trick Room: the slower moves first' : 'With stages, Tailwind and paralysis' };

  const disabled = new Set((member.activeMoves ?? []).filter((m) => m.disabled || m.pp === 0).map((m) => m.id));
  const moves = request.moves.slice(0, 4).map((id) => {
    const look = moveMeta(id, ctx.gen);
    const live = member.activeMoves?.find((m) => m.id === id);
    return { ...look, known: true, pp: live?.pp !== undefined ? `${live.pp}/${live.maxpp}` : '', dim: disabled.has(id) };
  });

  const item = itemName(request.item);
  const context = [whereText(seen, 'p1', ctx)];
  if (seen?.lastMove) context.push(`Last used: ${seen.lastMove}`);

  return {
    side: 'p1',
    own: true,
    sprite,
    name,
    subtitle: [`Lv ${level}`, gender === 'M' ? '♂' : gender === 'F' ? '♀' : '', name !== species ? species : ''].filter(Boolean).join(' · '),
    types: (tera ? [tera] : (info?.types ?? [])).map((type) => ({ text: tera ? `Tera ${type}` : type, color: typeColor(type) || '#374151', tera: !!tera })),
    teraType: tera ? '' : (request.teraType ?? ''),
    hp: { fraction: maxHp > 0 ? hp / maxHp : 0, text: fainted ? '0%' : `${hp}/${maxHp}` },
    status: statusOf(status),
    itemId: fainted ? '' : request.item,
    // Gen 1 has no items, Gens 1 and 2 no abilities: nothing shown.
    item: item || (hasItems(ctx.gen) ? 'No item' : ''),
    itemKnown: !!item || !hasItems(ctx.gen),
    ability: hasAbilities(ctx.gen) ? abilityName(request.ability ?? request.baseAbility ?? '') : '',
    abilityKnown: true,
    context,
    stats,
    otherStages: otherStages(boosts),
    speed,
    conditions: onField ? conditionsOf(seen, ctx.turn) : [],
    movesTitle: 'Moves',
    moves,
    fainted,
  };
}

/** A Pokémon as far as the battle (or its side's open team sheet) has shown it: an opponent's, or either side's watching. */
export function seenSheet(inspected: InspectedMember, sprite: string, ctx: SheetContext): PokemonSheet {
  const { side, member, sheet } = inspected;
  const seen = member.seen;
  const species = seen?.species ?? member.species;
  const info = speciesInfo(species, ctx.gen);
  const name = seen?.name ?? member.species;
  const gender = seen?.gender || sheet?.gender;
  const nature = sheet?.nature ?? '';
  const boosts = member.active ? (seen?.boosts ?? {}) : {};

  const stats = statRows(ctx.gen).map(({ id, label }) => {
    const stage = id === 'hp' ? 0 : (boosts[id] ?? 0);
    return { label, base: info?.baseStats[id] ?? 0, stage, now: '', multiplier: MULTIPLIERS[stage] ?? '' };
  });

  const base = info?.baseStats.spe ?? 0;
  const level = seen?.level ?? (isChampions(ctx.format) ? 50 : 100);
  const range = speedRange(base, level, isChampions(ctx.format));
  const now = member.active && seen ? range.map((v) => speedNow(v, seen, side, ctx)) : range;
  const change = Math.sign(now[1] - range[1]);
  const reasons = member.active && seen ? speedReasons(seen, side, ctx) : '';
  const speed: SheetSpeed | null = info ? { kind: 'range', now: `${now[0]} – ${now[1]}`, base: `${range[0]} – ${range[1]}`, change, reasons } : null;

  const lost = seen?.lostItem ?? '';
  // The sheet's item until the battle shows it used up or knocked off.
  const itemShown = seen?.item || (lost ? '' : (sheet?.item ?? ''));
  const item = itemShown || (lost ? `None (${lost} gone)` : sheet ? 'No item' : hasItems(ctx.gen) ? 'Not revealed' : '');
  const possible = info?.abilities ?? [];
  const knownAbility = seen?.ability || sheet?.ability;
  const abilityKnown = !!knownAbility || possible.length === 1 || !hasAbilities(ctx.gen);
  const ability = !hasAbilities(ctx.gen)
    ? ''
    : knownAbility || (possible.length === 1 ? possible[0] : possible.length ? `Maybe ${possible.join(' / ')}` : 'Not revealed');

  const known = sheet ? sheet.moves : (seen?.moves ?? []);
  const moves = Array.from({ length: 4 }, (_, i): SheetMove => {
    const move = known[i];
    if (!move) return { name: '?', color: '#1f2937', known: false, pp: '', meta: sheet ? '' : 'Not revealed', dim: false };
    return { ...moveMeta(move, ctx.gen), known: true, pp: '', dim: false };
  });

  const fraction = seen && !seen.fainted && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
  const context = [whereText(seen, side, ctx)];
  const last = [seen?.lastMove ? `Last used: ${seen.lastMove}` : '', seen?.tera ? `Terastallized` : ''].filter(Boolean);
  if (last.length) context.push(last.join(' · '));

  return {
    side,
    own: false,
    sprite,
    name,
    subtitle: [seen ? `Lv ${seen.level}` : '', gender === 'M' ? '♂' : gender === 'F' ? '♀' : '', name !== species ? species : '', nature].filter(Boolean).join(' · '),
    types: (seen?.tera ? [seen.tera] : (info?.types ?? [])).map((type) => ({ text: seen?.tera ? `Tera ${type}` : type, color: typeColor(type) || '#374151', tera: !!seen?.tera })),
    teraType: '',
    hp: seen ? { fraction, text: seen.fainted ? '0%' : `${Math.max(1, Math.round(fraction * 100))}%` } : null,
    status: statusOf(seen?.status),
    itemId: itemShown ? toId(itemShown) : '',
    item,
    itemKnown: !!itemShown || !hasItems(ctx.gen),
    ability,
    abilityKnown,
    context,
    stats,
    otherStages: otherStages(boosts),
    speed,
    conditions: member.active ? conditionsOf(seen, ctx.turn) : [],
    movesTitle: sheet ? 'Moves (open team sheet)' : `Moves seen (${known.length} of 4)`,
    moves,
    fainted: !!seen?.fainted,
  };
}

function otherStages(boosts: Record<string, number>): string {
  return `Accuracy ${stageText(boosts['accuracy'] ?? 0)} · Evasion ${stageText(boosts['evasion'] ?? 0)}`;
}
