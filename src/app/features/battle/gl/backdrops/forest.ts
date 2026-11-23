import { Rgba, rgba } from '@core/gl/gl-renderer';
import { FIELD_H, FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { Backdrop, BackdropPainter, DEPTH, seeded, wave } from './backdrop';

const FAR_PINE = rgba('#9cc196');
const MID_PINE = rgba('#6b9a68');
const SHAFT = rgba('#fffbe0', 0.1);
const FIREFLY = rgba('#fff59a');
const FIREFLY_CORE = rgba('#fffbd0');

interface Pine {
  x: number;
  h: number;
  w: number;
}

function pines(seed: number, count: number, height: number, width: number): Pine[] {
  const random = seeded(seed);
  const step = (FIELD_W + 300) / count;
  return Array.from({ length: count }, (_, i) => ({
    x: -150 + step * (i + 0.5) + (random() - 0.5) * step * 0.8,
    h: height * (0.75 + random() * 0.5),
    w: width * (0.85 + random() * 0.3),
  }));
}

const FAR_PINES = pines(11, 22, 120, 70);
const MID_PINES = pines(23, 13, 190, 104);

/** A row of pines standing on a band of forest (its foot goes well under the ground, out of sight). */
function drawPines(p: BackdropPainter, row: readonly Pine[], base: number, color: Rgba): void {
  p.rect(-200, base - 18, FIELD_W + 400, 140, color);
  for (const pine of row) {
    p.peak(pine.x, base - pine.h * 0.62, pine.w, pine.h * 0.62, color);
    p.peak(pine.x, base - pine.h, pine.w * 0.72, pine.h * 0.6, color);
  }
}

/** Pines in two rows, light falling between them and fireflies over the moss. */
export const FOREST: Backdrop = {
  id: 'forest',
  sky: ['#e8f1d6', '#b7d3a2'],
  ground: { ground: '#6f9b53', platform: '#5d8b44', edge: '#36602a' },
  far(p) {
    p.at(DEPTH.far);
    drawPines(p, FAR_PINES, GROUND_Y - 6, FAR_PINE);
    p.at(DEPTH.mid);
    drawPines(p, MID_PINES, GROUND_Y + 4, MID_PINE);
    // Shafts of light slanting down through the trees, swaying slowly.
    p.at(null);
    for (let i = 0; i < 4; i++) {
      const x = 120 + i * 300 + Math.sin(p.t * 0.4 + i) * 30;
      p.rect(x, -20, 90, FIELD_H + 40, SHAFT, { skew: -0.45, additive: true });
    }
  },
  ambient(p) {
    p.at(null);
    for (let i = 0; i < 14; i++) {
      const a = wave(p.t, 2.2 + (i % 4) * 0.4, i * 0.9);
      if (a < 0.08) continue;
      const x = (i * 211 + Math.sin(p.t * 0.5 + i) * 60 + FIELD_W) % FIELD_W;
      const y = p.groundY - 70 + ((i * 97) % (FIELD_H - p.groundY - 20)) + Math.cos(p.t * 0.7 + i) * 18;
      p.glow(x, y, 14, [FIREFLY[0], FIREFLY[1], FIREFLY[2], 0.55 * a]);
      p.rect(x - 2, y - 2, 4, 4, [FIREFLY_CORE[0], FIREFLY_CORE[1], FIREFLY_CORE[2], a], { radius: 2 });
    }
  },
};
