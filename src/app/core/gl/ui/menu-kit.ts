import { Rgba, Texture, mixRgba, withAlpha } from '@core/gl/gl-renderer';
import { TextStyle } from '@core/gl/gl-textures';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { UiContext, label } from '@core/gl/ui/retro-kit';

/**
 * The pieces the home menu and the entry screen share, so both read as one place: the lit trainer
 * side, the trainer on their platform with a name plate, slanted buttons with Pokémon drawn on them,
 * chips, and the entry screen's fields, switches and round buttons. Focus is drawn as the menu does:
 * an accentText border, the control lifted a little. `f` is a control's eased focus (0 to 1).
 */

/** The buttons' slant: tan(8°), the top edge to the right of the bottom one. */
export const SLANT = 0.14;
/** The trainer: an 80px sprite at 5x, standing on a platform, with its name plate under it. */
export const TRAINER = { x: 40, y: 112, size: 400 };
export const PLATE = { x: 48, y: 540, w: 400, h: 92 };

export type ChipTone = 'muted' | 'faded' | 'alert' | 'error';
export interface Chip {
  text: string;
  tone: ChipTone;
}

export interface NamePlate {
  name: string;
  status: string;
  chips: readonly Chip[];
}

/** The trainer's side: a deeper tint fading out to the right, and a halo behind them. */
export function drawGround(ctx: UiContext, alpha: number): void {
  const p = ctx.palette;
  ctx.renderer.rect(0, 0, 600, 720, { fill: withAlpha(p.hero, alpha), fillEnd: withAlpha(p.hero, 0) });
  const halo: Rgba = p.appearance === 'light' ? [1, 1, 1, 0.55 * alpha] : withAlpha(p.accentText, 0.22 * alpha);
  ctx.renderer.rect(-100, 140, 640, 640, { fill: halo, radius: 320, softness: 220 });
}

/**
 * The trainer on their platform (ringed while focused), sliding in from the left as `arrive` goes to 1:
 * their avatar, or, with none (offline, unknown, still loading), a big faint Poké Ball. `dim` greys a
 * trainer that isn't anyone yet.
 */
export function drawPlatformTrainer(
  ctx: UiContext,
  options: { avatar: Texture | null; ball: Texture | null; f: number; arrive: number; time: number; dim?: boolean },
): void {
  const p = ctx.palette;
  const { renderer } = ctx;
  const { avatar, ball, f, arrive, time } = options;
  const slide = (1 - arrive) * -60;
  const { x, y, size } = TRAINER;
  const px = x + 40 + slide;
  const py = y + size - 52;
  if (f > 0.01) renderer.rect(px - 10, py - 10, size - 60, 90, { fill: withAlpha(p.accentText, 0.3 * f * arrive), radius: 45, softness: 24 });
  renderer.rect(px, py, size - 80, 70, { fill: withAlpha(p.rim, arrive), radius: 35 });
  renderer.rect(px, py, size - 80, 62, { fill: withAlpha(p.panel, arrive), stroke: withAlpha(p.accentText, f * arrive), border: 4 * f, radius: 31 });
  const bob = Math.sin(time * 4) * 3 * f;
  if (avatar) renderer.rect(x + slide, y - 8 * f + bob, size, size, { fill: [1, 1, 1, arrive * (options.dim ? 0.55 : 1)], texture: avatar });
  else if (ball) renderer.image(ball, x + slide + size / 2 - 96, py - 190 + bob, 8, [1, 1, 1, 0.35 * arrive]);
}

/** The name plate under the trainer: the name, a status beside it, chips under it. */
export function drawNamePlate(ctx: UiContext, plate: NamePlate, arrive: number): void {
  const p = ctx.palette;
  const { renderer } = ctx;
  const slide = (1 - arrive) * -60;
  const { x, y, w, h } = PLATE;
  renderer.rect(x + slide, y + 10, w, h, { fill: [0, 0, 0, 0.22 * arrive], radius: 16, softness: 18 });
  renderer.rect(x + slide, y, w, h, { fill: withAlpha(p.panel, arrive), stroke: withAlpha(p.rim, arrive), border: 1, radius: 16 });
  const width = label(ctx, plate.name, x + 20 + slide, y + 28, { size: 28, bold: true }, withAlpha(p.ink, arrive), { maxWidth: 250 });
  if (plate.status) label(ctx, plate.status, x + 32 + width + slide, y + 30, { size: 15 }, withAlpha(p.muted, arrive), { maxWidth: w - 52 - width });
  let cx = x + 20 + slide;
  for (const chip of plate.chips) cx += drawChip(ctx, chip, cx, y + 66, arrive, 26, x + w - 16 - cx) + 8;
}

/** A rounded chip with a short text; its width. */
export function drawChip(ctx: UiContext, chip: Chip, x: number, cy: number, alpha: number, height: number, maxWidth = 360): number {
  const p = ctx.palette;
  const style: TextStyle = { size: height > 28 ? 16 : 15, bold: true };
  const text = ctx.text.fit(chip.text, style, Math.max(0, maxWidth - 24));
  const width = ctx.text.measure(text, style) + 24;
  const fill = chip.tone === 'alert' ? p.teal : chip.tone === 'error' ? p.danger : p.rim;
  const ink = chip.tone === 'alert' || chip.tone === 'error' ? p.contrast : chip.tone === 'faded' ? p.muted : p.ink;
  ctx.renderer.rect(x, cy - height / 2, width, height, { fill: withAlpha(fill, alpha), radius: height / 2 });
  label(ctx, text, x + 12, cy, style, withAlpha(ink, alpha), { fast: true });
  return width;
}

/** A Pokémon from the bundled sheets, optionally facing the other way. */
export function drawSprite(ctx: UiContext, sprite: string, x: number, y: number, size: number, alpha: number, flip = false): void {
  const texture = ctx.images.sprite(sprite, false, ImagePriority.Screen);
  if (!texture) return;
  const uv = texture.uv ?? [0, 0, 1, 1];
  ctx.renderer.rect(x, y, size, size, { fill: [1, 1, 1, alpha], texture, uv: flip ? [uv[2], uv[1], uv[0], uv[3]] : uv });
}

export interface SlantedButton {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its eased focus. */
  f: number;
  alpha: number;
  title: string;
  titleSize: number;
  /** The title's centre from the top; centred in the button when absent. */
  titleY?: number;
  /** With `titleY`: the chips' centre from the bottom (34 by default). */
  chipBottom?: number;
  icon?: Texture | null;
  /** How much bigger the icon is drawn (2: a 24px menu icon at 48px). */
  iconScale?: number;
  /** The colour the body fades into, at the right. */
  plate: Rgba;
  chips?: readonly Chip[];
  /** Faded (can't be used now): greyed title, faint art. */
  faded?: boolean;
  /** The accent fill and white title: the screen's main action. */
  primary?: boolean;
  /** The Pokémon drawn at its right, cut off by the button: given the box, their alpha and how much they've grown. */
  art?: (box: { x: number; y: number; w: number; h: number }, alpha: number, grow: number) => void;
}

/** A slanted button: its colour, its Pokémon, its icon and title along the slanted edge, its chips at the bottom. */
export function drawSlantedButton(ctx: UiContext, b: SlantedButton): void {
  if (b.alpha <= 0.001) return;
  const p = ctx.palette;
  const { renderer } = ctx;
  const { w, h, f, alpha } = b;
  const x = b.x;
  const y = b.y - 6 * f;
  const edge = (cy: number): number => x - (cy - (y + h / 2)) * SLANT;

  if (f > 0.01 || p.appearance === 'light') {
    renderer.rect(x, y + 12, w, h, { fill: [0, 0, 0, (0.12 + 0.2 * f) * alpha], radius: 14, softness: 22, skew: SLANT });
  }
  const body = b.primary ? mixRgba(p.accent, p.accentHover, f) : mixRgba(p.panel, p.select, f);
  renderer.rect(x, y, w, h, {
    fill: withAlpha(body, alpha),
    fillEnd: withAlpha(b.primary ? body : b.plate, alpha),
    stroke: withAlpha(b.primary ? mixRgba(p.accent, p.accentText, f) : mixRgba(p.rim, p.accentText, f), alpha),
    border: 1 + 3 * f,
    radius: 14,
    skew: SLANT,
  });

  if (b.art) {
    renderer.clip({ x, y: y + 4, w: w - 6, h: h - 8 });
    const rest = p.appearance === 'light' ? 0.8 : 0.55;
    b.art({ x, y, w, h }, alpha * (b.faded ? 0.3 : rest + (1 - rest) * f), 1 + 0.05 * f);
    renderer.clip(null);
  }

  const chips = b.chips ?? [];
  const titleY = y + (b.titleY ?? (chips.length > 0 ? h / 2 - 18 : h / 2));
  let left = edge(titleY) + 26;
  if (b.icon) {
    const scale = b.iconScale ?? 2;
    renderer.image(b.icon, left + 24 - (b.icon.width * scale) / 2, titleY - (b.icon.height * scale) / 2, scale, [1, 1, 1, alpha]);
    left += 60;
  }
  const ink = b.primary ? ([1, 1, 1, 1] as Rgba) : b.faded ? p.muted : p.ink;
  label(ctx, b.title, left, titleY, { size: b.titleSize, bold: true }, withAlpha(ink, alpha), { maxWidth: w - (left - x) - 16 });

  // Under a centred title, or along the bottom when the title has its own place.
  const chipY = b.titleY === undefined ? titleY + 40 : y + h - (b.chipBottom ?? 34);
  let cx = edge(chipY) + 24;
  for (const chip of chips) cx += drawChip(ctx, chip, cx, chipY, alpha, 30, x + w - 40 - cx) + 8;
}

/** A text field as the entry screen draws them: a small caps label over a rounded box; true when focused. */
export function drawField(
  ctx: UiContext,
  id: string,
  box: { x: number; y: number; w: number; h: number },
  options: { label: string; value: string; placeholder: string; masked?: boolean; edit: () => void },
): boolean {
  const p = ctx.palette;
  const focused = ctx.focus.control({ id, ...box, accept: options.edit });
  label(ctx, options.label, box.x + 4, box.y - 16, { size: 14, bold: true }, p.muted);
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.input, stroke: focused ? p.accentText : p.rim, border: focused ? 4 : 2, radius: 12 });
  const shown = options.masked ? '•'.repeat(options.value.length) : options.value;
  const cy = box.y + box.h / 2;
  const style: TextStyle = { size: 22 };
  if (shown) label(ctx, shown, box.x + 18, cy, style, p.ink, { maxWidth: box.w - 150, fast: true });
  else label(ctx, options.placeholder, box.x + 18, cy, style, p.muted, { maxWidth: box.w - 150 });
  if (focused) label(ctx, 'A to type', box.x + box.w - 18, cy, { size: 16 }, p.muted, { align: 'right' });
  return focused;
}

/** An on/off switch with its text; A turns it. */
export function drawSwitch(ctx: UiContext, id: string, x: number, y: number, text: string, on: boolean, accept: () => void): void {
  const p = ctx.palette;
  const width = ctx.text.measure(text, { size: 19, bold: true }) + 100;
  const focused = ctx.focus.control({ id, x, y, w: width, h: 44, accept });
  if (focused) ctx.renderer.rect(x, y, width, 44, { fill: p.select, stroke: p.accentText, border: 3, radius: 12 });
  ctx.renderer.rect(x + 12, y + 7, 54, 30, { fill: on ? p.accent : p.rim, radius: 15 });
  ctx.renderer.rect(x + (on ? 40 : 16), y + 11, 22, 22, { fill: [1, 1, 1, 1], radius: 11 });
  label(ctx, text, x + 80, y + 22, { size: 19, bold: true }, p.ink);
}

/**
 * A box over the page in the menu's style: the page dimmed (its controls out of reach), a soft shadow,
 * the panel fading from `tint` (the hero colour by default) at its left into the panel colour.
 */
export function menuModal(ctx: UiContext, box: { x: number; y: number; w: number; h: number }, tint?: Rgba, dim = 0.65): void {
  const p = ctx.palette;
  ctx.renderer.rect(0, 0, 1280, 720, { fill: withAlpha(p.bg, dim) });
  ctx.focus.trap();
  menuPanel(ctx, box, tint);
}

/** The menu's panel: a soft shadow, the panel fading from `tint` (the hero colour by default) into the panel colour. */
export function menuPanel(ctx: UiContext, box: { x: number; y: number; w: number; h: number }, tint?: Rgba, alpha = 1): void {
  const p = ctx.palette;
  const { renderer } = ctx;
  renderer.rect(box.x, box.y + 14, box.w, box.h, { fill: [0, 0, 0, 0.25 * alpha], radius: 22, softness: 30 });
  renderer.rect(box.x, box.y, box.w, box.h, {
    fill: withAlpha(mixRgba(tint ?? p.hero, p.panel, 0.55), alpha),
    fillEnd: withAlpha(p.panel, alpha),
    stroke: withAlpha(p.rim, alpha),
    border: 1,
    radius: 22,
  });
}

/** A round button with a controller button's name in it ("B Close"): `skip` keeps it off the d-pad's path (the button does it). */
export function drawKeyButton(
  ctx: UiContext,
  id: string,
  box: { x: number; y: number; w: number; h: number },
  key: string,
  text: string,
  accept: () => void,
  skip = true,
): void {
  const p = ctx.palette;
  const focused = ctx.focus.control({ id, ...box, accept, skip });
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.accentText : p.rim, border: focused ? 3 : 1, radius: box.h / 2 });
  const keyW = Math.max(28, ctx.text.measure(key, { size: 14, bold: true }) + 14);
  ctx.renderer.rect(box.x + 12, box.y + box.h / 2 - 14, keyW, 28, { fill: p.select, radius: 6 });
  label(ctx, key, box.x + 12 + keyW / 2, box.y + box.h / 2, { size: 14, bold: true }, p.ink, { align: 'center' });
  label(ctx, text, box.x + 20 + keyW, box.y + box.h / 2, { size: 18, bold: true }, p.ink, { maxWidth: box.w - keyW - 32 });
}

/** A round button with a short text (the entry screen's other ways in). */
export function drawRoundButton(ctx: UiContext, id: string, box: { x: number; y: number; w: number; h: number }, text: string, accept: () => void): void {
  const p = ctx.palette;
  const focused = ctx.focus.control({ id, ...box, accept });
  ctx.renderer.rect(box.x, box.y, box.w, box.h, {
    fill: focused ? p.select : p.panel,
    stroke: focused ? p.accentText : p.rim,
    border: focused ? 3 : 1,
    radius: box.h / 2,
  });
  label(ctx, text, box.x + box.w / 2, box.y + box.h / 2, { size: 19, bold: true }, p.ink, { align: 'center', maxWidth: box.w - 24 });
}
