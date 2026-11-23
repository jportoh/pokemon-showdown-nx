import { GlRenderer, Rgba, Texture, withAlpha } from '@core/gl/gl-renderer';
import { pixelTexture } from '@core/gl/gl-textures';
import { UiContext, label } from '@core/gl/ui/retro-kit';
import { BALL } from '@features/home/gl/logo-ball';

/** A wobble's length: the ball rocks for the first part of it, then rests. */
const WOBBLE_MS = 1500;
const ROCKING = 0.55;
/** How far it leans at most (radians). */
const LEAN = 0.42;
/** The dots' beat, each a third of it after the one before. */
const DOT_MS = 1200;

/** The Poké Ball's texture, made once per renderer. */
const balls = new WeakMap<GlRenderer, Texture>();

export interface WaitingLook {
  /** The text's size; the ball is a little taller than it. 22 by default. */
  size?: number;
  color?: Rgba;
  bold?: boolean;
  /** Where `x` is: the middle of the whole (default), or its left end. */
  align?: 'center' | 'left';
  alpha?: number;
}

/**
 * Something being waited for ("Joining battle", "Loading the battle"), with movement so it reads as
 * working: a Poké Ball rocking as when a catch is in the balance, then resting, and the text followed
 * by three dots that light up one after the other. `text` comes without its "…". Returns the width.
 */
export function drawWaiting(ctx: UiContext, text: string, x: number, cy: number, look: WaitingLook = {}): number {
  const { renderer, now } = ctx;
  const size = look.size ?? 22;
  const alpha = look.alpha ?? 1;
  const color = look.color ?? ctx.palette.ink;
  const style = { size, bold: look.bold ?? true };
  const ballSize = Math.round(size * 1.6);
  const dot = Math.max(4, Math.round(size / 5));
  const textW = ctx.text.measure(text, style);
  const width = ballSize + 14 + textW + 6 + 3 * dot * 2;
  let left = look.align === 'left' ? x : x - width / 2;

  let ball = balls.get(renderer);
  if (!ball) {
    ball = pixelTexture(renderer, BALL);
    balls.set(renderer, ball);
  }
  // Rocking: a damped swing over the first part of each wobble, still for the rest.
  const phase = (now % WOBBLE_MS) / WOBBLE_MS;
  const swing = phase < ROCKING ? Math.sin((phase / ROCKING) * 3 * Math.PI) * LEAN * (1 - phase / ROCKING) : 0;
  // Its shadow, and the ball leaning from its foot (so it rolls a little as it leans).
  renderer.rect(left + ballSize * 0.15, cy + ballSize / 2 - 4, ballSize * 0.7, 8, { fill: [0, 0, 0, 0.18 * alpha], radius: 4, softness: 4 });
  renderer.rect(left + swing * ballSize * 0.35, cy - ballSize / 2, ballSize, ballSize, { fill: [1, 1, 1, alpha], texture: ball, angle: swing });
  left += ballSize + 14;

  label(ctx, text, left, cy, style, withAlpha(color, alpha));
  left += textW + 6;
  for (let i = 0; i < 3; i++) {
    const beat = ((now - (i * DOT_MS) / 3) % DOT_MS + DOT_MS) % DOT_MS / DOT_MS;
    const lit = Math.max(0, Math.sin(beat * Math.PI * 2));
    const r = dot / 2;
    renderer.rect(left + i * dot * 2, cy + size * 0.3 - r - lit * 3, dot, dot, { fill: withAlpha(color, alpha * (0.3 + 0.7 * lit)), radius: r });
  }
  return width;
}
