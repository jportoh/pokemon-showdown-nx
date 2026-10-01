import { CanvasAction } from '@core/input/keyboard-navigation';
import { CanvasFocus } from '../canvas-ui';
import { ImagePriority } from '../sprite-bitmaps';
import { Box, UiContext, button, focusRing, label, modal } from './retro-kit';
import { maskOf } from './masks';

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

type PickerRow = { kind: 'heading'; text: string } | { kind: 'option'; option: PickerOption };

/** Short rows with text only, or tall ones with 96px sprites (teams), as the DOM picker. */
interface RowLayout {
  visible: number;
  height: number;
  titleCy: number;
  detailCy: number;
  titleWidth: number;
}
const TEXT_ROWS: RowLayout = { visible: 8, height: 60, titleCy: 18, detailCy: 44, titleWidth: 1080 };
const SPRITE_ROWS: RowLayout = { visible: 5, height: 100, titleCy: 36, detailCy: 66, titleWidth: 440 };
const SPRITE_SIZE = 96;
const SPRITE_STEP = 104;
const SPRITES_LEFT = 520;

/** The picker's box, over the page under the bar, and its list inside. */
const BOX: Box = { x: 32, y: 100, w: 1216, h: 596 };
const LIST_X = BOX.x + 24;
const LIST_Y = BOX.y + 72;
const LIST_W = 1156;
const CURSOR = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];

/**
 * A list to pick a format or a team from, drawn over the page (OptionPicker on the canvas): options
 * under their category's heading, a few rows at a time. The d-pad walks them and moves the list past
 * the first or last one shown; L/R (the page's, passed on) move it a page; A picks, B closes. The
 * focus starts on the option picked so far and goes back where it was on closing.
 */
export class OptionPickerView {
  private title = '';
  private rows: PickerRow[] = [];
  private layout = TEXT_ROWS;
  private selected: string | null = null;
  private start = 0;
  private picked: ((id: string) => void) | null = null;
  /** The control focused before opening, focused again on closing. */
  private returnFocus: string | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  get isOpen(): boolean {
    return this.picked !== null;
  }

  open(title: string, options: readonly PickerOption[], selected: string | null, picked: (id: string) => void): void {
    this.title = title;
    this.selected = selected;
    this.picked = picked;
    this.layout = options.some((option) => option.sprites?.length) ? SPRITE_ROWS : TEXT_ROWS;
    const categories = [...new Set(options.map((option) => option.category ?? ''))];
    this.rows = categories.flatMap((category): PickerRow[] => [
      ...(category ? [{ kind: 'heading' as const, text: category }] : []),
      ...options.filter((option) => (option.category ?? '') === category).map((option) => ({ kind: 'option' as const, option })),
    ]);
    const index = Math.max(0, this.rowIndex(selected ?? ''));
    this.start = this.clamp(index - 1);
    this.returnFocus = this.focus.focused;
    const first = this.rows.find((row) => row.kind === 'option');
    this.focus.focus(this.optionId(selected && this.rowIndex(selected) >= 0 ? selected : first?.kind === 'option' ? first.option.id : ''));
  }

  /** Shown again after something covered it (a challenge): the focus back on the option picked. */
  focusSelected(): void {
    const index = this.rowIndex(this.selected ?? '');
    const row = this.rows[index >= 0 ? index : this.optionIndexes()[0]];
    if (row?.kind === 'option') this.reveal(this.rows.indexOf(row));
  }

  close(): void {
    if (!this.picked) return;
    this.picked = null;
    this.focus.focus(this.returnFocus);
  }

  /** B closes; the jumps go to the first and last options. Null: not the picker's. */
  input(action: CanvasAction): boolean | null {
    if (!this.isOpen) return null;
    if (action === 'back') {
      this.close();
      return true;
    }
    if (action === 'first' || action === 'last') {
      const options = this.optionIndexes();
      const target = action === 'first' ? options[0] : options.at(-1);
      if (target !== undefined) this.reveal(target);
      return true;
    }
    return null;
  }

  /** L/R: the list moves a page, the focus on the first option shown. */
  page(by: 1 | -1): boolean {
    if (!this.isOpen) return false;
    const before = this.start;
    this.start = this.clamp(this.start + by * this.layout.visible);
    if (this.start === before) return true;
    const first = this.optionIndexes().find((i) => i >= this.start);
    if (first !== undefined) this.focus.focus(this.optionId((this.rows[first] as { option: PickerOption }).option.id));
    return true;
  }

  draw(ctx: UiContext): void {
    if (!this.isOpen) return;
    const p = ctx.palette;
    const { renderer } = ctx;
    modal(ctx, BOX, 0.7);
    label(ctx, this.title, BOX.x + 32, BOX.y + 36, { size: 30, bold: true }, p.ink, { maxWidth: 660 });
    const options = this.optionIndexes();
    const selectedAt = options.findIndex((i) => (this.rows[i] as { option: PickerOption }).option.id === this.selected);
    if (options.length > 1 && selectedAt >= 0) label(ctx, `${selectedAt + 1} of ${options.length}`, BOX.x + 988, BOX.y + 38, { size: 18 }, p.muted, { align: 'right' });
    const arrows = `${this.start > 0 ? '▲' : ''} ${this.start + this.layout.visible < this.rows.length ? '▼' : ''}`.trim();
    if (arrows) label(ctx, arrows, BOX.x + 700, BOX.y + 38, { size: 18 }, p.muted);
    button(ctx, 'picker-close', { x: BOX.x + 1040, y: BOX.y + 18, w: 128, h: 36 }, 'Close', { shortcut: 'B', skip: true, accept: () => this.close() });

    const { visible, height } = this.layout;
    const end = Math.min(this.rows.length, this.start + visible);
    const cursor = maskOf(renderer, CURSOR);
    for (let index = this.start; index < end; index++) {
      const row = this.rows[index];
      const y = LIST_Y + (index - this.start) * height;
      if (row.kind === 'heading') {
        label(ctx, row.text.toUpperCase(), LIST_X + 8, y + height - 22, { size: 18, bold: true }, p.teal, { maxWidth: LIST_W - 16 });
        renderer.rect(LIST_X + 8, y + height - 2, LIST_W - 16, 2, { fill: p.rim });
        continue;
      }
      const option = row.option;
      const box = { x: LIST_X, y: y + 2, w: LIST_W, h: height - 4 };
      const focused = this.focus.control({
        id: this.optionId(option.id),
        ...box,
        accept: () => this.pick(option.id),
        move: (direction) => this.step(index, direction),
      });
      const chosen = option.id === this.selected;
      if (chosen || focused) renderer.rect(box.x, box.y, box.w, box.h, { fill: p.select, radius: 6 });
      if (chosen) renderer.image(cursor, box.x + 12, box.y + (box.h - 28) / 2, 4, p.accentText);
      label(ctx, option.title, box.x + 44, y + this.layout.titleCy, { size: 24, bold: true }, p.ink, { maxWidth: this.layout.titleWidth });
      label(ctx, option.detail, box.x + 44, y + this.layout.detailCy, { size: 16 }, p.muted, { maxWidth: this.layout.titleWidth });
      (option.sprites ?? []).forEach((sprite, i) => {
        const texture = ctx.images.sprite(sprite, false, ImagePriority.Screen);
        if (texture) renderer.rect(box.x + SPRITES_LEFT + i * SPRITE_STEP, y, SPRITE_SIZE, SPRITE_SIZE, { fill: [1, 1, 1, 1], texture });
      });
      if (focused) focusRing(ctx, box);
    }
  }

  private pick(id: string): void {
    const picked = this.picked;
    this.close();
    picked?.(id);
  }

  /** Up from the first option shown, or down from the last, moves the list to the next option. */
  private step(index: number, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    if (direction === 'left' || direction === 'right') return true;
    const options = this.optionIndexes();
    const target = direction === 'up' ? options.filter((i) => i < index).at(-1) : options.find((i) => i > index);
    if (target === undefined) return true;
    this.reveal(target);
    return true;
  }

  /** Moves the list to show an option (and its heading, just above), and focuses it. */
  private reveal(index: number): void {
    const row = this.rows[index];
    if (row?.kind !== 'option') return;
    const top = this.rows[index - 1]?.kind === 'heading' ? index - 1 : index;
    if (top < this.start) this.start = top;
    else if (index >= this.start + this.layout.visible) this.start = index - this.layout.visible + 1;
    this.start = this.clamp(this.start);
    this.focus.focus(this.optionId(row.option.id));
  }

  private optionIndexes(): number[] {
    return this.rows.flatMap((row, i) => (row.kind === 'option' ? [i] : []));
  }

  private rowIndex(id: string): number {
    return this.rows.findIndex((row) => row.kind === 'option' && row.option.id === id);
  }

  private optionId(id: string): string {
    return `picker-${id}`;
  }

  private clamp(start: number): number {
    return Math.max(0, Math.min(start, this.rows.length - this.layout.visible));
  }
}
