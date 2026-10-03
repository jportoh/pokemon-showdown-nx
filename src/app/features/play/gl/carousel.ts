import { Rgba, withAlpha } from '@core/gl/gl-renderer';
import { Box, UiContext } from '@core/gl/ui/retro-kit';

/** How fast a carousel slides to its card: most of the way in about 200 ms. */
const SLIDE_MS = 80;

/**
 * Where a row of cards is on its way to the one picked: a position between cards that eases to the
 * picked index. A carousel that wraps around takes the shortest way (from the last card to the first
 * is one step on), so the neighbours on both sides are always there.
 */
export class CarouselMotion {
  private target = 0;
  private position = 0;
  private last = 0;

  /** The card picked now, of `count`; `wraps` when the row goes round. */
  follow(index: number, count: number, wraps: boolean, now: number): void {
    if (!wraps || count < 1) {
      this.target = index;
    } else {
      const shown = mod(Math.round(this.target), count);
      let by = index - shown;
      if (by > count / 2) by -= count;
      if (by < -count / 2) by += count;
      this.target += by;
      // Back into the first lap (both together, so the slide goes on): steps one way don't pile up.
      const laps = Math.floor(this.target / count) * count;
      this.target -= laps;
      this.position -= laps;
    }
    const dt = this.last ? Math.min(100, now - this.last) : 0;
    this.last = now;
    this.position += (this.target - this.position) * (1 - Math.exp(-dt / SLIDE_MS));
    if (Math.abs(this.target - this.position) < 0.001) this.position = this.target;
  }

  /** Jumps to the card, no slide (another list of cards: a new format's teams). */
  snap(index: number): void {
    this.target = index;
    this.position = index;
  }

  /**
   * The cards to draw, farthest first: each one's index and how many steps it is from the middle
   * (fractions while sliding); only those within `reach` steps. Going round, each card is drawn once,
   * on the side it's nearer: within half the row, so a short row never shows a card on both sides.
   */
  cards(count: number, wraps: boolean, reach: number): { index: number; offset: number }[] {
    const cards: { index: number; offset: number }[] = [];
    const half = count / 2;
    const limit = wraps ? Math.min(reach, half) : reach;
    for (let i = 0; i < count; i++) {
      const offset = wraps ? mod(i - this.position + half, count) - half : i - this.position;
      if (Math.abs(offset) < limit) cards.push({ index: i, offset });
    }
    return cards.sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset));
  }
}

/**
 * Draws a card `offset` steps from the middle: moved `step` px per step, smaller (down to `sideScale`
 * one step away) and faded into the page as it goes. `draw` draws it at its place in the middle.
 */
export function drawCarouselCard(ctx: UiContext, box: Box, offset: number, step: number, sideScale: number, fade: number, draw: () => void): void {
  const { renderer } = ctx;
  const away = Math.min(1, Math.abs(offset));
  const scale = 1 - away * (1 - sideScale);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  renderer.setView(scale, cx + offset * step - cx * scale, cy - cy * scale);
  draw();
  if (fade > 0)
    renderer.rect(box.x - 4, box.y - 4, box.w + 8, box.h + 8, {
      fill: withAlpha(ctx.palette.bg, Math.min(1, fade)),
      radius: 16,
    });
  renderer.setView(1, 0, 0);
}

/** How much a card `offset` steps away fades: none in the middle, `side` one step away, more beyond. */
export function sideFade(offset: number, side: number): number {
  return Math.min(1, Math.abs(offset) * side);
}

export function mod(n: number, count: number): number {
  return ((n % count) + count) % count;
}

/** A Poké Ball's grey for one that doesn't count (the third game of a best-of-3 not yet needed). */
export const DIM_TINT: Rgba = [0.55, 0.6, 0.65, 1];
