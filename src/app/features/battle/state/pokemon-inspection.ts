import { Service, computed, inject, signal } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { PreviewMember, previewTeam } from '@features/battle/state/team-preview';
import { SheetPokemon, unpackTeamSheet } from '@features/battle/state/team-sheet';
import { toId } from '@shared/utils/to-id';

/** A team member shown in the spectator's Pokémon panel, with its side. */
export interface InspectedMember {
  side: SideId;
  member: PreviewMember;
  /** Its entry on its side's open team sheet (Open Team Sheets formats): its item, ability, moves and nature from the start. */
  sheet?: SheetPokemon;
}

/**
 * Which team member the spectator's Pokémon panel shows. Watching a live battle, both sides' team
 * tiles can be pointed at, with the d-pad (the canvas focus, which stays a hover: A does nothing) or
 * the mouse; the panel shows the one pointed at, and goes back to its hint once the pointer moves on to
 * another control (or before any).
 */
@Service()
export class PokemonInspection {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);

  /** The tile pointed at, as a keyOf value; null for none. */
  readonly pointed = signal<string | null>(null);

  /** The team member the panel shows, as it is now; null while no tile is pointed at. */
  readonly shown = computed<InspectedMember | null>(() => {
    const key = this.pointed();
    if (!key) return null;
    const side = key.slice(0, 2) as SideId;
    const member = previewTeam(this.store.sides()[side]).find((m) => m.species === key.slice(2));
    if (!member) return null;
    const sheet = this.sheets()[side].find((s) => sameSpecies(s.species, member.species));
    return sheet ? { side, member, sheet } : { side, member };
  });

  /** Both sides' open team sheets, unpacked (empty without one). */
  private readonly sheets = computed<Record<SideId, SheetPokemon[]>>(() => {
    const packed = this.store.teamSheets();
    return {
      p1: packed.p1 ? unpackTeamSheet(packed.p1, this.dex) : [],
      p2: packed.p2 ? unpackTeamSheet(packed.p2, this.dex) : [],
    };
  });

  /** A side's team member as a key: its side and species ("p2Garchomp"; species may hold any character). */
  keyOf(side: SideId, species: string): string {
    return `${side}${species}`;
  }
}

/** A sheet's species against the team preview's, which may leave out the forme ("Urshifu" for "Urshifu-Rapid-Strike"). */
function sameSpecies(sheet: string, preview: string): boolean {
  return toId(sheet) === toId(preview) || sheet.startsWith(`${preview}-`) || preview.startsWith(`${sheet}-`);
}
