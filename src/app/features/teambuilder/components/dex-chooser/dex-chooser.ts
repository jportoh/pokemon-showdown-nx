import { Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { isEnterKey } from '@core/input/console-keys';
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
  /** An item's ID, whose icon goes at the row's start (see `withIcons`). */
  icon?: string;
}

/** Rows rendered at once from a searchable list: few enough for the console. Typing narrows the rest. */
const MAX_RESULTS = 30;

@Component({
  imports: [FormField, ItemIcon, ScrollRegion],
  selector: 'app-dex-chooser',
  host: { class: 'block' },
  // Fixed 408x564 panel (see styles.css): title, search box and a scrolling list of plain block rows
  // (Brewser layout rules, seen on device). Typing a few letters is the only writing needed; the
  // d-pad moves between the box and the results (KeyboardNavigation). A list that isn't searchable
  // hides the box and shows every option in the room it leaves. A list with icons (items) gives
  // every row the icon's room at its start, so the names line up even where there's none ("No item").
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
    <p class="h-7 text-sm leading-7 text-gray-300">{{ summary() }}</p>
    <ul
      #list
      appScrollRegion
      [id]="listId"
      [attr.aria-labelledby]="titleId"
      [style.height.px]="searchable() ? 476 : 516"
      class="w-[408px] overflow-y-auto rounded-md border border-gray-600 bg-card"
    >
      @for (option of results(); track option.id) {
        <li>
          <button
            type="button"
            [attr.aria-current]="option.id === selectedId() ? 'true' : null"
            (click)="picked.emit(option.id)"
            class="relative block w-[406px] cursor-pointer border-b border-gray-700 text-left text-white hover:bg-tab-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
            [class.bg-tab-hover]="option.id === selectedId()"
            [style.background-color]="option.id === selectedId() ? null : option.color || null"
            [class]="withIcons() ? 'min-h-[60px] p-[6px_12px_6px_64px]' : 'p-[6px_12px]'"
          >
            @if (option.icon) {
              <app-item-icon class="absolute top-[5px] left-[8px]" [item]="option.icon" />
            }
            <span class="block text-base font-bold">{{ option.name }}</span>
            @if (option.detail) {
              <span class="block text-sm text-gray-300">{{ option.detail }}</span>
            }
          </button>
        </li>
      }
    </ul>
  `,
})
export class DexChooser {
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly injector = inject(Injector);

  readonly title = input.required<string>();
  readonly options = input.required<readonly ChooserOption[]>();
  readonly selectedId = input('');
  /** Rows leave room for an icon at their start (the options' `icon`). */
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
    if (searched) afterNextRender(() => this.focusCurrent(), { injector: this.injector });
    else this.focusCurrent();
  }

  private focusCurrent(): void {
    const buttons = this.resultButtons();
    (buttons.find((button) => button.getAttribute('aria-current') === 'true') ?? buttons[0])?.focus();
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
    return [...this.list().nativeElement.querySelectorAll('button')];
  }
}

let nextId = 0;
