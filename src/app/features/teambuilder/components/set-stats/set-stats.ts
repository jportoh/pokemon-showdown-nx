import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input, linkedSignal, output, viewChild, viewChildren } from '@angular/core';
import { StatTable } from '@core/dex/champions-dex';
import { KeyboardNavigation, PageStep } from '@core/input/keyboard-navigation';
import { MAX_STAT_POINTS, MAX_TOTAL_STAT_POINTS, NATURES, STAT_IDS, STAT_NAMES, calcStat, totalStatPoints } from '@features/teambuilder/data/game-rules';
import { PokemonSet, StatId, StatSpread } from '@features/teambuilder/models/team';
import { BackAction } from '@shared/directives/back-action';

const FULL_NAMES: Record<StatId, string> = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };

/** The list's rows: 60px buttons, 68px apart, under the 36px header; the nature's row under them. */
const ROW_TOP = 36;
const ROW_STEP = 68;
/** The nature's choices, in order: none, then the natures by name. */
const NATURE_CHOICES = ['', ...NATURES.map((nature) => nature.name)];
/**
 * The natures' grid, as the games' charts lay it out: a row per stat raised, a column per stat lowered,
 * the neutral natures on the diagonal. Cells 64x50, 68 and 56 apart, after the row labels and the column
 * labels' line.
 */
const GRID_STATS: readonly StatId[] = ['atk', 'def', 'spa', 'spd', 'spe'];
const NEUTRAL_NATURES: Partial<Record<StatId, string>> = { atk: 'Hardy', def: 'Docile', spa: 'Bashful', spd: 'Quirky', spe: 'Serious' };
const GRID_LEFT = 72;
const GRID_TOP = 68;
const CELL_STEP_X = 68;
const CELL_STEP_Y = 56;

interface NatureCell {
  name: string;
  neutral: boolean;
  top: number;
  left: number;
  label: string;
}

const NATURE_GRID: readonly NatureCell[] = GRID_STATS.flatMap((plus, row) =>
  GRID_STATS.map((minus, column) => {
    const name = row === column ? NEUTRAL_NATURES[plus] : NATURES.find((n) => n.plus === plus && n.minus === minus)?.name;
    return {
      name: name ?? '',
      neutral: row === column,
      top: GRID_TOP + row * CELL_STEP_Y,
      left: GRID_LEFT + column * CELL_STEP_X,
      label: row === column ? `${name}, changes no stat` : `${name}, raises ${FULL_NAMES[plus]}, lowers ${FULL_NAMES[minus]}`,
    };
  }),
);
/** The bar in each row, and the gauge's segments (one per point). */
const BAR_WIDTH = 152;
const SEGMENT_WIDTH = 7;
const SEGMENT_STEP = 9;
/** The Battle page's pixel triangles: 4x7 pointing left/right, 7x4 pointing up/down. */
const LEFT_ARROW = 'M3 0h1v7h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z';
const RIGHT_ARROW = 'M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z';
const UP_ARROW = 'M3 0h1v1h1v1h1v1h1v1h-7v-1h1v-1h1v-1h1z';
const DOWN_ARROW = 'M0 0h7v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z';

interface StatRow {
  id: StatId;
  name: string;
  base: number;
  points: number;
  total: number;
  /** The nature raises it ('+'), lowers it ('−') or neither (''). */
  nature: '+' | '−' | '';
  top: number;
  barWidth: number;
  label: string;
}

interface Segment {
  left: number;
  /** Spent, still available (within the 66 total), or out of reach. */
  state: 'on' | 'free' | 'off';
}

/**
 * The Stats tab's stat points, Pokémon Champions style in the retro palette: six rows (the stat at
 * level 50, a bar for its points out of 32) and, beside them, the panel to adjust one. A on a row opens
 * it on that stat: a gauge of 32 segments that left/right move a point at a time (held, they repeat),
 * L empties and R fills as far as the 66 total allows, up/down move to the other stats. A confirms
 * every change made there and B drops them. Fixed 872x528, every part at a fixed place; the panel and
 * the hint that stands in for it stay mounted, toggled by normal-flow wrappers (Brewser layout rules).
 * Under the stats, the nature, as in Champions: A opens the natures' grid in the panel's place (A picks
 * one, B leaves it as it was) and left/right step through them in place (a native select didn't take
 * the d-pad on the console).
 */
@Component({
  selector: 'app-set-stats',
  imports: [BackAction],
  host: { class: 'relative block h-[528px] w-[872px] text-retro-ink' },
  template: `
    <h3 class="absolute top-0 left-0 block h-7 w-[200px] text-lg leading-7 font-bold text-retro-muted">Stat points</h3>
    <p class="absolute top-0 left-[220px] block h-7 w-[200px] text-right text-lg leading-7 font-bold" aria-live="polite">{{ used() }}/{{ maxTotal }}</p>

    @for (row of rows(); track row.id; let i = $index) {
      <button
        #row
        type="button"
        class="absolute left-0 block h-[60px] w-[420px] cursor-pointer rounded-lg border-2 p-0"
        [class]="editing() === row.id ? 'border-retro-accent-text bg-retro-select' : 'border-retro-outline bg-retro-panel hover:bg-retro-select'"
        [style.top.px]="row.top"
        [attr.aria-label]="row.label"
        (click)="open(row.id)"
      >
        <span aria-hidden="true" class="absolute top-[4px] left-[14px] block h-7 w-[96px] text-left text-lg leading-7 font-bold">{{ row.name }}</span>
        <span aria-hidden="true" class="absolute top-[32px] left-[14px] block h-5 w-[96px] text-left text-xs leading-5 text-retro-muted">Base {{ row.base }}</span>
        <span
          aria-hidden="true"
          class="absolute top-[18px] left-[108px] block size-5 rounded-sm text-center text-sm leading-5 font-bold"
          [class]="row.nature === '+' ? 'bg-retro-accent text-white' : row.nature === '−' ? 'bg-[#2f5f9e] text-white' : 'hidden'"
          >{{ row.nature }}</span
        >
        <span aria-hidden="true" class="absolute top-[12px] left-[132px] block h-8 w-[56px] text-right text-2xl leading-8 font-bold">{{ row.total }}</span>
        <span aria-hidden="true" class="absolute top-[20px] left-[204px] block h-4 w-[156px] rounded-sm border border-retro-outline bg-retro-bar"></span>
        <span aria-hidden="true" class="absolute top-[22px] left-[206px] block h-3 bg-[#e8c547]" [style.width.px]="row.barWidth"></span>
        <span aria-hidden="true" class="absolute top-[14px] left-[366px] block h-7 w-[40px] text-right text-lg leading-7 font-bold">{{ row.points }}</span>
      </button>
    }

    <!-- The nature: A opens the grid, left/right change it in place (see registerAdjuster). -->
    <button
      #natureButton
      type="button"
      class="absolute top-[452px] left-0 block h-[60px] w-[420px] cursor-pointer rounded-lg border-2 p-0"
      [class]="choosingNature() ? 'border-retro-accent-text bg-retro-select' : 'border-retro-outline bg-retro-panel hover:bg-retro-select'"
      aria-haspopup="true"
      [attr.aria-expanded]="choosingNature()"
      [attr.aria-label]="natureLabel()"
      (click)="openNatures()"
    >
      <span aria-hidden="true" class="absolute top-[16px] left-[14px] block h-6 w-[64px] text-left text-sm leading-6 font-bold text-retro-muted">Nature</span>
      <!-- Pixel triangles, as on the Battle page (Brewser draws ◀ ▶ as emoji and CSS triangles not at all). -->
      <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[21px] left-[92px] h-[14px] w-2 fill-retro-muted"><path [attr.d]="leftArrow" /></svg>
      <span aria-hidden="true" class="absolute top-[4px] left-[112px] block h-7 w-[256px] text-center text-xl leading-7 font-bold">{{ natureName() }}</span>
      <span aria-hidden="true" class="absolute top-[32px] left-[112px] block h-5 w-[256px] text-center text-xs leading-5 text-retro-muted">{{ natureEffect() }}</span>
      <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[21px] left-[384px] h-[14px] w-2 fill-retro-muted"><path [attr.d]="rightArrow" /></svg>
    </button>

    <!-- Beside the list: how to adjust, the panel adjusting one stat, or the natures' grid. -->
    <div class="block" [class.hidden]="editing() !== null || choosingNature()">
      <div class="absolute top-[36px] left-[452px] block h-[400px] w-[420px] rounded-lg border-2 border-dashed border-retro-rim">
        <p class="absolute top-[160px] left-[24px] block h-8 w-[368px] text-center text-lg leading-8 text-retro-muted">Press A on a stat to adjust it.</p>
        <p class="absolute top-[200px] left-[24px] block h-8 w-[368px] text-center text-base leading-8 text-retro-muted">Up to {{ maxPoints }} points a stat, {{ maxTotal }} in all.</p>
        <p class="absolute top-[240px] left-[24px] block h-8 w-[368px] text-center text-base leading-8 text-retro-muted">A on the nature lists them all.</p>
      </div>
    </div>
    <div class="block" [class.hidden]="!choosingNature()">
      <div #natureList role="group" aria-label="Natures" class="absolute top-[36px] left-[452px] block h-[400px] w-[420px] rounded-lg border-2 border-retro-outline bg-retro-panel" (appBack)="closeNatures()">
        <p class="absolute top-[8px] left-[16px] block h-7 w-[240px] text-left text-lg leading-7 font-bold">Nature</p>
        <p class="absolute top-[8px] left-[276px] block h-7 w-[128px] text-right text-sm leading-7 text-retro-muted">B keeps it</p>
        @for (stat of gridStats; track stat; let i = $index) {
          <span aria-hidden="true" class="absolute top-[44px] block h-5 w-[64px] text-center text-xs leading-5 font-bold text-[#8fb8ee]" [style.left.px]="gridLeft + i * cellStepX">−{{ statNames[stat] }}</span>
          <span aria-hidden="true" class="absolute left-[8px] block h-[50px] w-[56px] text-left text-xs leading-[50px] font-bold text-retro-accent-text" [style.top.px]="gridTop + i * cellStepY">+{{ statNames[stat] }}</span>
        }
        @for (cell of natureGrid; track cell.name) {
          <button
            type="button"
            class="absolute block h-[50px] w-[64px] cursor-pointer rounded-md border-2 p-0 text-sm font-bold"
            [class]="cell.name === set().nature ? 'border-retro-accent-text bg-retro-select' : cell.neutral ? 'border-retro-rim bg-retro-bg text-retro-muted hover:bg-retro-select' : 'border-retro-outline bg-retro-button hover:bg-retro-select'"
            [style.top.px]="cell.top"
            [style.left.px]="cell.left"
            [attr.aria-pressed]="cell.name === set().nature"
            [attr.aria-label]="cell.label"
            (click)="pickNature(cell.name)"
          >
            <span aria-hidden="true" class="absolute top-[12px] left-0 block h-5 w-[60px] text-center leading-5">{{ cell.name }}</span>
          </button>
        }
        <button
          type="button"
          class="absolute top-[348px] left-[72px] block h-10 w-[336px] cursor-pointer rounded-md border-2 p-0 text-sm font-bold"
          [class]="!set().nature ? 'border-retro-accent-text bg-retro-select' : 'border-retro-outline bg-retro-button hover:bg-retro-select'"
          [attr.aria-pressed]="!set().nature"
          (click)="pickNature('')"
        >
          <span class="absolute top-[8px] left-0 block h-5 w-[332px] text-center leading-5">No nature</span>
        </button>
      </div>
    </div>
    <div class="block" [class.hidden]="editing() === null">
      <div #panel class="absolute top-[36px] left-[452px] block h-[400px] w-[420px] rounded-lg border-2 border-retro-outline bg-retro-panel" (appBack)="cancel()">
        <!-- Up/down: the other stats (a click works too). -->
        <button type="button" data-kb-skip aria-label="Previous stat" class="absolute top-[8px] left-[186px] block h-5 w-11 cursor-pointer p-0" (click)="step(-1)">
          <svg aria-hidden="true" viewBox="0 0 7 4" class="absolute top-[6px] left-[15px] h-2 w-[14px] fill-retro-muted"><path [attr.d]="upArrow" /></svg>
        </button>
        <p class="absolute top-[32px] left-[20px] block h-8 w-[376px] text-center text-2xl leading-8 font-bold">
          {{ current()?.name }}<span class="text-retro-accent-text">{{ current()?.nature === '+' ? ' +' : '' }}</span
          ><span class="text-[#8fb8ee]">{{ current()?.nature === '−' ? ' −' : '' }}</span>
        </p>
        <p class="absolute top-[66px] left-[20px] block h-12 w-[376px] text-center text-5xl leading-[48px] font-bold">{{ current()?.total }}</p>
        <button type="button" data-kb-skip aria-label="Next stat" class="absolute top-[122px] left-[186px] block h-5 w-11 cursor-pointer p-0" (click)="step(1)">
          <svg aria-hidden="true" viewBox="0 0 7 4" class="absolute top-[6px] left-[15px] h-2 w-[14px] fill-retro-muted"><path [attr.d]="downArrow" /></svg>
        </button>

        <p class="absolute top-[158px] left-[20px] block h-7 w-[376px] text-center text-lg leading-7">
          Total stat points <span class="font-bold">{{ used() }}/{{ maxTotal }}</span>
        </p>

        <button type="button" data-kb-skip aria-label="One point less" class="absolute top-[204px] left-[12px] block h-10 w-10 cursor-pointer rounded-full border-2 border-retro-outline bg-retro-button p-0 hover:bg-retro-select" (click)="adjust(-1)">
          <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[8px] left-[11px] h-[21px] w-3 fill-retro-ink"><path [attr.d]="leftArrow" /></svg>
        </button>
        <div
          #gauge
          role="slider"
          tabindex="0"
          class="absolute top-[200px] left-[58px] block h-12 w-[302px] cursor-pointer rounded-md border-2 border-retro-outline bg-retro-bar"
          aria-valuemin="0"
          [attr.aria-valuemax]="maxPoints"
          [attr.aria-valuenow]="current()?.points ?? 0"
          [attr.aria-valuetext]="valueText()"
          [attr.aria-label]="(current()?.name ?? '') + ' stat points'"
          (click)="confirm()"
        >
          @for (segment of segments(); track $index) {
            <span
              aria-hidden="true"
              class="absolute top-[6px] block h-8"
              [class]="segment.state === 'on' ? 'bg-[#e8c547]' : segment.state === 'free' ? 'bg-[#3d5064]' : 'bg-retro-bg'"
              [style.left.px]="segment.left"
              [style.width.px]="segmentWidth"
            ></span>
          }
        </div>
        <button type="button" data-kb-skip aria-label="One point more" class="absolute top-[204px] left-[366px] block h-10 w-10 cursor-pointer rounded-full border-2 border-retro-outline bg-retro-button p-0 hover:bg-retro-select" (click)="adjust(1)">
          <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[8px] left-[13px] h-[21px] w-3 fill-retro-ink"><path [attr.d]="rightArrow" /></svg>
        </button>

        <button type="button" data-kb-skip aria-label="No points" class="absolute top-[260px] left-[8px] block h-7 w-[64px] cursor-pointer rounded-sm p-0 text-sm font-bold hover:bg-retro-select" (click)="setPoints(0)">
          <span aria-hidden="true" class="absolute top-[2px] left-[4px] block h-6 w-6 rounded-sm bg-retro-select text-center leading-6">L</span>
          <span aria-hidden="true" class="absolute top-[2px] left-[32px] block h-6 w-[30px] text-left leading-6">MIN</span>
        </button>
        <p class="absolute top-[258px] left-[120px] block h-8 w-[176px] text-center text-2xl leading-8 font-bold">
          {{ current()?.points }}<span class="text-lg text-retro-muted"> / {{ maxPoints }}</span>
        </p>
        <button type="button" data-kb-skip aria-label="As many points as allowed" class="absolute top-[260px] left-[344px] block h-7 w-[64px] cursor-pointer rounded-sm p-0 text-sm font-bold hover:bg-retro-select" (click)="setPoints(maxPoints)">
          <span aria-hidden="true" class="absolute top-[2px] left-[2px] block h-6 w-[30px] text-right leading-6">MAX</span>
          <span aria-hidden="true" class="absolute top-[2px] left-[36px] block h-6 w-6 rounded-sm bg-retro-select text-center leading-6">R</span>
        </button>

        <button type="button" data-kb-skip class="absolute top-[328px] left-[20px] block h-12 w-[180px] cursor-pointer rounded-md border-2 border-retro-outline bg-retro-button p-0 text-lg font-bold hover:bg-retro-select" (click)="cancel()">
          <span aria-hidden="true" class="absolute top-[10px] left-[14px] block h-6 w-6 rounded-sm bg-retro-select text-center text-base leading-6">B</span>
          <span class="absolute top-[8px] left-[46px] block h-7 w-[118px] text-center leading-7">Cancel</span>
        </button>
        <button type="button" data-kb-skip class="absolute top-[328px] left-[216px] block h-12 w-[180px] cursor-pointer rounded-md border-2 border-retro-bar bg-retro-accent p-0 text-lg font-bold text-white hover:bg-retro-accent-hover" (click)="confirm()">
          <span aria-hidden="true" class="absolute top-[10px] left-[14px] block h-6 w-6 rounded-sm bg-retro-accent-hover text-center text-base leading-6">A</span>
          <span class="absolute top-[8px] left-[46px] block h-7 w-[118px] text-center leading-7">Confirm</span>
        </button>
      </div>
    </div>
  `,
})
export class SetStats {
  private readonly navigation = inject(KeyboardNavigation);
  private readonly injector = inject(Injector);
  private readonly rowButtons = viewChildren<ElementRef<HTMLButtonElement>>('row');
  private readonly gauge = viewChild.required<ElementRef<HTMLElement>>('gauge');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly natureButton = viewChild.required<ElementRef<HTMLButtonElement>>('natureButton');
  private readonly natureGridElement = viewChild.required<ElementRef<HTMLElement>>('natureList');

  readonly set = input.required<PokemonSet>();
  /** The battling form's base stats (a Mega's when it holds its stone); unknown species have none. */
  readonly baseStats = input<StatTable | undefined>(undefined);
  readonly pointsChanged = output<StatSpread>();
  readonly natureChanged = output<string>();

  protected readonly maxPoints = MAX_STAT_POINTS;
  protected readonly maxTotal = MAX_TOTAL_STAT_POINTS;
  protected readonly segmentWidth = SEGMENT_WIDTH;
  protected readonly leftArrow = LEFT_ARROW;
  protected readonly rightArrow = RIGHT_ARROW;
  protected readonly upArrow = UP_ARROW;
  protected readonly downArrow = DOWN_ARROW;
  protected readonly natureGrid = NATURE_GRID;
  protected readonly gridStats = GRID_STATS;
  protected readonly statNames = STAT_NAMES;
  protected readonly gridLeft = GRID_LEFT;
  protected readonly gridTop = GRID_TOP;
  protected readonly cellStepX = CELL_STEP_X;
  protected readonly cellStepY = CELL_STEP_Y;

  /** The stat being adjusted in the panel; null while it's closed (or once the set changes). */
  protected readonly editing = linkedSignal<PokemonSet, StatId | null>({ source: this.set, computation: () => null });
  /** The natures' grid is open in the panel's place (a pick changes the set, which closes it). */
  protected readonly choosingNature = linkedSignal<PokemonSet, boolean>({ source: this.set, computation: () => false });
  /** The spread as adjusted in the panel, until it's confirmed or dropped. */
  private readonly draft = linkedSignal<PokemonSet, StatSpread | null>({ source: this.set, computation: () => null });

  private readonly spread = computed(() => this.draft() ?? this.set().evs);
  protected readonly used = computed(() => totalStatPoints(this.spread()));

  protected readonly rows = computed((): StatRow[] => {
    const spread = this.spread();
    const nature = NATURES.find((n) => n.name === this.set().nature);
    const baseStats = this.baseStats();
    return STAT_IDS.map((id, i) => {
      const points = Number.isFinite(spread[id]) ? (spread[id] as number) : 0;
      const base = baseStats?.[id] ?? 0;
      const total = baseStats ? calcStat(id, base, points, this.set().nature) : 0;
      const sign = nature?.plus === id ? '+' : nature?.minus === id ? '−' : '';
      return {
        id,
        name: FULL_NAMES[id],
        base,
        points,
        total,
        nature: sign,
        top: ROW_TOP + i * ROW_STEP,
        barWidth: Math.round((points / MAX_STAT_POINTS) * BAR_WIDTH),
        label: `${FULL_NAMES[id]} ${total}${sign === '+' ? ', raised by nature' : sign === '−' ? ', lowered by nature' : ''}: ${points} of ${MAX_STAT_POINTS} points. Adjust`,
      };
    });
  });

  protected readonly natureName = computed(() => this.set().nature || 'No nature');
  protected readonly natureEffect = computed(() => {
    const nature = NATURES.find((n) => n.name === this.set().nature);
    if (!nature) return 'Changes no stat';
    return nature.plus && nature.minus ? `+${STAT_NAMES[nature.plus]}  −${STAT_NAMES[nature.minus]}` : 'Neutral';
  });
  protected readonly natureLabel = computed(() => {
    const nature = NATURES.find((n) => n.name === this.set().nature);
    const effect = nature?.plus && nature.minus ? `, raises ${FULL_NAMES[nature.plus]}, lowers ${FULL_NAMES[nature.minus]}` : '';
    return `Nature: ${this.natureName()}${effect}. Choose`;
  });

  protected readonly current = computed(() => this.rows().find((row) => row.id === this.editing()) ?? null);

  /** The most the stat in the panel can have: 32, or less when the 66 in all run out. */
  private readonly reachable = computed(() => {
    const current = this.current();
    return current ? Math.min(MAX_STAT_POINTS, current.points + MAX_TOTAL_STAT_POINTS - this.used()) : 0;
  });

  protected readonly segments = computed((): Segment[] => {
    const points = this.current()?.points ?? 0;
    const reachable = this.reachable();
    return Array.from({ length: MAX_STAT_POINTS }, (_, i) => ({
      left: 6 + i * SEGMENT_STEP,
      state: i < points ? 'on' : i < reachable ? 'free' : 'off',
    }));
  });

  protected readonly valueText = computed(() => {
    const current = this.current();
    return current ? `${current.points} of ${MAX_STAT_POINTS} points, ${current.name} ${current.total}, ${MAX_TOTAL_STAT_POINTS - this.used()} left in all` : '';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    // While the panel is open, L and R set the stat's points (the Details/Stats tabs wait), and ZL/ZR do nothing.
    const whileOpen = (action: () => void) => () => {
      if (this.editing() === null) return false;
      action();
      return true;
    };
    const unregister = [
      this.navigation.registerButton('buttonL', whileOpen(() => this.setPoints(0))),
      this.navigation.registerButton('buttonR', whileOpen(() => this.setPoints(MAX_STAT_POINTS))),
      this.navigation.registerButton('buttonZL', whileOpen(() => undefined)),
      this.navigation.registerButton('buttonZR', whileOpen(() => undefined)),
    ];
    afterNextRender(() => {
      const gauge = this.gauge().nativeElement;
      unregister.push(
        this.navigation.registerAdjuster(gauge, (step) => {
          this.adjust(step);
          return true;
        }),
        this.navigation.registerAdjuster(this.natureButton().nativeElement, (step) => {
          this.changeNature(step);
          return true;
        }),
        // On the panel, not the gauge: A on an element with its own pager does nothing.
        this.navigation.registerPager(this.panel().nativeElement, (step) => this.page(step)),
      );
    });
    destroyRef.onDestroy(() => unregister.forEach((fn) => fn()));
  }

  /** The tab's first control, when it's shown. */
  focusFirst(): void {
    this.choosingNature.set(false);
    this.rowButtons()[0]?.nativeElement.focus();
  }

  /** A on the nature: the grid, on the nature the set has (its panel's changes, if open, are dropped). */
  protected openNatures(): void {
    this.editing.set(null);
    this.draft.set(null);
    this.choosingNature.set(true);
    afterNextRender(() => this.natureGridElement().nativeElement.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus(), { injector: this.injector });
  }

  /** A on a nature: it's the set's. */
  protected pickNature(name: string): void {
    this.closeNatures();
    if (name !== this.set().nature) this.natureChanged.emit(name);
  }

  /** B (or a pick): back to the nature's row. */
  protected closeNatures(): void {
    this.choosingNature.set(false);
    afterNextRender(() => this.natureButton().nativeElement.focus(), { injector: this.injector });
  }

  /** The previous or next nature (wrapping around). */
  protected changeNature(step: 1 | -1): void {
    const index = Math.max(0, NATURE_CHOICES.indexOf(this.set().nature));
    this.natureChanged.emit(NATURE_CHOICES[(index + step + NATURE_CHOICES.length) % NATURE_CHOICES.length]);
  }

  /** A on a stat: the panel, on it, with the spread as it is. */
  protected open(stat: StatId): void {
    if (this.editing() === null) this.draft.set({ ...this.set().evs });
    this.choosingNature.set(false);
    this.editing.set(stat);
    afterNextRender(() => this.gauge().nativeElement.focus(), { injector: this.injector });
  }

  /** Left/right: a point less or more. */
  protected adjust(step: 1 | -1): void {
    this.setPoints((this.current()?.points ?? 0) + step);
  }

  /** The stat's points, kept within 0–32 and the 66 in all. */
  protected setPoints(value: number): void {
    const stat = this.editing();
    if (!stat || !Number.isFinite(value)) return;
    const points = Math.max(0, Math.min(value, this.reachable()));
    this.draft.update((draft) => ({ ...(draft ?? this.set().evs), [stat]: points }));
  }

  /** Up/down: the previous or next stat (wrapping around). */
  protected step(step: 1 | -1): void {
    const index = STAT_IDS.indexOf(this.editing() ?? 'hp');
    this.editing.set(STAT_IDS[(index + step + STAT_IDS.length) % STAT_IDS.length]);
  }

  /** A (the gauge pressed): keeps the changes. */
  protected confirm(): void {
    const draft = this.draft();
    this.close();
    if (draft) this.pointsChanged.emit(draft);
  }

  /** B: drops the changes. */
  protected cancel(): void {
    this.close();
  }

  private page(step: PageStep): boolean {
    if (step === 'up' || step === 'down') this.step(step === 'down' ? 1 : -1);
    else this.setPoints(step === 'first' ? 0 : MAX_STAT_POINTS);
    return true;
  }

  /** Back to the list, on the stat the panel was on. */
  private close(): void {
    const index = STAT_IDS.indexOf(this.editing() ?? 'hp');
    this.editing.set(null);
    this.draft.set(null);
    afterNextRender(() => this.rowButtons()[index]?.nativeElement.focus(), { injector: this.injector });
  }
}
