import { Component, computed, inject } from '@angular/core';
import { SideId } from '@features/battle/models/battle';
import { BattleStore, signed } from '@features/battle/state/battle-store';

const WIDTH = 560;
/** Title rows; each rating row adds ROW_HEIGHT below them. */
const HEAD_HEIGHT = 96;
const ROW_HEIGHT = 32;
const FIELD_WIDTH = 985;
const FIELD_HEIGHT = 500;
/** As the match header: p1 sky, p2 red. */
const SIDE_COLOR: Record<SideId, string> = { p1: '#7dd3fc', p2: '#fca5a5' };

/**
 * The end of the battle, centred on the field: who won (or a tie) and, in a rated battle, each
 * player's rating before and after with the points won or lost. The ratings come a moment after the
 * battle ends (the server works them out first), with "Updating ratings…" meanwhile. Absolutely placed
 * rows with fixed heights (Brewser layout rules).
 */
@Component({
  selector: 'app-battle-result',
  host: { class: 'absolute top-0 left-0 block h-0 w-0' },
  template: `
    @if (view(); as v) {
      <div
        role="status"
        class="absolute block rounded-md border-4 bg-[#1f2937] text-white"
        [style.left.px]="v.left"
        [style.top.px]="v.top"
        [style.width.px]="width"
        [style.height.px]="v.height"
        [style.border-color]="v.accent"
      >
        <span class="absolute top-[12px] left-0 block h-6 w-[552px] text-center text-base leading-6 font-bold tracking-[4px] uppercase" [style.color]="v.accent">{{
          v.kicker
        }}</span>
        <span class="absolute top-[40px] left-0 block h-10 w-[552px] overflow-hidden text-center text-3xl leading-10 font-bold whitespace-nowrap">{{ v.title }}</span>
        @for (row of v.rows; track row.side) {
          <div class="absolute left-[24px] block h-7 w-[504px]" [style.top.px]="row.top">
            <span class="absolute top-0 left-0 block h-7 w-[240px] overflow-hidden text-lg leading-7 font-bold whitespace-nowrap" [style.color]="row.color">{{ row.name }}</span>
            <span class="absolute top-0 left-[244px] block h-7 w-[160px] text-right text-lg leading-7 text-gray-200">{{ row.before }} → {{ row.after }}</span>
            <span
              class="absolute top-0 left-[416px] block h-7 w-[88px] rounded-md text-center text-lg leading-7 font-bold text-white"
              [style.background-color]="row.changeColor"
              >{{ row.change }}</span
            >
          </div>
        }
        @if (v.updating) {
          <span class="absolute left-0 block h-7 w-[552px] text-center text-base leading-7 text-gray-300" [style.top.px]="headHeight">Updating ratings…</span>
        }
      </div>
    }
  `,
})
export class BattleResult {
  private readonly store = inject(BattleStore);
  protected readonly width = WIDTH;
  protected readonly headHeight = HEAD_HEIGHT;

  protected readonly view = computed(() => {
    const result = this.store.result();
    if (!result) return null;
    const watching = this.store.watching();
    const winner = this.store.winner();
    const kicker = watching ? 'Battle over' : result === 'win' ? 'Victory' : result === 'loss' ? 'Defeat' : 'Draw';
    const accent = result === 'tie' ? '#9ca3af' : watching || result === 'win' ? '#fbbf24' : '#f87171';
    const title = result === 'tie' ? 'The battle ended in a tie!' : `${winner} won!`;

    const ratings = this.store.ratings();
    const rows = (['p1', 'p2'] as const).flatMap((side) => {
      const rating = ratings[side];
      if (!rating) return [];
      return [
        {
          side,
          name: rating.name,
          color: SIDE_COLOR[side],
          before: rating.before,
          after: rating.after,
          change: signed(rating.change),
          changeColor: rating.change > 0 ? '#15803d' : rating.change < 0 ? '#b91c1c' : '#4b5563',
        },
      ];
    });
    const updating = this.store.rated() && rows.length === 0;
    const extraRows = rows.length > 0 ? rows.length : updating ? 1 : 0;
    const height = HEAD_HEIGHT + extraRows * ROW_HEIGHT + (extraRows > 0 ? 12 : 0);
    return {
      kicker,
      accent,
      title,
      rows: rows.map((row, i) => ({ ...row, top: HEAD_HEIGHT + i * ROW_HEIGHT })),
      updating,
      height,
      left: Math.round((FIELD_WIDTH - WIDTH) / 2),
      top: Math.round((FIELD_HEIGHT - height) / 2),
    };
  });
}
