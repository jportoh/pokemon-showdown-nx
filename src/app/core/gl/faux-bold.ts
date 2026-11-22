/**
 * Bold drawn from the regular face, where the font has no bold of its own.
 *
 * The native .nro's engine (nx.js) only has the console's system font at the normal weight: a
 * `bold …` font draws the same regular glyphs (native/app/bold-font.ts makes it resolve to a copy of
 * that face, so it no longer leaks). So bold text is thickened by hand, as browsers synthesize a
 * missing bold: the glyphs are filled and also stroked in the same colour, which grows every stem
 * by the stroke's width. The text keeps its regular advances (measures don't change), so letters sit
 * a little closer; the stroke's overhang fits in the texts' and glyphs' padding (2 stage px).
 *
 * Whether a font needs it is measured once: if bold text comes out exactly as wide as regular text,
 * there's no real bold. In a browser with a real bold face nothing changes.
 */

/** The stroke's width, as a share of the font size (browsers embolden by about this much). */
const STROKE_SHARE = 0.025;
/** The stroke reaches past the glyph by half its width: at most this (stage px), inside the 2 px padding. */
const MAX_OVERHANG = 1.2;

const known = new Map<string, boolean>();

/** Whether `family` has no bold face of its own (bold measures the same as regular), so bold is synthesized. */
export function needsFauxBold(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, family: string): boolean {
  const cached = known.get(family);
  if (cached !== undefined) return cached;
  const sample = 'Pokémon Showdown 0123';
  const font = context.font;
  context.font = `20px ${family}`;
  const regular = context.measureText(sample).width;
  context.font = `bold 20px ${family}`;
  const bold = context.measureText(sample).width;
  context.font = font;
  const needs = regular > 0 && Math.abs(bold - regular) < regular * 0.005;
  known.set(family, needs);
  return needs;
}

/**
 * Fills `text` at (x, y) with the context's font and fill colour, thickened: stroked first in the
 * same colour, `size` being the font size and `scale` the canvas pixels per stage pixel.
 */
export function fillBold(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  scale: number,
): void {
  const width = Math.min(size * STROKE_SHARE, MAX_OVERHANG * 2) * scale;
  if (typeof context.strokeText === 'function') {
    context.lineWidth = width;
    context.lineJoin = 'round';
    context.strokeStyle = context.fillStyle;
    context.strokeText(text, x, y);
  } else {
    // No strokes: struck twice, the second a stroke's width to the right.
    context.fillText(text, x + width, y);
  }
  context.fillText(text, x, y);
}
