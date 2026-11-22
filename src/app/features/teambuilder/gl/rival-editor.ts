import { computed, inject, signal } from '@angular/core';
import { ROLE_KEYS } from '@core/input/console-keys';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { UiContext } from '@core/gl/ui/retro-kit';
import { CalcState } from '@features/teambuilder/calc/calc-state';
import { RivalSet } from '@features/teambuilder/calc/rival-sets';
import { PokemonSet } from '@features/teambuilder/models/team';
import { ChooserView } from './chooser-view';
import { MOVE_FIELDS, SetChoosers } from './set-choosers';
import { DetailsField, SetRowsView, cardId } from './set-rows-view';
import { StatsView } from './stats-view';
import { BESIDE_COMPACT_X, EDIT_BODY_BOTTOM, EDIT_BODY_Y, EDIT_RIGHT, LegendEntry } from './tb-draw';

/** The editor's two pages, as the header's tabs (L/R). */
export type RivalPage = 'set' | 'stats';

/**
 * The Calcs tab's rival, edited (R3 on the tab): its item, ability and moves as the Details tab's
 * rows (A opens the same lists), and its points and nature as the Stats tab, beside its compact card.
 * The first change makes it "Custom": a copy of the set it was, the rival from then on and its
 * species' edited set (◀▶ on the rival's card reach it again), so the common sets stay as they are.
 * B closes a list or the natures, else ends the editing.
 */
export class RivalEditor {
  private readonly state = inject(CalcState);
  private readonly rows = new SetRowsView();
  private readonly chooser: ChooserView;
  private readonly stats: StatsView;

  private readonly editing = signal(false);
  readonly page = signal<RivalPage>('set');
  /** The field whose list is open, or null. */
  private readonly field = signal<DetailsField | null>(null);

  /** The rival's set while it's edited. */
  readonly set = computed((): PokemonSet | undefined => (this.editing() ? this.state.rival()?.set : undefined));
  private readonly choosers = new SetChoosers(this.set, this.field);
  readonly species = this.choosers.species;
  readonly mega = this.choosers.mega;
  /** The open list. */
  readonly spec = this.choosers.spec;

  constructor(private readonly focus: CanvasFocus) {
    this.chooser = new ChooserView(focus);
    this.stats = new StatsView(focus);
  }

  get isOpen(): boolean {
    return this.editing();
  }

  /** The move an open move list replaces, lit in the compact card; -1 for none. */
  get replacingMove(): number {
    const field = this.field();
    return field ? MOVE_FIELDS.indexOf(field) : -1;
  }

  /** Starts editing the rival, on its first row. */
  open(): void {
    if (!this.state.rival()) return;
    this.editing.set(true);
    this.field.set(null);
    this.stats.reset();
    this.switchPage('set');
  }

  close(): void {
    this.editing.set(false);
    this.field.set(null);
    this.stats.reset();
  }

  /** B: closes the list or the natures; false when it's the editing that ends. */
  back(): boolean {
    if (this.page() === 'stats' && this.stats.isOpen) {
      this.stats.back();
      return true;
    }
    const field = this.field();
    if (field) {
      this.field.set(null);
      this.focus.focus(cardId(field));
      return true;
    }
    this.close();
    return false;
  }

  /** L/R: the open list's filters, else the other page. */
  pressLR(by: 1 | -1): boolean {
    const spec = this.spec();
    if (spec) return this.chooser.stepFilter(spec, by);
    if (this.stats.isOpen) return false;
    return this.switchPage(this.page() === 'set' ? 'stats' : 'set');
  }

  /** ZL: the open list's "No item" / "No move", or on Stats the points as they were. */
  pressClear(): boolean {
    if (this.page() === 'stats') return !this.stats.isOpen && this.stats.undo();
    if (!this.choosers.clearLabel()) return false;
    this.pick('');
    return true;
  }

  /** R3: the open list's search. */
  pressSearch(): boolean {
    const spec = this.spec();
    return !!spec && this.chooser.openSearch(spec);
  }

  /** Home/End: the open list's ends, or the focused stat's none/max. */
  jump(to: 'first' | 'last'): boolean {
    if (this.page() === 'stats') return this.stats.jump(to);
    const spec = this.spec();
    if (!spec || !this.chooser.hasFocus()) return false;
    this.chooser.jump(spec, to);
    return true;
  }

  switchPage(page: RivalPage): boolean {
    if (!this.editing()) return false;
    this.field.set(null);
    this.stats.reset();
    this.page.set(page);
    if (page === 'stats') this.stats.focusFirst();
    else this.focus.focus(cardId('item'));
    return true;
  }

  draw(ctx: UiContext): void {
    const set = this.set();
    if (!set) return;
    const spec = this.spec();
    if (this.page() === 'stats') {
      this.stats.draw(
        ctx,
        {
          x: BESIDE_COMPACT_X,
          y: EDIT_BODY_Y,
          w: EDIT_RIGHT - BESIDE_COMPACT_X,
          h: EDIT_BODY_BOTTOM - EDIT_BODY_Y,
        },
        {
          set,
          baseStats: (this.mega() ?? this.species())?.baseStats,
          note: this.choosers.megaSummary(),
          points: (evs) => this.update({ evs }),
          nature: (nature) => this.update({ nature }),
        },
      );
    } else if (spec) {
      this.chooser.draw(ctx, spec, (id) => this.pick(id));
    } else {
      this.rows.draw(ctx, {
        set,
        species: this.species(),
        mega: this.mega(),
        open: (field) => this.openChooser(field),
        x: BESIDE_COMPACT_X,
      });
    }
  }

  /** The open list's title, for the page bar ("Move 2"); '' with none open. */
  get listTitle(): string {
    return this.spec()?.title ?? '';
  }

  /** What the buttons do while it's edited. */
  legend(): LegendEntry[] {
    const spec = this.spec();
    if (spec) {
      const current = this.choosers.currentValue();
      const entries: LegendEntry[] = [
        { keys: ['A'], text: 'Pick' },
        { keys: ['B'], text: current ? `Keep ${current}` : 'Close' },
      ];
      if (spec.searchable && !spec.unavailable) entries.push({ keys: [ROLE_KEYS.search.label], text: 'Search' });
      if (spec.filters.length > 1) entries.push({ keys: ['L', 'R'], text: 'Filter' });
      const clear = this.choosers.clearLabel();
      if (clear) entries.push({ keys: ['ZL'], text: clear });
      return entries;
    }
    if (this.page() === 'stats') {
      if (this.stats.isOpen) {
        const focused = this.stats.focusedNature;
        return [
          { keys: ['A'], text: focused ? `Pick ${focused}` : 'Pick' },
          { keys: ['B'], text: `Keep ${this.stats.currentNature}` },
        ];
      }
      const action = this.stats.rowAction;
      const entries: LegendEntry[] = action
        ? [
            { keys: ['◀▶'], text: 'Points' },
            { keys: ['A'], text: action },
          ]
        : [{ keys: ['A'], text: 'Choose' }];
      if (this.stats.canUndo) entries.push({ keys: ['ZL'], text: 'Undo' });
      entries.push({ keys: ['L', 'R'], text: 'Set / Stats' }, { keys: ['B'], text: 'Done' });
      return entries;
    }
    return [
      { keys: ['A'], text: 'Change' },
      { keys: ['L', 'R'], text: 'Set / Stats' },
      { keys: ['B'], text: 'Done' },
    ];
  }

  private openChooser(field: DetailsField): void {
    this.field.set(field);
    const spec = this.spec();
    if (spec) this.chooser.open(spec);
  }

  /** One change at a time: back to its row after picking. */
  private pick(id: string): void {
    const field = this.field();
    if (!field || field === 'species') return;
    this.update(this.choosers.picked(field, id));
    this.field.set(null);
    this.focus.focus(cardId(field));
  }

  /** The rival with `changes`: its edited set from now on. */
  private update(changes: Partial<PokemonSet>): void {
    const rival = this.state.rival();
    if (!rival) return;
    const custom: RivalSet = {
      id: 'custom',
      species: rival.species,
      title: rival.source === 'custom' ? rival.title : `Custom: ${rival.title}`,
      source: 'custom',
      set: { ...rival.set, ...changes },
    };
    this.state.setCustom(custom);
  }
}
