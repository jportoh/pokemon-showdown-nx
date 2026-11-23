import { Rgba, rgba } from '@core/gl/gl-renderer';
import { FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { Backdrop, BackdropPainter, DEPTH, seeded, wave } from './backdrop';

const STAR = rgba('#ffffff');
const MOON = rgba('#f4edcf');
const MOON_LIGHT = rgba('#f4edcf', 0.12);
/** The sky's colour where the moon is, for the shadow that makes it a crescent. */
const MOON_SHADOW = rgba('#121937');
const FAR_BLOCK = rgba('#141a36');
const NEAR_BLOCK = rgba('#1b2245');
const FAR_WINDOW = rgba('#ffd77a');
const NEAR_WINDOW = rgba('#ffe3a0');
const BEACON = rgba('#ff4040');
const RAIL = rgba('#3a4060');
const LEDGE = rgba('#4a5270');
const TILES = rgba('#4a5170', 0.5);

const random = seeded(3);
const STARS = Array.from({ length: 48 }, () => ({ x: random() * FIELD_W, y: random() * 190, size: 1.5 + random() * 1.5, phase: random() * 4 }));

interface Block {
  x: number;
  w: number;
  h: number;
}
interface Window {
  x: number;
  y: number;
  /** One in a few goes on and off. */
  blinks: boolean;
}

/** A skyline: blocks side by side and some of their windows lit. */
function skyline(seed: number, minH: number, maxH: number, lit: number): { blocks: Block[]; windows: Window[] } {
  const next = seeded(seed);
  const blocks: Block[] = [];
  const windows: Window[] = [];
  for (let x = -200; x < FIELD_W + 200; ) {
    const w = 50 + next() * 80;
    const h = minH + next() * (maxH - minH);
    blocks.push({ x, w, h });
    for (let wy = GROUND_Y - h + 12; wy < GROUND_Y - 14; wy += 18) {
      for (let wx = x + 8; wx < x + w - 14; wx += 16) {
        if (next() < lit) windows.push({ x: wx, y: wy, blinks: next() < 0.12 });
      }
    }
    x += w + 4;
  }
  return { blocks, windows };
}

const FAR_CITY = skyline(5, 110, 230, 0.16);
const NEAR_CITY = skyline(9, 50, 120, 0.12);

function drawCity(p: BackdropPainter, city: { blocks: Block[]; windows: Window[] }, block: Rgba, light: Rgba): void {
  for (const b of city.blocks) p.rect(b.x, GROUND_Y - b.h, b.w, b.h + 120, block);
  city.windows.forEach((w, i) => {
    if (w.blinks && wave(p.t, 9, i) < 0.4) return;
    p.rect(w.x, w.y, 7, 8, light);
  });
}

/** The top of a tower at night: stars, the moon, the city lit up behind a railing. */
export const ROOFTOP: Backdrop = {
  id: 'rooftop',
  sky: ['#0a0f24', '#26346a'],
  ground: { ground: '#2e3348', platform: '#3d4462', edge: '#ffcc55' },
  dark: true,
  far(p) {
    const t = p.t;
    p.at(DEPTH.sky);
    for (const star of STARS) {
      const a = 0.3 + 0.6 * wave(t, 3, star.phase);
      p.rect(star.x, star.y, star.size, star.size, [STAR[0], STAR[1], STAR[2], a]);
    }
    p.oval(1090, 74, 36, 36, MOON);
    p.oval(1106, 64, 32, 32, MOON_SHADOW);
    p.glow(1090, 74, 150, MOON_LIGHT);
    p.at(DEPTH.far);
    drawCity(p, FAR_CITY, FAR_BLOCK, FAR_WINDOW);
    // A mast on the tallest roof, its light blinking.
    p.rect(598, GROUND_Y - 290, 4, 70, FAR_BLOCK);
    if (wave(t, 1.6) > 0.5) p.glow(600, GROUND_Y - 292, 16, BEACON);
    p.at(DEPTH.mid);
    drawCity(p, NEAR_CITY, NEAR_BLOCK, NEAR_WINDOW);
  },
  floor(p) {
    p.floorLines(6, 6, 220, TILES);
    // The railing along the roof's edge.
    p.at(DEPTH.edge);
    p.rect(-200, GROUND_Y - 34, FIELD_W + 400, 4, RAIL);
    for (let x = -180; x < FIELD_W + 200; x += 64) p.rect(x, GROUND_Y - 32, 4, 32, RAIL);
    p.rect(-200, GROUND_Y - 2, FIELD_W + 400, 8, LEDGE);
  },
};
