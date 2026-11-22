import { StatTable } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { Box, UiContext, label, modal } from '@core/gl/ui/retro-kit';
import { menuFocus } from '@core/gl/ui/menu-kit';
import { MAX_STAT_POINTS, MAX_TOTAL_STAT_POINTS, NATURES, STAT_IDS, STAT_NAMES, calcStat, totalStatPoints } from '@features/teambuilder/data/game-rules';
import { PokemonSet, StatId, StatSpread } from '@features/teambuilder/models/team';
import { BAR_FILL, BAR_FULL, LEFT, LOWERED_FILL, RIGHT, WHITE, arrow, card, ring } from './tb-draw';

const FULL_NAMES: Record<StatId, string> = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
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
const NATURE_ID = 'stat-nature';
const CELL_PREFIX = 'nature-';

function rowId(stat: StatId): string {
  return `stat-${stat}`;
}

function cellId(name: string): string {
  return CELL_PREFIX + name;
}

/** What the tab shows and changes. */
export interface StatsModel {
  set: PokemonSet;
  /** The battling form's base stats (a Mega's when it holds its stone); unknown species have none. */
  baseStats: StatTable | undefined;
  /** A line about the form it battles as ("Mega Evolves into…"), or ''. */
  note: string;
  points: (spread: StatSpread) => void;
  nature: (name: string) => void;
}

/**
 * The Stats tab (SetStats on the canvas), Pokémon Champions style in the retro palette, beside the
 * compact card: six full-width rows (the stat at level 50, a gauge of its 32 points) under the points
 * spent and the nature. The focused row is edited as it is: left/right move a point at a time (held,
 * faster and faster), kept at once; A fills it as far as the 66 in all allow, or empties it when full.
 * ZL undoes everything changed since the tab opened. A on the nature opens the natures' grid in a
 * modal (A picks, B keeps it as it was), showing what the focused one would change.
 */
export class StatsView {
  private choosingNature = false;
  /** The spread when the tab opened, for undoing; null until the first frame shows it. */
  private initial: StatSpread | null = null;
  /** The model of the last frame, for the controller's buttons. */
  private model: StatsModel | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  /** Whether the natures are open (they keep the d-pad and B). */
  get isOpen(): boolean {
    return this.choosingNature;
  }

  /** The nature focused in the grid, for the legend. */
  get focusedNature(): string {
    const id = this.focus.focused ?? '';
    return id.startsWith(CELL_PREFIX) ? id.slice(CELL_PREFIX.length) : '';
  }

  get currentNature(): string {
    return this.natureName();
  }

  /** What A does on the focused row ("Max", "Empty"), or '' when it's not on a row. */
  get rowAction(): string {
    const stat = this.focusedStat();
    if (!stat) return '';
    return this.isFilled(stat) ? 'Empty' : 'Max';
  }

  /** Whether the points differ from when the tab opened (ZL undoes them). */
  get canUndo(): boolean {
    return !!this.initial && STAT_IDS.some((stat) => pointsOf(this.initial!, stat) !== pointsOf(this.spread(), stat));
  }

  /** Another slot, or the tab shown again: the natures closed, and what's undone starts over. */
  reset(): void {
    this.choosingNature = false;
    this.initial = null;
  }

  focusFirst(): void {
    this.reset();
    this.focus.focus(rowId('hp'));
  }

  /** B: leaves the nature as it was. */
  back(): void {
    if (this.choosingNature) this.closeNatures();
  }

  /** ZL: the points as they were when the tab opened. */
  undo(): boolean {
    if (!this.canUndo) return false;
    this.model?.points({ ...this.initial! });
    return true;
  }

  /** Home/End on a row: no points, or as many as allowed. */
  jump(to: 'first' | 'last'): boolean {
    const stat = this.focusedStat();
    if (!stat) return false;
    this.setPoints(stat, to === 'first' ? 0 : MAX_STAT_POINTS);
    return true;
  }

  draw(ctx: UiContext, area: Box, model: StatsModel): void {
    this.model = model;
    this.initial ??= { ...(model.set.evs ?? {}) };
    const p = ctx.palette;
    const used = totalStatPoints(this.spread());
    const natureBox = { x: area.x + area.w - 440, y: area.y, w: 440, h: 56 };
    this.drawPointsTotal(ctx, area.x, area.y + 16, used);
    if (model.note) label(ctx, model.note, area.x, area.y + 44, { size: 16 }, p.muted, { maxWidth: natureBox.x - area.x - 16 });
    this.drawNatureButton(ctx, natureBox);
    STAT_IDS.forEach((stat, i) => this.drawRow(ctx, { x: area.x, y: area.y + 64 + i * 76, w: area.w, h: 70 }, stat, used));
    if (this.choosingNature) this.drawNatures(ctx);
  }

  private drawRow(ctx: UiContext, box: Box, stat: StatId, used: number): void {
    const p = ctx.palette;
    const model = this.model!;
    const focused = ctx.focus.control({
      id: rowId(stat),
      ...box,
      accept: () => this.setPoints(stat, this.isFilled(stat) ? 0 : MAX_STAT_POINTS),
      move: (direction) => {
        if (direction !== 'left' && direction !== 'right') return false;
        this.setPoints(stat, pointsOf(this.spread(), stat) + (direction === 'right' ? 1 : -1));
        return true;
      },
    });
    // A click on its arrows (web) focuses them: the row still counts as focused.
    const active = focused || this.focusedStat() === stat;
    card(ctx, box, { focused: active });
    const points = pointsOf(this.spread(), stat);
    const base = model.baseStats?.[stat] ?? 0;
    const total = model.baseStats ? calcStat(stat, base, points, this.natureName()) : 0;
    label(ctx, FULL_NAMES[stat], box.x + 20, box.y + 24, { size: 24, bold: true }, p.ink, { maxWidth: 130 });
    label(ctx, `Base ${base}`, box.x + 20, box.y + 52, { size: 18 }, p.muted, { fast: true });
    this.signBadge(ctx, stat, box.x + 160, box.y + 21, 28);
    label(ctx, String(total), box.x + 272, box.y + box.h / 2, { size: 34, bold: true }, p.ink, { align: 'right', fast: true });
    const bar = { x: box.x + 318, y: box.y + 15, w: 500, h: 40 };
    // The focused row shows its arrows (clickable on the web) and how far its points can go.
    if (active) {
      this.clickArrow(ctx, `${rowId(stat)}-less`, { x: bar.x - 30, y: bar.y + 4, w: 24, h: 32 }, LEFT, () => this.setPoints(stat, points - 1));
      this.clickArrow(ctx, `${rowId(stat)}-more`, { x: bar.x + bar.w + 8, y: bar.y + 4, w: 24, h: 32 }, RIGHT, () => this.setPoints(stat, points + 1));
    }
    this.gauge(ctx, bar, points, active ? this.reachable(stat) : 0, used);
    label(ctx, String(points), box.x + 904, box.y + box.h / 2, { size: 28, bold: true }, p.ink, { align: 'right', fast: true });
    label(ctx, '/32', box.x + 908, box.y + box.h / 2 + 3, { size: 18 }, p.muted);
    ring(ctx, box, active);
  }

  private drawPointsTotal(ctx: UiContext, x: number, cy: number, used: number): void {
    const p = ctx.palette;
    const width = label(ctx, 'Stat points', x, cy, { size: 20 }, p.muted);
    const value = label(ctx, String(used), x + width + 14, cy, { size: 28, bold: true }, used >= MAX_TOTAL_STAT_POINTS ? BAR_FULL : p.ink, { fast: true });
    label(ctx, ` / ${MAX_TOTAL_STAT_POINTS}`, x + width + 14 + value, cy + 3, { size: 20 }, p.muted);
  }

  /** The 32 points as segments: spent, still reachable (on the focused row), or out of reach. */
  private gauge(ctx: UiContext, box: Box, points: number, reachable: number, used: number): void {
    const p = ctx.palette;
    const pad = 6;
    const gap = 3;
    const fill = used >= MAX_TOTAL_STAT_POINTS ? BAR_FULL : BAR_FILL;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.input, stroke: p.outline, radius: 4, border: 2 });
    const size = (box.w - pad * 2 - gap * (MAX_STAT_POINTS - 1)) / MAX_STAT_POINTS;
    for (let i = 0; i < MAX_STAT_POINTS; i++) {
      const color = i < points ? fill : i < reachable ? ctx.palette.segmentFree : p.button;
      ctx.renderer.rect(box.x + pad + i * (size + gap), box.y + pad, size, box.h - pad * 2, { fill: color });
    }
  }

  private drawNatureButton(ctx: UiContext, box: Box): void {
    const p = ctx.palette;
    const focused = ctx.focus.control({ id: NATURE_ID, ...box, accept: () => this.openNatures() });
    card(ctx, box, { active: this.choosingNature, focused });
    const name = this.natureName();
    const nature = NATURES.find((n) => n.name === name);
    const cy = box.y + box.h / 2;
    let x = box.x + 16;
    x += label(ctx, 'Nature', x, cy, { size: 18 }, p.muted) + 14;
    x += label(ctx, name, x, cy, { size: 24, bold: true }, p.ink) + 14;
    if (nature?.plus && nature.minus) {
      x += label(ctx, `+${STAT_NAMES[nature.plus]}`, x, cy, { size: 18, bold: true }, p.accentText) + 10;
      label(ctx, `−${STAT_NAMES[nature.minus]}`, x, cy, { size: 18, bold: true }, ctx.palette.lowered);
    } else label(ctx, 'Neutral', x, cy, { size: 18 }, p.muted);
    ring(ctx, box, focused);
  }

  /** The natures' grid in a modal; above it, what the focused one would change at these points. */
  private drawNatures(ctx: UiContext): void {
    const p = ctx.palette;
    const box = { x: 150, y: 90, w: 980, h: 540 };
    modal(ctx, box, 0.75);
    label(ctx, 'Nature', box.x + 28, box.y + 42, { size: 30, bold: true }, p.ink);
    this.drawChanges(ctx, box.x + box.w - 28, box.y + 42);

    const left = box.x + 28;
    const top = box.y + 80;
    const header = 96;
    const gap = 8;
    const cellW = (box.w - 56 - header - gap * GRID_STATS.length) / GRID_STATS.length;
    const cellH = 72;
    GRID_STATS.forEach((stat, i) => {
      label(ctx, `−${STAT_NAMES[stat]}`, left + header + gap + i * (cellW + gap) + cellW / 2, top + 16, { size: 20, bold: true }, ctx.palette.lowered, { align: 'center' });
      label(ctx, `+${STAT_NAMES[stat]}`, left, top + 40 + i * (cellH + gap) + cellH / 2, { size: 20, bold: true }, p.accentText);
    });
    const current = this.natureName();
    for (const cell of NATURE_GRID) {
      const cellBox = { x: left + header + gap + cell.column * (cellW + gap), y: top + 40 + cell.row * (cellH + gap), w: cellW, h: cellH };
      const focused = ctx.focus.control({ id: cellId(cell.name), ...cellBox, accept: () => this.pickNature(cell.name) });
      const chosen = cell.name === current;
      const fill = focused ? p.select : cell.neutral ? p.bg : p.button;
      const stroke = chosen ? p.accentText : cell.neutral ? p.rim : p.outline;
      ctx.renderer.rect(cellBox.x, cellBox.y, cellBox.w, cellBox.h, { fill, stroke, radius: 8, border: chosen ? 3 : 2 });
      label(ctx, cell.name, cellBox.x + cellW / 2, cellBox.y + cellH / 2, { size: 24, bold: true }, cell.neutral && !chosen ? p.muted : p.ink, { align: 'center', maxWidth: cellW - 12 });
      if (focused) menuFocus(ctx, cellBox, 8);
    }
  }

  /** "Attack 200 → 182", "Speed 154 → 169": the stats the focused nature changes, right-aligned at `right`. */
  private drawChanges(ctx: UiContext, right: number, cy: number): void {
    const p = ctx.palette;
    const model = this.model!;
    const next = this.focusedNature;
    const current = this.natureName();
    if (!next || !model.baseStats) return;
    if (next === current) {
      label(ctx, 'Current nature', right, cy, { size: 20 }, p.muted, { align: 'right' });
      return;
    }
    const spread = this.spread();
    const changes = STAT_IDS.map((stat) => {
      const base = model.baseStats![stat];
      const points = pointsOf(spread, stat);
      return { stat, from: calcStat(stat, base, points, current), to: calcStat(stat, base, points, next) };
    }).filter((change) => change.from !== change.to);
    if (changes.length === 0) {
      label(ctx, 'No change', right, cy, { size: 20 }, p.muted, { align: 'right' });
      return;
    }
    let x = right;
    for (const change of [...changes].reverse()) {
      const text = `${FULL_NAMES[change.stat]} ${change.from} → ${change.to}`;
      const width = ctx.text.measure(text, { size: 20, bold: true }) + 28;
      x -= width;
      ctx.renderer.rect(x, cy - 18, width, 36, { fill: p.bg, radius: 6 });
      label(ctx, text, x + 14, cy, { size: 20, bold: true }, change.to > change.from ? p.accentText : ctx.palette.lowered);
      x -= 10;
    }
    label(ctx, 'Changes', x - 6, cy, { size: 20 }, p.muted, { align: 'right' });
  }

  /** The nature's + or − on a stat, in a badge. */
  private signBadge(ctx: UiContext, stat: StatId, x: number, y: number, size: number): void {
    const nature = NATURES.find((n) => n.name === this.natureName());
    const sign = nature?.plus === stat ? '+' : nature?.minus === stat ? '−' : '';
    if (!sign) return;
    ctx.renderer.rect(x, y, size, size, { fill: sign === '+' ? ctx.palette.accent : LOWERED_FILL, radius: 4 });
    label(ctx, sign, x + size / 2, y + size / 2, { size: size - 8, bold: true }, WHITE, { align: 'center' });
  }

  /** A click-only pixel arrow (a point less or more). */
  private clickArrow(ctx: UiContext, id: string, box: Box, rows: readonly string[], accept: () => void): void {
    const focused = ctx.focus.control({ id, ...box, accept, skip: true });
    arrow(ctx, rows, box.x + 4, box.y + 2, 4, focused ? ctx.palette.accentText : ctx.palette.ink);
  }

  /** The stat whose row has the focus (or whose arrow was clicked), or null. */
  private focusedStat(): StatId | null {
    const id = this.focus.focused ?? '';
    return STAT_IDS.find((stat) => id === rowId(stat) || id.startsWith(`${rowId(stat)}-`)) ?? null;
  }

  /** The most the stat can have: 32, or what the 66 in all leave it. */
  private reachable(stat: StatId): number {
    const spread = this.spread();
    return Math.min(MAX_STAT_POINTS, pointsOf(spread, stat) + MAX_TOTAL_STAT_POINTS - totalStatPoints(spread));
  }

  /** Whether the stat has all it can have (A then empties it), and that's something. */
  private isFilled(stat: StatId): boolean {
    const points = pointsOf(this.spread(), stat);
    return points > 0 && points >= this.reachable(stat);
  }

  private spread(): StatSpread {
    return this.model?.set.evs ?? {};
  }

  private natureName(): string {
    return this.model?.set.nature || DEFAULT_NATURE;
  }

  /** The stat's points, kept within 0–32 and the 66 in all, kept at once. */
  private setPoints(stat: StatId, value: number): void {
    if (!this.model || !Number.isFinite(value)) return;
    const spread = this.spread();
    const points = Math.max(0, Math.min(value, this.reachable(stat)));
    if (points !== pointsOf(spread, stat)) this.model.points({ ...spread, [stat]: points });
  }

  private openNatures(): void {
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
}

function pointsOf(spread: StatSpread, stat: StatId): number {
  const value = spread[stat];
  return Number.isFinite(value) ? (value as number) : 0;
}
