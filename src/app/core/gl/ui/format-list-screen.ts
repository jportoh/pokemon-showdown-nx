import { DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { RoleKey } from '@core/input/console-keys';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { CanvasFocus, focusInput } from '../canvas-ui';
import { Rgba, mixRgba, rgba, withAlpha } from '../gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '../gl-stage';
import { GlTheme } from './gl-theme';
import { ImagePriority } from '../sprite-bitmaps';
import { SLANT, drawGround, drawKeyButton, menuModal, menuPanel } from './menu-kit';
import { OptionPickerView, PickerOption } from './option-picker';
import { PageBar, PageBarInfo } from './page-bar';
import { ListView, UiContext, label, pill } from './retro-kit';

/** One row of the list: its title on the left, a detail (rating, age…) further right. */
export interface FormatListRow {
  title: string;
  detail: string;
  /** A pill before the detail ("Won" in green, "Lost" in red; neutral in the theme's colours). */
  badge?: { text: string; tone: 'good' | 'bad' | 'neutral' };
  /** The two players: the row draws them facing each other around a VS (the title is then unused). */
  players?: readonly [string, string];
  /** The rating, as a chip ("★ 1712", amber when `high`); the detail is then only for news (loading, a failure). */
  rating?: { text: string; high: boolean };
  /** How long ago, at the row's end ("5 min ago"). */
  age?: string;
}

/** A battle's details: the players and their ratings, both teams, and how it stands. */
export interface BattleDetails {
  players: readonly [string, string];
  ratings: readonly [{ text: string; high: boolean }, { text: string; high: boolean }];
  teams: readonly [readonly string[], readonly string[]];
  format: string;
  /** Under the teams: a chip (Won, Lost, LIVE…) and a line. */
  status: { chip?: { text: string; tone: 'good' | 'bad' | 'neutral' | 'live' }; text: string };
}

export type BattleDetailsState = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready'; details: BattleDetails };

/**
 * The focused row's battle in detail: 'side', a panel beside a narrower list (the replays: their logs
 * are downloaded as rows get the focus); 'popup', a box over the list that `key` opens (Watch Live:
 * a live battle is looked at only when asked for).
 */
export interface DetailsModel {
  mode: 'side' | 'popup';
  key?: RoleKey;
  /** Asked for the row's details (the side panel asks once the focus rests on it). */
  request(index: number): void;
  get(index: number): BattleDetailsState | null;
}

/**
 * The badges' fixed colours, the same in every theme (a win is green, a loss red): white on them
 * passes WCAG AA (5.3:1 and 6.5:1). Neutral ones use the theme's select and ink.
 */
/** A badge's least width ("Won" and "Lost" the same). */
const BADGE_MIN_W = 72;
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
  /** The focused battle's details (teams, how it stands). */
  details?: DetailsModel;
  /** What A does on a row, in the legend ("Watch"). */
  openLabel?: string;
}

const ROWS = 7;
const ROW_H = 56;
const ROW_GAP = 10;
/** The page's controls along the top, the rows under them (narrower beside the details' panel). */
const TOP = 96;
const ROW_X = 48;
const ROW_Y = 182;
const ROW_W = 1184;
const SIDE_ROW_W = 520;
const PANEL = { x: 596, y: 182, w: 636, h: 456 };
const POPUP = { x: 220, y: 120, w: 840, h: 500 };
const LEGEND_Y = 684;
/** The details' panel waits for the focus to rest on a row before downloading its battle. */
const SETTLE_MS = 220;
/** The VS chip's ink. */
const VS_INK: Rgba = [1, 1, 1, 1];
/** Rows slide in one after another with each new list; the page fades out on leaving. */
const INTRO_MS = 260;
const LEAVE_MS = 180;

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
  /** Watch Live's details box: the row it's for, and when it opened. */
  private popup: number | null = null;
  /** The side panel's row: since when the focus rests on it, and whether its battle was asked for. */
  private settle = { index: -1, at: 0, asked: false };

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
      ...(model.details?.mode === 'popup' && model.details.key ? [this.navigation.registerButton(model.details.key.button, () => !this.picker.isOpen && this.pressDetails())] : []),
      this.navigation.registerButton('buttonZR', () => {
        if (this.picker.isOpen || this.popup !== null) return this.popup !== null;
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
    if (this.popup !== null) {
      if (action === 'back') this.closePopup();
      else if (action === 'accept') {
        const index = this.popup;
        this.closePopup();
        this.model.open(index);
      }
      return true;
    }
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

  /** The details' key (Watch Live): the focused row's battle in a box over the list, or the box closed. */
  private pressDetails(): boolean {
    if (this.popup !== null) {
      this.closePopup();
      return true;
    }
    const index = this.focusedRow();
    if (index === null || this.picker.isOpen || this.overlay?.isOpen()) return false;
    this.popup = index;
    this.model.details?.request(index);
    return true;
  }

  private closePopup(): void {
    const index = this.popup;
    this.popup = null;
    if (index !== null) this.focus.focus(`row-${index}`);
  }

  /** The row with the focus, if one has it. */
  private focusedRow(): number | null {
    const focused = this.focus.focused ?? '';
    if (!focused.startsWith('row-')) return null;
    const index = Number(focused.slice(4));
    return Number.isInteger(index) && index < this.model.rows().length ? index : null;
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

  private get side(): boolean {
    return this.model.details?.mode === 'side';
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    drawGround(ctx, 1);
    this.bar.drawHeader(ctx, { ...this.model.page, title: this.model.page.title.toUpperCase(), back: () => this.leave() });
    this.drawControls(ctx);
    const message = this.model.message();
    if (message && this.focus.focused?.startsWith('row-')) this.rowFocusLost = true;
    if (message) {
      menuPanel(ctx, { x: ROW_X, y: ROW_Y, w: ROW_W, h: 120 });
      label(ctx, message, ROW_X + 28, ROW_Y + 60, { size: 20 }, p.ink, { maxWidth: ROW_W - 56 });
    } else {
      this.drawRows(ctx);
      if (this.side) this.drawSide(ctx, now);
    }
    this.drawLegend(ctx);
    if (this.popup !== null && !message) this.drawPopup(ctx, this.popup);
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

  /** The format as a slanted card (A opens the list of formats), Refresh, where the list is, the pages. */
  private drawControls(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const selector = { x: 44, y: TOP, w: 470, h: 64 };
    const focused = ctx.focus.control({ id: 'format', ...selector, accept: () => this.openPicker() });
    renderer.rect(selector.x, selector.y + 10, selector.w, selector.h, { fill: [0, 0, 0, 0.14], radius: 14, softness: 18, skew: SLANT });
    renderer.rect(selector.x, selector.y, selector.w, selector.h, {
      fill: focused ? p.select : p.panel,
      fillEnd: mixRgba(focused ? p.select : p.panel, p.hero, 0.6),
      stroke: focused ? p.accentText : p.rim,
      border: focused ? 4 : 1,
      radius: 14,
      skew: SLANT,
    });
    label(ctx, 'FORMAT', selector.x + 30, selector.y + 32, { size: 13, bold: true }, p.muted);
    label(ctx, this.model.formatLabel(), selector.x + 104, selector.y + 32, { size: 21, bold: true }, p.ink, { maxWidth: 300 });
    label(ctx, '▼', selector.x + selector.w - 34, selector.y + 32, { size: 16, bold: true }, p.accentText, { align: 'center' });

    drawKeyButton(ctx, 'refresh', { x: 540, y: TOP + 10, w: 150, h: 44 }, 'ZR', 'Refresh', () => this.model.refresh(), true, !this.model.canRefresh());
    const count = this.model.rows().length;
    if (this.rowsShown()) label(ctx, this.list.range(count), 712, TOP + 32, { size: 16, bold: true }, p.muted, { maxWidth: 180 });
    const atStart = this.list.start === 0;
    const atEnd = this.list.start + ROWS >= count;
    drawKeyButton(ctx, 'previous', { x: 900, y: TOP + 10, w: 160, h: 44 }, 'L', 'Previous', () => this.movePage(-1), true, !this.rowsShown() || atStart);
    drawKeyButton(ctx, 'next', { x: 1074, y: TOP + 10, w: 158, h: 44 }, 'R', 'Next', () => this.movePage(1), true, !this.rowsShown() || atEnd);
  }

  private drawRows(ctx: UiContext): void {
    const p = ctx.palette;
    const rows = this.model.rows();
    const { now, renderer } = ctx;
    const width = this.side ? SIDE_ROW_W : ROW_W;
    this.list.draw(
      ctx,
      ROW_X,
      ROW_Y,
      width,
      rows.length,
      ({ box, index, focused }) => {
        const row = rows[index];
        const intro = Math.min(1, Math.max(0, (now - this.listAt - (index - this.list.start) * 30) / INTRO_MS));
        const a = 1 - Math.pow(1 - intro, 3);
        const x = box.x + (1 - a) * 24;
        const y = box.y - (focused ? 3 : 0);
        const cy = y + box.h / 2;
        if (focused) renderer.rect(x, y + 8, box.w, box.h, { fill: [0, 0, 0, 0.16 * a], radius: 14, softness: 16 });
        renderer.rect(x, y, box.w, box.h, {
          fill: withAlpha(focused ? p.select : p.panel, a),
          stroke: withAlpha(focused ? p.accentText : p.rim, a),
          border: focused ? 3 : 1,
          radius: 14,
        });

        // From the right: the age, the rating's chip, a badge (Won, Lost); then the players or the title.
        let right = x + box.w - 18;
        if (row.age) right -= 12 + label(ctx, row.age, right, cy, { size: 15 }, withAlpha(p.muted, a), { align: 'right' });
        if (row.rating) right -= 10 + this.chip(ctx, row.rating.text, right, cy, row.rating.high ? 'high' : 'plain', a, 'right');
        if (row.badge) right -= 10 + this.chip(ctx, row.badge.text, right, cy, row.badge.tone, a, 'right');
        const news = !row.rating && !row.age ? row.detail : row.detail && (row.detail.startsWith('Loading') || row.detail.startsWith("Couldn't")) ? row.detail : '';
        if (news) right -= 12 + label(ctx, news, right, cy, { size: 15, bold: true }, withAlpha(p.muted, a), { align: 'right', maxWidth: this.side ? 220 : 520 });

        const left = x + 20;
        if (row.players && !this.side) this.drawVersus(ctx, row.players, left, right - 16, cy, a);
        else {
          const title = row.players ? `${row.players[0]} vs ${row.players[1]}` : row.title;
          label(ctx, title, left, cy, { size: 19, bold: true }, withAlpha(p.ink, a), { maxWidth: right - left - 16 });
        }
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

  /** The players facing each other around a slanted VS, in the room between `left` and `right`. */
  private drawVersus(ctx: UiContext, players: readonly [string, string], left: number, right: number, cy: number, alpha: number): void {
    const p = ctx.palette;
    const middle = left + (right - left) / 2;
    const style = { size: 20, bold: true };
    const half = (right - left) / 2 - 46;
    label(ctx, players[0], middle - 40, cy, style, withAlpha(p.ink, alpha), { align: 'right', maxWidth: half });
    this.vsChip(ctx, middle, cy, alpha, 1);
    label(ctx, players[1], middle + 40, cy, style, withAlpha(p.ink, alpha), { maxWidth: half });
  }

  /** The VS: white on the accent, slanted like the menu's buttons. */
  private vsChip(ctx: UiContext, cx: number, cy: number, alpha: number, scale: number): void {
    const w = 46 * scale;
    const h = 28 * scale;
    ctx.renderer.rect(cx - w / 2, cy - h / 2, w, h, { fill: withAlpha(ctx.palette.accent, alpha), radius: 7 * scale, skew: SLANT });
    label(ctx, 'VS', cx, cy, { size: Math.round(15 * scale), bold: true }, withAlpha(VS_INK, alpha), { align: 'center' });
  }

  /** A chip (a rating, a badge) ending at `x` (or starting there); its width. */
  private chip(ctx: UiContext, text: string, x: number, cy: number, tone: 'high' | 'plain' | 'good' | 'bad' | 'neutral' | 'live', alpha: number, align: 'left' | 'right'): number {
    const p = ctx.palette;
    const style = { size: 14, bold: true };
    const width = Math.max(tone === 'good' || tone === 'bad' ? BADGE_MIN_W : 0, ctx.text.measure(text, style) + 22);
    const fixed = tone === 'good' || tone === 'bad' ? BADGE_TONES[tone] : null;
    const fill = fixed?.fill ?? (tone === 'high' ? p.teal : tone === 'live' ? p.danger : p.rim);
    const ink = fixed?.ink ?? (tone === 'high' || tone === 'live' ? p.contrast : p.ink);
    const left = align === 'right' ? x - width : x;
    ctx.renderer.rect(left, cy - 13, width, 26, { fill: withAlpha(fill, alpha), radius: 13 });
    label(ctx, text, left + width / 2, cy, style, withAlpha(ink, alpha), { align: 'center' });
    return width;
  }

  /** Beside the list: the focused row's battle, asked for once the focus rests on it. */
  private drawSide(ctx: UiContext, now: number): void {
    const index = this.focusedRow() ?? this.list.start;
    if (index !== this.settle.index) this.settle = { index, at: now, asked: false };
    if (!this.settle.asked && now - this.settle.at > SETTLE_MS) {
      this.settle.asked = true;
      this.model.details?.request(index);
    }
    this.drawDetails(ctx, PANEL, this.model.details?.get(index) ?? null);
  }

  /** Watch Live's box over the list: the battle's details, and what A and B do. */
  private drawPopup(ctx: UiContext, index: number): void {
    const p = ctx.palette;
    menuModal(ctx, POPUP, undefined, 0.6);
    this.drawDetails(ctx, { x: POPUP.x + 20, y: POPUP.y + 20, w: POPUP.w - 40, h: POPUP.h - 90 }, this.model.details?.get(index) ?? null, false);
    const keys: [string, string][] = [['A', this.model.openLabel ?? 'Open'], ['B', 'Close']];
    let x = POPUP.x + POPUP.w - 28;
    for (const [key, text] of [...keys].reverse()) {
      x -= ctx.text.measure(text, { size: 17 });
      label(ctx, text, x, POPUP.y + POPUP.h - 36, { size: 17 }, p.ink);
      x -= 8 + Math.max(36, ctx.text.measure(key, { size: 14, bold: true }) + 14);
      pill(ctx, key, x, POPUP.y + POPUP.h - 36, 28);
      x -= 24;
    }
  }

  /** A battle's details in a panel: the players facing each other, their ratings, both teams, how it stands. */
  private drawDetails(ctx: UiContext, box: { x: number; y: number; w: number; h: number }, state: BattleDetailsState | null, panel = true): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    if (panel) menuPanel(ctx, box);
    if (!state || state.kind !== 'ready') {
      const text = !state || state.kind === 'loading' ? 'Loading the battle…' : state.text;
      label(ctx, text, box.x + box.w / 2, box.y + box.h / 2, { size: 19, bold: state?.kind === 'error' }, state?.kind === 'error' ? p.danger : p.muted, { align: 'center', maxWidth: box.w - 60 });
      return;
    }
    const d = state.details;
    const pad = 26;
    const half = box.w / 2 - pad - 40;
    label(ctx, d.players[0], box.x + pad, box.y + 36, { size: 22, bold: true }, p.ink, { maxWidth: half });
    label(ctx, d.players[1], box.x + box.w - pad, box.y + 36, { size: 22, bold: true }, p.ink, { align: 'right', maxWidth: half });
    this.vsChip(ctx, box.x + box.w / 2, box.y + 36, 1, 1.2);
    this.chip(ctx, d.ratings[0].text, box.x + pad, box.y + 74, d.ratings[0].high ? 'high' : 'plain', 1, 'left');
    this.chip(ctx, d.ratings[1].text, box.x + box.w - pad, box.y + 74, d.ratings[1].high ? 'high' : 'plain', 1, 'right');
    label(ctx, d.format, box.x + box.w / 2, box.y + 74, { size: 14 }, p.muted, { align: 'center', maxWidth: box.w - 300 });

    // The teams: three by two on each side, facing each other.
    const top = box.y + 102;
    const statusH = 52;
    const room = box.h - (top - box.y) - statusH - 24;
    const size = Math.min(96, Math.floor((box.w / 2 - pad - 16) / 3), Math.floor(room / 2));
    // Centred in the room between the ratings and the status.
    const teamsTop = top + Math.max(0, (room - size * 2) / 2);
    const drawTeam = (team: readonly string[], fromRight: boolean): void => {
      for (let i = 0; i < Math.min(6, team.length); i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const sx = fromRight ? box.x + box.w - pad - (3 - col) * size : box.x + pad + col * size;
        const sy = teamsTop + row * size;
        const texture = ctx.images.sprite(team[i], false, ImagePriority.Screen);
        if (!texture) continue;
        const uv = texture.uv ?? [0, 0, 1, 1];
        renderer.rect(sx, sy, size, size, { fill: [1, 1, 1, 1], texture, uv: fromRight ? [uv[2], uv[1], uv[0], uv[3]] : uv });
      }
      if (team.length === 0) label(ctx, 'Not shown yet', fromRight ? box.x + box.w - pad : box.x + pad, teamsTop + 30, { size: 16 }, p.muted, { align: fromRight ? 'right' : 'left' });
    };
    drawTeam(d.teams[0], false);
    drawTeam(d.teams[1], true);
    renderer.rect(box.x + box.w / 2 - 1, teamsTop + 8, 2, size * 2 - 16, { fill: p.rim });

    // How it stands.
    const bar = { x: box.x + pad, y: box.y + box.h - statusH - 16, w: box.w - pad * 2, h: statusH };
    renderer.rect(bar.x, bar.y, bar.w, bar.h, { fill: p.rim, radius: 14 });
    let tx = bar.x + 14;
    if (d.status.chip) tx += 10 + this.chip(ctx, d.status.chip.text, tx, bar.y + bar.h / 2, d.status.chip.tone, 1, 'left');
    label(ctx, d.status.text, tx, bar.y + bar.h / 2, { size: 17, bold: true }, p.ink, { maxWidth: bar.x + bar.w - tx - 14 });
  }

  /** The buttons along the bottom: A, the details' key (Watch Live), B. */
  private drawLegend(ctx: UiContext): void {
    const p = ctx.palette;
    const keys: [string, string][] = [];
    if (this.rowsShown()) keys.push(['A', this.model.openLabel ?? 'Open']);
    const key = this.model.details?.mode === 'popup' ? this.model.details.key : undefined;
    if (key && this.rowsShown()) keys.push([key.label, 'View details']);
    keys.push(['B', 'Back']);
    let x = 1232;
    for (const [k, text] of [...keys].reverse()) {
      x -= ctx.text.measure(text, { size: 18 });
      label(ctx, text, x, LEGEND_Y, { size: 18 }, p.ink);
      x -= 8 + Math.max(36, ctx.text.measure(k, { size: 14, bold: true }) + 14);
      pill(ctx, k, x, LEGEND_Y, 28);
      x -= 24;
    }
  }
}
