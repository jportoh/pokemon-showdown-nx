import { Component, computed, inject, input } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { PokemonSet } from '@features/teambuilder/models/team';
import { PokemonSprite } from '@shared/components/pokemon-sprite';

@Component({
  imports: [PokemonSprite],
  selector: 'app-team-slot',
  host: { class: 'block' },
  // Fixed 424x172 card with absolutely placed parts (Brewser layout rules, seen on device): sprite, a
  // 3-line summary (name, item/ability, types/nature) and the 4 moves below it. It lives inside a
  // button, so it only uses phrasing elements (spans shown as blocks).
  template: `
    <span class="relative block h-[172px] w-[424px] rounded-lg border border-gray-600 bg-card text-left">
      @if (set(); as pokemon) {
        <app-pokemon-sprite class="absolute top-2 left-2" [sprite]="(mega() ?? species())?.sprite ?? ''" [size]="96" />
        <span class="absolute top-2 left-[108px] block w-[304px]">
          <span class="block text-lg leading-6 font-bold text-white">{{ title() }}</span>
          <span class="block text-sm leading-5 text-gray-300">{{ details() }}</span>
          <span class="block text-sm leading-5 text-gray-400">{{ typesAndNature() }}</span>
        </span>
        <span class="absolute top-[84px] left-[108px] block w-[304px] text-sm leading-5 text-gray-200">
          @for (move of pokemon.moves; track $index) {
            <span class="block">{{ move }}</span>
          }
        </span>
      } @else {
        <span class="absolute top-[74px] left-0 block w-[424px] text-center text-base text-gray-300">+ Add Pokémon</span>
      }
    </span>
  `,
})
export class TeamSlot {
  private readonly dex = inject(ChampionsDex);

  readonly set = input<PokemonSet | undefined>(undefined);

  protected readonly species = computed(() => {
    const set = this.set();
    return set ? this.dex.species(set.species) : undefined;
  });

  /** What it Mega Evolves into, when it holds its Mega Stone: its name and types are shown instead. */
  protected readonly mega = computed(() => {
    const set = this.set();
    return set ? this.dex.mega(set.species, set.item) : undefined;
  });

  /** "Big Shark (Garchomp-Mega)", or just the species without a nickname. */
  readonly title = computed(() => {
    const set = this.set();
    if (!set) return '';
    const species = this.mega()?.name ?? this.species()?.name ?? set.species;
    return set.name ? `${set.name} (${species})` : species;
  });

  protected readonly details = computed(() => {
    const set = this.set();
    if (!set) return '';
    return [set.item || 'No item', set.ability || 'No ability'].join(' · ');
  });

  /** Types and nature: "Dragon / Ground · Jolly Nature". */
  protected readonly typesAndNature = computed(() => {
    const nature = this.set()?.nature;
    const parts = [(this.mega() ?? this.species())?.types.join(' / '), nature ? `${nature} Nature` : undefined];
    return parts.filter(Boolean).join(' · ');
  });
}
