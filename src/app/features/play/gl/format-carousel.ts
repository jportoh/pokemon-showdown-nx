import { Rgba, Texture, rgba } from '@core/gl/gl-renderer';
import { Box, UiContext, focusRing, label, paragraph, pill } from '@core/gl/ui/retro-kit';
import { DIM_TINT, CarouselMotion, drawCarouselCard, sideFade } from '@features/play/gl/carousel';
import { PlayableFormat } from '@shared/data/formats';

/** The format picked, in the middle under the bar; the others 600px apart, smaller. */
export const FORMAT_CARD: Box = { x: 340, y: 96, w: 600, h: 120 };
const STEP = 600;
const SIDE_SCALE = 0.8;
/** The card turning over to show the search, and back. */
const FLIP_MS = 420;
const ART = 100;
/** A random format's "?" card: dark on its near-white, in every theme. */
const RANDOM_INK: Rgba = rgba('#0b1016');
/** The right column: how many teams, and the rules. */
const COLUMN_X = 448;

/** A format as its card shows it. */
export interface FormatCard {
  format: PlayableFormat;
  /** The player's teams for it (random formats need none). */
  teams: number;
}

export interface FormatCarouselModel {
  cards: readonly FormatCard[];
  index: number;
  /** The d-pad is on the row (left/right turn it). */
  focused: boolean;
  /** A search is under way: the format can't change. */
  locked: boolean;
  ball: Texture | null;
  /** The search under way, shown on the card's back: since when, and its two lines. */
  search: { since: number; title: string; line: string } | null;
  open: () => void;
  step: (by: 1 | -1) => void;
}

/**
 * The Battle page's formats as a carousel that goes round (FormatCarousel): the one picked in the
 * middle, wide (its kind drawn as Poké Balls or a die, its category, name and line, how many teams
 * there are for it and its rules), its neighbours smaller at the sides. ZL/ZR turn it (the page's
 * call), so do left/right while it has the focus; A opens the list. While searching, the card turns
 * over and shows the search on its back.
 */
export class FormatCarouselView {
  private readonly motion = new CarouselMotion();
  private flip = { at: -Infinity, searching: false };

  draw(ctx: UiContext, model: FormatCarouselModel): void {
    const { now } = ctx;
    const count = model.cards.length;
    this.motion.follow(model.index, count, true, now);
    if (!!model.search !== this.flip.searching) this.flip = { at: now, searching: !!model.search };
    const t = Math.min(1, (now - this.flip.at) / FLIP_MS);
    // 0: the front; 1: turned over.
    const turned = this.flip.searching ? t : 1 - t;

    const box = FORMAT_CARD;
    const focused = ctx.focus.control({
      id: 'format',
      ...box,
      accept: () => !model.locked && model.open(),
      move: (direction) => {
        if (direction !== 'left' && direction !== 'right') return false;
        if (!model.locked) model.step(direction === 'left' ? -1 : 1);
        return true;
      },
    });
    for (const { index, offset } of this.motion.cards(count, true, 1.7)) {
      const middle = Math.abs(offset) < 0.5;
      // The neighbours step back while the card is turned over.
      const fade = middle ? 0 : sideFade(offset, 0.35) + (1 - sideFade(offset, 0.35)) * turned;
      if (fade >= 1) continue;
      drawCarouselCard(ctx, box, offset, STEP, SIDE_SCALE, fade, () => {
        if (middle && turned > 0) this.drawTurning(ctx, model, model.cards[index], turned, focused);
        else this.drawFront(ctx, model.cards[index], middle, middle && focused, model.ball);
      });
    }
    if (count > 1 && !model.locked) this.drawPills(ctx, model);
  }

  private drawFront(ctx: UiContext, card: FormatCard, middle: boolean, focused: boolean, ball: Texture | null): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const box = FORMAT_CARD;
    const { format } = card;
    renderer.rect(box.x, box.y, box.w, box.h, {
      fill: focused ? p.select : p.panel,
      stroke: middle ? p.accentText : p.outline,
      radius: 14,
      border: 3,
    });
    renderer.rect(box.x + 10, box.y + 10, ART, ART, { fill: p.bg, radius: 10 });
    drawFormatArt(ctx, format, box.x + 10 + ART / 2, box.y + 10 + ART / 2, ball);

    const textX = box.x + 128;
    const chipStyle = { size: 11, bold: true };
    const chipW = ctx.text.measure(format.category.toUpperCase(), chipStyle) + 20;
    renderer.rect(textX, box.y + 14, chipW, 22, {
      fill: p.bar,
      stroke: p.outline,
      radius: 6,
      border: 2,
    });
    label(ctx, format.category.toUpperCase(), textX + chipW / 2, box.y + 25, chipStyle, p.accentText, { align: 'center' });
    // A long name steps down a size before it's cut short.
    const nameW = COLUMN_X - 140;
    const size = ctx.text.measure(format.label, { size: 26, bold: true }) > nameW ? 21 : 26;
    label(ctx, format.label, textX, box.y + 60, { size, bold: true }, p.ink, { maxWidth: nameW });
    label(ctx, format.detail, textX, box.y + 92, { size: 15 }, p.muted, {
      maxWidth: COLUMN_X - 140,
    });

    renderer.rect(box.x + COLUMN_X - 16, box.y + 16, 2, box.h - 32, { fill: p.rim });
    const columnW = box.w - COLUMN_X - 16;
    const teams = format.randomTeams ? 'No team needed' : card.teams === 0 ? 'No teams yet' : `${card.teams} team${card.teams === 1 ? '' : 's'}`;
    label(ctx, teams, box.x + COLUMN_X, box.y + 36, { size: 16, bold: true }, format.randomTeams ? p.teal : card.teams === 0 ? p.danger : p.ink, { maxWidth: columnW });
    paragraph(ctx, format.rules, box.x + COLUMN_X, box.y + 54, columnW, 20, { size: 14 }, p.muted, 2);
    if (focused) focusRing(ctx, box, 14);
  }

  /** Turning over: the card narrows to its edge and opens out again on its other side. */
  private drawTurning(ctx: UiContext, model: FormatCarouselModel, card: FormatCard, turned: number, focused: boolean): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const box = FORMAT_CARD;
    const width = box.w * Math.abs(Math.cos(turned * Math.PI));
    const back = turned > 0.5;
    renderer.rect(box.x + (box.w - width) / 2, box.y, width, box.h, {
      fill: back ? p.select : p.panel,
      stroke: p.accentText,
      radius: Math.min(14, width / 2),
      border: 3,
    });
    // The face shows once it's open enough to read.
    if (width < box.w * 0.85) return;
    if (!back) {
      this.drawFront(ctx, card, true, focused, model.ball);
      return;
    }
    const search = model.search;
    if (!search) return;
    if (model.ball) {
      const size = model.ball.width * 3;
      renderer.rect(box.x + 70 - size / 2, box.y + box.h / 2 - size / 2, size, size, {
        fill: [1, 1, 1, 1],
        texture: model.ball,
        angle: now / 260,
      });
    }
    label(ctx, search.title, box.x + 140, box.y + 44, { size: 26, bold: true }, p.ink, {
      maxWidth: box.w - 170,
      fast: true,
    });
    label(ctx, search.line, box.x + 140, box.y + 82, { size: 16 }, p.muted, {
      maxWidth: box.w - 170,
    });
    if (focused) focusRing(ctx, box, 14);
  }

  /** ZL and ZR in the gaps between the cards (a click turns it too). */
  private drawPills(ctx: UiContext, model: FormatCarouselModel): void {
    const cy = FORMAT_CARD.y + FORMAT_CARD.h / 2;
    const keys = [
      { id: 'format-prev', key: 'ZL', x: FORMAT_CARD.x - 48, by: -1 as const },
      { id: 'format-next', key: 'ZR', x: FORMAT_CARD.x + FORMAT_CARD.w + 12, by: 1 as const },
    ];
    for (const key of keys) {
      ctx.focus.control({
        id: key.id,
        x: key.x,
        y: cy - 16,
        w: 36,
        h: 32,
        skip: true,
        accept: () => model.step(key.by),
      });
      pill(ctx, key.key, key.x, cy, 28);
    }
  }
}

/**
 * The format's kind as a picture: a die for random teams, three Poké Balls for a best-of-3 (the third
 * greyed: it may not be needed), two for doubles, one for singles.
 */
function drawFormatArt(ctx: UiContext, format: PlayableFormat, cx: number, cy: number, ball: Texture | null): void {
  const { renderer } = ctx;
  if (format.randomTeams) {
    renderer.rect(cx - 28, cy - 28, 56, 56, {
      fill: [0.96, 0.96, 0.96, 1],
      stroke: RANDOM_INK,
      radius: 10,
      border: 3,
    });
    label(ctx, '?', cx, cy + 1, { size: 38, bold: true }, RANDOM_INK, { align: 'center' });
    return;
  }
  if (!ball) return;
  const balls = (scale: number, count: number, gap: number) => {
    const size = ball.width * scale;
    const left = cx - (count * size + (count - 1) * gap) / 2;
    for (let i = 0; i < count; i++) {
      const tint = count === 3 && i === 2 ? DIM_TINT : ([1, 1, 1, 1] as const);
      renderer.rect(left + i * (size + gap), cy - size / 2, size, size, {
        fill: tint,
        texture: ball,
      });
    }
  };
  if (format.id.endsWith('bo3')) balls(1, 3, 4);
  else if (format.category === 'Doubles') balls(1.5, 2, 4);
  else balls(2.5, 1, 0);
}
