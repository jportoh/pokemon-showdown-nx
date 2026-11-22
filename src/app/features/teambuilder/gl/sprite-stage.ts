import { DexMega, DexSpecies } from '@core/dex/champions-dex';
import { withAlpha } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { Box, UiContext, label } from '@core/gl/ui/retro-kit';

/** How the sprite comes in: a drop, then a squash as it lands. */
const DROP_MS = 260;
const LAND_MS = 200;
const DROP_HEIGHT = 48;
/** The breathing afterwards: a slow stretch, 1.5% at most. */
const BREATH_MS = 2400;

/**
 * The little stage a Pokémon stands on, as big as the team's and the editor's cards have it: its
 * ground, its shadow, and its sprite dropping in and landing when another one appears, then
 * breathing. The team and the editor share one, so opening a Pokémon keeps it where it stood.
 */
export class SpriteStage {
  /** The sprite drawn, and when it appeared (it drops in again for another one). */
  private sprite = '';
  private appearedAt = 0;

  /** The next sprite drops in, even the same one. */
  restart(): void {
    this.sprite = '';
  }

  /** `empty`: what the stage says without a form. */
  draw(ctx: UiContext, stage: Box & { size: number }, form: DexSpecies | DexMega | undefined, empty: string): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const cx = stage.x + stage.w / 2;
    const ground = stage.y + stage.h - stage.size * 0.17;
    // The menu's platform: a lit glow behind, an ellipse with a lip to stand on.
    renderer.rect(stage.x, stage.y, stage.w, stage.h, { fill: withAlpha(p.hero, 0.45), radius: 18 });
    const platformW = Math.min(stage.w - 24, stage.size * 1.05);
    const platformH = stage.size * 0.2;
    renderer.rect(cx - platformW / 2, ground - platformH / 2 + 4, platformW, platformH, { fill: p.rim, radius: platformH / 2 });
    renderer.rect(cx - platformW / 2, ground - platformH / 2, platformW, platformH - 4, { fill: p.panel, radius: (platformH - 4) / 2 });
    if (!form) {
      this.sprite = '';
      label(ctx, empty, cx, stage.y + stage.h / 2, { size: 20 }, p.muted, { align: 'center', maxWidth: stage.w - 24 });
      return;
    }
    const texture = ctx.images.sprite(form.sprite, false, ImagePriority.Screen);
    // It appears once it's there: until then (and for another species) the drop starts over.
    if (form.sprite !== this.sprite || !texture) {
      this.sprite = form.sprite;
      this.appearedAt = now;
    }
    const motion = spriteMotion(now - this.appearedAt);
    const shadowW = stage.size * 0.8 * motion.shadow;
    const shadowH = stage.size * 0.11;
    renderer.rect(cx - shadowW / 2, ground - shadowH / 2, shadowW, shadowH, { fill: [0, 0, 0, 0.18 * motion.alpha], radius: shadowH / 2, softness: 8 });
    if (!texture) return;
    const w = stage.size * motion.sx;
    const h = stage.size * motion.sy;
    // Standing on the ground: the sprites have some room under their feet.
    const feet = ground + stage.size * 0.12;
    renderer.rect(cx - w / 2, feet - h + motion.dy, w, h, { fill: [1, 1, 1, motion.alpha], texture });
  }
}

/** The sprite `ms` after it appeared: its offset, stretch, opacity and how wide its shadow is. */
function spriteMotion(ms: number): { dy: number; sx: number; sy: number; alpha: number; shadow: number } {
  if (ms < DROP_MS) {
    const t = ms / DROP_MS;
    return { dy: -DROP_HEIGHT * (1 - t * t), sx: 0.95, sy: 1.05, alpha: Math.min(1, t * 2), shadow: 0.6 + 0.4 * t };
  }
  if (ms < DROP_MS + LAND_MS) {
    const s = Math.sin((Math.PI * (ms - DROP_MS)) / LAND_MS);
    return { dy: 0, sx: 1 + 0.08 * s, sy: 1 - 0.1 * s, alpha: 1, shadow: 1 + 0.05 * s };
  }
  const breath = Math.sin((2 * Math.PI * (ms - DROP_MS - LAND_MS)) / BREATH_MS);
  return { dy: 0, sx: 1 - 0.008 * breath, sy: 1 + 0.015 * breath, alpha: 1, shadow: 1 };
}

