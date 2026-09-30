import { Component, computed, inject, input } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { MAX_MOVES, PokemonSet } from '@features/teambuilder/models/team';
import { ItemIcon } from '@shared/components/item-icon';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { typeColor } from '@shared/data/type-colors';

/** The move pills: 2x2, 116x28, 120 and 32 apart, under the item and ability line. */
const MOVES_TOP = 100;
const MOVES_LEFT = 176;
const MOVE_STEP_X = 120;
const MOVE_STEP_Y = 32;

interface MovePill {
  name: string;
  /** The type's colour; empty for a slot without a move. */
  color: string;
  top: number;
  left: number;
}

interface TypeBadge {
  name: string;
  color: string;
}

@Component({
  imports: [ItemIcon, PokemonSprite],
  selector: 'app-team-slot',
  host: { class: 'block' },
  // Fixed 424x172 card in the Details tab's retro style, with absolutely placed parts (Brewser layout
  // rules, seen on device); positions are inside the 2px border. On the left, the sprite (the form it
  // battles in) at 1.5x on a 152px stage, with the held item's icon in the stage's bottom right corner.
  // On the right (x 176-412): the name, the types as pills, the item and ability, and the four moves as
  // a 2x2 grid of pills in their types' colours (dashed for an empty one). The stat points are left to
  // the Stats tab. It lives inside a button, so it only uses phrasing elements (spans shown as blocks).
  template: `
    @if (set(); as pokemon) {
      <span data-slot-card class="relative block h-[172px] w-[424px] rounded-lg border-2 border-retro-outline bg-retro-panel text-left text-retro-ink hover:bg-retro-select">
        <span class="absolute top-2 left-2 block size-[152px] rounded-md border border-retro-rim bg-retro-bg"></span>
        <app-pokemon-sprite class="absolute top-3 left-3" [sprite]="form()?.sprite ?? ''" [size]="144" />
        <app-item-icon class="absolute top-[124px] left-[124px]" [item]="itemId()" [size]="32" />

        <span class="absolute top-2 left-[176px] block h-7 w-[236px] overflow-hidden text-lg leading-7 font-bold whitespace-nowrap">{{ title() }}</span>
        @for (badge of typeBadges(); track $index) {
          <span
            class="absolute top-[42px] block h-5 w-[72px] rounded-sm text-center text-xs leading-5 font-bold text-white"
            [style.left.px]="176 + $index * 80"
            [style.background-color]="badge.color"
            >{{ badge.name }}</span
          >
        }
        <span class="absolute top-[70px] left-[176px] block h-5 w-[236px] overflow-hidden text-sm leading-5 whitespace-nowrap text-retro-muted">{{
          details()
        }}</span>

        <!-- Tracked by position: a pill never moves (Brewser leaves a moved box's children behind). -->
        @for (move of moves(); track $index) {
          <span
            class="absolute block h-7 w-[116px] overflow-hidden rounded-md p-[0_5px] text-[13px] leading-7 whitespace-nowrap"
            [class]="move.color ? 'text-white' : 'border border-dashed border-retro-rim'"
            [style.top.px]="move.top"
            [style.left.px]="move.left"
            [style.background-color]="move.color || null"
            >{{ move.name }}</span
          >
        }
      </span>
    } @else {
      <span data-slot-card class="relative block h-[172px] w-[424px] rounded-lg border-2 border-dashed border-retro-outline bg-retro-bg text-retro-muted hover:bg-retro-select">
        <span class="absolute top-[72px] left-0 block h-6 w-[420px] text-center text-base leading-6">+ Add Pokémon</span>
      </span>
    }
  `,
})
export class TeamSlot {
  private readonly dex = inject(ChampionsDex);

  readonly set = input<PokemonSet | undefined>(undefined);

  private readonly species = computed(() => {
    const set = this.set();
    return set ? this.dex.species(set.species) : undefined;
  });

  /** The form it battles in: what it Mega Evolves into when it holds its Mega Stone. */
  protected readonly form = computed(() => {
    const set = this.set();
    return (set ? this.dex.mega(set.species, set.item) : undefined) ?? this.species();
  });

  protected readonly typeBadges = computed((): TypeBadge[] => (this.form()?.types ?? []).map((name) => ({ name, color: typeColor(name) })));

  /** The held item's id when it's a legal one (only those have icons). */
  protected readonly itemId = computed(() => this.dex.item(this.set()?.item ?? '')?.id ?? '');

  /** Always four, each with its type's colour; the empty ones are drawn dashed. */
  protected readonly moves = computed((): MovePill[] => {
    const moves = this.set()?.moves ?? [];
    return Array.from({ length: MAX_MOVES }, (_, i) => {
      const name = moves[i] ?? '';
      return {
        name,
        color: name ? typeColor(this.dex.move(name)?.type ?? '') : '',
        top: MOVES_TOP + Math.floor(i / 2) * MOVE_STEP_Y,
        left: MOVES_LEFT + (i % 2) * MOVE_STEP_X,
      };
    });
  });

  /** "Big Shark (Garchomp-Mega)", or just the species without a nickname. */
  protected readonly title = computed(() => {
    const set = this.set();
    if (!set) return '';
    const species = this.form()?.name ?? set.species;
    return set.name ? `${set.name} (${species})` : species;
  });

  /** "Garchompite · Rough Skin". */
  protected readonly details = computed(() => {
    const set = this.set();
    if (!set) return '';
    return [set.item || 'No item', set.ability || 'No ability'].join(' · ');
  });
}
