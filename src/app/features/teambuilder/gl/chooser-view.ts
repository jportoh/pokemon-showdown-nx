import { inject } from '@angular/core';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, ListView, UiContext, focusRing, label, textField } from '@core/gl/ui/retro-kit';
import { toId } from '@shared/utils/to-id';
import { CATEGORY_ICON_W } from '@core/gl/ui/category-icons';
import { BESIDE_COMPACT_X, EDIT_BODY_BOTTOM, EDIT_BODY_Y, EDIT_RIGHT, WHITE, WrapCache, categoryBadge, keyPill, typeRgba } from './tb-draw';

export interface ChooserOption {
  id: string;
  name: string;
  /** A move's type (its row takes the type's colour), or a species' types. */
  type?: string;
  types?: readonly string[];
  category?: string;
  /** An item's ID, whose icon starts the row. */
  icon?: string;
  /** Shown at the row's end: a move's power, an item's kind. */
  value?: string;
  /** IDs a search also finds it by (a species' abilities and moves). */
  keywords?: readonly string[];
}

/** How the rows look: a species (its types), an ability, an item (its icon), a move (its colours). */
export type ChooserRows = 'species' | 'ability' | 'item' | 'move';

/** A way to narrow the list, which L/R step through. */
export interface ChooserFilter {
  name: string;
  test: (option: ChooserOption) => boolean;
  /** A search looks through every option instead (the popular items). */
  searchesAll?: boolean;
}

/** What the editor has the chooser show: the list of the field pressed. */
export interface ChooserSpec {
  /** The search's name for the options ("moves"), and the keyboard's title. */
  noun: string;
  title: string;
  options: readonly ChooserOption[];
  selectedId: string;
  rows: ChooserRows;
  /** A search box (the canvas keyboard) over the list. */
  searchable: boolean;
  /** The filters, the first one on when the list opens; none for a short list. */
  filters: readonly ChooserFilter[];
  /** Shown instead of the list (moves of a species the format doesn't allow). */
  unavailable: string;
  /** What an option is, in the detail panel beside the list. */
  describe: (ctx: UiContext, box: Box, id: string) => void;
}

const ROW_H = 56;
const ROW_GAP = 4;
/** Rows shown under the search box and the filters, and without either. */
const VISIBLE_SEARCHABLE = 7;
const VISIBLE_PLAIN = 8;
const LIST_W = 540;
/** Names the canvas keyboard lists while searching, under its text. */
const HINT_NAMES = 4;
const MAX_QUERY_LENGTH = 24;
const SEARCH_ID = 'chooser-search';

/**
 * A list to pick a species, an item, an ability or a move from, beside the Pokémon's compact card: a
 * search box for long lists (a few letters on the canvas keyboard, which lists the matches as they're
 * typed; OK goes to the first one), the filters (L/R), and the options a row each, a page at a time,
 * which the d-pad walks (moving the list a row past the first or last one shown). Beside the list, the
 * detail panel says what the focused option is. A picks.
 */
export class ChooserView {
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly wraps = new WrapCache();
  private readonly searchable = new ListView('choose-s', ROW_H, VISIBLE_SEARCHABLE, ROW_GAP, false);
  private readonly plain = new ListView('choose-p', ROW_H, VISIBLE_PLAIN, ROW_GAP, false);

  private query = '';
  private filter = 0;
  /** The matches of the last options, filter and query, kept until one of them changes. */
  private memo: { options: readonly ChooserOption[]; filter: ChooserFilter | undefined; query: string; matches: readonly ChooserOption[] } | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  /** Opens on a list: no search, the first filter, and the current choice shown and focused. */
  open(spec: ChooserSpec): void {
    this.query = '';
    this.filter = 0;
    // The current choice may not pass the first filter (a held item that isn't popular): then All.
    if (spec.selectedId && !this.results(spec).some((option) => option.id === spec.selectedId)) {
      const all = spec.filters.findIndex((filter) => filter.name === 'All');
      if (all >= 0) this.filter = all;
    }
    this.show(spec, spec.selectedId);
  }

  /** Whether the focus is in the chooser (its search box or a row). */
  hasFocus(): boolean {
    const id = this.focus.focused ?? '';
    return id === SEARCH_ID || id.startsWith('choose-');
  }

  /** L/R: the previous or next filter, on its first option; false without filters. */
  stepFilter(spec: ChooserSpec, by: 1 | -1): boolean {
    const count = spec.filters.length;
    if (count < 2) return false;
    this.filter = (this.filter + by + count) % count;
    this.show(spec, '');
    return true;
  }

  /** Home/End: the list's first or last option. */
  jump(spec: ChooserSpec, to: 'first' | 'last'): void {
    this.list(spec).jump(to, this.results(spec).length, this.focus);
  }

  draw(ctx: UiContext, spec: ChooserSpec, picked: (id: string) => void): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const x = BESIDE_COMPACT_X;
    const results = this.results(spec);
    const list = this.list(spec);
    let top = EDIT_BODY_Y;

    if (spec.searchable) {
      const field = { x, y: top, w: LIST_W, h: 44 };
      textField(ctx, SEARCH_ID, field, this.query, { placeholder: `Search ${spec.noun}`, edit: () => this.search(spec) });
      label(ctx, list.range(results.length) || 'None', field.x + field.w - 14, field.y + 22, { size: 16 }, p.muted, { align: 'right' });
      top += 52;
    }
    if (spec.filters.length > 1) {
      this.drawFilters(ctx, { x, y: top, w: LIST_W, h: 36 }, spec);
      top += 44;
    } else if (!spec.searchable) {
      label(ctx, `${results.length} ${spec.noun}`, x + 4, top + 14, { size: 18 }, p.muted);
      top += 32;
    }

    const listBox = { x, y: top, w: LIST_W, h: EDIT_BODY_BOTTOM - top };
    renderer.rect(listBox.x, listBox.y, listBox.w, listBox.h, { fill: p.input, stroke: p.rim, radius: 10, border: 2 });
    const message = spec.unavailable || (results.length === 0 ? 'No matches. Try fewer letters, or another filter.' : '');
    if (message) this.wraps.draw(ctx, message, listBox.x + 24, listBox.y + 24, listBox.w - 48, 28, { size: 20 }, p.muted, 6);
    list.draw(
      ctx,
      listBox.x + 4,
      listBox.y + 4,
      listBox.w - 8,
      results.length,
      (row) => this.drawRow(ctx, spec, results[row.index], row.box, row.focused),
      (index) => picked(results[index].id),
    );

    // Beside the list: the focused option (the current choice while the search box has the focus).
    const panel = { x: x + LIST_W + 20, y: EDIT_BODY_Y, w: EDIT_RIGHT - (x + LIST_W + 20), h: EDIT_BODY_BOTTOM - EDIT_BODY_Y };
    renderer.rect(panel.x, panel.y, panel.w, panel.h, { fill: p.panel, stroke: p.outline, radius: 10, border: 2 });
    const focusedIndex = this.focusedIndex(list);
    const shown = focusedIndex !== null ? results[focusedIndex] : spec.options.find((option) => option.id === spec.selectedId);
    if (shown && !spec.unavailable) spec.describe(ctx, panel, shown.id);
    else this.wraps.draw(ctx, `Pick from the list, or press up to search ${spec.noun}.`, panel.x + 24, panel.y + 24, panel.w - 48, 28, { size: 20 }, p.muted, 4);
  }

  /** The filters as chips between L and R, the one on lit; as many as fit, around it. */
  private drawFilters(ctx: UiContext, box: Box, spec: ChooserSpec): void {
    const p = ctx.palette;
    const cy = box.y + box.h / 2;
    const style = { size: 18, bold: true };
    const widths = spec.filters.map((filter) => ctx.text.measure(filter.name, style) + 28);
    const keyW = 34;
    const room = box.w - 2 * (keyW + 8);
    // From the filter on, add the next ones while they fit, then the ones before it.
    let first = this.filter;
    let last = this.filter;
    let used = widths[this.filter];
    while (last + 1 < widths.length && used + 6 + widths[last + 1] <= room) used += 6 + widths[++last];
    while (first > 0 && used + 6 + widths[first - 1] <= room) used += 6 + widths[--first];

    keyPill(ctx, 'L', box.x, cy);
    let x = box.x + keyW + 8;
    for (let i = first; i <= last; i++) {
      const on = i === this.filter;
      ctx.renderer.rect(x, box.y, widths[i], box.h, { fill: on ? p.accent : p.button, radius: box.h / 2 });
      label(ctx, spec.filters[i].name, x + widths[i] / 2, cy, style, on ? WHITE : p.muted, { align: 'center' });
      x += widths[i] + 6;
    }
    keyPill(ctx, 'R', x + 2, cy);
  }

  private drawRow(ctx: UiContext, spec: ChooserSpec, option: ChooserOption, box: Box, focused: boolean): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const chosen = option.id === spec.selectedId;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : chosen ? p.button : p.panel, radius: 8 });
    const cy = box.y + box.h / 2;
    const right = box.x + box.w - 14;
    let left = box.x + 16;
    let end = right;
    switch (spec.rows) {
      case 'move': {
        renderer.rect(box.x, box.y, 10, box.h, { fill: (option.type && typeRgba(option.type)) || p.rim, radius: 4 });
        left = box.x + 24;
        label(ctx, option.value ?? '', right, cy, { size: 22, bold: true }, p.ink, { align: 'right', fast: true });
        const category = option.category ?? '';
        end = right - 50 - CATEGORY_ICON_W;
        categoryBadge(ctx, category, end, cy);
        if (option.type) {
          end -= 8 + 90;
          renderer.rect(end, cy - 13, 90, 26, { fill: typeRgba(option.type) ?? p.rim, radius: 4 });
          label(ctx, option.type, end + 45, cy, { size: 16, bold: true }, WHITE, { align: 'center', maxWidth: 84 });
        }
        break;
      }
      case 'species': {
        const types = option.types ?? [];
        types.forEach((type, i) => {
          const tx = right - (types.length - i) * 92 + 8;
          renderer.rect(tx, cy - 13, 84, 26, { fill: typeRgba(type) ?? p.rim, radius: 4 });
          label(ctx, type, tx + 42, cy, { size: 16, bold: true }, WHITE, { align: 'center', maxWidth: 78 });
        });
        end = right - types.length * 92;
        break;
      }
      case 'item':
        if (option.icon) ctx.images.drawItem(option.icon, left, box.y + 10, 36);
        left += 48;
        if (option.value) end = right - 8 - label(ctx, option.value, right, cy, { size: 16 }, p.muted, { align: 'right' });
        break;
      default:
        break;
    }
    label(ctx, option.name, left, cy, { size: 22, bold: true }, p.ink, { maxWidth: end - left - 12 });
    // The current choice: a bar at the row's end.
    if (chosen) renderer.rect(box.x + box.w - 5, box.y + 8, 4, box.h - 16, { fill: p.accentText, radius: 2 });
    if (focused) focusRing(ctx, box, 8);
  }

  /** The search box: the canvas keyboard, which lists the matches as they're typed; OK focuses the first. */
  private search(spec: ChooserSpec): void {
    this.keyboard.open({
      label: `Search ${spec.noun}`,
      value: this.query,
      maxLength: MAX_QUERY_LENGTH,
      hint: (text) => {
        const words = searchWords(text);
        if (words.length === 0) return spec.rows === 'species' ? 'Type part of a name, an ability or a move' : 'Type part of a name';
        const found = matching(this.pool(spec, true), words);
        if (found.length === 0) return 'No matches';
        const names = found.slice(0, HINT_NAMES).map((option) => option.name).join(', ');
        return `${found.length} ${found.length === 1 ? 'match' : 'matches'}: ${names}${found.length > HINT_NAMES ? '…' : ''}`;
      },
      done: (value) => {
        if (value !== null) this.query = value;
        const list = this.list(spec);
        list.start = 0;
        this.focus.focus(value !== null && this.results(spec).length > 0 ? `${list.id}-0` : SEARCH_ID);
      },
    });
  }

  /** The list from its start, on an option (the first one when it isn't there). */
  private show(spec: ChooserSpec, id: string): void {
    const list = this.list(spec);
    const results = this.results(spec);
    if (results.length === 0) {
      list.start = 0;
      this.focus.focus(spec.searchable && !spec.unavailable ? SEARCH_ID : null);
      return;
    }
    const index = Math.max(0, results.findIndex((option) => option.id === id));
    list.start = Math.max(0, index - 1);
    list.reveal(index, results.length);
    this.focus.focus(`${list.id}-${index}`);
  }

  /** The options the filter on lets through (all of them while searching with a "searches all" one). */
  private pool(spec: ChooserSpec, searching: boolean): readonly ChooserOption[] {
    const filter = spec.filters[this.filter];
    if (!filter || (searching && filter.searchesAll)) return spec.options;
    return spec.options.filter(filter.test);
  }

  private results(spec: ChooserSpec): readonly ChooserOption[] {
    if (spec.unavailable) return [];
    const filter = spec.filters[this.filter];
    if (this.memo?.options !== spec.options || this.memo.filter !== filter || this.memo.query !== this.query) {
      const words = searchWords(this.query);
      this.memo = { options: spec.options, filter, query: this.query, matches: matching(this.pool(spec, words.length > 0), words) };
    }
    return this.memo.matches;
  }

  private list(spec: ChooserSpec): ListView {
    return spec.searchable || spec.filters.length > 1 ? this.searchable : this.plain;
  }

  /** The row with the focus, if one has it. */
  private focusedIndex(list: ListView): number | null {
    const id = this.focus.focused ?? '';
    const prefix = `${list.id}-`;
    return id.startsWith(prefix) ? Number(id.slice(prefix.length)) : null;
  }
}

/** A query's words, as IDs (letters and digits only). */
function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map(toId).filter(Boolean);
}

/** A keyword search needs this many letters (fewer would match nearly every species). */
const MIN_KEYWORD_QUERY = 3;

/**
 * The options whose name has every word, names starting with the first word first; then the ones
 * with a keyword starting with the whole query (a species' ability or move: "fake out").
 */
function matching(options: readonly ChooserOption[], words: readonly string[]): readonly ChooserOption[] {
  if (words.length === 0) return options;
  const found = options.filter((option) => {
    const name = toId(option.name);
    return words.every((word) => name.includes(word));
  });
  const first = words[0];
  const query = words.join('');
  const byName = new Set(found);
  const byKeyword =
    query.length < MIN_KEYWORD_QUERY ? [] : options.filter((option) => !byName.has(option) && !!option.keywords?.some((keyword) => keyword.startsWith(query)));
  return [...found.filter((o) => toId(o.name).startsWith(first)), ...found.filter((o) => !toId(o.name).startsWith(first)), ...byKeyword];
}
