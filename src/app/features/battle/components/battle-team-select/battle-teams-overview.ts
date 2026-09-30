import { Component, computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { BattleStore } from '@features/battle/state/battle-store';
import { ItemIcon } from '@shared/components/item-icon';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { SheetRow, sheetRows } from './sheet-rows';

const SLOTS = 6;
const ROW_TOP = 8;
const ROW_STEP = 82;
const MOVE_PILL_WIDTH = 150;
const PILL_TOP = 3;
const PILL_STEP = 18;

interface Row extends SheetRow {
  top: number;
}

/**
 * Team preview for a spectator: while the players pick theirs, both teams side by side, laid out like
 * the opponent's in our own team preview (item, ability and moves from each open team sheet, else the
 * types), with nothing to press. Over the field and the side column (1280x500), leaving the spectator
 * panel below. Shown with display:none otherwise (removed, big overlays stayed painted on the console);
 * rows at fixed places, tracked by position.
 */
@Component({
  selector: 'app-battle-teams-overview',
  imports: [ItemIcon, PokemonSprite],
  host: {
    class: 'h-[500px] w-[1280px] bg-retro-bg text-retro-ink',
    '[style.display]': "shown() ? 'block' : 'none'",
  },
  template: `
    <div class="relative block h-[500px] w-[1280px]" role="group" aria-label="Team preview">
      @for (side of sides(); track $index) {
        @for (row of side.rows; track $index) {
          <div class="block" [class.hidden]="!row">
            @if (row) {
              <div
                class="absolute block h-[78px] w-[584px] rounded-xl border-2 bg-retro-panel"
                [class]="side.border"
                role="img"
                [attr.aria-label]="side.name + ': ' + row.label"
                [style.top.px]="row.top"
                [style.left.px]="side.left"
              >
                <app-pokemon-sprite class="absolute top-[1px] left-[6px]" [sprite]="row.sprite" [size]="72" />
                <span aria-hidden="true" class="absolute top-[2px] left-[84px] block h-7 w-[320px] overflow-hidden text-xl leading-7 font-bold whitespace-nowrap">{{ row.name }}</span>
                @if (row.sheet; as sheet) {
                  <app-item-icon class="absolute top-[30px] left-[82px]" [item]="sheet.itemId" [size]="24" />
                  <span aria-hidden="true" class="absolute top-[30px] left-[110px] block h-6 w-[296px] overflow-hidden text-base leading-6 whitespace-nowrap text-retro-muted">{{ sheet.item }}</span>
                  <span aria-hidden="true" class="absolute top-[54px] left-[84px] block h-5 w-[320px] overflow-hidden text-sm leading-5 whitespace-nowrap text-retro-muted">{{ sheet.ability }}</span>
                  @for (move of sheet.moves; track $index) {
                    <span
                      aria-hidden="true"
                      class="absolute left-[420px] block h-4 overflow-hidden rounded-sm text-center text-xs leading-4 font-bold whitespace-nowrap text-white"
                      [style.top.px]="move.top"
                      [style.width.px]="pillWidth"
                      [style.background-color]="move.color"
                      >{{ move.name }}</span
                    >
                  }
                } @else {
                  <span aria-hidden="true" class="absolute top-[30px] left-[84px] block h-6 w-[320px] overflow-hidden text-base leading-6 whitespace-nowrap text-retro-muted">{{ row.types }}</span>
                }
              </div>
            }
          </div>
        }
      }
      <p aria-hidden="true" class="absolute top-[222px] left-[596px] block h-14 w-[88px] text-center text-5xl leading-[56px] font-bold text-retro-accent-text">VS</p>
    </div>
  `,
})
export class BattleTeamsOverview {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);

  protected readonly pillWidth = MOVE_PILL_WIDTH;

  protected readonly shown = computed(() => this.store.spectating() && this.store.teamPreview());

  /** The first player on the left (in blue, as in the header), the second on the right (in red). */
  protected readonly sides = computed(() => {
    if (!this.shown()) return [];
    const { p1, p2 } = this.store.sides();
    const sheets = this.store.teamSheets();
    return [
      { name: p1.name, left: 12, border: 'border-sky-300', rows: this.rows(p1.preview, sheets.p1) },
      { name: p2.name, left: 684, border: 'border-red-300', rows: this.rows(p2.preview, sheets.p2) },
    ];
  });

  private rows(preview: readonly string[], sheet: string | undefined): (Row | null)[] {
    const rows = sheetRows(preview, sheet, this.dex, PILL_TOP, PILL_STEP);
    return Array.from({ length: SLOTS }, (_, i) => (rows[i] ? { ...rows[i], top: ROW_TOP + i * ROW_STEP } : null));
  }
}
