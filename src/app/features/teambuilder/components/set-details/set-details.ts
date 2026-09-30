import { NgOptimizedImage } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, viewChild } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { STAT_IDS } from '@features/teambuilder/data/game-rules';
import { MAX_MOVES, PokemonSet } from '@features/teambuilder/models/team';
import { ItemIcon } from '@shared/components/item-icon';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { typeColor } from '@shared/data/type-colors';

/** The fields a card opens a list for. */
export type DetailsField = 'species' | 'item' | 'ability' | 'move0' | 'move1' | 'move2' | 'move3';

type Gender = '' | 'M' | 'F';

/** The Battle page's pixel triangles, 4x7, pointing left and right. */
const LEFT_ARROW = 'M3 0h1v7h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z';
const RIGHT_ARROW = 'M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z';

/** The move cards: 2x2, 206x72, 214 and 80 apart, under the ability. */
const MOVES_TOP = 400;
const MOVE_STEP_X = 214;
const MOVE_STEP_Y = 80;
/**
 * The item's and the ability's descriptions: two lines at most, cut in code (a CSS-truncated line sat
 * off-centre on Brewser). The console's font fits ~55 characters on the item's line and ~60 on the
 * ability's, less a word lost to wrapping.
 */
const MAX_ITEM_DESC_LENGTH = 96;
const MAX_ABILITY_DESC_LENGTH = 104;
/** An empty move slot's background, inline like a move's colour: Brewser kept the old colour when it was removed. */
const EMPTY_MOVE_COLOR = '#121821';
const ACTIVE_EMPTY_MOVE_COLOR = '#2c4157';

interface MoveCard {
  field: DetailsField;
  name: string;
  detail: string;
  /** Showdown's physical/special/status icon; none for an empty slot or an unknown move. */
  categoryIcon: string;
  color: string;
  top: number;
  left: number;
  label: string;
}

interface TypeBadge {
  name: string;
  color: string;
}

/**
 * The Details tab's cards, in the Stats tab's retro style: the species (its sprite, types, base stat total and
 * gender), the item and the ability with a line of what they do, and the moves as a 2x2 grid of cards
 * in their types' colours. A on a card asks for its list (`fieldOpened`, the editor's chooser beside
 * it); left/right on the species step through the genders it can have, as they do the nature. Fixed
 * 420x552, every part at a fixed place (Brewser layout rules). Cards carry `data-field`, so the editor
 * can bring focus back to one.
 */
@Component({
  selector: 'app-set-details',
  imports: [ItemIcon, NgOptimizedImage, PokemonSprite],
  host: { class: 'relative block h-[552px] w-[420px] text-retro-ink' },
  template: `
    <button
      #speciesCard
      type="button"
      data-field="species"
      aria-controls="set-chooser"
      [attr.aria-expanded]="activeField() === 'species'"
      [attr.aria-label]="speciesLabel()"
      (click)="fieldOpened.emit('species')"
      [class]="cardClass('species')"
      class="absolute top-0 left-0 block h-[208px] w-[420px] cursor-pointer rounded-lg border-2 p-0"
    >
      <!-- The sprite (the form it battles in) at 1.5x on a stage that's there even before one is chosen. -->
      <span aria-hidden="true" class="absolute top-[14px] left-[14px] block size-[176px] rounded-md border border-retro-rim bg-retro-bg"></span>
      <app-pokemon-sprite aria-hidden="true" class="absolute top-[18px] left-[18px]" [sprite]="form()?.sprite ?? ''" [size]="168" />

      <span aria-hidden="true" class="absolute top-[24px] left-[204px] block h-7 w-[200px] overflow-hidden text-left text-xl leading-7 font-bold whitespace-nowrap">{{
        speciesName()
      }}</span>
      @for (badge of typeBadges(); track $index) {
        <span
          aria-hidden="true"
          class="absolute top-[60px] block h-5 w-[72px] rounded-sm text-center text-xs leading-5 font-bold text-white"
          [style.left.px]="204 + $index * 80"
          [style.background-color]="badge.color"
          >{{ badge.name }}</span
        >
      }
      <span aria-hidden="true" class="absolute top-[88px] left-[204px] block h-6 w-[200px] text-left text-sm leading-6 text-retro-muted">{{ bstText() }}</span>

      <!-- The gender, changed in place with left/right. -->
      <span aria-hidden="true" class="absolute top-[146px] left-[204px] block h-11 w-[200px] rounded-md border border-retro-rim bg-retro-bg"></span>
      <span aria-hidden="true" class="absolute top-[156px] left-[214px] block h-6 w-[70px] text-left text-sm leading-6 font-bold text-retro-muted">Gender</span>
      <!-- Pixel triangles (Brewser draws ◀ ▶ as emoji), only when there's more than one to pick. -->
      <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[161px] left-[288px] h-[14px] w-2 fill-retro-muted" [class.hidden]="!canChangeGender()">
        <path [attr.d]="leftArrow" />
      </svg>
      <span aria-hidden="true" class="absolute top-[154px] left-[300px] block h-7 w-[80px] text-center text-base leading-7 font-bold">{{ genderName() }}</span>
      <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[161px] left-[384px] h-[14px] w-2 fill-retro-muted" [class.hidden]="!canChangeGender()">
        <path [attr.d]="rightArrow" />
      </svg>
    </button>

    <button
      type="button"
      data-field="item"
      aria-controls="set-chooser"
      [attr.aria-expanded]="activeField() === 'item'"
      [attr.aria-label]="'Item: ' + itemName() + '. Choose'"
      [disabled]="!set()"
      (click)="fieldOpened.emit('item')"
      [class]="cardClass('item')"
      class="absolute top-[216px] left-0 block h-[84px] w-[420px] cursor-pointer rounded-lg border-2 p-0"
    >
      @if (itemId()) {
        <app-item-icon class="absolute top-[24px] left-[8px]" [item]="itemId()" [size]="32" />
      }
      <span aria-hidden="true" class="absolute top-[8px] left-[48px] block h-7 w-[356px] overflow-hidden text-left text-lg leading-7 font-bold whitespace-nowrap">{{
        itemName()
      }}</span>
      <span aria-hidden="true" class="absolute top-[36px] left-[48px] block h-9 w-[356px] text-left text-xs leading-[18px] text-retro-muted">{{ itemDesc() }}</span>
    </button>

    <button
      type="button"
      data-field="ability"
      aria-controls="set-chooser"
      [attr.aria-expanded]="activeField() === 'ability'"
      [attr.aria-label]="'Ability: ' + abilityName() + '. ' + abilityDesc() + '. Choose'"
      [disabled]="!set()"
      (click)="fieldOpened.emit('ability')"
      [class]="cardClass('ability')"
      class="absolute top-[308px] left-0 block h-[84px] w-[420px] cursor-pointer rounded-lg border-2 p-0"
    >
      <span aria-hidden="true" class="absolute top-[8px] left-[14px] block h-7 w-[390px] overflow-hidden text-left text-lg leading-7 font-bold whitespace-nowrap">{{
        abilityName()
      }}</span>
      <span aria-hidden="true" class="absolute top-[36px] left-[14px] block h-9 w-[390px] text-left text-xs leading-[18px] text-retro-muted">{{ abilityDesc() }}</span>
    </button>

    <!-- Tracked by position: a card never moves (Brewser leaves a moved card's children behind). -->
    @for (card of moveCards(); track $index) {
      <button
        type="button"
        [attr.data-field]="card.field"
        aria-controls="set-chooser"
        [attr.aria-expanded]="activeField() === card.field"
        [attr.aria-label]="card.label"
        [disabled]="!set()"
        (click)="fieldOpened.emit(card.field)"
        class="absolute block h-[72px] w-[206px] cursor-pointer rounded-lg border-2 p-0"
        [class]="moveClass(card)"
        [style.top.px]="card.top"
        [style.left.px]="card.left"
        [style.background-color]="moveColor(card)"
      >
        <span aria-hidden="true" class="absolute top-[8px] left-[12px] block h-7 w-[178px] overflow-hidden text-left text-lg leading-7 font-bold whitespace-nowrap">{{
          card.name
        }}</span>
        <!--
          Showdown's category icon, as in battle, and the rest of the line apart (an inline image wraps on
          Brewser). A new image per icon (tracked by URL): a changed src wasn't repainted on Brewser.
        -->
        @for (src of card.categoryIcon ? [card.categoryIcon] : []; track src) {
          <img [ngSrc]="src" width="32" height="14" alt="" class="absolute top-[45px] left-[12px] block" />
        }
        <span
          aria-hidden="true"
          class="absolute top-[42px] block h-5 text-left text-sm leading-5 whitespace-nowrap"
          [class]="card.color ? 'text-[#d1d5db]' : 'text-retro-muted'"
          [style.left.px]="card.categoryIcon ? 50 : 12"
          [style.width.px]="card.categoryIcon ? 140 : 178"
          >{{ card.detail }}</span
        >
      </button>
    }
  `,
})
export class SetDetails {
  private readonly dex = inject(ChampionsDex);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly speciesCard = viewChild.required<ElementRef<HTMLButtonElement>>('speciesCard');

  /** The Pokémon; none yet in a new slot, where only the species can be chosen. */
  readonly set = input<PokemonSet | undefined>(undefined);
  readonly species = input<DexSpecies | undefined>(undefined);
  /** What it Mega Evolves into, when it holds its stone. */
  readonly mega = input<DexMega | undefined>(undefined);
  /** The field whose list is open beside the cards. */
  readonly activeField = input<DetailsField | null>(null);
  readonly fieldOpened = output<DetailsField>();
  readonly genderChanged = output<Gender>();

  protected readonly leftArrow = LEFT_ARROW;
  protected readonly rightArrow = RIGHT_ARROW;

  /** The form it battles in: the Mega's when it holds its stone. */
  protected readonly form = computed(() => this.mega() ?? this.species());

  protected readonly speciesName = computed(() => this.form()?.name ?? (this.set()?.species || 'Choose a species'));
  protected readonly typeBadges = computed((): TypeBadge[] => (this.form()?.types ?? []).map((name) => ({ name, color: typeColor(name) })));
  protected readonly bstText = computed(() => {
    const form = this.form();
    return form ? `BST ${STAT_IDS.reduce((sum, stat) => sum + form.baseStats[stat], 0)}` : '';
  });

  /** '' is "either"; single-gender and genderless species only have what they can be. */
  private readonly genders = computed((): readonly Gender[] => {
    switch (this.species()?.gender) {
      case 'N':
      case 'M':
      case 'F':
        return [];
      default:
        return ['', 'M', 'F'];
    }
  });
  protected readonly canChangeGender = computed(() => !!this.set() && this.genders().length > 1);
  protected readonly genderName = computed(() => {
    const species = this.species();
    if (!this.set() || !species) return '—';
    if (species.gender === 'N') return 'None';
    const gender = species.gender || this.set()?.gender;
    return gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Either';
  });

  protected readonly speciesLabel = computed(() => {
    const form = this.form();
    if (!form) return `Species: ${this.speciesName()}. Choose`;
    const gender = this.canChangeGender() ? `Gender: ${this.genderName()}, left and right change it. ` : '';
    return `Species: ${form.name}, ${form.types.join(' / ')}, ${this.bstText()}. ${gender}Choose`;
  });

  protected readonly itemId = computed(() => this.dex.item(this.set()?.item ?? '')?.id ?? '');
  protected readonly itemName = computed(() => this.set()?.item || 'No item');
  protected readonly itemDesc = computed(() => {
    if (!this.set()?.item) return 'Choose an item';
    return shorten(this.dex.item(this.set()?.item ?? '')?.desc ?? '', MAX_ITEM_DESC_LENGTH);
  });

  protected readonly abilityName = computed(() => this.set()?.ability || 'No ability');
  /** What it does, or, for a Mega, the ability it gets once it Mega Evolves. */
  protected readonly abilityDesc = computed(() => {
    const mega = this.mega();
    if (mega) return `Becomes ${mega.ability} when it Mega Evolves`;
    const ability = this.set()?.ability;
    if (!ability) return 'Choose an ability';
    return shorten(this.dex.ability(ability)?.desc ?? '', MAX_ABILITY_DESC_LENGTH);
  });

  protected readonly moveCards = computed((): MoveCard[] => {
    const moves = this.set()?.moves ?? [];
    return Array.from({ length: MAX_MOVES }, (_, i) => {
      const field = `move${i}` as DetailsField;
      const name = moves[i] ?? '';
      const move = name ? this.dex.move(name) : undefined;
      const detail = move ? [move.type, move.basePower ? `${move.basePower} BP` : ''].filter(Boolean).join(' · ') : name ? '' : 'Choose a move';
      return {
        field,
        name: name || 'No move',
        detail,
        categoryIcon: move ? `categories/${move.category.toLowerCase()}.png` : '',
        color: move ? typeColor(move.type) : '',
        top: MOVES_TOP + Math.floor(i / 2) * MOVE_STEP_Y,
        left: (i % 2) * MOVE_STEP_X,
        label: `Move ${i + 1}: ${name || 'none'}${move ? `, ${[move.type, move.category, move.basePower ? `${move.basePower} BP` : ''].filter(Boolean).join(', ')}` : ''}. Choose`,
      };
    });
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Left/right on the species: the other genders (wrapping around), as on the nature in Stats.
      const unregister = this.navigation.registerAdjuster(this.speciesCard().nativeElement, (step) => {
        if (!this.canChangeGender()) return false;
        this.changeGender(step);
        return true;
      });
      destroyRef.onDestroy(unregister);
    });
  }

  protected cardClass(field: DetailsField): string {
    return this.activeField() === field
      ? 'border-retro-accent-text bg-retro-select'
      : 'border-retro-outline bg-retro-panel hover:bg-retro-select disabled:cursor-not-allowed disabled:border-retro-rim disabled:bg-retro-bg disabled:text-retro-muted';
  }

  /** A move keeps its type's colour; an empty slot looks like a space to fill. */
  protected moveClass(card: MoveCard): string {
    if (this.activeField() === card.field) return 'border-retro-accent-text';
    if (card.color) return 'border-retro-outline';
    return 'border-dashed border-retro-outline text-retro-muted disabled:cursor-not-allowed disabled:border-retro-rim';
  }

  /** Always a colour, never none: Brewser doesn't repaint an inline background that's taken away. */
  protected moveColor(card: MoveCard): string {
    if (card.color) return card.color;
    return this.activeField() === card.field ? ACTIVE_EMPTY_MOVE_COLOR : EMPTY_MOVE_COLOR;
  }

  private changeGender(step: 1 | -1): void {
    const genders = this.genders();
    const index = Math.max(0, genders.indexOf(this.set()?.gender ?? ''));
    this.genderChanged.emit(genders[(index + step + genders.length) % genders.length]);
  }
}

function shorten(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
