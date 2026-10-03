import { speciesInfo } from '@core/dex/species';
import { Rgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { Palette } from '@core/gl/ui/gl-theme';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { MovePill, SheetRow } from '@features/battle/gl/screen/sheet-rows';
import { typeColor } from '@shared/data/type-colors';
import { INK, ScreenContext, ring, write } from './screen-context';

/**
 * Team preview face to face, shared by our team select and a spectator's view of both teams: the
 * stage under the top bar split on a diagonal, the left side's six as icons down its edge and the
 * right side's down the other, the one in focus on each side big in the middle over a card with its set.
 */
export const TOP = 44;
export const SLOTS = 6;
export const ICON = 88;
export const ICON_STEP = 96;
export const ICON_TOP = 56;
export const LEFT_COLUMN = 16;
export const RIGHT_COLUMN = 1176;
/** The seam between the halves runs from the top's (700, 44) to the foot's (580, 720). */
const SEAM_ANGLE = Math.atan2(120, 676);
const SEAM_MID = { x: 640, y: 382 };
/** Each side's Pokémon in focus, big, over its card. */
const HERO = { left: { x: 340, size: 288 }, right: { x: 940, size: 256 }, feetY: 400 };
export const CARD = { left: 124, right: 716, y: 432, w: 440, h: 168 };
const SWAP_MS = 280;

export type FaceSide = 'left' | 'right';

export type IconBox = { x: number; y: number; w: number; h: number };

/** One Pokémon as its side's big card shows it. */
export interface HeroSet {
  sprite: string;
  name: string;
  types: readonly string[];
  /** Item, ability and moves: always ours; someone else's only from an open team sheet. */
  set: { item: string; itemId: string; ability: string; moves: readonly MovePill[] } | null;
  /** Without their sheet: the abilities it may have. */
  abilities: string;
  speed: number | null;
}

/** A team preview row (`|poke|` plus the open sheet, if any) as a hero card. */
export function heroFromRow(row: SheetRow): HeroSet {
  const info = speciesInfo(row.name);
  return {
    sprite: row.sprite,
    name: row.name,
    types: info?.types ?? [],
    set: row.sheet,
    abilities: info ? info.abilities.filter(Boolean).join(' / ') : '',
    speed: info?.baseStats.spe ?? null,
  };
}

/** The icon box of a side's i-th Pokémon. */
export function iconBox(side: FaceSide, i: number): IconBox {
  return { x: side === 'left' ? LEFT_COLUMN : RIGHT_COLUMN, y: ICON_TOP + i * ICON_STEP, w: ICON, h: ICON };
}

/** A side's edge colour: the left in the theme's accent, the right in red. */
function edgeColor(p: Palette, side: FaceSide): Rgba {
  return side === 'left' ? p.accentText : INK.red300;
}

/** The two halves' tints, cut by a diagonal seam of light (pulsing while `pulse`). */
export function drawHalves(ctx: ScreenContext, p: Palette, pulse: boolean): void {
  const { renderer } = ctx;
  const size = 1400;
  const dx = (size / 2) * Math.cos(SEAM_ANGLE);
  const dy = (size / 2) * Math.sin(SEAM_ANGLE);
  renderer.rect(0, TOP, 1280, 720 - TOP, { fill: p.bg });
  renderer.clip({ x: 0, y: TOP, w: 1280, h: 720 - TOP });
  renderer.rect(SEAM_MID.x - dx - size / 2, SEAM_MID.y - dy - size / 2, size, size, { fill: withAlpha(p.accent, 0.22), angle: SEAM_ANGLE });
  renderer.rect(SEAM_MID.x + dx - size / 2, SEAM_MID.y + dy - size / 2, size, size, { fill: withAlpha(INK.red800, 0.28), angle: SEAM_ANGLE });
  const glow = pulse ? 0.6 + 0.3 * Math.sin(ctx.now / 300) : 0.45;
  renderer.rect(SEAM_MID.x - 14, SEAM_MID.y - 360, 28, 720, { fill: withAlpha(p.teal, glow * 0.35), angle: SEAM_ANGLE, softness: 12, additive: true });
  renderer.rect(SEAM_MID.x - 3, SEAM_MID.y - 360, 6, 720, { fill: withAlpha(p.teal, glow), angle: SEAM_ANGLE });
  renderer.clip(null);
  write(ctx, 'VS', 640, 300, { size: 64, bold: true }, p.teal, 'center');
}

/** A column's icon: the one shown big is lit; `badge` is its place in the order picked. */
export function drawIcon(
  ctx: ScreenContext,
  p: Palette,
  box: IconBox,
  set: HeroSet,
  side: FaceSide,
  shown: boolean,
  focused: boolean,
  badge: { order: number; lead: boolean } | null,
  dim: boolean,
): void {
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: shown ? p.select : p.panel, stroke: shown ? edgeColor(p, side) : p.rim, radius: 10, border: shown ? 3 : 2 });
  drawSprite(ctx, set.sprite, box.x + 2, box.y + 2, box.w - 4, side === 'left', dim ? 0.45 : 1);
  if (badge) drawBadge(ctx, p, box.x + box.w - 14, box.y + 14, 13, badge.order, badge.lead);
  if (focused) ring(ctx, box, 10);
}

/** A side's Pokémon in focus: big on its platform, sliding in from its column (since `since`), over its card. */
export function drawHero(ctx: ScreenContext, p: Palette, set: HeroSet, side: FaceSide, since: number, active: boolean): void {
  const { renderer } = ctx;
  const edge = edgeColor(p, side);
  const hero = HERO[side];
  const t = easeOut(Math.min(1, Math.max(0, (ctx.now - since) / SWAP_MS)));
  const slide = (side === 'left' ? -1 : 1) * 70 * (1 - t);
  renderer.rect(hero.x - 150, HERO.feetY - 28, 300, 56, { fill: withAlpha(edge, active ? 0.55 : 0.25), texture: ctx.disc });
  renderer.rect(hero.x - 144, HERO.feetY - 24, 288, 48, { fill: withAlpha(p.bg, 0.85), texture: ctx.disc });
  drawSprite(ctx, set.sprite, hero.x - hero.size / 2 + slide, HERO.feetY - hero.size + 8, hero.size, side === 'left', (0.3 + 0.7 * t) * (active ? 1 : 0.7));

  const x = CARD[side];
  const { y, w, h } = CARD;
  renderer.rect(x, y, w, h, { fill: p.panel, stroke: active ? edge : p.rim, radius: 12, border: active ? 3 : 2 });
  write(ctx, set.name, x + 16, y + 24, { size: 22, bold: true }, p.ink, 'left', w - 32 - set.types.length * 80);
  set.types.forEach((type, i) => {
    const left = x + w - 16 - (set.types.length - i) * 80;
    renderer.rect(left, y + 12, 74, 24, { fill: rgba(typeColor(type) || '#4b5563'), radius: 4 });
    write(ctx, type.toUpperCase(), left + 37, y + 24, { size: 12, bold: true }, INK.white, 'center', 70);
  });
  const speed = set.speed !== null ? `Base Spe ${set.speed}` : '';
  if (!set.set) {
    write(ctx, set.abilities, x + 16, y + 56, { size: 16 }, p.muted, 'left', w - 32);
    write(ctx, speed, x + 16, y + 82, { size: 16 }, p.muted, 'left', w - 32);
    write(ctx, 'No open team sheet: item and moves unknown', x + 16, y + 130, { size: 14 }, p.muted, 'left', w - 32);
    return;
  }
  ctx.images.drawItem(set.set.itemId, x + 12, y + 44, 24);
  const info = [set.set.item, set.set.ability, speed].filter(Boolean).join(' · ');
  write(ctx, info, x + 40, y + 56, { size: 15 }, p.muted, 'left', w - 56);
  set.set.moves.forEach((move, i) => {
    const left = x + 16 + (i % 2) * 208;
    const top = y + 76 + Math.floor(i / 2) * 44;
    renderer.rect(left, top, 200, 38, { fill: rgba(move.color || '#4b5563'), radius: 6 });
    write(ctx, move.name, left + 12, top + 19, { size: 15, bold: true }, INK.white, 'left', 180);
  });
}

export function drawBadge(ctx: ScreenContext, p: Palette, cx: number, cy: number, r: number, order: number, lead: boolean): void {
  ctx.renderer.rect(cx - r - 2, cy - r - 2, (r + 2) * 2, (r + 2) * 2, { fill: p.bar, radius: r + 2 });
  ctx.renderer.rect(cx - r, cy - r, r * 2, r * 2, { fill: lead ? p.accent : p.teal, radius: r });
  write(ctx, String(order), cx, cy, { size: Math.round(r * 1.2), bold: true }, lead ? INK.white : p.bar, 'center');
}

/** A front sprite in a square; the left side's turned round to face the right's across the seam. */
export function drawSprite(ctx: ScreenContext, sprite: string, x: number, y: number, size: number, flip: boolean, alpha: number): void {
  const texture = ctx.images.sprite(sprite, false, ImagePriority.Screen);
  if (!texture) return;
  const [u0, v0, u1, v1] = texture.uv ?? [0, 0, 1, 1];
  ctx.renderer.rect(x, y, size, size, { fill: [1, 1, 1, alpha] as Rgba, texture, uv: flip ? [u1, v0, u0, v1] : [u0, v0, u1, v1] });
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
