import { Align, CanvasFocus, FOCUS_RING, drawText } from '@features/gl-home/gl/canvas-ui';
import { GlRenderer, Rgba, Texture, rgba } from '@features/gl-home/gl/gl-renderer';
import { TextStyle, TextTextures } from '@features/gl-home/gl/gl-textures';
import { GlSprites } from '../gl-sprites';

/** What every part of a canvas screen draws with, for one frame. */
export interface ScreenContext {
  renderer: GlRenderer;
  text: TextTextures;
  images: GlSprites;
  focus: CanvasFocus;
  disc: Texture;
  now: number;
}

/** The battle screen's colours (styles.css's --color-* and the Tailwind ones its DOM used). */
export const INK = {
  white: rgba('#ffffff'),
  header: rgba('#1f2d45'),
  headerBar: rgba('#172238'),
  stage: rgba('#34496b'),
  tab: rgba('#2a3b58'),
  card: rgba('#22304a'),
  panel: rgba('#283040'),
  dark: rgba('#1f2937'),
  gray100: rgba('#f3f4f6'),
  gray200: rgba('#e5e7eb'),
  gray300: rgba('#d1d5db'),
  gray400: rgba('#9ca3af'),
  gray500: rgba('#6b7280'),
  gray600: rgba('#4b5563'),
  gray700: rgba('#374151'),
  sky300: rgba('#7dd3fc'),
  red300: rgba('#fca5a5'),
  red800: rgba('#991b1b'),
  yellow100: rgba('#fef9c3'),
  yellow200: rgba('#fef08a'),
  yellow300: rgba('#fde047'),
  blue300: rgba('#93c5fd'),
  blue700: rgba('#1d4ed8'),
  selected: rgba('#2c4a78'),
  fainted: rgba('#1a2436'),
  green400: rgba('#4ade80'),
} as const;

/** Text with its middle at `cy`. */
export function write(ctx: ScreenContext, value: string, x: number, cy: number, style: TextStyle, color: Rgba, align: Align = 'left', maxWidth?: number): number {
  return drawText(ctx.renderer, ctx.text, value, x, cy, style, color, { align, maxWidth });
}

/** Lines of wrapped text from `top`, `lineHeight` apart, at most `maxLines` (the last cut with an ellipsis). */
export function writeLines(ctx: ScreenContext, value: string, x: number, top: number, width: number, lineHeight: number, style: TextStyle, color: Rgba, maxLines = 99): void {
  const lines = ctx.text.wrap(value, style, width);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = ctx.text.fit(`${shown[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, style, width);
  shown.forEach((line, i) => write(ctx, line, x, top + lineHeight * i + lineHeight / 2, style, color, 'left'));
}

export type ButtonLook = 'primary' | 'plain' | 'disabled';

const BUTTON_LOOK: Record<ButtonLook, { fill: Rgba; border: Rgba; ink: Rgba }> = {
  primary: { fill: INK.blue700, border: INK.blue300, ink: INK.white },
  plain: { fill: INK.gray600, border: INK.gray400, ink: INK.white },
  disabled: { fill: INK.gray700, border: INK.gray600, ink: INK.gray400 },
};

/**
 * A button: declared to the focus (A presses it; a disabled one can't be focused) and drawn as the
 * DOM's, with the yellow ring while focused. Returns whether it has the focus.
 */
export function button(
  ctx: ScreenContext,
  id: string,
  box: { x: number; y: number; w: number; h: number },
  label: string,
  look: ButtonLook,
  accept: () => void,
): boolean {
  const disabled = look === 'disabled';
  const focused = disabled ? false : ctx.focus.control({ id, ...box, accept });
  const { fill, border, ink } = BUTTON_LOOK[look];
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke: border, radius: 6, border: 1 });
  write(ctx, label, box.x + box.w / 2, box.y + box.h / 2, { size: 16, bold: true }, ink, 'center', box.w - 12);
  if (focused) ring(ctx, box, 6);
  return focused;
}

/** The focus ring: 3px of yellow just inside the box. */
export function ring(ctx: ScreenContext, box: { x: number; y: number; w: number; h: number }, radius: number): void {
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: FOCUS_RING, radius, border: 3 });
}

/** A button hint as the header's: "ZR" on a dark chip, then its action. Clickable, never focused by the d-pad. */
export function hint(ctx: ScreenContext, id: string, box: { x: number; y: number; w: number; h: number }, key: string, label: string, active: boolean, accept: () => void): void {
  ctx.focus.control({ id, ...box, accept, skip: true });
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: active ? INK.selected : INK.tab, stroke: active ? INK.sky300 : INK.gray500, radius: 6, border: 1 });
  const keyWidth = ctx.text.measure(key, { size: 14, bold: true }) + 12;
  const labelWidth = ctx.text.measure(label, { size: 14, bold: true });
  const start = box.x + (box.w - keyWidth - 6 - labelWidth) / 2;
  ctx.renderer.rect(start, box.y + box.h / 2 - 10, keyWidth, 20, { fill: INK.header, radius: 2 });
  write(ctx, key, start + keyWidth / 2, box.y + box.h / 2, { size: 14, bold: true }, INK.white, 'center');
  write(ctx, label, start + keyWidth + 6, box.y + box.h / 2, { size: 14, bold: true }, INK.white);
}
