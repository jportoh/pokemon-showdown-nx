import { inject } from '@angular/core';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, ListView, UiContext, focusRing, label, textField } from '@core/gl/ui/retro-kit';
import { toId } from '@shared/utils/to-id';
import { ON_TYPE, WHITE, WrapCache, shortcutButton, typeRgba } from './tb-draw';

export interface ChooserOption {
  id: string;
  name: string;
  detail: string;
  /** A move's type: its row takes the type's colour, with its category's icon. */
  type?: string;
  category?: string;
  /** An item's ID, whose icon starts the row. */
  icon?: string;
}

/** How the rows look: a line of detail (species), two (abilities), an item's icon, or a move's colours. */
export type ChooserRows = 'text' | 'long' | 'item' | 'move';

/** What the editor has the chooser show: the list of the card pressed. */
export interface ChooserSpec {
  title: string;
  options: readonly ChooserOption[];
  selectedId: string;
  rows: ChooserRows;
  /** A search box (the canvas keyboard) over the list. */
  searchable: boolean;
  /** A short list shown until something is typed (popular items), and its name. */
  suggested: readonly ChooserOption[] | null;
  suggestedLabel: string;
  /** Shown instead of the list (moves of a species the format doesn't allow). */
  unavailable: string;
  /** The "none" choice ZL picks ("No item", "No move"); '' without one. */
  clearLabel: string;
}

interface Layout {
  height: number;
  /** Rows shown under a search box, and without one. */
  searchable: number;
  plain: number;
}

const LAYOUTS: Record<ChooserRows, Layout> = {
  text: { height: 53, searchable: 8, plain: 8 },
  long: { height: 70, searchable: 6, plain: 6 },
  item: { height: 70, searchable: 6, plain: 6 },
  move: { height: 58, searchable: 7, plain: 8 },
};

/** Names the canvas keyboard lists while searching, under its text. */
const HINT_NAMES = 4;
const MAX_QUERY_LENGTH = 24;
const SEARCH_ID = 'chooser-search';
const CLEAR_ID = 'chooser-clear';

/** The chooser's frame beside the cards: 420x552, with its list inside. */
export const CHOOSER_W = 420;
export const CHOOSER_H = 552;

/**
 * A list to pick a species, an item, an ability or a move from (DexChooser on the canvas), in a frame
 * beside the set's cards: its title, "No item"/"No move" on ZL, a search box for long lists (a few
 * letters on the canvas keyboard, which lists the matches as they're typed; OK goes to the first
 * one), and the options a page at a time, which the d-pad walks (moving the list a row past the
 * first or last one shown). A picks. Every match is listed: a page draws only its own rows.
 */
export class ChooserView {
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly wraps = new WrapCache();
  /** One list per layout (each shows its own number of rows). */
  private readonly lists = new Map<string, ListView>();

  private query = '';
  /** The matches of the last options and query, kept until either changes. */
  private memo: { options: readonly ChooserOption[]; query: string; matches: readonly ChooserOption[] } | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  /** Opens on a list: the search cleared, the current choice shown and focused (or the first option). */
  open(spec: ChooserSpec): void {
    this.query = '';
    const list = this.list(spec);
    const results = this.results(spec);
    if (results.length === 0) {
      this.focus.focus(spec.searchable && !spec.unavailable ? SEARCH_ID : null);
      return;
    }
    const selected = Math.max(0, results.findIndex((option) => option.id === spec.selectedId));
    list.start = Math.max(0, selected - 1);
    list.reveal(selected, results.length);
    this.focus.focus(`${list.id}-${selected}`);
  }

  /** Whether the focus is in the chooser (its search box or a row). */
  hasFocus(): boolean {
    const id = this.focus.focused ?? '';
    return id === SEARCH_ID || id === CLEAR_ID || id.startsWith('choose-');
  }

  /** Home/End: the list's first or last option. */
  jump(spec: ChooserSpec, to: 'first' | 'last'): void {
    this.list(spec).jump(to, this.results(spec).length, this.focus);
  }

  draw(ctx: UiContext, box: Box, spec: ChooserSpec, picked: (id: string) => void, clear: () => void): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: p.outline, radius: 8, border: 2 });
    const x = box.x + 6;
    const width = box.w - 12;
    label(ctx, spec.title, x + 6, box.y + 22, { size: 18, bold: true }, p.ink, { maxWidth: spec.clearLabel ? 260 : width - 12 });
    if (spec.clearLabel) shortcutButton(ctx, CLEAR_ID, { x: box.x + 284, y: box.y + 8, w: 128, h: 28 }, 'ZL', spec.clearLabel, { size: 14, accept: clear });

    let top = box.y + 40;
    if (spec.searchable) {
      textField(ctx, SEARCH_ID, { x, y: top, w: width, h: 40 }, this.query, { placeholder: 'Search', edit: () => this.search(spec) });
      top += 44;
    }
    const results = this.results(spec);
    const list = this.list(spec);
    const layout = LAYOUTS[spec.rows];
    const visible = spec.searchable ? layout.searchable : layout.plain;
    const arrows = `${list.start > 0 ? ' ▲' : ''}${list.start + visible < results.length ? ' ▼' : ''}`;
    label(ctx, this.summary(spec) + arrows, x + 6, top + 14, { size: 14 }, p.muted, { maxWidth: width - 12 });
    top += 28;

    const listBox = { x, y: top, w: width, h: box.y + box.h - 10 - top };
    renderer.rect(listBox.x, listBox.y, listBox.w, listBox.h, { fill: p.bg, stroke: p.rim, radius: 6, border: 2 });
    list.draw(
      ctx,
      listBox.x + 2,
      listBox.y + 2,
      listBox.w - 4,
      results.length,
      (row) => this.drawRow(ctx, spec, results[row.index], row.box, row.focused),
      (index) => picked(results[index].id),
    );
  }

  private drawRow(ctx: UiContext, spec: ChooserSpec, option: ChooserOption, box: Box, focused: boolean): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const chosen = option.id === spec.selectedId;
    const typeFill = option.type ? typeRgba(option.type) : null;
    if (chosen || focused) renderer.rect(box.x, box.y, box.w, box.h, { fill: p.select });
    else if (typeFill) renderer.rect(box.x, box.y, box.w, box.h, { fill: typeFill });
    renderer.rect(box.x, box.y + box.h - 1, box.w, 1, { fill: p.rim });
    const ink = typeFill && !chosen && !focused ? WHITE : p.ink;
    const muted = typeFill && !chosen && !focused ? ON_TYPE : p.muted;
    switch (spec.rows) {
      case 'item':
        if (option.icon) ctx.images.drawItem(option.icon, box.x + 8, box.y + 11, 48);
        label(ctx, option.name, box.x + 64, box.y + 17, { size: 16, bold: true }, ink, { maxWidth: box.w - 76 });
        this.wraps.draw(ctx, option.detail, box.x + 64, box.y + 29, box.w - 76, 17, { size: 14 }, muted, 2);
        break;
      case 'long':
        label(ctx, option.name, box.x + 12, box.y + 18, { size: 16, bold: true }, ink, { maxWidth: box.w - 24 });
        this.wraps.draw(ctx, option.detail, box.x + 12, box.y + 30, box.w - 24, 18, { size: 14 }, muted, 2);
        break;
      case 'move': {
        label(ctx, option.name, box.x + 12, box.y + 17, { size: 16, bold: true }, ink, { maxWidth: box.w - 24 });
        const icon = option.category ? ctx.images.image(`categories/${option.category.toLowerCase()}.png`) : null;
        if (icon) renderer.rect(box.x + 12, box.y + 33, 32, 14, { fill: WHITE, texture: icon });
        label(ctx, option.detail, box.x + (option.category ? 50 : 12), box.y + 40, { size: 14 }, muted, { maxWidth: box.w - 62 });
        break;
      }
      default:
        label(ctx, option.name, box.x + 12, box.y + 18, { size: 16, bold: true }, ink, { maxWidth: box.w - 24 });
        label(ctx, option.detail, box.x + 12, box.y + 38, { size: 14 }, muted, { maxWidth: box.w - 24 });
    }
    if (focused) focusRing(ctx, box, 4);
  }

  /** The search box: the canvas keyboard, which lists the matches as they're typed; OK focuses the first. */
  private search(spec: ChooserSpec): void {
    this.keyboard.open({
      label: `Search: ${spec.title}`,
      value: this.query,
      maxLength: MAX_QUERY_LENGTH,
      hint: (text) => {
        const words = searchWords(text);
        if (words.length === 0) return 'Type part of a name';
        const found = matching(spec.options, words);
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

  /** Searchable lists show their suggestions until something is typed, else every match. */
  private results(spec: ChooserSpec): readonly ChooserOption[] {
    if (spec.unavailable) return [];
    if (!spec.searchable) return spec.options;
    if (spec.suggested && searchWords(this.query).length === 0) return spec.suggested;
    return this.matches(spec.options);
  }

  private matches(options: readonly ChooserOption[]): readonly ChooserOption[] {
    if (this.memo?.options !== options || this.memo.query !== this.query) {
      this.memo = { options, query: this.query, matches: matching(options, searchWords(this.query)) };
    }
    return this.memo.matches;
  }

  private summary(spec: ChooserSpec): string {
    if (spec.unavailable) return spec.unavailable;
    const total = spec.searchable ? this.matches(spec.options).length : spec.options.length;
    const options = `${total} ${total === 1 ? 'option' : 'options'}`;
    if (!spec.searchable) return options;
    const typed = searchWords(this.query).length > 0;
    if (spec.suggested && !typed) return `${spec.suggestedLabel}; type to search all ${total}`;
    if (total === 0) return 'No matches';
    if (!typed) return `${options}; type to search`;
    return `${total} ${total === 1 ? 'match' : 'matches'}`;
  }

  private list(spec: ChooserSpec): ListView {
    const key = `${spec.rows}-${spec.searchable ? 's' : 'p'}`;
    let list = this.lists.get(key);
    if (!list) {
      const layout = LAYOUTS[spec.rows];
      list = new ListView(`choose-${key}`, layout.height, spec.searchable ? layout.searchable : layout.plain, 0, false);
      this.lists.set(key, list);
    }
    return list;
  }
}

/** A query's words, as IDs (letters and digits only). */
function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map(toId).filter(Boolean);
}

/** The options whose name has every word; names starting with the first word come first. */
function matching(options: readonly ChooserOption[], words: readonly string[]): readonly ChooserOption[] {
  if (words.length === 0) return options;
  const found = options.filter((option) => {
    const name = toId(option.name);
    return words.every((word) => name.includes(word));
  });
  const first = words[0];
  return [...found.filter((o) => toId(o.name).startsWith(first)), ...found.filter((o) => !toId(o.name).startsWith(first))];
}
