import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { FormField, form } from '@angular/forms/signals';
import { isEnterKey } from '@core/input/console-keys';
import { KeyboardNavigation, PageStep } from '@core/input/keyboard-navigation';
import { ItemIcon } from '@shared/components/item-icon';
import { ScrollRegion } from '@shared/directives/scroll-region';
import { toId } from '@shared/utils/to-id';

export interface ChooserOption {
  /** What gets picked; '' for a "none" option (no item, no move). */
  id: string;
  name: string;
  detail: string;
  /** Row background (e.g. the move's type colour) while it isn't the current choice. */
  color?: string;
  /** An item's ID, whose icon goes at the row's start (see `withIcons`); a detail up to 3 lines fits beside it. */
  icon?: string;
}

/** Rows rendered at once from a searchable list: few enough for the console. Typing narrows the rest. */
const MAX_RESULTS = 30;

/**
 * A long list (a learnset: up to ~100 moves) froze the console for a moment when it opened, building
 * every row at once. Its rows are added in batches instead: enough to fill the list (and reach the
 * current choice) first, the rest a batch at a time, with a pause between them for the buttons.
 */
const ROWS_PER_BATCH = 16;
const BATCH_DELAY_MS = 40;
/** A list this close to the one shown (the next move slot's: one move in, one out) keeps its rows. */
const SAME_LIST_CHANGES = 2;

/** A list with icons shows this many fixed rows at a time: a name and up to 3 lines of detail each. */
const PAGE_ROWS = 6;
const PAGE_ROW_STEP = 78;

@Component({
  imports: [FormField, ItemIcon, ScrollRegion],
  selector: 'app-dex-chooser',
  host: { class: 'block' },
  // Fixed 408x564 panel (see styles.css): title, search box and a scrolling list of plain block rows
  // (Brewser layout rules, seen on device). Typing a few letters is the only writing needed; the
  // d-pad moves between the box and the results (KeyboardNavigation). A list that isn't searchable
  // hides the box and shows every option in the room it leaves. A list with icons (items) is NOT a
  // scroll box: images in one stayed painted at their old places when it scrolled (device,
  // 2026-09-29), whether placed absolutely or in the line of text. It shows a page of fixed rows
  // instead, and moving past the first or last one shown moves it (a pager, as the option picker).
  template: `
    <h3 [id]="titleId" class="h-8 text-lg font-bold text-white">{{ title() }}</h3>
    <input
      type="search"
      autocomplete="off"
      spellcheck="false"
      [attr.aria-label]="'Search ' + title()"
      [attr.aria-controls]="listId"
      [formField]="searchForm.query"
      [class.hidden]="!searchable()"
      (keydown)="onSearchKey($event)"
      class="block h-10 w-[408px] rounded-md border border-gray-400 bg-gray-800 p-[0_12px] text-lg text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    />
    <p class="h-7 text-sm leading-7 text-gray-300">{{ summary() }}{{ paged() ? pageArrows() : '' }}</p>
    <ul
      #list
      appScrollRegion
      [id]="paged() ? null : listId"
      [attr.aria-labelledby]="titleId"
      [style.height.px]="searchable() ? 476 : 516"
      [class.hidden]="paged()"
      class="w-[408px] overflow-y-auto rounded-md border border-gray-600 bg-card"
    >
      @for (option of shownResults(); track option.id) {
        <li>
          <button
            type="button"
            [attr.aria-current]="option.id === selectedId() ? 'true' : null"
            (click)="picked.emit(option.id)"
            class="block w-[406px] cursor-pointer border-b border-gray-700 p-[6px_12px] text-left text-white hover:bg-tab-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
            [class.bg-tab-hover]="option.id === selectedId()"
            [style.background-color]="option.id === selectedId() ? null : option.color || null"
          >
            <span class="block text-base font-bold">{{ option.name }}</span>
            @if (option.detail) {
              <span class="block text-sm text-gray-300">{{ option.detail }}</span>
            }
          </button>
        </li>
      }
    </ul>
    <!-- Rows with icons: a page of fixed rows, tracked by position (see PAGE_ROWS). -->
    <div
      #pages
      role="group"
      [id]="paged() ? listId : null"
      [attr.aria-labelledby]="titleId"
      [class.hidden]="!paged()"
      [style.height.px]="searchable() ? 476 : 516"
      class="relative block w-[408px] rounded-md border border-gray-600 bg-card"
    >
      @for (row of pageRows(); track $index) {
        <button
          type="button"
          [attr.aria-current]="row.option.id === selectedId() ? 'true' : null"
          [attr.data-index]="row.index"
          (click)="picked.emit(row.option.id)"
          class="absolute left-0 block w-[406px] cursor-pointer border-b border-gray-700 p-0 text-left text-white hover:bg-tab-hover"
          [class.bg-tab-hover]="row.option.id === selectedId()"
          [style.top.px]="$index * pageRowStep"
          [style.height.px]="pageRowStep"
        >
          <app-item-icon class="absolute top-[14px] left-[8px]" [item]="row.option.icon ?? ''" />
          <span class="absolute top-[4px] left-[64px] block h-[22px] w-[330px] overflow-hidden text-base leading-[22px] font-bold whitespace-nowrap">{{
            row.option.name
          }}</span>
          <span class="absolute top-[26px] left-[64px] block h-[48px] w-[330px] text-sm leading-4 text-gray-300">{{
            row.option.detail
          }}</span>
        </button>
      }
    </div>
  `,
})
export class DexChooser {
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly pages = viewChild.required<ElementRef<HTMLElement>>('pages');
  private readonly injector = inject(Injector);
  private readonly navigation = inject(KeyboardNavigation);

  readonly title = input.required<string>();
  readonly options = input.required<readonly ChooserOption[]>();
  readonly selectedId = input('');
  /** Rows show the options' `icon`: listed a page at a time, not in a scroll box (see the template). */
  readonly withIcons = input(false);
  /** Whether it has a search box; without one, every option is listed. */
  readonly searchable = input(true);
  /** A short list (and its name) to show instead of the first results until something is typed. */
  readonly suggested = input<readonly ChooserOption[] | null>(null);
  readonly suggestedLabel = input('');
  /** Shown instead of the results while the data they come from loads or fails. */
  readonly unavailable = input('');
  readonly picked = output<string>();

  protected readonly titleId = `chooser-title-${nextId}`;
  protected readonly listId = `chooser-list-${nextId++}`;

  private readonly model = signal({ query: '' });
  protected readonly searchForm = form(this.model);

  private readonly words = computed(() => this.model().query.toLowerCase().split(/\s+/).map(toId).filter(Boolean));
  /** Nothing typed yet in a list with suggestions: those are shown. */
  private readonly showingSuggested = computed(() => this.searchable() && this.suggested() !== null && this.words().length === 0);

  /** All matches: every word of the query must appear in the name; names starting with it come first. */
  private readonly matches = computed(() => {
    const words = this.words();
    const options = this.options();
    if (!this.searchable() || words.length === 0) return options;
    const matching = options.filter((option) => {
      const name = toId(option.name);
      return words.every((word) => name.includes(word));
    });
    const first = words[0];
    return [...matching.filter((o) => toId(o.name).startsWith(first)), ...matching.filter((o) => !toId(o.name).startsWith(first))];
  });

  protected readonly results = computed(() => {
    if (this.unavailable()) return [];
    if (this.showingSuggested()) return this.suggested() ?? [];
    return this.searchable() ? this.matches().slice(0, MAX_RESULTS) : this.matches();
  });

  /**
   * How many rows are built so far. A new list starts with the first batch (or up to the current
   * choice, which gets focus); the next move slot's list keeps what the last one had built.
   */
  private readonly rowCount = linkedSignal<readonly ChooserOption[], number>({
    source: this.results,
    computation: (results, previous) => {
      if (previous && isSameList(previous.source, results)) return previous.value;
      const current = untracked(this.selectedId);
      const selected = current ? results.findIndex((option) => option.id === current) : -1;
      return Math.max(ROWS_PER_BATCH, selected + ROWS_PER_BATCH / 2);
    },
  });

  protected readonly shownResults = computed(() => (this.paged() ? [] : this.results().slice(0, this.rowCount())));

  /** Listed a page at a time (see the template). */
  protected readonly paged = computed(() => this.withIcons());
  protected readonly pageRowStep = PAGE_ROW_STEP;

  /** The first result shown on the page: at first, the page that shows the current choice. */
  private readonly pageStart = linkedSignal({
    source: this.results,
    computation: (results) => this.startFor(results, untracked(this.selectedId)),
  });

  protected readonly pageRows = computed(() => {
    if (!this.paged()) return [];
    const start = this.pageStart();
    return this.results()
      .slice(start, start + PAGE_ROWS)
      .map((option, i) => ({ option, index: start + i }));
  });

  protected readonly pageArrows = computed(() => {
    const start = this.pageStart();
    return `${start > 0 ? ' ▲' : ''}${start + PAGE_ROWS < this.results().length ? ' ▼' : ''}`;
  });

  /** The result to focus once the page has rendered (after moving it); the tick reruns the effect. */
  private focusIndex: number | null = null;
  private readonly focusTick = signal(0);

  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly render = inject(RenderScheduler);

  constructor() {
    afterRenderEffect(() => {
      this.focusTick();
      this.pageRows();
      if (this.focusIndex === null) return;
      const button = this.pageButton(this.focusIndex);
      this.focusIndex = null;
      button?.focus();
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const pages = this.pages().nativeElement;
      const unregister = this.navigation.registerPager(pages, (step, focused) => this.page(step, focused));
      // Browsers: the wheel moves the page a row at a time (focus stays where it is).
      const onWheel = (event: WheelEvent) => {
        if (event.deltaY === 0 || !this.paged()) return;
        event.preventDefault();
        const start = this.clampStart(this.pageStart() + (event.deltaY > 0 ? 1 : -1));
        if (start === this.pageStart()) return;
        this.pageStart.set(start);
        this.render.request();
      };
      pages.addEventListener('wheel', onWheel, { passive: false });
      destroyRef.onDestroy(() => {
        unregister();
        pages.removeEventListener('wheel', onWheel);
      });
    });

    // Once a batch is on screen, the next one is scheduled. The render is requested explicitly: a
    // timer's change didn't always get one on the console (see RenderScheduler).
    const render = this.render;
    afterRenderEffect(() => {
      if (this.paged() || this.rowCount() >= this.results().length || this.batchTimer !== null) return;
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.rowCount.update((count) => count + ROWS_PER_BATCH);
        render.request();
      }, BATCH_DELAY_MS);
    });
    destroyRef.onDestroy(() => {
      if (this.batchTimer !== null) clearTimeout(this.batchTimer);
    });
  }

  protected readonly summary = computed(() => {
    if (this.unavailable()) return this.unavailable();
    const total = this.matches().length;
    if (!this.searchable()) return `${total} ${total === 1 ? 'option' : 'options'}`;
    if (this.showingSuggested()) return `${this.suggestedLabel()}; type to search all ${total}`;
    if (total === 0) return 'No matches';
    return total > MAX_RESULTS ? `Showing ${MAX_RESULTS} of ${total}; type to narrow down` : `${total} ${total === 1 ? 'match' : 'matches'}`;
  });

  /**
   * Clears the search and focuses the current choice (or the first result), ready for the d-pad.
   * Not the search box: focusing it opens the console's on-screen keyboard. Call it once the list
   * has rendered.
   */
  open(): void {
    // After a pick from a search, the rows on screen are still that search's results: focus waits
    // for the cleared list to render, or it would land on a row that's about to go. Untracked: the
    // caller runs this from an effect, which must not rerun (and refocus) whenever the query changes.
    const searched = untracked(this.model).query !== '';
    if (searched) this.model.set({ query: '' });
    this.list().nativeElement.scrollTop = 0;
    if (untracked(this.paged)) {
      // The page that shows the current choice, focused once rendered.
      const results = untracked(this.results);
      const selected = results.findIndex((option) => option.id === untracked(this.selectedId));
      this.pageStart.set(this.startFor(results, untracked(this.selectedId)));
      this.focusIndex = Math.max(0, selected);
      this.focusTick.update((tick) => tick + 1);
      this.render.request();
      return;
    }
    if (searched) afterNextRender(() => this.focusCurrent(), { injector: this.injector });
    else this.focusCurrent();
  }

  private focusCurrent(): void {
    const buttons = this.resultButtons();
    (buttons.find((button) => button.getAttribute('aria-current') === 'true') ?? buttons[0])?.focus();
  }

  /**
   * Up from the first row shown, or down from the last, moves the page a row and focuses the next
   * result; Home/End jump to the first and last. False leaves the press to normal navigation (up from
   * the first result goes to the search box).
   */
  private page(step: PageStep, focused: HTMLElement): boolean {
    if (!this.paged()) return false;
    const index = Number(focused.getAttribute('data-index'));
    if (focused.getAttribute('data-index') === null || Number.isNaN(index)) return false;
    const start = this.pageStart();
    const last = this.results().length - 1;
    let target: number;
    switch (step) {
      case 'up':
        if (index > start || index === 0) return false;
        target = index - 1;
        break;
      case 'down':
        if (index < start + PAGE_ROWS - 1 || index >= last) return false;
        target = index + 1;
        break;
      case 'first':
        target = 0;
        break;
      case 'last':
        target = last;
        break;
    }
    if (target < 0) return false;
    this.pageStart.set(this.clampStart(target < start ? target : target >= start + PAGE_ROWS ? target - PAGE_ROWS + 1 : start));
    this.focusIndex = target;
    this.focusTick.update((tick) => tick + 1);
    this.render.request();
    return true;
  }

  /** The first row of a page that shows a result (one row above it, where there's room). */
  private startFor(results: readonly ChooserOption[], id: string): number {
    const selected = id ? results.findIndex((option) => option.id === id) : -1;
    return this.clampStart(selected - 1, results.length);
  }

  private clampStart(start: number, count = this.results().length): number {
    return Math.max(0, Math.min(start, count - PAGE_ROWS));
  }

  private pageButton(index: number): HTMLElement | null {
    return this.pages().nativeElement.querySelector(`[data-index="${index}"]`);
  }

  /**
   * Enter in the search box picks the first result (the A button's letter types while searching).
   * The d-pad moves focus as everywhere else.
   */
  protected onSearchKey(event: KeyboardEvent): void {
    if (!isEnterKey(event)) return;
    event.preventDefault();
    const first = this.results()[0];
    if (first) this.picked.emit(first.id);
  }

  private resultButtons(): HTMLButtonElement[] {
    const region = this.paged() ? this.pages() : this.list();
    return [...region.nativeElement.querySelectorAll('button')];
  }
}

let nextId = 0;

/** Whether two lists differ by only a few options (in either direction). */
function isSameList(before: readonly ChooserOption[], after: readonly ChooserOption[]): boolean {
  if (Math.abs(before.length - after.length) > SAME_LIST_CHANGES) return false;
  const ids = new Set(before.map((option) => option.id));
  let changes = 0;
  for (const option of after) {
    if (!ids.has(option.id) && ++changes > SAME_LIST_CHANGES) return false;
  }
  return true;
}
