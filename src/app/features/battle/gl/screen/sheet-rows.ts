import { ChampionsDex } from '@core/dex/champions-dex';
import { moveType } from '@core/dex/moves';
import { unpackTeamSheet } from '@features/battle/state/team-sheet';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

export interface MovePill {
  name: string;
  top: number;
  color: string;
}

/** A team member as team preview shows it: from their open team sheet when there's one, else its types. */
export interface SheetRow {
  sprite: string;
  name: string;
  /** Item, ability and moves from the open team sheet; null without one (the types show instead). */
  sheet: { item: string; itemId: string; ability: string; moves: readonly MovePill[] } | null;
  types: string;
  label: string;
}

/**
 * A side's team preview (`|poke|` species, in order) as rows, with its packed open team sheet
 * (`|showteam|`) when it's come. Move pills go one under another, from `pillTop`, `pillStep` apart.
 */
export function sheetRows(
  preview: readonly string[],
  packed: string | undefined,
  dex: ChampionsDex,
  pillTop: number,
  pillStep: number,
): SheetRow[] {
  const sheet = packed ? unpackTeamSheet(packed, dex) : [];
  return preview.map((species, i) => {
    const entry = sheet.find((pokemon) => pokemon.species === species) ?? sheet[i];
    const types = dex.species(species)?.types.join(' / ') ?? '';
    return {
      sprite: spriteId(species),
      name: species,
      sheet: entry
        ? {
            item: entry.item || 'No item',
            itemId: toId(entry.item),
            ability: entry.ability,
            moves: movePills(entry.moves.slice(0, 4), pillTop, pillStep),
          }
        : null,
      types,
      label: entry ? `${species} @ ${entry.item || 'no item'}, ${entry.ability}. Moves: ${entry.moves.join(', ')}` : `${species}, ${types}`,
    };
  });
}

/** Move names as pills, one under another, coloured by type. */
export function movePills(names: readonly string[], top: number, step: number): MovePill[] {
  return names.map((name, m) => ({ name, top: top + m * step, color: typeColor(moveType(name)) }));
}
