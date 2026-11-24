import { hasAbilities, hasItems, statRows } from '@core/dex/generations';
import { moveInfo } from '@core/dex/moves';
import { speciesInfo } from '@core/dex/species';
import { barColor } from '@features/battle/gl/hp-bar';
import { STATUS } from '@features/battle/state/status-conditions';
import { InspectedMember } from '@features/battle/state/pokemon-inspection';
import { typeColor } from '@shared/data/type-colors';
import { toId } from '@shared/utils/to-id';

/** Stat stages with no row of their own, shown under the HP. */
const OTHER_BOOSTS = [
  { id: 'accuracy', label: 'Acc' },
  { id: 'evasion', label: 'Eva' },
] as const;
const STAT_TOP = 10;
const STAT_ROW = 21;
/** The widest bar, for a base stat of MAX_STAT or more. */
const STAT_BAR = 96;
const MAX_STAT = 200;
const HP_BAR = 120;
const TYPE_WIDTH = 64;
const MOVE_TOP = 60;
const MOVE_ROW = 21;
const MOVE_SLOTS = 4;

/** A base stat's bar colour, from red (low) to teal (very high), as Showdown's. */
export function statColor(value: number): string {
  if (value < 50) return '#dc2626';
  if (value < 70) return '#ea580c';
  if (value < 90) return '#ca8a04';
  if (value < 110) return '#65a30d';
  if (value < 130) return '#16a34a';
  return '#0d9488';
}

/** "+2", "−1" (a real minus sign). */
function stageText(stage: number): string {
  return stage > 0 ? `+${stage}` : `−${-stage}`;
}

/**
 * Everything a spectator knows of one team member, for the command panel's card while watching a live
 * battle: its trainer, name, level, types (or its Tera type once Terastallized), HP and status; its
 * base stats, with its stat stages while it's on the field; its item and ability once the battle has
 * revealed them (until then the abilities it may have), and the moves it has used so far. With an open
 * team sheet (Open Team Sheets formats) all of those, and its nature, are known from the start.
 */
export function pokemonInfoView(inspected: InspectedMember | null, owner: string, gen = 9) {
  if (!inspected) return { ...EMPTY_VIEW, label: 'Pokémon details: point at a Pokémon on the right' };
  const { side, member, sheet } = inspected;
  const seen = member.seen;
  const species = seen?.species ?? member.species;
  const info = speciesInfo(species, gen);
  const name = seen?.name ?? member.species;

  const gender = seen?.gender || sheet?.gender;
  const nature = sheet?.nature ?? '';
  const subtitle = [seen ? `Lv ${seen.level}` : '', gender === 'M' ? '♂' : gender === 'F' ? '♀' : '', name !== species ? species : '', nature]
    .filter(Boolean)
    .join(' · ');

  // Terastallized, it's of its Tera type only.
  const typeNames = seen?.tera ? [seen.tera] : (info?.types ?? []);
  const types = typeNames.map((type, i) => ({
    text: seen?.tera ? `Tera ${type}` : type,
    tera: !!seen?.tera,
    left: 12 + i * (TYPE_WIDTH + 6),
    width: seen?.tera ? 96 : TYPE_WIDTH,
    color: typeColor(type) || '#374151',
  }));

  const fraction = seen && !seen.fainted && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
  const percent = seen?.fainted ? 0 : Math.max(1, Math.round(fraction * 100));
  const hp = seen ? { width: Math.round(fraction * HP_BAR), color: barColor(fraction), text: `${percent}%` } : null;
  const status = seen?.status && STATUS[seen.status] ? STATUS[seen.status] : null;

  const boosts = member.active ? (seen?.boosts ?? {}) : {};
  const otherBoosts = OTHER_BOOSTS.filter((b) => boosts[b.id]).map((b) => `${b.label} ${stageText(boosts[b.id])}`);
  const where = seen?.fainted ? 'Fainted' : member.active ? 'On the field' : seen ? 'In the back' : 'Not sent out yet';
  const note = [where, ...otherBoosts].join(' · ');

  const stats = info
    ? statRows(gen).map((stat, i) => {
        const value = info.baseStats[stat.id];
        const stage = stat.id === 'hp' ? 0 : (boosts[stat.id] ?? 0);
        return {
          label: stat.label,
          value,
          top: STAT_TOP + i * STAT_ROW,
          width: Math.max(2, Math.round((Math.min(value, MAX_STAT) / MAX_STAT) * STAT_BAR)),
          color: statColor(value),
          stage,
          stageText: stage ? stageText(stage) : '',
        };
      })
    : [];

  const lost = seen?.lostItem ?? '';
  // The sheet's item until the battle shows it used up or knocked off.
  const itemName = seen?.item || (lost ? '' : (sheet?.item ?? ''));
  // Gen 1 has no items, Gens 1 and 2 no abilities: nothing shown.
  const item = itemName || (lost ? `No item (${lost} gone)` : sheet ? 'No item' : hasItems(gen) ? 'Item not revealed' : '');

  const possible = info?.abilities ?? [];
  const known = seen?.ability || sheet?.ability;
  const abilityKnown = !!known || possible.length === 1 || !hasAbilities(gen);
  const ability = !hasAbilities(gen)
    ? ''
    : known || (possible.length === 1 ? possible[0] : possible.length ? `Maybe ${possible.join(' / ')}` : 'Ability not revealed');

  const moves = Array.from({ length: MOVE_SLOTS }, (_, i) => {
    // The sheet's moves in its order; without one, those used so far.
    const move = sheet ? sheet.moves[i] : seen?.moves[i];
    const top = MOVE_TOP + i * MOVE_ROW;
    if (!move) return { name: sheet ? '—' : 'Move not revealed', known: false, top, color: '#111827' };
    const data = moveInfo(move, gen);
    return { name: data?.name ?? move, known: true, top, color: typeColor(data?.type ?? '') || '#4b5563' };
  });

  const knownMoves = moves.filter((m) => m.known).map((m) => m.name);
  const label = [
    `${owner ? `${owner}'s ` : ''}${name}${name !== species ? ` (${species})` : ''}`,
    seen ? `level ${seen.level}` : '',
    nature ? `${nature} nature` : '',
    types.map((t) => t.text).join(' and ') + (types.length ? ' type' : ''),
    hp ? `${hp.text} HP` : '',
    status ? status.name : '',
    note,
    stats.map((s) => `base ${s.label} ${s.value}${s.stage ? ` (${s.stageText})` : ''}`).join(', '),
    item,
    ability && abilityKnown ? `ability ${ability}` : ability,
    knownMoves.length ? `${sheet ? 'moves' : 'moves used'}: ${knownMoves.join(', ')}` : 'no moves used yet',
  ]
    .filter(Boolean)
    .join('; ');

  return {
    shown: true,
    label,
    side,
    owner,
    name,
    subtitle,
    types,
    hp,
    status,
    note,
    stats,
    itemId: itemName ? toId(itemName) : '',
    itemKnown: !!itemName || !hasItems(gen),
    item,
    abilityKnown,
    ability,
    moves,
  };
}

const EMPTY_VIEW = {
  shown: false,
  label: '',
  side: 'p2',
  owner: '',
  name: '',
  subtitle: '',
  types: [],
  hp: null,
  status: null,
  note: '',
  stats: [],
  itemId: '',
  itemKnown: false,
  item: '',
  abilityKnown: false,
  ability: '',
  moves: [],
};
