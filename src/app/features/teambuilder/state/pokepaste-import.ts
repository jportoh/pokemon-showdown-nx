import { Service, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { NATURES, toStatPoints } from '@features/teambuilder/data/game-rules';
import { PastedSet, parseShowdownPaste } from '@features/teambuilder/data/showdown-paste';
import { MAX_MOVES, MAX_TEAM_SIZE, PokemonSet } from '@features/teambuilder/models/team';
import { toId } from '@shared/utils/to-id';

const POKEPASTE_URL = 'https://pokepast.es';

/** A PokePaste brought into the format: its title and the sets the format has, plus what was left out. */
export interface ImportedPaste {
  title: string;
  sets: PokemonSet[];
  /** Pokémon the format doesn't have (left out of the team). */
  skipped: string[];
  /** Items, abilities and moves the format doesn't have, or the Pokémon can't use (dropped from its set). */
  dropped: number;
}

/** The ID in what was typed: a whole link ("https://pokepast.es/5c8e…/raw") or the ID alone. */
export function pasteId(text: string): string | null {
  const value = text.trim().toLowerCase();
  const id = /(?:^|pokepast\.es\/)([0-9a-f]{16}|[0-9]{1,10})(?:[/?#]|$)/.exec(value);
  return id ? id[1] : null;
}

/** Reads a team from pokepast.es (its `/json`, which any site may read) into the teambuilder's format. */
@Service()
export class PokePasteImport {
  private readonly dex = inject(ChampionsDex);

  /** Throws a message to show when it can't: no paste with that ID, no connection, nothing usable. */
  async load(id: string): Promise<ImportedPaste> {
    let response: Response;
    try {
      response = await fetch(`${POKEPASTE_URL}/${id}/json`);
    } catch {
      throw new Error("Couldn't reach pokepast.es. Check the connection.");
    }
    if (response.status === 404 || response.status === 400) throw new Error(`There's no PokePaste with the ID ${id}.`);
    if (!response.ok) throw new Error(`pokepast.es answered with an error (${response.status}).`);
    const body = (await response.json()) as { paste?: string; title?: string };
    const imported = this.toFormat(parseShowdownPaste(body.paste ?? ''));
    if (imported.sets.length === 0) {
      throw new Error(imported.skipped.length ? `None of its Pokémon are in ${this.dex.format.name}.` : 'That PokePaste has no Pokémon in it.');
    }
    return { ...imported, title: (body.title ?? '').trim() };
  }

  private toFormat(pasted: readonly PastedSet[]): Omit<ImportedPaste, 'title'> {
    const sets: PokemonSet[] = [];
    const skipped: string[] = [];
    let dropped = 0;
    for (const set of pasted) {
      // A Mega's name stands for its base species holding its stone.
      const mega = this.dex.megaById(set.species);
      const species = this.dex.species(mega?.base ?? set.species);
      if (!species || sets.length >= MAX_TEAM_SIZE) {
        skipped.push(set.species);
        continue;
      }
      const item = this.dex.item(set.item || mega?.item || '')?.name ?? '';
      if (set.item && !item) dropped++;
      const ability = species.abilities.find((name) => toId(name) === toId(set.ability)) ?? species.abilities[0] ?? '';
      if (set.ability && toId(ability) !== toId(set.ability)) dropped++;
      const learnable = new Map(species.moves.map((move) => [move.id, move.name]));
      const moves = set.moves.flatMap((move) => learnable.get(toId(move)) ?? []).slice(0, MAX_MOVES);
      dropped += Math.min(set.moves.length, MAX_MOVES) - moves.length;
      sets.push({
        name: set.name,
        species: species.name,
        item,
        ability,
        // As the editor sets it: single-gender species have theirs, genderless ones none.
        gender: species.gender === 'N' ? '' : species.gender || set.gender,
        shiny: set.shiny,
        ...(set.happiness !== undefined ? { happiness: set.happiness } : {}),
        evs: toStatPoints(set.evs),
        nature: NATURES.some((nature) => nature.name === set.nature) ? set.nature : 'Serious',
        moves,
      });
    }
    return { sets, skipped, dropped };
  }
}
