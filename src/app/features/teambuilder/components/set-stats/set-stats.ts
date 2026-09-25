import { Component, computed, input, output } from '@angular/core';
import { StatTable } from '@core/dex/champions-dex';
import { MAX_STAT_POINTS, MAX_TOTAL_STAT_POINTS, STAT_IDS, STAT_NAMES, calcStat } from '@features/teambuilder/data/game-rules';
import { PokemonSet, StatId, StatSpread } from '@features/teambuilder/models/team';

interface StatRow {
  id: StatId;
  name: string;
  base: number;
  points: number;
  total: number;
  canLower: boolean;
  canRaise: boolean;
}

/** Bigger steps for the −4/+4 buttons, so a stat can go from 0 to 32 in a few presses. */
const BIG_STEP = 4;

@Component({
  selector: 'app-set-stats',
  host: { class: 'block' },
  // Fixed 872x420 table with every control at a fixed absolute position in fixed-height rows
  // (Brewser layout rules, see styles.css). Stat points change with buttons so nothing has to be typed.
  template: `
    <div class="relative h-8 w-[872px] text-sm font-bold text-gray-300">
      <span class="absolute top-1 left-0">Stat</span>
      <span class="absolute top-1 left-[72px]">Base</span>
      <span class="absolute top-1 left-[146px]">Stat points</span>
      <span class="absolute top-1 left-[640px]">Lv. 50</span>
    </div>
    @for (row of rows(); track row.id) {
      <div class="relative h-[52px] w-[872px] border-t border-gray-600" role="group" [attr.aria-label]="row.name">
        <span class="absolute top-[14px] left-0 text-lg font-bold text-white">{{ row.name }}</span>
        <span class="absolute top-[14px] left-[72px] text-lg text-gray-300">{{ row.base }}</span>
        <button
          type="button"
          [disabled]="!row.canLower"
          [attr.aria-label]="'Clear ' + row.name + ' stat points'"
          (click)="changePoints(row.id, 0)"
          [class]="buttonClass"
          class="left-[146px] w-14"
        >
          0
        </button>
        <button
          type="button"
          [disabled]="!row.canLower"
          [attr.aria-label]="'Lower ' + row.name + ' by ' + bigStep"
          (click)="changePoints(row.id, row.points - bigStep)"
          [class]="buttonClass"
          class="left-[210px] w-14"
        >
          −{{ bigStep }}
        </button>
        <button
          type="button"
          [disabled]="!row.canLower"
          [attr.aria-label]="'Lower ' + row.name + ' by 1'"
          (click)="changePoints(row.id, row.points - 1)"
          [class]="buttonClass"
          class="left-[274px] w-11"
        >
          −
        </button>
        <span class="absolute top-[14px] left-[326px] w-14 text-center text-lg text-white" aria-live="polite">{{ row.points }}</span>
        <button
          type="button"
          [disabled]="!row.canRaise"
          [attr.aria-label]="'Raise ' + row.name + ' by 1'"
          (click)="changePoints(row.id, row.points + 1)"
          [class]="buttonClass"
          class="left-[390px] w-11"
        >
          +
        </button>
        <button
          type="button"
          [disabled]="!row.canRaise"
          [attr.aria-label]="'Raise ' + row.name + ' by ' + bigStep"
          (click)="changePoints(row.id, row.points + bigStep)"
          [class]="buttonClass"
          class="left-[442px] w-14"
        >
          +{{ bigStep }}
        </button>
        <button
          type="button"
          [disabled]="!row.canRaise"
          [attr.aria-label]="'Max ' + row.name + ' stat points'"
          (click)="changePoints(row.id, maxPoints)"
          [class]="buttonClass"
          class="left-[506px] w-16"
        >
          Max
        </button>
        <span class="absolute top-[14px] left-[640px] text-lg font-bold text-white">{{ row.total }}</span>
      </div>
    }
    <p class="h-10 border-t border-gray-600 text-base leading-10 text-gray-200" aria-live="polite">
      Stat points left: {{ remaining() }} of {{ maxTotal }}
    </p>
  `,
})
export class SetStats {
  readonly set = input.required<PokemonSet>();
  /** The battling form's base stats (a Mega's when it holds its stone); unknown species have none. */
  readonly baseStats = input<StatTable | undefined>(undefined);
  readonly pointsChanged = output<StatSpread>();

  protected readonly bigStep = BIG_STEP;
  protected readonly maxPoints = MAX_STAT_POINTS;
  protected readonly maxTotal = MAX_TOTAL_STAT_POINTS;
  protected readonly buttonClass =
    'absolute top-2 h-9 cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-400';

  private readonly totalPoints = computed(() => STAT_IDS.reduce((sum, stat) => sum + (this.set().evs[stat] ?? 0), 0));
  protected readonly remaining = computed(() => MAX_TOTAL_STAT_POINTS - this.totalPoints());

  protected readonly rows = computed<StatRow[]>(() => {
    const set = this.set();
    const baseStats = this.baseStats();
    return STAT_IDS.map((id) => {
      const points = set.evs[id] ?? 0;
      const base = baseStats?.[id] ?? 0;
      return {
        id,
        name: STAT_NAMES[id],
        base,
        points,
        total: baseStats ? calcStat(id, base, points, set.nature) : 0,
        canLower: points > 0,
        canRaise: points < MAX_STAT_POINTS && this.remaining() > 0,
      };
    });
  });

  /** Sets a stat's points, kept within 0–32 and the 66 total. */
  protected changePoints(stat: StatId, value: number): void {
    const current = this.set().evs[stat] ?? 0;
    const allowed = Math.max(0, Math.min(value, MAX_STAT_POINTS, current + this.remaining()));
    this.pointsChanged.emit({ ...this.set().evs, [stat]: allowed });
  }
}
