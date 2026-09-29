import { Component, ElementRef, Injector, afterNextRender, afterRenderEffect, computed, inject, input, linkedSignal, output, viewChild, viewChildren } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { abilityName, itemName } from '@core/dex/names';
import { moveType } from '@core/dex/moves';
import { SheetButton } from '@features/battle/components/battle-team-preview/battle-team-preview';
import { BattleStore } from '@features/battle/state/battle-store';
import { unpackTeamSheet } from '@features/battle/state/team-sheet';
import { ItemIcon } from '@shared/components/item-icon';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

const SLOTS = 6;
/** Rows: ours on the left (buttons), theirs on the right, "VS" between them. */
const ROW_TOP = 52;
const ROW_STEP = 96;
const MOVE_PILL_WIDTH = 150;

interface MovePill {
  name: string;
  top: number;
  color: string;
}

interface OwnRow {
  top: number;
  sprite: string;
  name: string;
  item: string;
  itemId: string;
  ability: string;
  moves: readonly MovePill[];
  /** Its place in the order chosen (1 = first lead); null while not chosen. */
  order: number | null;
  lead: boolean;
  label: string;
}

interface TheirRow {
  top: number;
  sprite: string;
  name: string;
  /** Item, ability and moves from their open team sheet; null without one (the types show instead). */
  sheet: { item: string; itemId: string; ability: string; moves: readonly MovePill[] } | null;
  types: string;
  label: string;
}

/**
 * Team preview, Pokémon Champions style in the retro palette: before a battle in a format played
 * with our own teams, the server waits for us to pick the Pokémon we bring, in order (the first ones
 * lead: two in doubles, one in singles). The whole stage's width under the header (1280x672), over the
 * field, the command panel and the side column. Ours are six rows on the left, each a button that adds
 * it to the order or takes it out (its number shows on it, the leads marked); theirs, as the server
 * shows them, on the right, laid out like ours (item, ability and moves from their open team sheet, when
 * there's one); "VS" in the gap between. Done sends the order (\`team 3142\`); B takes the last pick
 * back; ZL (or the button by their name) agrees to open team sheets or shows theirs. Shown while the
 * server asks for it and hidden with display:none otherwise (removed, big overlays stayed painted on
 * the console). Rows at fixed places, tracked by position.
 */
@Component({
  selector: 'app-battle-team-select',
  imports: [ItemIcon, PokemonSprite],
  host: {
    class: 'h-[672px] w-[1280px] bg-retro-bg text-retro-ink',
    '[style.display]': "shown() ? 'block' : 'none'",
  },
  template: `
    <div class="relative block h-[672px] w-[1280px]" role="group" aria-labelledby="team-select-title">
      <h2 id="team-select-title" class="absolute top-[12px] left-[16px] block h-8 w-[560px] overflow-hidden text-2xl leading-8 font-bold whitespace-nowrap">
        {{ instructions() }}
      </h2>
      <p class="absolute top-[16px] left-[704px] block h-6 w-[436px] overflow-hidden text-lg leading-6 font-bold whitespace-nowrap text-red-300">
        {{ opponent() }}
      </p>
      <!-- Their open team sheet (or agreeing to show them): ZL (or a click), not the d-pad. -->
      <div class="block" [class.hidden]="!sheet()">
        <button
          type="button"
          data-kb-skip
          class="absolute top-[12px] left-[1152px] block h-8 w-[112px] rounded-md border-2 border-retro-outline bg-retro-panel p-0 text-sm font-bold hover:bg-retro-select"
          [attr.aria-label]="sheetAriaLabel()"
          (click)="sheetPressed.emit()"
        >
          <span aria-hidden="true" class="absolute top-[4px] left-[4px] block h-5 w-7 rounded-sm bg-retro-select text-center leading-5">ZL</span>
          <span aria-hidden="true" class="absolute top-[4px] left-[36px] block h-5 w-[68px] text-center leading-5">{{ sheetLabel() }}</span>
        </button>
      </div>

      @for (row of own(); track $index; let i = $index) {
        <div class="block" [class.hidden]="!row">
          @if (row) {
            <button
              #pick
              type="button"
              class="absolute left-[16px] block h-[88px] w-[560px] cursor-pointer rounded-xl border-4 p-0"
              [class]="row.order !== null ? 'border-retro-accent-text bg-retro-select' : 'border-retro-outline bg-retro-panel hover:bg-retro-select'"
              [style.top.px]="row.top"
              [attr.aria-pressed]="row.order !== null"
              [attr.aria-label]="row.label"
              (click)="toggle(i)"
            >
              <span
                aria-hidden="true"
                class="absolute top-[20px] left-[10px] block size-10 rounded-full text-center text-xl leading-10 font-bold"
                [class]="row.order === null ? 'border-2 border-retro-outline text-retro-muted' : row.lead ? 'bg-retro-accent text-white' : 'bg-retro-teal text-retro-bg'"
                >{{ row.order ?? '' }}</span
              >
              <app-pokemon-sprite class="absolute top-[2px] left-[58px]" [sprite]="row.sprite" [size]="80" />
              <span aria-hidden="true" class="absolute top-[4px] left-[146px] block h-7 w-[232px] overflow-hidden text-left text-xl leading-7 font-bold whitespace-nowrap">{{ row.name }}</span>
              <app-item-icon class="absolute top-[34px] left-[144px]" [item]="row.itemId" [size]="24" />
              <span aria-hidden="true" class="absolute top-[34px] left-[172px] block h-6 w-[206px] overflow-hidden text-left text-base leading-6 whitespace-nowrap text-retro-muted">{{ row.item }}</span>
              <span aria-hidden="true" class="absolute top-[60px] left-[146px] block h-5 w-[176px] overflow-hidden text-left text-sm leading-5 whitespace-nowrap text-retro-muted">{{ row.ability }}</span>
              <span aria-hidden="true" class="absolute top-[62px] left-[326px] block h-4 w-[52px] text-right text-xs leading-4 font-bold text-retro-accent-text uppercase" [class.hidden]="!row.lead">Lead</span>
              @for (move of row.moves; track $index) {
                <span
                  aria-hidden="true"
                  class="absolute left-[394px] block h-[18px] overflow-hidden rounded-sm text-center text-xs leading-[18px] font-bold whitespace-nowrap text-white"
                  [style.top.px]="move.top"
                  [style.width.px]="pillWidth"
                  [style.background-color]="move.color"
                  >{{ move.name }}</span
                >
              }
            </button>
          }
        </div>
      }

      <p aria-hidden="true" class="absolute top-[308px] left-[576px] block h-14 w-[128px] text-center text-5xl leading-[56px] font-bold text-retro-accent-text">VS</p>

      @for (row of theirs(); track $index) {
        <div class="block" [class.hidden]="!row">
          @if (row) {
            <div
              class="absolute left-[704px] block h-[88px] w-[560px] rounded-xl border-4 border-red-300 bg-retro-panel"
              role="img"
              [attr.aria-label]="row.label"
              [style.top.px]="row.top"
            >
              <app-pokemon-sprite class="absolute top-[2px] left-[10px]" [sprite]="row.sprite" [size]="80" />
              <span aria-hidden="true" class="absolute top-[4px] left-[98px] block h-7 w-[280px] overflow-hidden text-xl leading-7 font-bold whitespace-nowrap">{{ row.name }}</span>
              @if (row.sheet; as sheet) {
                <app-item-icon class="absolute top-[34px] left-[96px]" [item]="sheet.itemId" [size]="24" />
                <span aria-hidden="true" class="absolute top-[34px] left-[124px] block h-6 w-[254px] overflow-hidden text-base leading-6 whitespace-nowrap text-retro-muted">{{ sheet.item }}</span>
                <span aria-hidden="true" class="absolute top-[60px] left-[98px] block h-5 w-[280px] overflow-hidden text-sm leading-5 whitespace-nowrap text-retro-muted">{{ sheet.ability }}</span>
                @for (move of sheet.moves; track $index) {
                  <span
                    aria-hidden="true"
                    class="absolute left-[394px] block h-[18px] overflow-hidden rounded-sm text-center text-xs leading-[18px] font-bold whitespace-nowrap text-white"
                    [style.top.px]="move.top"
                    [style.width.px]="pillWidth"
                    [style.background-color]="move.color"
                    >{{ move.name }}</span
                  >
                }
              } @else {
                <span aria-hidden="true" class="absolute top-[34px] left-[98px] block h-6 w-[280px] overflow-hidden text-base leading-6 whitespace-nowrap text-retro-muted">{{ row.types }}</span>
              }
            </div>
          }
        </div>
      }

      <p role="status" class="absolute top-[634px] left-[16px] block h-7 w-[376px] text-lg leading-7 text-retro-muted">{{ status() }}</p>
      <button
        #doneButton
        type="button"
        class="absolute top-[628px] left-[396px] h-10 w-[180px] rounded-md border-2 text-xl font-bold disabled:cursor-not-allowed disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400"
        [class]="ready() ? 'cursor-pointer border-retro-bar bg-retro-accent text-white hover:bg-retro-accent-hover' : ''"
        [disabled]="!ready()"
        (click)="done()"
      >
        Done
      </button>
      <p class="absolute top-[634px] left-[704px] block h-7 w-[560px] text-right text-base leading-7 text-retro-muted">{{ hint() }}</p>
    </div>
  `,
})
export class BattleTeamSelect {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly injector = inject(Injector);
  private readonly picks = viewChildren<ElementRef<HTMLButtonElement>>('pick');
  private readonly doneButton = viewChild.required<ElementRef<HTMLButtonElement>>('doneButton');

  /** What ZL (and the button by their name) does: see BattleTeamPreview.sheet. */
  readonly sheet = input<SheetButton | null>(null);
  readonly sheetPressed = output<void>();

  protected readonly pillWidth = MOVE_PILL_WIDTH;

  private readonly request = computed(() => {
    const request = this.store.request();
    return request?.teamPreview && !this.store.result() && !this.store.watching() ? request : null;
  });

  protected readonly shown = computed(() => this.request() !== null);

  /** Leads: two in doubles, one in singles. */
  private readonly leads = computed(() => (this.store.gameType() === 'doubles' ? 2 : 1));

  /** How many to bring; all of them when the format doesn't say (then the leads are enough, the server orders the rest). */
  private readonly toBring = computed(() => {
    const request = this.request();
    return request ? Math.min(request.maxChosenTeamSize ?? request.side.pokemon.length, request.side.pokemon.length) : 0;
  });

  /** The team's positions (0-based) in the order picked; a new request starts over. */
  private readonly order = linkedSignal({ source: this.request, computation: (): number[] => [] });

  protected readonly ready = computed(() => {
    const count = this.order().length;
    const request = this.request();
    if (!request) return false;
    return request.maxChosenTeamSize ? count === this.toBring() : count >= Math.min(this.leads(), this.toBring());
  });

  protected readonly instructions = computed(() => {
    const leads = this.leads();
    return `Choose ${this.toBring()} Pokémon · the first ${leads === 1 ? 'one leads' : `${leads} lead`}`;
  });

  protected readonly opponent = computed(() => this.store.sides().p2.name);

  protected readonly status = computed(() => `${this.order().length}/${this.toBring()} chosen`);
  protected readonly hint = computed(() => {
    const sheet = this.sheet();
    if (sheet === 'sheet') return 'A pick · B undo · ZL their full team sheet';
    if (sheet === 'accept') return 'A pick · B undo · ZL accept open team sheets';
    if (sheet === 'waiting') return 'A pick · B undo · Waiting for their answer on sheets';
    return 'A pick · B undo';
  });
  protected readonly sheetLabel = computed(() => ({ sheet: 'Sheet', accept: 'Accept', waiting: 'Waiting' })[this.sheet() ?? 'sheet']);
  protected readonly sheetAriaLabel = computed(
    () =>
      ({
        sheet: "Opponent's team sheet",
        accept: 'Accept open team sheets',
        waiting: 'Open team sheets accepted: waiting for the opponent',
      })[this.sheet() ?? 'sheet'],
  );

  protected readonly own = computed((): (OwnRow | null)[] => {
    const team = this.request()?.side.pokemon ?? [];
    const order = this.order();
    return Array.from({ length: SLOTS }, (_, i) => {
      const pokemon = team[i];
      if (!pokemon) return null;
      const species = pokemon.details.split(', ')[0];
      const place = order.indexOf(i);
      const item = itemName(pokemon.item);
      const moves = pokemon.moves.slice(0, 4).map((move) => this.dex.move(move)?.name ?? move);
      return {
        top: ROW_TOP + i * ROW_STEP,
        sprite: this.dex.mega(species, pokemon.item)?.sprite ?? spriteId(species),
        name: species,
        item: item || 'No item',
        itemId: pokemon.item,
        ability: abilityName(pokemon.ability ?? ''),
        moves: movePills(moves),
        order: place === -1 ? null : place + 1,
        lead: place !== -1 && place < this.leads(),
        label: `${species} @ ${item || 'no item'}${place === -1 ? '' : `: chosen ${place + 1}${place < this.leads() ? ', lead' : ''}`}`,
      };
    });
  });

  protected readonly theirs = computed((): (TheirRow | null)[] => {
    const preview = this.store.sides().p2.preview;
    const packed = this.store.teamSheets().p2;
    const sheet = packed ? unpackTeamSheet(packed, this.dex) : [];
    return Array.from({ length: SLOTS }, (_, i) => {
      const species = preview[i];
      if (!species) return null;
      const entry = sheet.find((pokemon) => pokemon.species === species) ?? sheet[i];
      const types = this.dex.species(species)?.types.join(' / ') ?? '';
      const itemId = entry ? toId(entry.item) : '';
      return {
        top: ROW_TOP + i * ROW_STEP,
        sprite: spriteId(species),
        name: species,
        sheet: entry ? { item: entry.item || 'No item', itemId, ability: entry.ability, moves: movePills(entry.moves.slice(0, 4)) } : null,
        types,
        label: entry
          ? `${species} @ ${entry.item || 'no item'}, ${entry.ability}. Moves: ${entry.moves.join(', ')}`
          : `${species}, ${types}`,
      };
    });
  });

  constructor() {
    // Shown: focus on the first of ours (never a text field here).
    let wasShown = false;
    afterRenderEffect(() => {
      const shown = this.shown();
      const opening = shown && !wasShown;
      wasShown = shown;
      if (opening) this.picks()[0]?.nativeElement.focus();
    });
  }

  /** A: adds the Pokémon to the order (while there's room), or takes it out. */
  protected toggle(index: number): void {
    const order = this.order();
    if (order.includes(index)) this.order.set(order.filter((i) => i !== index));
    else if (order.length < this.toBring()) this.order.set([...order, index]);
    // All picked: on to Done.
    if (this.order().length === this.toBring()) {
      afterNextRender(() => this.doneButton().nativeElement.focus(), { injector: this.injector });
    }
  }

  /** B: takes the last pick back. */
  undo(): void {
    this.order.update((order) => order.slice(0, -1));
  }

  protected done(): void {
    if (!this.ready()) return;
    this.store.choose(`team ${this.order().map((i) => i + 1).join('')}`);
  }
}

/** Move names as pills, one under another, coloured by type. */
function movePills(names: readonly string[]): MovePill[] {
  return names.map((name, m) => ({ name, top: 4 + m * 20, color: typeColor(moveType(name)) }));
}
