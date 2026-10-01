import { moveInfo } from '@core/dex/moves';
import { abilityName, itemName } from '@core/dex/names';
import { RequestPokemon } from '@features/battle/models/battle';
import { parseCondition } from '@features/battle/state/battle-store';
import { typeColor } from '@shared/data/type-colors';

const STATS = [
  { id: 'atk', label: 'Atk' },
  { id: 'def', label: 'Def' },
  { id: 'spa', label: 'SpA' },
  { id: 'spd', label: 'SpD' },
  { id: 'spe', label: 'Spe' },
] as const;
/** The stats strip's columns, 322px across the card's inner width. */
const STAT_WIDTH = 64;
/** The moves, two by two. */
const MOVE_WIDTH = 157;
const MOVE_LEFTS = [8, 8 + MOVE_WIDTH + 8];
const MOVE_TOPS = [54, 81];

/**
 * What the card shows under the Pokémon's name and item: its stats (the one choosing, or out there),
 * or its moves (a team member pointed at to switch in, on a blue card so it's clearly another view).
 */
export type PokemonCardMode = 'stats' | 'moves';

/**
 * What the card beside the moves shows of one of our Pokémon as the request describes it: its name and
 * Tera type, its held item and ability, then its stats in a strip or its four moves on their type colours.
 */
export function pokemonCardView(pokemon: RequestPokemon | null, mode: PokemonCardMode) {
  if (!pokemon) return { label: 'Pokémon details', itemId: '', name: '', tera: null, item: '', ability: '', stats: [], moves: [] };
  const name = pokemon.ident.slice(pokemon.ident.indexOf(': ') + 2);
  const { hp, maxHp, fainted } = parseCondition(pokemon.condition, 100);
  const item = itemName(pokemon.item) || 'No item';
  const ability = abilityName(pokemon.ability ?? '');
  const teraType = pokemon.terastallized || pokemon.teraType || '';
  const tera = teraType
    ? { text: `Tera ${teraType}`, color: typeColor(teraType) || '#374151', done: !!pokemon.terastallized }
    : null;
  const stats = pokemon.stats
    ? STATS.map((stat, i) => ({ label: stat.label, value: pokemon.stats?.[stat.id] ?? 0, left: 9 + i * STAT_WIDTH }))
    : [];
  const moves = pokemon.moves.slice(0, 4).map((id, i) => {
    const info = moveInfo(id);
    return {
      name: info?.name ?? id,
      color: typeColor(info?.type ?? '') || '#4b5563',
      left: MOVE_LEFTS[i % 2],
      top: MOVE_TOPS[Math.floor(i / 2)],
    };
  });
  const details = mode === 'moves' ? moves.map((move) => move.name).join(', ') : stats.map((stat) => `${stat.label} ${stat.value}`).join(', ');
  const teraText = tera ? (tera.done ? `Terastallized into ${teraType}` : `Tera ${teraType}`) : '';
  return {
    label: [`${name}, ${fainted ? 'fainted' : `${hp}/${maxHp} HP`}`, item, ability, teraText, details].filter(Boolean).join('; '),
    itemId: fainted ? '' : pokemon.item,
    name,
    tera,
    item,
    ability,
    stats,
    moves,
  };
}
