import { STAT_IDS } from '@features/teambuilder/data/game-rules';
import { PokemonSet } from '@features/teambuilder/models/team';

// Showdown's packed team format, which the server takes with `/utm` (and validates with `/vtm`):
// sets joined by `]`, each one
//
//   NICKNAME|SPECIES|ITEM|ABILITY|MOVES|NATURE|EVS|GENDER|IVS|SHINY|LEVEL|HAPPINESS
//
// with names packed to letters and digits (the server looks them up by ID), moves joined by `,`, and
// EVs as six comma-separated numbers. Champions has no IVs or levels to send (the format fixes the
// level at 50), and its stat points travel as EVs.

const DEFAULT_HAPPINESS = 255;

export function packTeam(sets: readonly PokemonSet[]): string {
  return sets.map(packSet).join(']');
}

function packSet(set: PokemonSet): string {
  const species = packName(set.species);
  const name = set.name.replace(/[|\]]/g, '');
  return [
    name || set.species,
    packName(name || set.species) === species ? '' : species,
    packName(set.item),
    packName(set.ability),
    set.moves.map(packName).join(','),
    set.nature,
    // Always explicit: an empty field would leave the server to pick default EVs.
    STAT_IDS.map((stat) => set.evs[stat] ?? 0).join(','),
    set.gender,
    '',
    set.shiny ? 'S' : '',
    '',
    set.happiness !== undefined && set.happiness !== DEFAULT_HAPPINESS ? String(set.happiness) : '',
  ].join('|');
}

/** "Choice Scarf" → "ChoiceScarf", the way Showdown packs names. */
function packName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '');
}
