import { inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { Rgba, withAlpha } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { MAX_TEAM_SIZE, Team } from '@features/teambuilder/models/team';
import { formatLabel } from '@shared/data/formats';
import { BAR_FILL, EDIT_X, TOP, WHITE, arrow, entrance, fadeIn } from './tb-draw';

const BLACK: Rgba = [0, 0, 0, 1];

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

/** A held card is lifted this much, and the cards it passes slide to their new places in SLIDE_MS. */
const LIFT = 10;
const SLIDE_MS = 140;
/** A five-pointed star (a favourite), 9x9. */
const STAR = ['....x....', '...xxx...', '...xxx...', 'xxxxxxxxx', '.xxxxxxx.', '..xxxxx..', '..xxxxx..', '.xxx.xxx.', '.x.....x.'];
const STAR_SCALE = 2;
export const STAR_W = STAR[0].length * STAR_SCALE;

/** Draws the favourite's star (gold over an ink shadow, so it shows on light and dark cards). */
export function favouriteStar(ctx: UiContext, x: number, y: number): void {
  arrow(ctx, STAR, x + 1, y + 2, STAR_SCALE, ctx.palette.ink);
  arrow(ctx, STAR, x, y, STAR_SCALE, BAR_FILL);
}

/**
 * The teams, as cards in a grid (the teambuilder's first page, its "boxes"): New team first, then the
 * teams in the user's order (a new one first), each with its name, its format, how many Pokémon it has
 * and their sprites, and a star on its format's favourite. Three rows show at a time: the d-pad past
 * the last one scrolls the grid a row. The cards come in one after another when the grid is shown, and
 * the focused card's Pokémon hop. ZL picks a team up: the d-pad carries it through the grid (the others
 * make room), A puts it down there and B puts it back.
 */
export class TeamGridView {
  private readonly dex = inject(ChampionsDex);

  /** The first row shown, and the scroll easing towards it. */
  private firstRow = 0;
  private scroll = { from: 0, at: -Infinity };
  /** When the cards came in (set on the next frame drawn after enter()). */
  private enteredAt: number | null = null;
  /** The team picked up, and the order the grid has while it's carried (team IDs, first to last). */
  private moving: { id: string; order: string[] } | null = null;
  /** The cards on their way to a new place: by team ID, the card index they come from and when. */
  private readonly slides = new Map<string, { from: number; at: number }>();

  constructor(private readonly focus: CanvasFocus) {}

  /** The grid is shown (again): its cards come in. */
  enter(): void {
    this.enteredAt = null;
    this.moving = null;
    this.slides.clear();
  }

  /** Whether a team is being carried. */
  isMoving(): boolean {
    return this.moving !== null;
  }

  /** The focused team's ID, or null on New (or off the cards). */
  focusedTeam(teams: readonly Team[]): string | null {
    const focused = this.focus.focused ?? '';
    if (!focused.startsWith('team-card-')) return null;
    return inGridOrder(teams)[Number(focused.slice('team-card-'.length)) - 1]?.id ?? null;
  }

  /** ZL: picks the focused team up; whether there was one. */
  pickUp(teams: readonly Team[]): boolean {
    const id = this.focusedTeam(teams);
    if (!id) return false;
    this.moving = { id, order: inGridOrder(teams).map((team) => team.id) };
    return true;
  }

  /** A or ZL: puts the team down where it is now; returns the grid's new order, to keep. */
  drop(): string[] | null {
    const order = this.moving?.order ?? null;
    this.moving = null;
    return order;
  }

  /** B: the team goes back where it was, and nothing changes. */
  cancel(teams: readonly Team[]): void {
    if (!this.moving) return;
    const { id } = this.moving;
    this.reorder(inGridOrder(teams).map((team) => team.id));
    this.moving = null;
    this.focusTeam(teams, id);
  }

  /** The d-pad while carrying: left/right a place, up/down a row (as far as the grid goes). */
  private carry(direction: 'up' | 'down' | 'left' | 'right'): void {
    const moving = this.moving;
    if (!moving) return;
    const from = moving.order.indexOf(moving.id);
    const by = direction === 'left' ? -1 : direction === 'right' ? 1 : direction === 'up' ? -COLUMNS : COLUMNS;
    const to = Math.max(0, Math.min(from + by, moving.order.length - 1));
    if (to === from) return;
    const order = moving.order.filter((id) => id !== moving.id);
    order.splice(to, 0, moving.id);
    this.reorder(order);
    this.focusCard(to + 1, order.length + 1);
  }

  /** A or a tap on a card while carrying: the team goes to that card's place (New's is the first). */
  private dropAt(index: number): string[] {
    const moving = this.moving!;
    const order = moving.order.filter((id) => id !== moving.id);
    order.splice(Math.max(0, index - 1), 0, moving.id);
    this.reorder(order);
    this.focusCard(order.indexOf(moving.id) + 1, order.length + 1);
    return this.drop() ?? order;
  }

  /** The carried order changes: the cards that move slide from where they were. */
  private reorder(order: string[]): void {
    if (!this.moving) return;
    const now = performance.now();
    order.forEach((id, index) => {
      const from = this.moving!.order.indexOf(id);
      if (from !== index) this.slides.set(id, { from: from + 1, at: now });
    });
    this.moving.order = order;
  }

  /** Focuses a team's card (scrolling to it), or New when it isn't there. */
  focusTeam(teams: readonly Team[], id: string | null): void {
    const index = inGridOrder(teams).findIndex((team) => team.id === id);
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

  /** Home/End: New, or the last team. */
  jump(to: 'first' | 'last', teamCount: number): void {
    this.focusCard(to === 'first' ? 0 : teamCount, teamCount + 1);
  }

  draw(
    ctx: UiContext,
    model: { teams: readonly Team[]; create: () => void; open: (id: string) => void; reorder: (order: string[]) => void },
  ): void {
    const { now } = ctx;
    this.enteredAt ??= now;
    const moving = this.moving;
    const teams = moving ? moving.order.flatMap((id) => model.teams.find((team) => team.id === id) ?? []) : inGridOrder(model.teams);
    const count = teams.length + 1;
    const rows = Math.ceil(count / COLUMNS);
    this.firstRow = Math.max(0, Math.min(this.firstRow, rows - ROWS_SHOWN));
    const offset = this.scrollOffset(now);
    /** Where a card's place is now (the grid scrolling). */
    const place = (index: number) => ({
      x: EDIT_X + (index % COLUMNS) * (CARD_W + GAP),
      y: GRID_Y + (Math.floor(index / COLUMNS) - offset) * ROW_STEP,
    });
    // The card carried goes over the others, so it's drawn last.
    let held: (() => void) | null = null;

    for (let index = 0; index < count; index++) {
      const row = Math.floor(index / COLUMNS);
      const col = index % COLUMNS;
      const box = { ...place(index), w: CARD_W, h: CARD_H };
      // Only what's on the page (a row scrolling away goes under the bar and the legend).
      if (box.y + CARD_H < TOP - 20 || box.y > GRID_Y + ROWS_SHOWN * ROW_STEP) continue;
      const shownRow = row >= this.firstRow && row < this.firstRow + ROWS_SHOWN;
      const team = index > 0 ? teams[index - 1] : null;
      // The controls are where the cards end up, so the d-pad goes by the rows shown.
      const focused =
        shownRow &&
        ctx.focus.control({
          id: teamCardId(index),
          ...box,
          y: GRID_Y + (row - this.firstRow) * ROW_STEP,
          accept: () => {
            if (this.moving) return model.reorder(this.dropAt(index));
            if (team) model.open(team.id);
            else model.create();
          },
          move: (direction) => {
            if (!this.moving) return this.scrollPast(direction, index, count);
            this.carry(direction);
            return true;
          },
        });

      const slide = team ? this.slides.get(team.id) : undefined;
      if (slide) {
        const t = Math.min(1, (now - slide.at) / SLIDE_MS);
        const eased = 1 - (1 - t) * (1 - t);
        const from = place(slide.from);
        box.x = from.x + (box.x - from.x) * eased;
        box.y = from.y + (box.y - from.y) * eased;
        if (t >= 1) this.slides.delete(team!.id);
      }
      const shown = entrance(now, this.enteredAt, ((row - this.firstRow) * COLUMNS + col) * STAGGER_MS);
      const drawn = { ...box, y: box.y + (1 - shown) * 18 };
      if (team && team.id === moving?.id) {
        held = () => this.drawHeld(ctx, drawn, team);
        continue;
      }
      if (team) this.drawTeam(ctx, drawn, team, focused);
      else this.drawNew(ctx, drawn, focused);
      fadeIn(ctx, drawn, shown);
    }
    held?.();

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
    let right = box.x + box.w - 20;
    right -= label(ctx, count, right, box.y + 32, { size: 18 }, p.muted, { align: 'right' });
    if (team.favourite) {
      right -= 12 + STAR_W;
      favouriteStar(ctx, right, box.y + 32 - STAR_W / 2 - 1);
    }
    label(ctx, team.name, box.x + 20, box.y + 32, { size: 24, bold: true }, p.ink, { maxWidth: right - box.x - 36 });
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

  /** The card carried: lifted over a shadow, bobbing a little, ringed in the accent. */
  private drawHeld(ctx: UiContext, box: Box, team: Team): void {
    const bob = 2 * Math.sin(ctx.now / 180);
    ctx.renderer.rect(box.x + 6, box.y + 8, box.w, box.h, { fill: withAlpha(BLACK, 0.35), radius: 12 });
    const lifted = { ...box, y: box.y - LIFT + bob };
    this.drawTeam(ctx, lifted, team, true);
    ctx.renderer.rect(lifted.x - 4, lifted.y - 4, lifted.w + 8, lifted.h + 8, { fill: [0, 0, 0, 0], stroke: ctx.palette.accent, radius: 15, border: 3 });
  }
}

/** The grid's order: the reverse of the stored one (a new team, stored last, shows first; see TeamStore). */
export function inGridOrder(teams: readonly Team[]): Team[] {
  return [...teams].reverse();
}

/** "VGC 2026 Reg M-C": the format without its "[Gen 9 Champions]" prefix, so it fits a card. */
export function shortFormat(format: string): string {
  return formatLabel(format).replace(/^\[[^\]]*\]\s*/, '');
}
