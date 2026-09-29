import { Component, ElementRef, afterRenderEffect, computed, inject, input, viewChild } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { moveType } from '@core/dex/moves';
import { BattleStore } from '@features/battle/state/battle-store';
import { unpackTeamSheet } from '@features/battle/state/team-sheet';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';

/** Two columns of three cards over the whole field (985x500). */
const COLUMNS = 2;
const CARD_WIDTH = 472;
const CARD_HEIGHT = 146;
const CARD_GAP = 17;
const FIRST_LEFT = 12;
const FIRST_TOP = 48;
const ROW_GAP = 6;
const SLOTS = 6;
/** Move pills, two per row beside the sprite. */
const PILL_WIDTH = 170;
const PILL_GAP = 8;

interface SheetCard {
  left: number;
  top: number;
  sprite: string;
  species: string;
  item: string;
  details: string;
  moves: readonly { name: string; left: number; top: number; color: string }[];
  label: string;
}

/**
 * The opponent's open team sheet (Open Team Sheets formats, such as the best-of-3 VGC one): their six
 * Pokémon as the server shows them at team preview, each with its item, ability, nature and moves
 * (moves coloured by type, as on the team cards), everything but stats. Over the whole field, shown
 * on request (ZL) and hidden with display:none rather than removed, as the battle log (removed, the log
 * stayed painted on the console). The six cards sit at fixed places, tracked by position (Brewser
 * layout rules). It takes focus when it opens, so B closes it; the d-pad never moves onto it.
 */
@Component({
  selector: 'app-battle-team-sheet',
  imports: [PokemonSprite],
  host: {
    class: 'h-[500px] w-[985px] bg-card',
    '[style.display]': "open() ? 'block' : 'none'",
  },
  template: `
    <div #sheet role="region" [attr.aria-label]="title()" tabindex="0" data-kb-skip class="relative block h-[500px] w-[985px] text-white">
      <h2 class="absolute top-[10px] left-[16px] block h-7 w-[700px] overflow-hidden text-xl leading-7 font-bold whitespace-nowrap text-red-300">{{ title() }}</h2>
      <p class="absolute top-[12px] left-[720px] block h-6 w-[250px] text-right text-sm leading-6 text-gray-300">Open team sheet · ZL or B to close</p>
      @for (card of cards(); track $index) {
        <div class="block" [class.hidden]="!card">
          @if (card) {
            <div class="absolute block rounded-md bg-stage" role="group" [attr.aria-label]="card.label" [style.left.px]="card.left" [style.top.px]="card.top" [style.width.px]="cardWidth" [style.height.px]="cardHeight">
              <app-pokemon-sprite class="absolute top-[25px] left-[6px]" [sprite]="card.sprite" [size]="96" />
              <span aria-hidden="true" class="absolute top-[6px] left-[112px] block h-7 w-[350px] overflow-hidden text-lg leading-7 font-bold whitespace-nowrap">{{ card.species }}</span>
              <span aria-hidden="true" class="absolute top-[34px] left-[112px] block h-6 w-[350px] overflow-hidden text-base leading-6 whitespace-nowrap text-yellow-100">{{ card.item }}</span>
              <span aria-hidden="true" class="absolute top-[58px] left-[112px] block h-6 w-[350px] overflow-hidden text-base leading-6 whitespace-nowrap text-gray-300">{{ card.details }}</span>
              @for (move of card.moves; track $index) {
                <span
                  aria-hidden="true"
                  class="absolute block h-[22px] overflow-hidden rounded-sm text-center text-sm leading-[22px] font-bold whitespace-nowrap text-white"
                  [style.left.px]="move.left"
                  [style.top.px]="move.top"
                  [style.width.px]="pillWidth"
                  [style.background-color]="move.color"
                  >{{ move.name }}</span
                >
              }
            </div>
          }
        </div>
      }
      <p class="absolute top-[240px] left-0 block h-7 w-[985px] text-center text-lg leading-7 text-gray-300" [class.hidden]="hasSheet()">
        No team sheet for this battle.
      </p>
    </div>
  `,
})
export class BattleTeamSheet {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly sheetElement = viewChild.required<ElementRef<HTMLElement>>('sheet');

  /** Shown over the field; hidden (not removed) otherwise. */
  readonly open = input(false);

  protected readonly cardWidth = CARD_WIDTH;
  protected readonly cardHeight = CARD_HEIGHT;
  protected readonly pillWidth = PILL_WIDTH;

  private readonly sheet = computed(() => {
    const packed = this.store.teamSheets().p2;
    return packed ? unpackTeamSheet(packed, this.dex) : [];
  });

  protected readonly hasSheet = computed(() => this.sheet().length > 0);

  protected readonly title = computed(() => {
    const name = this.store.sides().p2.name;
    return name ? `${name}'s team` : "Your opponent's team";
  });

  /** Six places, each with its card or null. */
  protected readonly cards = computed((): (SheetCard | null)[] => {
    const sheet = this.sheet();
    return Array.from({ length: SLOTS }, (_, index) => {
      const pokemon = sheet[index];
      if (!pokemon) return null;
      const details = [pokemon.ability, pokemon.nature && `${pokemon.nature} Nature`].filter(Boolean).join(' · ');
      return {
        left: FIRST_LEFT + (index % COLUMNS) * (CARD_WIDTH + CARD_GAP),
        top: FIRST_TOP + Math.floor(index / COLUMNS) * (CARD_HEIGHT + ROW_GAP),
        sprite: spriteId(pokemon.species),
        species: pokemon.species,
        item: pokemon.item ? `@ ${pokemon.item}` : 'No item',
        details,
        moves: pokemon.moves.slice(0, 4).map((name, i) => ({
          name,
          left: 112 + (i % 2) * (PILL_WIDTH + PILL_GAP),
          top: 88 + Math.floor(i / 2) * 28,
          color: typeColor(moveType(name)),
        })),
        label: `${pokemon.species} @ ${pokemon.item || 'no item'}. ${details}. Moves: ${pokemon.moves.join(', ')}`,
      };
    });
  });

  private wasOpen = false;

  constructor() {
    afterRenderEffect(() => {
      const open = this.open();
      const opening = open && !this.wasOpen;
      this.wasOpen = open;
      if (opening) this.sheetElement().nativeElement.focus();
    });
  }
}
