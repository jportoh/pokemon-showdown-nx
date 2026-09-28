import { Component, computed, inject, input } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { speciesInfo } from '@core/dex/species';
import { MAX_TEAM_SIZE, Team } from '@features/teambuilder/models/team';
import { ItemIcon } from '@shared/components/item-icon';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

interface PreviewCard {
  sprite: string;
  species: string;
  types: readonly { name: string; color: string; left: number }[];
  item: string;
  itemId: string;
}

/** Card size and gaps, three per row in the 746px inside of the preview box. */
const CARD_WIDTH = 228;
const CARD_HEIGHT = 244;
const CARD_GAP = 16;
const TYPE_WIDTH = 96;
const TYPE_GAP = 8;

/**
 * The team picked, as six cards of three per row: each Pokémon's sprite at its own 96px (its Mega's when it holds its Mega Stone), its species,
 * its types and its item. Species of any format work (types from the species data). A random format
 * shows six "?" cards; a team short of six, empty cards. Read-only: nothing here takes focus.
 */
@Component({
  imports: [ItemIcon, PokemonSprite],
  selector: 'app-team-preview',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[504px] w-[716px]' },
  template: `
    <ul class="relative block h-[504px] w-[716px]" [attr.aria-label]="randomTeams() ? null : 'Pokémon in the team'" [attr.aria-hidden]="randomTeams() ? 'true' : null">
      @for (card of cards(); track $index; let i = $index) {
        <li
          class="absolute block rounded-lg border-2 border-retro-rim bg-retro-bg"
          [style.left.px]="(i % 3) * (cardWidth + cardGap)"
          [style.top.px]="Math.floor(i / 3) * (cardHeight + cardGap)"
          [style.width.px]="cardWidth"
          [style.height.px]="cardHeight"
        >
          @if (card; as card) {
            <app-pokemon-sprite class="absolute top-[8px] left-[64px]" [sprite]="card.sprite" [size]="96" />
            <span class="absolute top-[108px] left-[8px] block h-8 w-[208px] truncate text-center text-xl leading-8 font-bold">{{ card.species }}</span>
            @for (type of card.types; track type.name) {
              <span
                class="absolute top-[148px] block h-7 rounded-md text-center text-base leading-7 font-bold text-white"
                [style.left.px]="type.left"
                [style.width.px]="typeWidth"
                [style.background-color]="type.color"
                >{{ type.name }}</span
              >
            }
            @if (card.item) {
              <app-item-icon class="absolute top-[192px] left-[12px]" [item]="card.itemId" [size]="24" />
              <span class="absolute top-[190px] left-[44px] block h-7 w-[168px] truncate text-base leading-7 text-retro-muted">{{ card.item }}</span>
            }
          } @else if (randomTeams()) {
            <span class="absolute top-[64px] left-[8px] block h-24 w-[208px] text-center text-[80px] leading-[96px] font-bold text-retro-rim">?</span>
          }
        </li>
      }
    </ul>
  `,
})
export class TeamPreview {
  private readonly dex = inject(ChampionsDex);

  /** The team to show; null with random teams (or none to show). */
  readonly team = input<Team | null>(null);
  readonly randomTeams = input(false);

  protected readonly Math = Math;
  protected readonly cardWidth = CARD_WIDTH;
  protected readonly cardHeight = CARD_HEIGHT;
  protected readonly cardGap = CARD_GAP;
  protected readonly typeWidth = TYPE_WIDTH;

  /** Six cards; null for an empty slot (or a "?" one with random teams). */
  protected readonly cards = computed((): (PreviewCard | null)[] => {
    const sets = this.randomTeams() ? [] : (this.team()?.sets ?? []);
    const cards = sets.slice(0, MAX_TEAM_SIZE).map((set): PreviewCard => {
      const info = speciesInfo(set.species);
      const types = info?.types ?? [];
      // Centred as a pair, or the one type alone.
      const first = (CARD_WIDTH - 4 - types.length * TYPE_WIDTH - (types.length - 1) * TYPE_GAP) / 2;
      return {
        // Holding its Mega Stone, it shows as the Mega it becomes.
        sprite: this.dex.mega(set.species, set.item)?.sprite ?? this.dex.species(set.species)?.sprite ?? spriteId(set.species),
        species: info?.name ?? set.species,
        types: types.map((name, i) => ({ name, color: typeColor(name) || '#4b5563', left: first + i * (TYPE_WIDTH + TYPE_GAP) })),
        item: set.item,
        itemId: this.dex.item(set.item)?.id ?? toId(set.item),
      };
    });
    return [...cards, ...Array<null>(MAX_TEAM_SIZE - cards.length).fill(null)];
  });
}
