import { Service, computed, inject, signal } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { PreviewMember, previewTeam } from '@features/battle/state/team-preview';

/** On a team tile a spectator can point at: its side and species ("p2Garchomp"; species may hold any character). */
export const INSPECT_ATTRIBUTE = 'data-inspect';

/** A team member shown in the spectator's Pokémon panel, with its side. */
export interface InspectedMember {
  side: SideId;
  member: PreviewMember;
}

/**
 * Which team member the spectator's Pokémon panel shows. Watching a live battle, both sides' team
 * tiles can be pointed at, with the d-pad (the controller's focus, which stays a hover: A does
 * nothing) or the mouse; the panel shows the one pointed at, and goes back to its hint once the
 * pointer moves on to another control (or before any).
 */
@Service()
export class PokemonInspection {
  private readonly store = inject(BattleStore);
  private readonly navigation = inject(KeyboardNavigation);

  /** The tile under the mouse, as its INSPECT_ATTRIBUTE value; null for none. */
  readonly hovered = signal<string | null>(null);

  private readonly pointed = computed(() => {
    const hovered = this.hovered();
    if (hovered) return hovered;
    const focused = this.navigation.lastFocusedControl();
    return (focused?.isConnected && focused.getAttribute(INSPECT_ATTRIBUTE)) || null;
  });

  /** The team member the panel shows, as it is now; null while no tile is pointed at. */
  readonly shown = computed<InspectedMember | null>(() => {
    const key = this.pointed();
    if (!key) return null;
    const side = key.slice(0, 2) as SideId;
    const member = previewTeam(this.store.sides()[side]).find((m) => m.species === key.slice(2));
    return member ? { side, member } : null;
  });

  /** The INSPECT_ATTRIBUTE value of a side's team member. */
  keyOf(side: SideId, species: string): string {
    return `${side}${species}`;
  }
}
