import { Align, CanvasFocus, drawText } from '@core/gl/canvas-ui';
import { GlRenderer, Rgba, Texture, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { TextStyle, TextTextures } from '@core/gl/gl-textures';
import { GlSprites } from '@core/gl/gl-sprites';
import { Palette } from '@core/gl/ui/gl-theme';

/**
 * What every part of a canvas screen draws with, for one frame: the stage's resources, the focus and
 * the theme's palette (Settings' light or dark look), so the menu kit's pieces draw here too.
 */
export interface ScreenContext {
  renderer: GlRenderer;
  text: TextTextures;
  images: GlSprites;
  focus: CanvasFocus;
  disc: Texture;
  palette: Palette;
  now: number;
}

/**
 * The battle's own fixed colours, for what belongs to the battle itself and doesn't follow the theme
 * (the field's marks, white text on a type's colour, HP and status colours). Its menus and buttons use
 * the palette.
 */
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

/**
 * A button in the menu's style: declared to the focus (A presses it; a disabled one can't be focused),
 * round-cornered, the accent for the main one, lit with the accent border while focused. Returns
 * whether it has the focus.
 */
export function button(
  ctx: ScreenContext,
  id: string,
  box: { x: number; y: number; w: number; h: number },
  label: string,
  look: ButtonLook,
  accept: () => void,
): boolean {
  const p = ctx.palette;
  const disabled = look === 'disabled';
  const focused = disabled ? false : ctx.focus.control({ id, ...box, accept });
  const primary = look === 'primary';
  const fill = disabled ? p.disabledFill : primary ? (focused ? p.accentHover : p.accent) : focused ? p.select : p.panel;
  const border = disabled ? p.disabledBorder : focused ? p.accentText : primary ? p.accent : p.rim;
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke: border, radius: 12, border: focused ? 3 : 1 });
  const ink = disabled ? p.disabledInk : primary ? ([1, 1, 1, 1] as Rgba) : p.ink;
  write(ctx, label, box.x + box.w / 2, box.y + box.h / 2, { size: box.h >= 60 ? 22 : 17, bold: true }, ink, 'center', box.w - 16);
  return focused;
}

/** The focus as the menu draws it: an accent border just inside the box. */
export function ring(ctx: ScreenContext, box: { x: number; y: number; w: number; h: number }, radius: number): void {
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: ctx.palette.accentText, radius, border: 3 });
}

/** A controller button's name on a small rounded chip ("ZR"), its middle at `cy`; its width. */
export function keyChip(ctx: ScreenContext, key: string, x: number, cy: number, height = 24, fill?: Rgba, ink?: Rgba): number {
  const p = ctx.palette;
  const width = Math.max(height, ctx.text.measure(key, { size: 13, bold: true }) + 12);
  ctx.renderer.rect(x, cy - height / 2, width, height, { fill: fill ?? p.select, radius: height / 2 });
  write(ctx, key, x + width / 2, cy, { size: 13, bold: true }, ink ?? p.ink, 'center');
  return width;
}

/**
 * A button hint as the header's, in the menu's style: a round button with the controller button's
 * chip ("ZR") and its action. Clickable, never focused by the d-pad (the controller has the button).
 * `held` fills it from the left while its button is held down (hold to confirm).
 */
export function hint(
  ctx: ScreenContext,
  id: string,
  box: { x: number; y: number; w: number; h: number },
  key: string,
  label: string,
  active: boolean,
  accept: () => void,
  look?: { fill: Rgba; border: Rgba; ink?: Rgba },
  held?: { progress: number; color: Rgba },
): void {
  const p = ctx.palette;
  ctx.focus.control({ id, ...box, accept, skip: true });
  const fill = look?.fill ?? (active ? p.select : p.panel);
  const border = look?.border ?? (active ? p.accentText : p.rim);
  const radius = box.h / 2;
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke: border, radius, border: active ? 2 : 1 });
  if (held && held.progress > 0) {
    const width = (box.w - 2) * Math.min(1, held.progress);
    ctx.renderer.rect(box.x + 1, box.y + 1, width, box.h - 2, { fill: held.color, radius: Math.min(radius - 1, width / 2) });
  }
  const ink = look?.ink ?? p.ink;
  const cy = box.y + box.h / 2;
  const keyW = keyChip(ctx, key, box.x + 5, cy, box.h - 8, look ? withAlpha(mixRgba(fill, [0, 0, 0, 1], 0.3), 1) : undefined, look ? ink : undefined);
  write(ctx, label, box.x + keyW + 13, cy, { size: 14, bold: true }, ink, 'left', box.w - keyW - 22);
}
