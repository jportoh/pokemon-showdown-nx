import { rgba } from '@core/gl/gl-renderer';
import { FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { Backdrop, DEPTH, wave } from './backdrop';

const SUN_X = 860;
const SUN = rgba('#fff0c4');
const SUN_LIGHT = rgba('#ffe2a0', 0.4);
const PINK_CLOUD = rgba('#ffc2b0', 0.45);
const HEADLAND = rgba('#6d5a8c');
const HEADLAND_NEAR = rgba('#5e4d7e');
const SEA_FAR = rgba('#5d6fae');
const SEA_NEAR = rgba('#86a0cc');
const GLINT = rgba('#ffe7b0');
const FOAM = rgba('#ffffff', 0.55);
const GULL = rgba('#3b2f4a');
/** The sea between the horizon and the beach (the opponent's platforms stand at its edge). */
const SEA_H = 26;

/** Glints on the water: where each one sits, and its own beat. */
const GLINTS = Array.from({ length: 12 }, (_, i) => ({ x: (i * 397 + 80) % FIELD_W, y: GROUND_Y + 4 + ((i * 7) % (SEA_H - 8)), w: 18 + (i % 3) * 10 }));

/** Warm sand, the sea behind it and the sun going down over the horizon; two gulls go by. */
export const COAST: Backdrop = {
  id: 'coast',
  sky: ['#5b4f97', '#d9807a', '#ffd39a'],
  ground: { ground: '#ecd3a0', platform: '#dcbb80', edge: '#a98650' },
  far(p) {
    const t = p.t;
    p.at(DEPTH.sky);
    p.glow(SUN_X, GROUND_Y - 10, 260, SUN_LIGHT);
    // Half sunk: the sea is drawn over its lower half.
    p.oval(SUN_X, GROUND_Y + 4, 64, 64, SUN);
    for (let i = 0; i < 3; i++) {
      const w = 340 + i * 80;
      const x = ((t * (4 + i * 2) + i * 460) % (FIELD_W + w)) - w;
      p.oval(x + w / 2, 70 + i * 46, w / 2, 12 + i * 3, PINK_CLOUD);
    }
    // A headland far off on the left, its foot in the sea.
    p.at(DEPTH.far);
    p.oval(90, GROUND_Y + 30, 300, 74, HEADLAND);
    p.oval(-40, GROUND_Y + 30, 220, 92, HEADLAND_NEAR);
    // Gulls: two wings each, flapping.
    for (let i = 0; i < 2; i++) {
      const x = ((t * (34 + i * 10) + i * 520) % (FIELD_W + 120)) - 60;
      const y = 92 + i * 44 + Math.sin(t * 1.5 + i) * 8;
      const flap = 0.35 + 0.3 * Math.sin(t * 7 + i * 2);
      p.rect(x - 15, y - 1.5, 15, 3, GULL, { angle: flap, radius: 1.5 });
      p.rect(x, y - 1.5, 15, 3, GULL, { angle: -flap, radius: 1.5 });
    }
  },
  floor(p) {
    const t = p.t;
    p.at(DEPTH.edge);
    p.gradient(-200, GROUND_Y, FIELD_W + 400, SEA_H, SEA_FAR, SEA_NEAR);
    // The sun's path on the water, and glints coming and going.
    for (let i = 0; i < 4; i++) {
      const w = 120 - i * 18 + Math.sin(t * 2 + i) * 10;
      p.rect(SUN_X - w / 2, GROUND_Y + 3 + i * 6, w, 2, GLINT, { additive: true });
    }
    for (const glint of GLINTS) {
      const a = wave(t, 2.4, glint.x / 200) * 0.6;
      if (a > 0.05) p.rect(glint.x, glint.y, glint.w, 2, [GLINT[0], GLINT[1], GLINT[2], a], { additive: true });
    }
    // The foam coming in and going back along the beach.
    const reach = Math.sin(t * 0.8) * 3;
    p.rect(-200, GROUND_Y + SEA_H - 2 + reach, FIELD_W + 400, 5, FOAM, { radius: 2.5 });
    p.rect(-200, GROUND_Y + SEA_H + 5 + reach * 1.6, FIELD_W + 400, 2, [1, 1, 1, 0.3]);
  },
};
