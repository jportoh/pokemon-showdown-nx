import { computed, inject } from '@angular/core';
import { Rgba, rgba } from '@core/gl/gl-renderer';
import { BOX_H, DOUBLES, FIELD_TOP, SINGLES } from '@features/battle/gl/field-layout';
import { FieldCondition, SideId } from '@features/battle/models/battle';
import { BattleStore, parseCondition } from '@features/battle/state/battle-store';
import { conditionColor, conditionTurns } from '@features/battle/state/field-conditions';
import { maskOf } from '@core/gl/ui/masks';
import { INK, ScreenContext, write } from './screen-context';

const BALL = 22;
const BALL_GAP = 6;
const CHIP_H = 34;
/** The balls' pill keeps the same room round them on every side (the end balls sit in its round ends). */
const BALL_PAD = (CHIP_H - BALL) / 2;
const CHIP_GAP = 8;
const MAX_TEAM = 6;
/** A Poké Ball in pixels (drawn twice as big, BALL square): R its red top, W its white bottom and button, o the outline and band. */
const BALL_PIXELS = [
  '...ooooo...',
  '.ooRRRRRoo.',
  '.oRRRRRRRo.',
  'oRRRRRRRRRo',
  'oRRRoooRRRo',
  'ooooowooooo',
  'oWWWoooWWWo',
  'oWWWWWWWWWo',
  '.oWWWWWWWo.',
  '.ooWWWWWoo.',
  '...ooooo...',
];
const pixelsOf = (keys: string): string[] => BALL_PIXELS.map((row) => [...row].map((c) => (keys.includes(c) ? 'x' : '.')).join(''));
const BALL_RED = pixelsOf('R');
const BALL_WHITE = pixelsOf('Ww');
const BALL_INK = pixelsOf('o');
/** Each part's colour: red and white while it can fight, dull greys once it has fainted. */
const BALL_COLORS: Record<'alive' | 'fainted', { top: Rgba; bottom: Rgba; ink: Rgba }> = {
  alive: { top: rgba('#ef4444'), bottom: INK.gray100, ink: INK.dark },
  fainted: { top: INK.gray600, bottom: INK.gray500, ink: INK.dark },
};

type Ball = 'alive' | 'fainted' | 'unseen';

interface StripChip {
  text: string;
  turns: string;
  color: Rgba;
}

/**
 * Over the field, by each side's status boxes: its team as Poké Balls (alive, fainted, not seen yet)
 * and its side's conditions as chips with the turns left (Tailwind 2, Reflect 4); the field's own
 * (weather, terrain, rooms) centred at the top. Battle info (ZR) has the full detail.
 */
export class SideStripView {
  private readonly store = inject(BattleStore);

  private readonly balls = computed<Record<SideId, Ball[]>>(() => {
    const sides = this.store.sides();
    const team = this.store.team();
    const ballsOf = (side: SideId): Ball[] => {
      // Ours, in our own battles: the whole team from the request.
      if (side === 'p1' && team.length > 0 && !this.store.watching()) {
        return team.slice(0, MAX_TEAM).map((pokemon) => (parseCondition(pokemon.condition, 100).fainted ? 'fainted' : 'alive'));
      }
      const { pokemon, teamSize, preview } = sides[side];
      const count = Math.min(MAX_TEAM, teamSize || preview.length || pokemon.length);
      return Array.from({ length: count }, (_, i): Ball => (i < pokemon.length ? (pokemon[i].fainted ? 'fainted' : 'alive') : 'unseen'));
    };
    return { p1: ballsOf('p1'), p2: ballsOf('p2') };
  });

  private readonly chips = computed(() => {
    const field = this.store.field();
    const turn = this.store.turn();
    const toChip = (condition: FieldCondition): StripChip => {
      const turns = conditionTurns(condition, turn);
      return {
        text: condition.name,
        turns: turns ? String(turns.left) : condition.layers > 1 ? `×${condition.layers}` : '',
        color: rgba(conditionColor(condition)),
      };
    };
    return {
      field: [field.weather, field.terrain, ...field.rooms].filter((c): c is FieldCondition => !!c).map(toChip),
      p1: field.sides.p1.map(toChip),
      p2: field.sides.p2.map(toChip),
    };
  });

  /** Where each side's strip goes: under the opponent's boxes, over ours. */
  private readonly places = computed(() => {
    const layout = this.store.gameType() === 'singles' ? SINGLES : DOUBLES;
    const stands = Object.entries(layout.stands);
    const foeBottom = Math.max(...stands.filter(([key]) => key.startsWith('p2')).map(([, s]) => s.boxTop)) + BOX_H;
    const ownTop = Math.min(...stands.filter(([key]) => key.startsWith('p1')).map(([, s]) => s.boxTop));
    return { p2: { x: 24, y: FIELD_TOP + foeBottom + 10 }, p1: { x: 1268, y: FIELD_TOP + ownTop - CHIP_H - 8 } };
  });

  draw(ctx: ScreenContext): void {
    if (!this.store.started()) return;
    const places = this.places();
    const chips = this.chips();
    // The opponent's, from the left: balls then chips.
    let x = places.p2.x;
    x = this.drawBalls(ctx, x, places.p2.y, this.balls().p2);
    for (const chip of chips.p2) x = this.drawChip(ctx, x + CHIP_GAP, places.p2.y, chip, 'left');
    // Ours, from the right: balls then chips leftwards.
    const own = this.balls().p1;
    let right = places.p1.x - this.ballsWidth(own);
    this.drawBalls(ctx, right, places.p1.y, own);
    for (const chip of chips.p1) right = this.drawChip(ctx, right - CHIP_GAP, places.p1.y, chip, 'right');
    // The field's, centred at the top.
    const widths = chips.field.map((chip) => this.chipWidth(ctx, chip));
    let left = 640 - (widths.reduce((sum, w) => sum + w, 0) + CHIP_GAP * Math.max(0, widths.length - 1)) / 2;
    for (const chip of chips.field) left = this.drawChip(ctx, left, FIELD_TOP + 10, chip, 'left') + CHIP_GAP;
  }

  private ballsWidth(balls: Ball[]): number {
    return balls.length === 0 ? 0 : balls.length * (BALL + BALL_GAP) - BALL_GAP + 2 * BALL_PAD;
  }

  /** The balls on a dark pill; returns where it ends. */
  private drawBalls(ctx: ScreenContext, x: number, y: number, balls: Ball[]): number {
    if (balls.length === 0) return x;
    const { renderer } = ctx;
    const width = this.ballsWidth(balls);
    renderer.rect(x, y, width, CHIP_H, { fill: [0.06, 0.09, 0.16, 0.82], radius: CHIP_H / 2 });
    balls.forEach((ball, i) => {
      const bx = x + BALL_PAD + i * (BALL + BALL_GAP);
      const by = y + BALL_PAD;
      if (ball === 'unseen') {
        renderer.rect(bx, by, BALL, BALL, { fill: [0, 0, 0, 0], stroke: INK.gray500, radius: BALL / 2, border: 2 });
        return;
      }
      // A Poké Ball: its top, its bottom, the band and the button (greyed out once fainted).
      const colors = BALL_COLORS[ball];
      renderer.rect(bx, by, BALL, BALL, { fill: colors.top, texture: maskOf(renderer, BALL_RED) });
      renderer.rect(bx, by, BALL, BALL, { fill: colors.bottom, texture: maskOf(renderer, BALL_WHITE) });
      renderer.rect(bx, by, BALL, BALL, { fill: colors.ink, texture: maskOf(renderer, BALL_INK) });
    });
    return x + width;
  }

  private chipWidth(ctx: ScreenContext, chip: StripChip): number {
    const name = ctx.text.measure(chip.text, { size: 18, bold: true });
    const turns = chip.turns ? ctx.text.measure(chip.turns, { size: 18, bold: true }) + 10 : 0;
    return name + turns + 44;
  }

  /** A condition chip from `x` (its left edge, or its right one aligned right); returns its other edge. */
  private drawChip(ctx: ScreenContext, x: number, y: number, chip: StripChip, align: 'left' | 'right'): number {
    const width = this.chipWidth(ctx, chip);
    const left = align === 'left' ? x : x - width;
    ctx.renderer.rect(left, y, width, CHIP_H, { fill: [0.06, 0.09, 0.16, 0.82], stroke: chip.color, radius: CHIP_H / 2, border: 2 });
    ctx.renderer.rect(left + 12, y + CHIP_H / 2 - 6, 12, 12, { fill: chip.color, radius: 6 });
    const nameWidth = write(ctx, chip.text, left + 30, y + CHIP_H / 2, { size: 18, bold: true }, INK.white);
    if (chip.turns) write(ctx, chip.turns, left + 40 + nameWidth, y + CHIP_H / 2, { size: 18, bold: true }, INK.yellow200);
    return align === 'left' ? left + width : left;
  }
}
