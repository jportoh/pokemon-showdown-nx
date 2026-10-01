import { StatTable } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { Rgba } from '@core/gl/gl-renderer';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { MAX_STAT_POINTS, MAX_TOTAL_STAT_POINTS, NATURES, STAT_IDS, STAT_NAMES, calcStat, totalStatPoints } from '@features/teambuilder/data/game-rules';
import { PokemonSet, StatId, StatSpread } from '@features/teambuilder/models/team';
import { BAR_FILL, BAR_FULL, DOWN, LEFT, LOWERED_FILL, LOWERED_INK, RIGHT, SEGMENT_FREE, UP, WHITE, arrow, card, ring, shortcutButton } from './tb-draw';

const FULL_NAMES: Record<StatId, string> = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
/** The natures by name, in order. A set without one battles as Serious (Showdown's default). */
const NATURE_CHOICES = NATURES.map((nature) => nature.name);
const DEFAULT_NATURE = 'Serious';
/** The natures' grid as the games' charts lay it out: a row per stat raised, a column per stat lowered. */
const GRID_STATS: readonly StatId[] = ['atk', 'def', 'spa', 'spd', 'spe'];
const NEUTRAL_NATURES: Partial<Record<StatId, string>> = { atk: 'Hardy', def: 'Docile', spa: 'Bashful', spd: 'Quirky', spe: 'Serious' };
const NATURE_GRID: readonly { name: string; neutral: boolean; row: number; column: number }[] = GRID_STATS.flatMap((plus, row) =>
  GRID_STATS.map((minus, column) => ({
    name: (row === column ? NEUTRAL_NATURES[plus] : NATURES.find((n) => n.plus === plus && n.minus === minus)?.name) ?? '',
    neutral: row === column,
    row,
    column,
  })),
);
const BAR_WIDTH = 152;
const GAUGE_ID = 'stat-gauge';
const NATURE_ID = 'stat-nature';

function rowId(stat: StatId): string {
  return `stat-${stat}`;
}

function cellId(name: string): string {
  return `nature-${name}`;
}

/** What the tab shows and changes. */
export interface StatsModel {
  set: PokemonSet;
  /** The battling form's base stats (a Mega's when it holds its stone); unknown species have none. */
  baseStats: StatTable | undefined;
  points: (spread: StatSpread) => void;
  nature: (name: string) => void;
}

/**
 * The Stats tab (SetStats on the canvas), Pokémon Champions style in the retro palette: six rows (the
 * stat at level 50, a bar for its points out of 32) and the nature under them; beside them, a hint,
 * the panel adjusting one stat, or the natures' grid. A on a row opens the panel on it: a gauge of 32
 * segments that left/right move a point at a time, L empties and R fills as far as the 66 in all
 * allow, up/down move to the other stats; A keeps every change made there and B drops them. A on the
 * nature opens the grid (A picks, B keeps it as it was); left/right step through the natures in place.
 */
export class StatsView {
  /** The stat being adjusted in the panel, or null while it's closed. */
  private editing: StatId | null = null;
  /** The spread as adjusted in the panel, until it's confirmed or dropped. */
  private draft: StatSpread | null = null;
  private choosingNature = false;
  /** The model of the last frame, for the controller's buttons. */
  private model: StatsModel | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  /** Whether the panel or the grid is open (they keep the d-pad and B). */
  get isOpen(): boolean {
    return this.editing !== null || this.choosingNature;
  }

  get adjusting(): boolean {
    return this.editing !== null;
  }

  /** Another slot, or the tab shown again: everything closed. */
  reset(): void {
    this.editing = null;
    this.draft = null;
    this.choosingNature = false;
  }

  focusFirst(): void {
    this.reset();
    this.focus.focus(rowId('hp'));
  }

  /** B: drops the panel's changes, or leaves the nature as it was. */
  back(): void {
    if (this.choosingNature) this.closeNatures();
    else if (this.editing) this.close();
  }

  /** L/R with the panel open: no points, or as many as allowed. */
  pressLR(by: 1 | -1): boolean {
    if (!this.editing) return false;
    this.setPoints(by < 0 ? 0 : MAX_STAT_POINTS);
    return true;
  }

  /** Home/End with the panel open: the same as L/R. */
  jump(to: 'first' | 'last'): boolean {
    return this.pressLR(to === 'first' ? -1 : 1);
  }

  draw(ctx: UiContext, x: number, y: number, model: StatsModel): void {
    this.model = model;
    const p = ctx.palette;
    const spread = this.spread();
    const used = totalStatPoints(spread);
    const fill = used >= MAX_TOTAL_STAT_POINTS ? BAR_FULL : BAR_FILL;
    label(ctx, 'Stat points', x, y + 14, { size: 18, bold: true }, p.muted);
    label(ctx, `${used}/${MAX_TOTAL_STAT_POINTS}`, x + 420, y + 14, { size: 18, bold: true }, p.ink, { align: 'right', fast: true });

    const nature = NATURES.find((n) => n.name === model.set.nature);
    STAT_IDS.forEach((stat, i) => {
      const box = { x, y: y + 36 + i * 68, w: 420, h: 60 };
      const focused = ctx.focus.control({ id: rowId(stat), ...box, accept: () => this.open(stat) });
      card(ctx, box, { active: this.editing === stat, focused });
      const points = pointsOf(spread, stat);
      const base = model.baseStats?.[stat] ?? 0;
      const total = model.baseStats ? calcStat(stat, base, points, model.set.nature) : 0;
      label(ctx, FULL_NAMES[stat], box.x + 14, box.y + 20, { size: 18, bold: true }, p.ink, { maxWidth: 94 });
      label(ctx, `Base ${base}`, box.x + 14, box.y + 44, { size: 12 }, p.muted);
      const sign = nature?.plus === stat ? '+' : nature?.minus === stat ? '−' : '';
      if (sign) {
        ctx.renderer.rect(box.x + 108, box.y + 20, 20, 20, { fill: sign === '+' ? p.accent : LOWERED_FILL, radius: 3 });
        label(ctx, sign, box.x + 118, box.y + 30, { size: 14, bold: true }, WHITE, { align: 'center' });
      }
      label(ctx, String(total), box.x + 188, box.y + 30, { size: 24, bold: true }, p.ink, { align: 'right', fast: true });
      ctx.renderer.rect(box.x + 204, box.y + 22, 156, 16, { fill: p.bar, stroke: p.outline, radius: 2, border: 1 });
      const width = Math.round((points / MAX_STAT_POINTS) * BAR_WIDTH);
      if (width > 0) ctx.renderer.rect(box.x + 206, box.y + 24, width, 12, { fill });
      label(ctx, String(points), box.x + 406, box.y + 30, { size: 18, bold: true }, p.ink, { align: 'right', fast: true });
      ring(ctx, box, focused);
    });
    this.drawNatureRow(ctx, { x, y: y + 452, w: 420, h: 60 });

    const panel = { x: x + 452, y: y + 36, w: 420, h: 400 };
    if (this.choosingNature) this.drawGrid(ctx, panel);
    else if (this.editing) this.drawPanel(ctx, panel, this.editing, spread, used, fill);
    else {
      ctx.renderer.rect(panel.x, panel.y, panel.w, panel.h, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 8, border: 2 });
      const cx = panel.x + panel.w / 2;
      label(ctx, 'Press A on a stat to adjust it.', cx, panel.y + 176, { size: 18 }, p.muted, { align: 'center' });
      label(ctx, `Up to ${MAX_STAT_POINTS} points a stat, ${MAX_TOTAL_STAT_POINTS} in all.`, cx, panel.y + 216, { size: 16 }, p.muted, { align: 'center' });
      label(ctx, 'A on the nature lists them all.', cx, panel.y + 256, { size: 16 }, p.muted, { align: 'center' });
    }
  }

  private drawNatureRow(ctx: UiContext, box: Box): void {
    const p = ctx.palette;
    const focused = ctx.focus.control({
      id: NATURE_ID,
      ...box,
      accept: () => this.openNatures(),
      move: (direction) => {
        if (direction !== 'left' && direction !== 'right') return false;
        this.changeNature(direction === 'right' ? 1 : -1);
        return true;
      },
    });
    card(ctx, box, { active: this.choosingNature, focused });
    const name = this.natureName();
    const nature = NATURES.find((n) => n.name === name);
    label(ctx, 'Nature', box.x + 14, box.y + 30, { size: 14, bold: true }, p.muted);
    arrow(ctx, LEFT, box.x + 92, box.y + 23, 2, p.muted);
    label(ctx, name, box.x + 240, box.y + 20, { size: 20, bold: true }, p.ink, { align: 'center' });
    const effect = nature?.plus && nature.minus ? `+${STAT_NAMES[nature.plus]}  −${STAT_NAMES[nature.minus]}` : 'Neutral';
    label(ctx, effect, box.x + 240, box.y + 44, { size: 12 }, p.muted, { align: 'center' });
    arrow(ctx, RIGHT, box.x + 384, box.y + 23, 2, p.muted);
    ring(ctx, box, focused);
  }

  /** The natures' grid in the panel's place: only its cells take the d-pad. */
  private drawGrid(ctx: UiContext, panel: Box): void {
    const p = ctx.palette;
    ctx.focus.trap();
    ctx.renderer.rect(panel.x, panel.y, panel.w, panel.h, { fill: p.panel, stroke: p.outline, radius: 8, border: 2 });
    label(ctx, 'Nature', panel.x + 16, panel.y + 24, { size: 18, bold: true }, p.ink);
    label(ctx, 'B keeps it', panel.x + 404, panel.y + 24, { size: 14 }, p.muted, { align: 'right' });
    GRID_STATS.forEach((stat, i) => {
      label(ctx, `−${STAT_NAMES[stat]}`, panel.x + 42 + i * 74 + 35, panel.y + 56, { size: 12, bold: true }, LOWERED_INK, { align: 'center' });
      label(ctx, `+${STAT_NAMES[stat]}`, panel.x + 8, panel.y + 70 + i * 64 + 28, { size: 12, bold: true }, p.accentText);
    });
    const current = this.natureName();
    for (const cell of NATURE_GRID) {
      const box = { x: panel.x + 42 + cell.column * 74, y: panel.y + 70 + cell.row * 64, w: 70, h: 56 };
      const focused = ctx.focus.control({ id: cellId(cell.name), ...box, accept: () => this.pickNature(cell.name) });
      const chosen = cell.name === current;
      const fill = chosen || focused ? p.select : cell.neutral ? p.bg : p.button;
      const stroke = chosen ? p.accentText : cell.neutral ? p.rim : p.outline;
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke, radius: 6, border: 2 });
      label(ctx, cell.name, box.x + box.w / 2, box.y + box.h / 2, { size: 14, bold: true }, cell.neutral && !chosen ? p.muted : p.ink, { align: 'center', maxWidth: 66 });
      if (focused) focusRing(ctx, box);
    }
  }

  /** The panel adjusting one stat: only the gauge takes the d-pad (its buttons are for clicks). */
  private drawPanel(ctx: UiContext, panel: Box, stat: StatId, spread: StatSpread, used: number, fill: Rgba): void {
    const p = ctx.palette;
    const model = this.model!;
    const { renderer } = ctx;
    ctx.focus.trap();
    renderer.rect(panel.x, panel.y, panel.w, panel.h, { fill: p.panel, stroke: p.outline, radius: 8, border: 2 });
    const cx = panel.x + 208;
    const points = pointsOf(spread, stat);
    const base = model.baseStats?.[stat] ?? 0;
    const total = model.baseStats ? calcStat(stat, base, points, model.set.nature) : 0;
    const reachable = Math.min(MAX_STAT_POINTS, points + MAX_TOTAL_STAT_POINTS - used);
    const nature = NATURES.find((n) => n.name === model.set.nature);

    this.clickArrow(ctx, 'stat-prev', { x: panel.x + 186, y: panel.y + 8, w: 44, h: 20 }, UP, () => this.step(-1));
    const nameWidth = label(ctx, FULL_NAMES[stat], cx, panel.y + 48, { size: 24, bold: true }, p.ink, { align: 'center' });
    if (nature?.plus === stat) label(ctx, '+', cx + nameWidth / 2 + 6, panel.y + 48, { size: 24, bold: true }, p.accentText);
    if (nature?.minus === stat) label(ctx, '−', cx + nameWidth / 2 + 6, panel.y + 48, { size: 24, bold: true }, LOWERED_INK);
    label(ctx, String(total), cx, panel.y + 90, { size: 48, bold: true }, p.ink, { align: 'center', fast: true });
    this.clickArrow(ctx, 'stat-next', { x: panel.x + 186, y: panel.y + 122, w: 44, h: 20 }, DOWN, () => this.step(1));
    label(ctx, `Total stat points ${used}/${MAX_TOTAL_STAT_POINTS}`, cx, panel.y + 172, { size: 18 }, p.ink, { align: 'center', fast: true });

    this.roundButton(ctx, 'stat-less', { x: panel.x + 12, y: panel.y + 204, w: 40, h: 40 }, LEFT, () => this.adjust(-1));
    const gauge = { x: panel.x + 58, y: panel.y + 200, w: 302, h: 48 };
    const focused = ctx.focus.control({
      id: GAUGE_ID,
      ...gauge,
      accept: () => this.confirm(),
      move: (direction) => {
        if (direction === 'left' || direction === 'right') this.adjust(direction === 'right' ? 1 : -1);
        else this.step(direction === 'down' ? 1 : -1);
        return true;
      },
    });
    renderer.rect(gauge.x, gauge.y, gauge.w, gauge.h, { fill: p.bar, stroke: p.outline, radius: 6, border: 2 });
    for (let i = 0; i < MAX_STAT_POINTS; i++) {
      const color = i < points ? fill : i < reachable ? SEGMENT_FREE : p.bg;
      renderer.rect(gauge.x + 8 + i * 9, gauge.y + 8, 7, 32, { fill: color });
    }
    if (focused) focusRing(ctx, gauge);
    this.roundButton(ctx, 'stat-more', { x: panel.x + 366, y: panel.y + 204, w: 40, h: 40 }, RIGHT, () => this.adjust(1));

    shortcutButton(ctx, 'stat-min', { x: panel.x + 8, y: panel.y + 258, w: 76, h: 30 }, 'L', 'MIN', { size: 14, accept: () => this.setPoints(0) });
    label(ctx, String(points), cx - 8, panel.y + 274, { size: 24, bold: true }, p.ink, { align: 'right', fast: true });
    label(ctx, ` / ${MAX_STAT_POINTS}`, cx - 8, panel.y + 275, { size: 18 }, p.muted);
    shortcutButton(ctx, 'stat-max', { x: panel.x + 332, y: panel.y + 258, w: 76, h: 30 }, 'R', 'MAX', { size: 14, accept: () => this.setPoints(MAX_STAT_POINTS) });

    shortcutButton(ctx, 'stat-cancel', { x: panel.x + 20, y: panel.y + 328, w: 180, h: 48 }, 'B', 'Cancel', { size: 18, accept: () => this.close() });
    shortcutButton(ctx, 'stat-confirm', { x: panel.x + 216, y: panel.y + 328, w: 180, h: 48 }, 'A', 'Confirm', { primary: true, size: 18, accept: () => this.confirm() });
  }

  /** A click-only pixel arrow (the panel's previous and next stat). */
  private clickArrow(ctx: UiContext, id: string, box: Box, rows: readonly string[], accept: () => void): void {
    const focused = ctx.focus.control({ id, ...box, accept, skip: true });
    arrow(ctx, rows, box.x + 15, box.y + 6, 2, focused ? ctx.palette.ink : ctx.palette.muted);
  }

  /** A click-only round button with a pixel arrow (a point less or more). */
  private roundButton(ctx: UiContext, id: string, box: Box, rows: readonly string[], accept: () => void): void {
    const p = ctx.palette;
    const focused = ctx.focus.control({ id, ...box, accept, skip: true });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.button, stroke: p.outline, radius: 20, border: 2 });
    arrow(ctx, rows, box.x + (rows === LEFT ? 12 : 14), box.y + 9, 3, p.ink);
  }

  private spread(): StatSpread {
    return this.draft ?? this.model?.set.evs ?? {};
  }

  private natureName(): string {
    return this.model?.set.nature || DEFAULT_NATURE;
  }

  /** A on a stat: the panel, on it, with the spread as it is. */
  private open(stat: StatId): void {
    if (this.editing === null) this.draft = { ...(this.model?.set.evs ?? {}) };
    this.choosingNature = false;
    this.editing = stat;
    this.focus.focus(GAUGE_ID);
  }

  private adjust(step: 1 | -1): void {
    if (this.editing) this.setPoints(pointsOf(this.spread(), this.editing) + step);
  }

  /** The stat's points, kept within 0–32 and the 66 in all. */
  private setPoints(value: number): void {
    const stat = this.editing;
    if (!stat || !Number.isFinite(value)) return;
    const spread = this.spread();
    const current = pointsOf(spread, stat);
    const reachable = Math.min(MAX_STAT_POINTS, current + MAX_TOTAL_STAT_POINTS - totalStatPoints(spread));
    this.draft = { ...spread, [stat]: Math.max(0, Math.min(value, reachable)) };
  }

  /** Up/down: the previous or next stat (wrapping around). */
  private step(step: 1 | -1): void {
    const index = STAT_IDS.indexOf(this.editing ?? 'hp');
    this.editing = STAT_IDS[(index + step + STAT_IDS.length) % STAT_IDS.length];
  }

  /** A: keeps the changes. */
  private confirm(): void {
    const draft = this.draft;
    this.close();
    if (draft) this.model?.points(draft);
  }

  /** Back to the list, on the stat the panel was on. */
  private close(): void {
    const stat = this.editing ?? 'hp';
    this.editing = null;
    this.draft = null;
    this.focus.focus(rowId(stat));
  }

  private openNatures(): void {
    this.editing = null;
    this.draft = null;
    this.choosingNature = true;
    this.focus.focus(cellId(this.natureName()));
  }

  private pickNature(name: string): void {
    this.closeNatures();
    if (name !== this.model?.set.nature) this.model?.nature(name);
  }

  private closeNatures(): void {
    this.choosingNature = false;
    this.focus.focus(NATURE_ID);
  }

  /** The previous or next nature (wrapping around). */
  private changeNature(step: 1 | -1): void {
    const index = Math.max(0, NATURE_CHOICES.indexOf(this.natureName()));
    this.model?.nature(NATURE_CHOICES[(index + step + NATURE_CHOICES.length) % NATURE_CHOICES.length]);
  }
}

function pointsOf(spread: StatSpread, stat: StatId): number {
  const value = spread[stat];
  return Number.isFinite(value) ? (value as number) : 0;
}
