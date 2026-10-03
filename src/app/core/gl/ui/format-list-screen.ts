import { DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { CanvasFocus, focusInput } from '../canvas-ui';
import { Rgba, rgba, withAlpha } from '../gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '../gl-stage';
import { GlTheme } from './gl-theme';
import { maskOf } from './masks';
import { OptionPickerView, PickerOption } from './option-picker';
import { PageBar, PageBarInfo } from './page-bar';
import { ListView, UiContext, button, focusRing, label, retroBox } from './retro-kit';

/** One row of the list: its title on the left, a detail (rating, age…) further right. */
export interface FormatListRow {
  title: string;
  detail: string;
  /** A pill before the detail ("Won" in green, "Lost" in red; neutral in the theme's colours). */
  badge?: { text: string; tone: 'good' | 'bad' | 'neutral' };
}

/**
 * The badges' fixed colours, the same in every theme (a win is green, a loss red): white on them
 * passes WCAG AA (5.3:1 and 6.5:1). Neutral ones use the theme's select and ink.
 */
/** A badge's least width ("Won" and "Lost" the same), and the room kept for one before the detail ("Unfinished" fits). */
const BADGE_MIN_W = 72;
const BADGE_SLOT_W = 124;
const BADGE_TONES:Partial<Record<'good' | 'bad' | 'neutral', { fill: Rgba; ink: Rgba }>> = {
  good: { fill: rgba('#1e7b3c'), ink: rgba('#ffffff') },
  bad: { fill: rgba('#b3261e'), ink: rgba('#ffffff') },
};

/** A box a page opens over itself (Watch Live's login): its ZR and B come first, and it's drawn last. */
export interface PageOverlay {
  /** Whether it took the press (opening the box, or while it's open). */
  pressZR(): boolean;
  /** Whether it took B (closing the box). */
  back(): boolean;
  /** The box is open (the page's jumps wait). */
  isOpen(): boolean;
  draw(ctx: UiContext): void;
}

/** What a list page shows and does; the screen draws it and handles the controller. */
export interface FormatListModel {
  page: Omit<PageBarInfo, 'back'>;
  /** Where B (and the bar's Back) goes; a function is asked as the page is left. */
  backTo: string | (() => string);
  formats: readonly PickerOption[];
  format(): string;
  formatLabel(): string;
  pickFormat(id: string): void;
  canRefresh(): boolean;
  refresh(): void;
  /** Said in the box instead of the rows (loading, offline, nothing found). */
  message(): string | null;
  rows(): readonly FormatListRow[];
  /** Where a row's detail starts, from the row's left. */
  detailX: number;
  open(index: number): void;
  /** The rows shown now (from, to): for lookups made only for those. */
  shown?(from: number, to: number): void;
  /** A box over the page, made with the page's focus. */
  overlay?(focus: CanvasFocus): PageOverlay;
}

const ROWS = 8;
const ROW_H = 56;
const ROW_GAP = 6;
/** The page's controls along the top, and the box of rows under them. */
const TOP = 100;
const BOX = { x: 32, y: 168, w: 1220, h: 528 };
const ROW_X = BOX.x + 12;
const ROW_Y = BOX.y + 12;
const ROW_W = 1184;
/** Rows slide in one after another with each new list; the page fades out on leaving. */
const INTRO_MS = 260;
const LEAVE_MS = 180;
/** The selector's ▼: 7x4 pixels, drawn 3 times bigger. */
const DOWN = ['xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];

/**
 * A page listing things of a format (Watch Live's battles, the replays), drawn on the stage: the
 * pages' bar; a format selector (the list of formats opens over the page), Refresh (ZR), where the
 * list is, Previous (L) and Next (R) along the top; eight rows in a box below, or a message. The
 * d-pad walks the rows and moves the list a row past the first or last shown; A opens one; B leaves.
 * Must be made in an injection context (a component's constructor).
 */
export class FormatListScreen {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bar = inject(PageBar);
  private readonly navigation = inject(KeyboardNavigation);

  readonly focus = new CanvasFocus();
  private readonly list = new ListView('row', ROW_H, ROWS, ROW_GAP, false);
  private readonly picker = new OptionPickerView(this.focus);
  private listAt = performance.now();
  private shownKey = '';
  /** A row had the focus when the list went away (a refresh): the new list's first row gets it. */
  private rowFocusLost = false;
  private leaving: { at: number; path: string } | null = null;
  private readonly overlay: PageOverlay | null;

  constructor(private readonly model: FormatListModel) {
    this.overlay = model.overlay?.(this.focus) ?? null;
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => !this.leaving && this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.focus.focus('format');
    const release = [
      this.navigation.registerButton('buttonL', () => (this.picker.isOpen ? this.picker.page(-1) : this.movePage(-1))),
      this.navigation.registerButton('buttonR', () => (this.picker.isOpen ? this.picker.page(1) : this.movePage(1))),
      this.navigation.registerButton('buttonZR', () => {
        if (this.picker.isOpen) return false;
        if (this.overlay?.pressZR()) return true;
        if (this.model.canRefresh()) this.model.refresh();
        return true;
      }),
    ];
    inject(DestroyRef).onDestroy(() => {
      hide();
      release.forEach((fn) => fn());
    });
  }

  /** A new list: back to its start, the rows sliding in; `focusFirst` puts the focus on its first row. */
  resetList(focusFirst = false): void {
    this.list.start = 0;
    this.listAt = performance.now();
    this.shownKey = '';
    const onRow = this.rowFocusLost || this.focus.focused?.startsWith('row-');
    this.rowFocusLost = false;
    if ((focusFirst || onRow) && !this.picker.isOpen) this.focus.focus('row-0');
  }

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    // The player moved on: a lost row's focus isn't given back.
    this.rowFocusLost = false;
    const picker = this.picker.input(action);
    if (picker !== null) return picker;
    if (action === 'back') {
      if (!this.overlay?.back()) this.leave();
      return true;
    }
    if (action === 'first' || action === 'last') {
      if (!this.picker.isOpen && !this.overlay?.isOpen() && this.rowsShown()) this.list.jump(action, this.model.rows().length, this.focus);
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  /** Previous/Next (L/R): the list moves a page; true once handled, even at the ends. */
  private movePage(by: 1 | -1): true {
    if (this.rowsShown()) this.list.page(by, this.model.rows().length, this.focus);
    return true;
  }

  private leave(): void {
    if (this.leaving) return;
    const { backTo } = this.model;
    this.leaving = { at: performance.now(), path: typeof backTo === 'string' ? backTo : backTo() };
  }

  private openPicker(): void {
    this.picker.open('Pick a format', this.model.formats, this.model.format(), (id) => this.model.pickFormat(id));
  }

  private rowsShown(): boolean {
    return !this.model.message() && this.model.rows().length > 0;
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    this.bar.draw(ctx, { ...this.model.page, back: () => this.leave() });
    this.drawControls(ctx);
    retroBox(ctx, BOX);
    const message = this.model.message();
    if (message && this.focus.focused?.startsWith('row-')) this.rowFocusLost = true;
    if (message) label(ctx, message, BOX.x + 24, BOX.y + 38, { size: 20 }, p.ink, { maxWidth: 1160 });
    else this.drawRows(ctx);
    this.picker.draw(ctx);
    this.overlay?.draw(ctx);
    if (this.leaving) {
      const t = Math.min(1, (now - this.leaving.at) / LEAVE_MS);
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: withAlpha(p.bg, t) });
      if (t >= 1) {
        const path = this.leaving.path;
        this.leaving = null;
        void this.router.navigateByUrl(path);
      }
    }
    this.focus.end();
    renderer.end();
  }

  private drawControls(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const selector = { x: 32, y: TOP, w: 468, h: 48 };
    const focused = ctx.focus.control({ id: 'format', ...selector, accept: () => this.openPicker() });
    renderer.rect(selector.x, selector.y, selector.w, selector.h, { fill: focused ? p.select : p.button, stroke: p.outline, radius: 6, border: 2 });
    label(ctx, 'Format', selector.x + 16, selector.y + 24, { size: 16 }, p.muted);
    label(ctx, this.model.formatLabel(), selector.x + 92, selector.y + 24, { size: 20, bold: true }, p.ink, { maxWidth: 320 });
    renderer.image(maskOf(renderer, DOWN), selector.x + 424, selector.y + 18, 3, p.accentText);
    if (focused) focusRing(ctx, selector);

    button(ctx, 'refresh', { x: 516, y: TOP, w: 160, h: 48 }, 'Refresh', { shortcut: 'ZR', skip: true, size: 20, disabled: !this.model.canRefresh(), accept: () => this.model.refresh() });
    const count = this.model.rows().length;
    if (this.rowsShown()) label(ctx, this.list.range(count), 692, TOP + 24, { size: 18 }, p.muted, { maxWidth: 232 });
    const atStart = this.list.start === 0;
    const atEnd = this.list.start + ROWS >= count;
    button(ctx, 'previous', { x: 940, y: TOP, w: 150, h: 48 }, 'Previous', { shortcut: 'L', skip: true, size: 20, disabled: !this.rowsShown() || atStart, accept: () => this.movePage(-1) });
    button(ctx, 'next', { x: 1102, y: TOP, w: 150, h: 48 }, 'Next', { shortcut: 'R', skip: true, size: 20, disabled: !this.rowsShown() || atEnd, accept: () => this.movePage(1) });
  }

  private drawRows(ctx: UiContext): void {
    const p = ctx.palette;
    const rows = this.model.rows();
    const { now } = ctx;
    this.list.draw(
      ctx,
      ROW_X,
      ROW_Y,
      ROW_W,
      rows.length,
      ({ box, index, focused }) => {
        const row = rows[index];
        const intro = Math.min(1, Math.max(0, (now - this.listAt - (index - this.list.start) * 30) / INTRO_MS));
        const arrive = 1 - Math.pow(1 - intro, 3);
        const x = box.x + (1 - arrive) * 24;
        const a = arrive;
        ctx.renderer.rect(x, box.y, box.w, box.h, { fill: withAlpha(focused ? p.select : p.button, a), stroke: withAlpha(p.rim, a), radius: 8, border: 2 });
        label(ctx, row.title, x + 20, box.y + box.h / 2, { size: 20, bold: true }, withAlpha(p.ink, a), { maxWidth: this.model.detailX - 40 });
        let detailX = this.model.detailX;
        if (row.badge) {
          const width = Math.max(BADGE_MIN_W, ctx.text.measure(row.badge.text, { size: 16, bold: true }) + 24);
          const tone = BADGE_TONES[row.badge.tone];
          ctx.renderer.rect(x + detailX, box.y + box.h / 2 - 15, width, 30, { fill: withAlpha(tone?.fill ?? p.select, a), radius: 15 });
          label(ctx, row.badge.text, x + detailX + width / 2, box.y + box.h / 2, { size: 16, bold: true }, withAlpha(tone?.ink ?? p.ink, a), { align: 'center' });
          // The details line up after any badge that fits its slot.
          detailX += Math.max(BADGE_SLOT_W, width + 12);
        }
        label(ctx, row.detail, x + detailX, box.y + box.h / 2, { size: 18 }, withAlpha(p.muted, a), { maxWidth: box.w - detailX - 20 });
        if (focused) focusRing(ctx, { ...box, x }, 8);
      },
      (index) => this.model.open(index),
    );
    const from = this.list.start;
    const to = Math.min(rows.length, from + ROWS);
    const key = `${from}:${to}:${rows.length}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.model.shown?.(from, to);
    }
  }
}
