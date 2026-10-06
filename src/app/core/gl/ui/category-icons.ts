import { GlRenderer, Texture } from '@core/gl/gl-renderer';

/** The icons' size, drawn 1:1 so they stay sharp: as tall as the type pills beside them. */
export const CATEGORY_ICON_W = 60;
export const CATEGORY_ICON_H = 26;

type Rgb = readonly [number, number, number];
/** A point's colour inside the icon, or null where it's clear. */
type Shader = (x: number, y: number) => Rgb | null;

const RADIUS = 4;
const CX = CATEGORY_ICON_W / 2;
const CY = CATEGORY_ICON_H / 2;
/** Samples per pixel along each axis, for smooth edges. */
const SAMPLES = 4;

const COLOURS = new Map<string, Rgb>();
/** A colour, parsed once: the shaders ask for one per sample (16 a pixel), which made the Physical icon take ~60 ms on a slow CPU. */
const hex = (value: string): Rgb => {
  let colour = COLOURS.get(value);
  if (!colour) {
    colour = [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
    COLOURS.set(value, colour);
  }
  return colour;
};

/** Inside the rounded box the icon fills. */
function inBox(x: number, y: number): boolean {
  const dx = Math.max(RADIUS - x, 0, x - (CATEGORY_ICON_W - RADIUS));
  const dy = Math.max(RADIUS - y, 0, y - (CATEGORY_ICON_H - RADIUS));
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

/** Inside an 8-pointed star centred on the icon, its points `outer` from the centre and its notches `inner`. */
function inStar(x: number, y: number, outer: number, inner: number): boolean {
  const dx = x - CX;
  const dy = y - CY;
  const step = Math.PI / 8;
  const angle = (((Math.atan2(dy, dx) + Math.PI / 2) % (2 * step)) + 2 * step) % (2 * step);
  const t = Math.abs(angle - step) / step;
  return Math.hypot(dx, dy) <= inner + (outer - inner) * t;
}

/** Physical: a burst, as in the games. */
const PHYSICAL: Shader = (x, y) => {
  if (!inBox(x, y)) return null;
  if (inStar(x, y, 7, 3.5)) return hex('#fff1a8');
  if (inStar(x, y, 11.5, 6)) return hex('#ffa53a');
  return hex('#b8321a');
};

/** Special: rings around a centre. */
const SPECIAL: Shader = (x, y) => {
  if (!inBox(x, y)) return null;
  const d = Math.hypot((x - CX) / 1.35, y - CY);
  if (d <= 2.5) return hex('#e6f6ff');
  if (d <= 4.5) return hex('#2a5bb0');
  if (d <= 6.5) return hex('#9fd4ff');
  if (d <= 8) return hex('#2a5bb0');
  if (d <= 10) return hex('#9fd4ff');
  return hex('#1f4e99');
};

/**
 * Status: as in the games, a quiet swirl on the beige box: a circle outlined in grey, its left half
 * the box's beige and its right half white, split by a thin S.
 */
const STATUS: Shader = (x, y) => {
  if (!inBox(x, y)) return null;
  const beige = hex('#aaa290');
  const line = hex('#56544f');
  const r = 9;
  const dx = x - CX;
  const dy = y - CY;
  const d = Math.hypot(dx, dy);
  if (d > r + 1.1) return beige;
  if (d > r) return line;
  const top = Math.hypot(dx, dy + r / 2);
  const bottom = Math.hypot(dx, dy - r / 2);
  // The S: the top small circle's left arc, then the bottom one's right arc.
  const s = Math.min(dy <= 0 && dx <= 0 ? Math.abs(top - r / 2) : Infinity, dy >= 0 && dx >= 0 ? Math.abs(bottom - r / 2) : Infinity);
  if (s <= 0.55) return line;
  const white = top <= r / 2 || (dx > 0 && bottom > r / 2);
  return white ? hex('#f7f6f0') : beige;
};

const SHADERS: Readonly<Record<string, Shader>> = { Physical: PHYSICAL, Special: SPECIAL, Status: STATUS };

/** Each renderer's icons, made once and kept for the app's run. */
const ICONS = new WeakMap<GlRenderer, Map<string, Texture>>();

/** A move category's icon (Physical, Special, Status) as a 60x26 texture; null for anything else. */
export function categoryIcon(renderer: GlRenderer, category: string): Texture | null {
  const shader = SHADERS[category];
  if (!shader) return null;
  let icons = ICONS.get(renderer);
  if (!icons) {
    icons = new Map();
    ICONS.set(renderer, icons);
  }
  let texture = icons.get(category);
  if (!texture) {
    texture = renderer.textureFromPixels(paint(shader), CATEGORY_ICON_W, CATEGORY_ICON_H, false);
    icons.set(category, texture);
  }
  return texture;
}

/** The shader averaged over each pixel's samples, premultiplied. */
function paint(shader: Shader): Uint8Array {
  const pixels = new Uint8Array(CATEGORY_ICON_W * CATEGORY_ICON_H * 4);
  const total = SAMPLES * SAMPLES;
  for (let py = 0; py < CATEGORY_ICON_H; py++) {
    for (let px = 0; px < CATEGORY_ICON_W; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const colour = shader(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES);
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          covered++;
        }
      }
      const i = (py * CATEGORY_ICON_W + px) * 4;
      // Premultiplied: the sums over every sample are already scaled by the coverage.
      pixels[i] = Math.round(r / total);
      pixels[i + 1] = Math.round(g / total);
      pixels[i + 2] = Math.round(b / total);
      pixels[i + 3] = Math.round((covered / total) * 255);
    }
  }
  return pixels;
}
