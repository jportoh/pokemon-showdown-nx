import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import { KeyboardNavigation, PageStep } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { RetroBox } from '@shared/components/retro-box';
import { BackAction } from '@shared/directives/back-action';

/** One choice in the picker. */
export interface PickerOption {
  id: string;
  title: string;
  detail: string;
  /** The heading it's listed under; options of a category come together. */
  category?: string;
  /** Sprite file names shown on its row (a team's Pokémon). */
  sprites?: readonly string[];
}

type PickerRow = { kind: 'heading'; key: string; text: string } | { kind: 'option'; key: string; option: PickerOption };

/** How the rows are laid out: short ones with text only, or tall ones with 96px sprites (teams). */
interface RowLayout {
  /** Rows shown at once, in the 500px under the title. */
  visibleRows: number;
  rowHeight: number;
  titleTop: number;
  detailTop: number;
  titleWidth: number;
}

const TEXT_ROWS: RowLayout = { visibleRows: 8, rowHeight: 60, titleTop: 2, detailTop: 32, titleWidth: 1080 };
/** Sprites at their own 96px, so they stay sharp (as in the team preview). */
const SPRITE_ROWS: RowLayout = { visibleRows: 5, rowHeight: 100, titleTop: 20, detailTop: 54, titleWidth: 440 };
const SPRITE_SIZE = 96;
const SPRITE_STEP = 104;
const SPRITES_LEFT = 520;

/**
 * A list to pick a format or a team from, in a box over the whole page (the page hides its own
 * controls meanwhile). Options come under their category's heading. A picks, B closes without
 * picking. The list is NOT a scroll box (one shown after load stays blank on Brewser): it shows
 * a few rows at a time (fewer, taller ones when options have sprites), and moving past the first or last one shown moves it (a pager, see
 * KeyboardNavigation), as the replay list does. Focus starts on the option picked.
 */
@Component({
  imports: [BackAction, PokemonSprite, RetroBox],
  selector: 'app-option-picker',
  host: { class: 'block' },
  template: `
    <app-retro-box [width]="1216" [height]="596">
      <div class="block" (appBack)="closed.emit()">
        <h2 id="picker-title" class="absolute top-[16px] left-[32px] block h-10 w-[700px] text-3xl leading-10 font-bold">{{ title() }}</h2>
        <p class="absolute top-[22px] left-[760px] block h-8 w-[260px] text-right text-lg leading-8 text-retro-muted">{{ range() }}</p>
        <button
          type="button"
          data-kb-skip
          class="absolute top-[18px] left-[1040px] h-9 w-[128px] cursor-pointer rounded-md border-2 border-retro-outline bg-retro-button text-lg font-bold text-retro-ink hover:bg-retro-select"
          aria-label="Close without picking"
          (click)="closed.emit()"
        >
          <span aria-hidden="true" class="absolute top-[4px] left-[8px] block h-6 w-7 rounded-sm bg-retro-select text-center leading-6">B</span>
          <span class="absolute top-0 left-[40px] block h-8 w-[76px] text-center leading-8">Close</span>
        </button>
        <div #list role="group" aria-labelledby="picker-title" class="absolute top-[72px] left-[24px] block h-[500px] w-[1156px]">
          @for (row of shownRows(); track row.key; let i = $index) {
            @if (row.kind === 'heading') {
              <h3
                class="absolute left-[8px] block h-[60px] w-[1140px] border-b-2 border-retro-rim text-lg leading-[76px] font-bold text-retro-teal uppercase"
                [style.top.px]="i * layout().rowHeight + layout().rowHeight - 60"
              >
                {{ row.text }}
              </h3>
            } @else {
              <button
                #optionButton
                type="button"
                class="absolute left-0 w-[1156px] cursor-pointer rounded-md text-left hover:bg-retro-select"
                [style.height.px]="layout().rowHeight - 4"
                [class.bg-retro-select]="row.option.id === selected()"
                [style.top.px]="i * layout().rowHeight + 2"
                [attr.aria-pressed]="row.option.id === selected()"
                [attr.data-option]="row.option.id"
                (click)="picked.emit(row.option.id)"
              >
                <span class="block" [class.hidden]="row.option.id !== selected()">
                  <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute left-[12px] h-7 w-4 fill-retro-accent-text"
                    [style.top.px]="(layout().rowHeight - 32) / 2">
                    <path d="M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" />
                  </svg>
                </span>
                <span
                  class="absolute left-[44px] block h-8 truncate text-2xl leading-8 font-bold"
                  [style.top.px]="layout().titleTop"
                  [style.width.px]="layout().titleWidth"
                  >{{ row.option.title }}</span>
                <span
                  class="absolute left-[44px] block h-6 truncate text-base leading-6 text-retro-muted"
                  [style.top.px]="layout().detailTop"
                  [style.width.px]="layout().titleWidth"
                  >{{ row.option.detail }}</span>
                @for (sprite of row.option.sprites ?? []; track $index) {
                  <app-pokemon-sprite class="absolute top-0" [style.left.px]="spritesLeft + $index * spriteStep" [sprite]="sprite" [size]="spriteSize" />
                }
              </button>
            }
          }
        </div>
        <p class="absolute top-[22px] left-[700px] block h-8 w-[48px] text-lg leading-8 text-retro-muted" aria-hidden="true">
          {{ moreAbove() ? '▲' : '' }} {{ moreBelow() ? '▼' : '' }}
        </p>
      </div>
    </app-retro-box>
  `,
})
export class OptionPicker {
  private readonly navigation = inject(KeyboardNavigation);
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('optionButton');

  readonly title = input.required<string>();
  readonly options = input.required<readonly PickerOption[]>();
  /** The option picked so far; focus starts on it. */
  readonly selected = input<string | null>(null);

  readonly picked = output<string>();
  readonly closed = output<void>();

  protected readonly spriteSize = SPRITE_SIZE;
  protected readonly spriteStep = SPRITE_STEP;
  protected readonly spritesLeft = SPRITES_LEFT;
  protected readonly layout = computed(() => (this.options().some((option) => option.sprites?.length) ? SPRITE_ROWS : TEXT_ROWS));
  private readonly visibleRows = computed(() => this.layout().visibleRows);

  /** Headings and options in list order; options of a category are gathered under its first heading. */
  private readonly rows = computed(() => {
    const options = this.options();
    const categories = [...new Set(options.map((option) => option.category ?? ''))];
    return categories.flatMap((category): PickerRow[] => [
      ...(category ? [{ kind: 'heading' as const, key: `h:${category}`, text: category }] : []),
      ...options
        .filter((option) => (option.category ?? '') === category)
        .map((option) => ({ kind: 'option' as const, key: `o:${option.id}`, option })),
    ]);
  });

  /** The first row shown: at first, the one that shows the option picked (and its heading, when it's just above). */
  private readonly start = linkedSignal(() => this.clamp(this.rowIndex(this.selected() ?? '') - 1));

  protected readonly shownRows = computed(() => this.rows().slice(this.start(), this.start() + this.visibleRows()));
  protected readonly moreAbove = computed(() => this.start() > 0);
  protected readonly moreBelow = computed(() => this.start() + this.visibleRows() < this.rows().length);

  /** "3 of 12": where the option picked is among all of them. */
  protected readonly range = computed(() => {
    const count = this.options().length;
    const index = this.options().findIndex((option) => option.id === this.selected());
    return count > 1 && index >= 0 ? `${index + 1} of ${count}` : '';
  });

  /** The option to focus once rendered, after moving the list. */
  private focusOption: string | null = null;

  constructor() {
    afterRenderEffect(() => {
      const target = this.focusOption === null ? undefined : this.buttonFor(this.focusOption);
      if (target) {
        this.focusOption = null;
        target.focus();
      }
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      (this.buttonFor(this.selected() ?? '') ?? this.buttons()[0]?.nativeElement)?.focus();
      const list = this.list().nativeElement;
      const unregister = this.navigation.registerPager(list, (step, focused) => this.page(step, focused));
      // Browsers: the wheel moves the list as it would scroll it (focus stays where it is).
      const onWheel = (event: WheelEvent) => {
        if (event.deltaY === 0) return;
        event.preventDefault();
        const start = this.clamp(this.start() + (event.deltaY > 0 ? 1 : -1));
        if (start === this.start()) return;
        this.start.set(start);
        this.renderScheduler.request();
      };
      list.addEventListener('wheel', onWheel, { passive: false });
      destroyRef.onDestroy(() => {
        unregister();
        list.removeEventListener('wheel', onWheel);
      });
    });
  }

  /**
   * Up from the first option shown, or down from the last, moves the list to the next option (with
   * its heading, when it has one); Home/End jump to the first and last options.
   */
  private page(step: PageStep, focused: HTMLElement): boolean {
    const id = focused.getAttribute('data-option');
    if (id === null) return false;
    const rows = this.rows();
    const index = this.rowIndex(id);
    const optionIndexes = rows.flatMap((row, i) => (row.kind === 'option' ? [i] : []));
    let target: number | undefined;
    switch (step) {
      case 'up':
        target = optionIndexes.filter((i) => i < index).at(-1);
        if (target === undefined || target >= this.start()) return false;
        break;
      case 'down':
        target = optionIndexes.find((i) => i > index);
        if (target === undefined || target < this.start() + this.visibleRows()) return false;
        break;
      case 'first':
        target = optionIndexes[0];
        break;
      case 'last':
        target = optionIndexes.at(-1);
        break;
    }
    if (target === undefined) return false;
    this.show(target);
    return true;
  }

  /** Moves the list to show a row (its heading too, when it's just above), then focuses it. */
  private show(index: number): void {
    const row = this.rows()[index];
    if (row?.kind !== 'option') return;
    const withHeading = this.rows()[index - 1]?.kind === 'heading' ? index - 1 : index;
    let start = this.start();
    if (withHeading < start) start = withHeading;
    else if (index >= start + this.visibleRows()) start = index - this.visibleRows() + 1;
    start = this.clamp(start);
    if (start === this.start()) {
      this.buttonFor(row.option.id)?.focus();
      return;
    }
    this.focusOption = row.option.id;
    this.start.set(start);
  }

  private rowIndex(optionId: string): number {
    return this.rows().findIndex((row) => row.kind === 'option' && row.option.id === optionId);
  }

  private clamp(start: number): number {
    return Math.max(0, Math.min(start, this.rows().length - this.visibleRows()));
  }

  private buttonFor(optionId: string): HTMLButtonElement | undefined {
    return this.buttons().find((button) => button.nativeElement.getAttribute('data-option') === optionId)?.nativeElement;
  }
}
