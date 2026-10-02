import { Service, computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { PreviewMember, previewTeam } from '@features/battle/state/team-preview';
import { SheetPokemon, unpackTeamSheet } from '@features/battle/state/team-sheet';
import { toId } from '@shared/utils/to-id';

/** A team member as far as the battle has shown it, with its side. */
export interface InspectedMember {
  side: SideId;
  member: PreviewMember;
  /** Its entry on its side's open team sheet (Open Team Sheets formats): its item, ability, moves and nature from the start. */
  sheet?: SheetPokemon;
}

/**
 * Both teams as far as the battle has shown them, for Battle info: each side's team preview (or the
 * Pokémon seen so far, without one), every member with what's been seen of it and its entry on its
 * side's open team sheet, when there's one.
 */
@Service()
export class PokemonInspection {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);

  readonly teams = computed<Record<SideId, InspectedMember[]>>(() => {
    const sides = this.store.sides();
    const sheets = this.sheets();
    const membersOf = (side: SideId): InspectedMember[] =>
      previewTeam(sides[side]).map((member) => {
        const sheet = sheets[side].find((s) => sameSpecies(s.species, member.species));
        return sheet ? { side, member, sheet } : { side, member };
      });
    return { p1: membersOf('p1'), p2: membersOf('p2') };
  });

  /** Both sides' open team sheets, unpacked (empty without one). */
  private readonly sheets = computed<Record<SideId, SheetPokemon[]>>(() => {
    const packed = this.store.teamSheets();
    return {
      p1: packed.p1 ? unpackTeamSheet(packed.p1, this.dex) : [],
      p2: packed.p2 ? unpackTeamSheet(packed.p2, this.dex) : [],
    };
  });
}

/** A sheet's species against the team preview's, which may leave out the forme ("Urshifu" for "Urshifu-Rapid-Strike"). */
function sameSpecies(sheet: string, preview: string): boolean {
  return toId(sheet) === toId(preview) || sheet.startsWith(`${preview}-`) || preview.startsWith(`${sheet}-`);
}
