import { Component, computed, inject, input } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { MAX_TOTAL_STAT_POINTS, STAT_IDS, STAT_NAMES, totalStatPoints } from '@features/teambuilder/data/game-rules';
import { PokemonSet } from '@features/teambuilder/models/team';
import { ItemIcon } from '@shared/components/item-icon';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { typeColor } from '@shared/data/type-colors';

// Where each stat with points goes under the EV pill: two per row, lined up with the pill's text and
// the move rows (21px apart). Six stats fill the three rows.
const SPREAD_POSITIONS = [
  'top-[101px] left-[288px]',
  'top-[101px] left-[352px]',
  'top-[122px] left-[288px]',
  'top-[122px] left-[352px]',
  'top-[143px] left-[288px]',
  'top-[143px] left-[352px]',
];

@Component({
  imports: [ItemIcon, PokemonSprite],
  selector: 'app-team-slot',
  host: { class: 'block' },
  // Fixed 424x172 card with absolutely placed parts (Brewser layout rules, seen on device): sprite, the
  // item's 48x48 icon centred under it, a
  // 3-line summary (name, item/ability, types/nature) and the 4 moves below it, each on its type's
  // colour: 160x19 pills 2px apart, centred between the summary (which ends at 72px) and the bottom
  // border (8px of space on each side). Right of the moves (x 280-412), a pill of the same size with
  // the EVs (stat points) spent out of 66: grey with none, amber part-way, green once all are spent.
  // Below it, in the rows of moves 2-4, the stats that have points, two per row.
  // It lives inside a button, so it only uses phrasing elements (spans shown as blocks).
  template: `
    <span data-slot-card class="relative block h-[172px] w-[424px] rounded-lg border border-gray-600 bg-card text-left">
      @if (set(); as pokemon) {
        <app-pokemon-sprite class="absolute top-2 left-2" [sprite]="(mega() ?? species())?.sprite ?? ''" [size]="96" />
        <app-item-icon class="absolute top-[110px] left-8" [item]="itemId()" />
        <span class="absolute top-2 left-[108px] block w-[304px]">
          <span class="block text-lg leading-6 font-bold text-white">{{ title() }}</span>
          <span class="block text-sm leading-5 text-gray-300">{{ details() }}</span>
          <span class="block text-sm leading-5 text-gray-400">{{ typesAndNature() }}</span>
        </span>
        <span class="absolute top-[80px] left-[108px] block w-[160px] text-sm leading-[19px] text-white">
          @for (move of moves(); track $index) {
            <span class="mb-[2px] block h-[19px] w-[160px] overflow-hidden rounded-sm p-[0_8px] whitespace-nowrap" [style.background-color]="move.color || null">{{ move.name }}</span>
          }
        </span>
        <span
          class="absolute top-[80px] left-[280px] block h-[19px] w-[132px] rounded-sm p-[0_8px] text-sm leading-[19px] font-bold text-white"
          [class.bg-gray-700]="evTotal() === 0"
          [class.bg-amber-800]="evTotal() > 0 && evTotal() < maxEvs"
          [class.bg-green-800]="evTotal() >= maxEvs"
        >
          {{ evTotal() }}/{{ maxEvs }} EVs
        </span>
        @for (stat of evSpread(); track stat.label) {
          <span class="absolute block h-[19px] w-[60px] text-sm leading-[19px] text-gray-200" [class]="stat.position">{{ stat.label }}</span>
        }
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

  protected readonly maxEvs = MAX_TOTAL_STAT_POINTS;
  /** Stat points (Showdown's EVs in Champions) spent across all stats. */
  protected readonly evTotal = computed(() => totalStatPoints(this.set()?.evs ?? {}));
  /** Only the stats that have points, in stat order: "Atk 32", "Spe 32", "HP 2"… */
  protected readonly evSpread = computed(() => {
    const evs = this.set()?.evs ?? {};
    return STAT_IDS.filter((stat) => (evs[stat] ?? 0) > 0).map((stat, i) => ({
      label: `${STAT_NAMES[stat]} ${evs[stat]}`,
      position: SPREAD_POSITIONS[i],
    }));
  });

  /** The held item's id when it's a legal one (only those have icons). */
  protected readonly itemId = computed(() => this.dex.item(this.set()?.item ?? '')?.id ?? '');

  /** Each move with its type's row colour, as in the move chooser. */
  protected readonly moves = computed(() =>
    (this.set()?.moves ?? []).map((name) => ({ name, color: typeColor(this.dex.move(name)?.type ?? '') })),
  );

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
