import { NgTemplateOutlet } from '@angular/common';
import { SharedItemIcon, SharedSprite } from '@features/battle/components/shared-image/shared-image';
import { Component, ElementRef, afterRenderEffect, computed, inject, input, output } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { itemName } from '@core/dex/names';
import { barColor } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { BattlePokemon, RequestPokemon, SideId } from '@features/battle/models/battle';
import { BattleChoices, SWITCH_ATTRIBUTE } from '@features/battle/state/battle-choices';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { BattleStore, parseCondition } from '@features/battle/state/battle-store';
import { previewTeam } from '@features/battle/state/team-preview';
import { spriteId } from '@shared/utils/sprite-id';

/** Two rows of three tiles, centred in the card under the owner's name. */
const PER_ROW = 3;
const TILE_SIZE = 72;
const TILE_GAP = 10;
const FIRST_LEFT = 17;
const FIRST_TOP = 26;
const ROW_GAP = 8;
const BAR_WIDTH = 56;
const MAX_NAME_CHARS = 30;
const MAX_TEAM = PER_ROW * 2;

/** What the opponent's card's ZL button does: see BattleTeamPreview.sheet. */
export type SheetButton = 'sheet' | 'accept' | 'waiting';

interface Tile {
  key: string;
  sprite: string;
  left: number;
  top: number;
  /** HP bar width in px and colour, once it's been sent out. */
  bar: { width: number; color: string } | null;
  fainted: boolean;
  active: boolean;
  /** Our own Pokémon's held item's ID, for its icon in the corner; '' for none or the opponent's. */
  item: string;
  /** The switch that brings it in (Showdown's switch number) while it can be chosen; null otherwise. */
  switchIndex: number | null;
  /** While choosing, why this one of ours can't come in (A says so in the command panel); null otherwise. */
  blocked: string | null;
  /** Its INSPECT_ATTRIBUTE value while a spectator can point at it; null otherwise. */
  inspect: string | null;
  /** What the tile says to screen readers. */
  label: string;
}

/**
 * A side's team at a glance, under its owner's name: its Pokémon as shown at team preview, the ones on
 * the field framed, the ones sent out with their HP bar and the fainted ones faded. Without a team
 * preview (Random Battle), the Pokémon seen so far, then an empty tile for each one still unseen; our
 * own side knows its whole team from the requests, though, and shows it all, each with its held
 * item's icon in the corner (as Showdown's team icons). Both sides' sit in the battle's right column,
 * the opponent's on top. A card fixed at 271x188, tiles at fixed positions (Brewser layout rules).
 * The tiles show once the battle's opening title has gone: by then the sprites, fetched from team
 * preview on, have had time to download (they popped in late on the console).
 *
 * Our own tiles are how we switch: while choosing, the ones that can come in light up and pick the
 * switch (the command panel's card shows the one pointed at), and a forced switch focuses the first.
 * They're always buttons, disabled while there's nothing to choose: an element that changes kind is
 * the kind of toggle Brewser doesn't redraw reliably.
 *
 * Watching a live battle, both sides' tiles are buttons the d-pad can point at (A does nothing): the
 * command panel shows everything known of the one pointed at (PokemonInspection), framed in yellow.
 * In our own battles the opponent's tiles work the same way.
 */
@Component({
  selector: 'app-battle-team-preview',
  imports: [SharedItemIcon, SharedSprite, NgTemplateOutlet],
  host: { class: 'block h-[188px] w-[271px]' },
  template: `
    <div class="relative block h-[188px] w-[271px] rounded-md bg-card" role="group" [attr.aria-label]="ariaLabel()">
      <span
        aria-hidden="true"
        class="absolute top-[4px] left-[10px] block h-4 overflow-hidden text-xs leading-4 font-bold whitespace-nowrap uppercase"
        [class]="side() === 'p1' ? 'text-sky-300' : 'text-red-300'"
        [style.width.px]="sheet() ? 160 : 251"
        >{{ ownerLabel() }}</span
      >
      <!-- The opponent's open team sheet (or agreeing to show them): ZL (or a click), not the d-pad. -->
      <div class="block" [class.hidden]="!sheet()">
        <button
          type="button"
          data-kb-skip
          class="absolute top-[2px] left-[176px] block h-5 w-[88px] rounded-sm border p-0 text-[11px] font-bold text-white"
          [class]="sheetOpen() ? 'border-sky-300 bg-[#2c4a78]' : 'border-gray-500 bg-tab hover:bg-tab-hover'"
          [attr.aria-expanded]="sheetOpen()"
          [attr.aria-label]="sheetAriaLabel()"
          (click)="toggleSheet.emit()"
        >
          <span aria-hidden="true" class="absolute top-[1px] left-[3px] block h-4 w-[22px] rounded-sm bg-header text-center leading-4">ZL</span>
          <span aria-hidden="true" class="absolute top-0 left-[28px] block h-[18px] w-[56px] text-center leading-[18px]">{{ sheetLabel() }}</span>
        </button>
      </div>
      @for (tile of tiles(); track tile.key) {
        @if (side() === 'p1' || inspectable()) {
          <button
            type="button"
            class="absolute block h-[72px] w-[72px] rounded-md border p-0"
            [class]="tileFrame(tile)"
            [style.left.px]="tile.left"
            [style.top.px]="tile.top"
            [attr.data-switch]="tile.switchIndex"
            [attr.data-inspect]="tile.inspect"
            [disabled]="tile.switchIndex === null && tile.blocked === null && tile.inspect === null"
            [attr.aria-disabled]="tile.blocked !== null"
            [attr.aria-label]="tile.label"
            (click)="pick(tile)"
            (mouseenter)="pointAt(tile)"
            (mouseleave)="pointAt(null)"
          >
            <ng-container [ngTemplateOutlet]="face" [ngTemplateOutletContext]="{ $implicit: tile }" />
          </button>
        } @else {
          <div
            aria-hidden="true"
            class="absolute block h-[72px] w-[72px] rounded-md border"
            [class]="tileFrame(tile)"
            [style.left.px]="tile.left"
            [style.top.px]="tile.top"
          >
            <ng-container [ngTemplateOutlet]="face" [ngTemplateOutletContext]="{ $implicit: tile }" />
          </div>
        }
      }
    </div>

    <ng-template #face let-tile>
      <app-shared-sprite class="absolute top-0 left-[3px]" [sprite]="tile.sprite" [size]="64" [style.opacity]="tile.fainted ? 0.3 : 1" />
      <app-shared-item-icon class="absolute top-[34px] left-[44px]" [item]="tile.item" [size]="24" />
      @if (tile.bar; as bar) {
        <span class="absolute top-[62px] left-[7px] block h-[4px] w-[56px] rounded-[1px] bg-gray-700">
          <span class="block h-[4px] rounded-[1px]" [style.width.px]="bar.width" [style.background-color]="bar.color"></span>
        </span>
      }
    </ng-template>
  `,
})
export class BattleTeamPreview {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly choices = inject(BattleChoices);
  private readonly inspection = inject(PokemonInspection);

  readonly side = input.required<SideId>();
  /**
   * The opponent's card's ZL button: their open team sheet, when it's here; agreeing to open team sheets,
   * while offered; waiting for the opponent to agree too; or none.
   */
  readonly sheet = input<SheetButton | null>(null);
  readonly sheetOpen = input(false);
  readonly toggleSheet = output<void>();

  /**
   * Tiles that can be pointed at, to see everything known of that Pokémon in the panel: both sides'
   * watching a live battle; the opponent's in our own battles (B there goes back to the command panel).
   */
  protected readonly inspectable = computed(() => this.store.spectating() || (this.side() === 'p2' && !this.store.replay()));

  /** Our own team from the last request (the opponent's is never known). */
  private readonly ownTeam = computed(() => (this.side() === 'p1' ? this.store.team() : []));

  /** Without a team preview, our side's team in the request's order; otherwise as previewed. */
  private readonly team = computed(() => {
    const side = this.store.sides()[this.side()];
    const own = this.ownTeam();
    return previewTeam(side.preview.length === 0 && own.length > 0 ? { ...side, preview: own.map(speciesOf) } : side);
  });

  /** Pokémon brought but not seen yet (only without a team preview: it shows them all). */
  private readonly unseen = computed(() => {
    const side = this.store.sides()[this.side()];
    return side.preview.length > 0 ? 0 : Math.max(0, Math.min(MAX_TEAM, side.teamSize) - this.team().length);
  });

  /** Our switches by species while one is being chosen, the ones that can't come in too (with why). */
  private readonly switches = computed(() => {
    if (this.side() !== 'p1' || this.choices.slot() === null || this.choices.pendingMove()) return [];
    return this.choices.switchOptions();
  });

  protected readonly tiles = computed<Tile[]>(() => {
    if (!this.store.started()) return [];
    const members = this.team().map(({ species, seen, active }, i) => {
      const fraction = seen && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
      const option = this.switchFor(species);
      const switchIndex = option?.allowed ? option.index : null;
      // A team member missing from the request was left out at team preview.
      const blocked = this.switches().length === 0 || option?.allowed ? null : (option?.blocked ?? `${this.memberName(species, seen)} wasn't brought to this battle.`);
      return {
        key: `${i}-${species}`,
        sprite: seen?.sprite || (this.dex.species(species)?.sprite ?? spriteId(species)),
        ...this.tilePosition(i),
        bar: seen && !seen.fainted ? { width: Math.max(1, Math.round(fraction * BAR_WIDTH)), color: barColor(fraction) } : null,
        fainted: !!seen?.fainted,
        active,
        item: seen?.fainted ? '' : this.itemOf(species),
        switchIndex,
        blocked,
        inspect: this.inspectable() ? this.inspection.keyOf(this.side(), species) : null,
        label: `${switchIndex !== null ? 'Switch to ' : ''}${this.memberText(species, seen, active)}${blocked ? `. ${blocked}` : ''}`,
      };
    });
    const empty = Array.from({ length: this.unseen() }, (_, n) => {
      const i = members.length + n;
      return { ...this.tilePosition(i), key: `unseen-${i}`, sprite: '', bar: null, fainted: false, active: false, item: '', switchIndex: null, blocked: null, inspect: null, label: 'Not seen yet' };
    });
    return [...members, ...empty];
  });

  private readonly owner = computed(() => this.store.sides()[this.side()].name || (this.side() === 'p2' ? 'Opponent' : 'Player'));

  /** The owner's name, cut by hand to fit (text-overflow is untested on Brewser). */
  protected readonly ownerLabel = computed(() => {
    const name = this.owner();
    return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
  });

  /**
   * "SC-Control's team: Garchomp 64%, in battle; Incineroar, fainted; Amoonguss, not sent out". Our
   * own tiles are buttons with their own labels: the group just names the team.
   */
  protected readonly sheetLabel = computed(() => ({ sheet: 'Sheet', accept: 'Accept', waiting: 'Waiting' })[this.sheet() ?? 'sheet']);
  protected readonly sheetAriaLabel = computed(
    () =>
      ({
        sheet: "Opponent's team sheet",
        accept: 'Accept open team sheets',
        waiting: 'Open team sheets accepted: waiting for the opponent',
      })[this.sheet() ?? 'sheet'],
  );

  protected readonly ariaLabel = computed(() => {
    const owner = this.owner();
    if (this.side() === 'p1' || this.inspectable()) return `${owner}'s team`;
    const members = this.team().map(({ species, seen, active }) => this.memberText(species, seen, active));
    const unseen = this.unseen() > 0 ? [`${this.unseen()} not seen yet`] : [];
    return `${owner}'s team: ${[...members, ...unseen].join('; ') || 'unknown'}`;
  });

  constructor() {
    // A forced switch is chosen here: focus the first Pokémon that can come in, for the controller.
    afterRenderEffect(() => {
      if (this.side() !== 'p1' || !this.choices.forceSwitch() || this.switches().length === 0) return;
      this.focusFirstSwitch();
    });
  }

  /** Focuses the first of our Pokémon that can come in; false when none can. */
  focusFirstSwitch(): boolean {
    const first = this.host.nativeElement.querySelector<HTMLButtonElement>(`button[${SWITCH_ATTRIBUTE}]:not([disabled])`);
    first?.focus();
    return !!first;
  }

  /**
   * The tile's frame: the ones that can come in light up; the one the spectator's panel shows is framed
   * in yellow; the ones on the field are blue; fainted ones dark.
   */
  protected tileFrame(tile: Tile): string {
    if (tile.switchIndex !== null) return 'border-gray-100 bg-[#3a4a68] hover:bg-[#465a7e]';
    if (tile.inspect !== null && tile.inspect === this.shownKey()) {
      return `border-yellow-300 ${tile.fainted ? 'bg-[#1a2436]' : tile.active ? 'bg-[#2c4a78]' : 'bg-header'}`;
    }
    if (tile.fainted) return 'border-gray-700 bg-[#1a2436]';
    return tile.active ? 'border-sky-300 bg-[#2c4a78]' : 'border-gray-600 bg-header';
  }

  /** The spectator panel's Pokémon, as its tile's INSPECT_ATTRIBUTE value. */
  private readonly shownKey = computed(() => {
    const shown = this.inspection.shown();
    return shown ? this.inspection.keyOf(shown.side, shown.member.species) : null;
  });

  /** The mouse over a tile: the switch it would make, or (spectating) the Pokémon to show. */
  protected pointAt(tile: Tile | null): void {
    this.choices.hoveredSwitch.set(tile?.switchIndex ?? null);
    this.inspection.hovered.set(tile?.inspect ?? null);
  }

  protected pick(tile: Tile): void {
    if (tile.blocked !== null) this.choices.notice.set(tile.blocked);
    if (tile.switchIndex === null) return;
    this.choices.hoveredSwitch.set(null);
    this.choices.chooseSwitch(tile.switchIndex);
  }

  /** Our switch of that species while one is being chosen (allowed or not); undefined if not brought. */
  private switchFor(species: string) {
    return this.switches().find((o) => o.species === species || o.species.startsWith(`${species}-`));
  }

  /** Its nickname when known, else its species. */
  private memberName(species: string, seen: BattlePokemon | undefined): string {
    const own = this.ownTeam().find((member) => speciesOf(member) === species);
    return seen?.name ?? (own ? own.ident.slice(own.ident.indexOf(': ') + 2) : species);
  }

  /** "Garchomp 64%, holding Leftovers, in battle", "Incineroar, fainted", "Amoonguss, not sent out". */
  private memberText(species: string, seen: BattlePokemon | undefined, active: boolean): string {
    const own = this.ownTeam().find((member) => speciesOf(member) === species);
    const name = this.memberName(species, seen);
    if (seen?.fainted) return `${name}, fainted`;
    const fraction = seen ? (seen.maxHp > 0 ? seen.hp / seen.maxHp : 0) : own ? hpFraction(own.condition) : null;
    const percent = fraction === null ? '' : ` ${Math.max(1, Math.round(fraction * 100))}%`;
    const item = itemName(own?.item ?? '');
    const holding = item ? `, holding ${item}` : '';
    const where = active ? ', in battle' : seen ? '' : ', not sent out';
    return `${name}${percent}${holding}${where}`;
  }

  /** The held item of our Pokémon of that species, from the last request. */
  private itemOf(species: string): string {
    return this.ownTeam().find((member) => speciesOf(member) === species)?.item ?? '';
  }

  private tilePosition(i: number): { left: number; top: number } {
    return {
      left: FIRST_LEFT + (i % PER_ROW) * (TILE_SIZE + TILE_GAP),
      top: FIRST_TOP + Math.floor(i / PER_ROW) * (TILE_SIZE + ROW_GAP),
    };
  }
}

/** "Garchomp, L50, M" → "Garchomp". */
function speciesOf(pokemon: RequestPokemon): string {
  return pokemon.details.split(',')[0];
}

/** "143/180" → 0.79; 0 when fainted. */
function hpFraction(condition: string): number {
  const { hp, maxHp } = parseCondition(condition, 100);
  return maxHp > 0 ? hp / maxHp : 0;
}
