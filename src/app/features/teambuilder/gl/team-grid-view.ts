import { inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { MAX_TEAM_SIZE, Team } from '@features/teambuilder/models/team';
import { formatLabel } from '@shared/data/formats';
import { EDIT_X, TOP, WHITE, entrance, fadeIn } from './tb-draw';

/** 3 columns of 400x176 cards, 16 apart, three rows shown at a time. */
const COLUMNS = 3;
const CARD_W = 400;
const CARD_H = 176;
const GAP = 16;
const ROWS_SHOWN = 3;
const GRID_Y = TOP + 20;
const ROW_STEP = CARD_H + GAP;
const MINI = 54;
/** How long the grid takes to scroll a row, and the cards to come in, one after another. */
const SCROLL_MS = 180;
const STAGGER_MS = 45;

export function teamCardId(index: number): string {
  return `team-card-${index}`;
}

/** The first card: a new team. */
export const NEW_TEAM_ID = teamCardId(0);

/**
 * The teams, as cards in a grid (the teambuilder's first page, its "boxes"): New team first, then the
 * teams newest first, each with its name, its format, how many Pokémon it has and their sprites. Three
 * rows show at a time: the d-pad past the last one scrolls the grid a row. The cards come in one after
 * another when the grid is shown, and the focused card's Pokémon hop.
 */
export class TeamGridView {
  private readonly dex = inject(ChampionsDex);

  /** The first row shown, and the scroll easing towards it. */
  private firstRow = 0;
  private scroll = { from: 0, at: -Infinity };
  /** When the cards came in (set on the next frame drawn after enter()). */
  private enteredAt: number | null = null;

  constructor(private readonly focus: CanvasFocus) {}

  /** The grid is shown (again): its cards come in. */
  enter(): void {
    this.enteredAt = null;
  }

  /** Focuses a team's card (scrolling to it), or New when it isn't there. */
  focusTeam(teams: readonly Team[], id: string | null): void {
    const index = newestFirst(teams).findIndex((team) => team.id === id);
    this.focusCard(index < 0 ? 0 : index + 1, teams.length + 1);
  }

  /** Focuses a card by its place (0 is New), the nearest there is. */
  focusCard(index: number, count: number): void {
    const card = Math.max(0, Math.min(index, count - 1));
    this.reveal(Math.floor(card / COLUMNS), count);
    this.focus.focus(teamCardId(card));
  }

  /** Whether the focus is on a card. */
  hasFocus(): boolean {
    return (this.focus.focused ?? '').startsWith('team-card-');
  }

  /** Home/End: New, or the oldest team. */
  jump(to: 'first' | 'last', teamCount: number): void {
    this.focusCard(to === 'first' ? 0 : teamCount, teamCount + 1);
  }

  draw(ctx: UiContext, model: { teams: readonly Team[]; create: () => void; open: (id: string) => void }): void {
    const { now } = ctx;
    this.enteredAt ??= now;
    const teams = newestFirst(model.teams);
    const count = teams.length + 1;
    const rows = Math.ceil(count / COLUMNS);
    this.firstRow = Math.max(0, Math.min(this.firstRow, rows - ROWS_SHOWN));
    const offset = this.scrollOffset(now);

    for (let index = 0; index < count; index++) {
      const row = Math.floor(index / COLUMNS);
      const col = index % COLUMNS;
      const y = GRID_Y + (row - offset) * ROW_STEP;
      // Only what's on the page (a row scrolling away goes under the bar and the legend).
      if (y + CARD_H < TOP - 20 || y > GRID_Y + ROWS_SHOWN * ROW_STEP) continue;
      const box = { x: EDIT_X + col * (CARD_W + GAP), y, w: CARD_W, h: CARD_H };
      const shownRow = row >= this.firstRow && row < this.firstRow + ROWS_SHOWN;
      const team = index > 0 ? teams[index - 1] : null;
      // The controls are where the cards end up, so the d-pad goes by the rows shown.
      const focused =
        shownRow &&
        ctx.focus.control({
          id: teamCardId(index),
          ...box,
          y: GRID_Y + (row - this.firstRow) * ROW_STEP,
          accept: () => (team ? model.open(team.id) : model.create()),
          move: (direction) => this.scrollPast(direction, index, count),
        });

      const shown = entrance(now, this.enteredAt, ((row - this.firstRow) * COLUMNS + col) * STAGGER_MS);
      const drawn = { ...box, y: box.y + (1 - shown) * 18 };
      if (team) this.drawTeam(ctx, drawn, team, focused);
      else this.drawNew(ctx, drawn, focused);
      fadeIn(ctx, drawn, shown);
    }

    if (teams.length === 0) {
      label(ctx, 'No teams yet: press A on New team to build one.', EDIT_X + CARD_W + GAP + 8, GRID_Y + CARD_H / 2, { size: 20 }, ctx.palette.muted);
    }
  }

  /** The d-pad past the rows shown: the grid scrolls a row and the focus goes on to the card there. */
  private scrollPast(direction: 'up' | 'down' | 'left' | 'right', index: number, count: number): boolean {
    const row = Math.floor(index / COLUMNS);
    const rows = Math.ceil(count / COLUMNS);
    if (direction === 'down' && row === this.firstRow + ROWS_SHOWN - 1 && row < rows - 1) {
      this.reveal(row + 1, count);
      this.focus.focus(teamCardId(Math.min(index + COLUMNS, count - 1)));
      return true;
    }
    if (direction === 'up' && row === this.firstRow && row > 0) {
      this.reveal(row - 1, count);
      this.focus.focus(teamCardId(index - COLUMNS));
      return true;
    }
    return false;
  }

  /** Scrolls (easing) so the row shows. */
  private reveal(row: number, count: number): void {
    const rows = Math.ceil(count / COLUMNS);
    let first = this.firstRow;
    if (row < first) first = row;
    if (row >= first + ROWS_SHOWN) first = row - ROWS_SHOWN + 1;
    first = Math.max(0, Math.min(first, rows - ROWS_SHOWN));
    if (first === this.firstRow) return;
    this.scroll = { from: this.scrollOffset(performance.now()), at: performance.now() };
    this.firstRow = first;
  }

  /** The row at the top now, in rows (between two while scrolling). */
  private scrollOffset(now: number): number {
    const t = Math.min(1, (now - this.scroll.at) / SCROLL_MS);
    return this.scroll.from + (this.firstRow - this.scroll.from) * (1 - (1 - t) * (1 - t));
  }

  private drawNew(ctx: UiContext, box: Box, focused: boolean): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: p.outline, radius: 12, border: 2 });
    const cx = box.x + box.w / 2;
    const cy = box.y + 66;
    renderer.rect(cx - 28, cy - 28, 56, 56, { fill: p.accent, radius: 28 });
    renderer.rect(cx - 14, cy - 2, 28, 4, { fill: WHITE, radius: 2 });
    renderer.rect(cx - 2, cy - 14, 4, 28, { fill: WHITE, radius: 2 });
    label(ctx, 'New team', cx, box.y + 128, { size: 22, bold: true }, p.ink, { align: 'center' });
    if (focused) focusRing(ctx, box, 12);
  }

  private drawTeam(ctx: UiContext, box: Box, team: Team, focused: boolean): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.outline : p.rim, radius: 12, border: 2 });
    const count = `${team.sets.length}/${MAX_TEAM_SIZE}`;
    const countW = label(ctx, count, box.x + box.w - 20, box.y + 32, { size: 18 }, p.muted, { align: 'right' });
    label(ctx, team.name, box.x + 20, box.y + 32, { size: 24, bold: true }, p.ink, { maxWidth: box.w - 56 - countW });
    label(ctx, shortFormat(team.format), box.x + 20, box.y + 64, { size: 18 }, p.muted, { maxWidth: box.w - 40 });

    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const slot = { x: box.x + 20 + i * (MINI + 8), y: box.y + box.h - 18 - MINI, w: MINI, h: MINI };
      const set = team.sets[i];
      if (!set) {
        renderer.rect(slot.x, slot.y, slot.w, slot.h, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 8, border: 2 });
        continue;
      }
      renderer.rect(slot.x, slot.y, slot.w, slot.h, { fill: p.bg, radius: 8 });
      const form = this.dex.mega(set.species, set.item) ?? this.dex.species(set.species);
      const sprite = form ? ctx.images.sprite(form.sprite, false, ImagePriority.Screen) : null;
      if (!sprite) continue;
      // The focused team's Pokémon hop, one after another.
      const hop = focused ? -3 * Math.abs(Math.sin(now / 260 - i * 0.5)) : 0;
      renderer.rect(slot.x + 1, slot.y + 1 + hop, MINI - 2, MINI - 2, { fill: WHITE, texture: sprite });
    }
    if (focused) focusRing(ctx, box, 12);
  }
}

/** Listed newest first: the team just built is at the top (they're stored in creation order). */
export function newestFirst(teams: readonly Team[]): Team[] {
  return [...teams].reverse();
}

/** "VGC 2026 Reg M-C": the format without its "[Gen 9 Champions]" prefix, so it fits a card. */
export function shortFormat(format: string): string {
  return formatLabel(format).replace(/^\[[^\]]*\]\s*/, '');
}
