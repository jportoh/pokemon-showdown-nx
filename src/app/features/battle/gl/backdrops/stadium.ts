import { rgba } from '@core/gl/gl-renderer';
import { FIELD_H, FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { Backdrop, DEPTH, seeded, wave } from './backdrop';
import { drawClouds } from './meadow';

const POLE = rgba('#7a8399');
const LAMP = rgba('#eef2f8');
const LAMP_LIGHT = rgba('#fffbe6', 0.3);
const STAND = rgba('#566078');
const ROOF = rgba('#3b4357');
const BOARDS = ['#2f6db5', '#d9493a', '#2f6db5', '#e8b030', '#2f6db5', '#3a9a5a'].map((hex) => rgba(hex));
const BOARD_TRIM = rgba('#1f2a3c');
const FLASH = rgba('#ffffff', 0.9);
const STRIPE = rgba('#58a24f');

const STAND_TOP = GROUND_Y - 100;
const random = seeded(17);
const SHIRTS = ['#e85d4a', '#f4c542', '#4a90e2', '#ffffff', '#7ed36b', '#c86ad8', '#f09a3e'].map((hex) => rgba(hex, 0.8));
/** The crowd: three rows of fans in the stand, some jumping now and then. */
const FANS = Array.from({ length: 3 }, (_, row) =>
  Array.from({ length: 50 }, (_, i) => ({ x: -180 + i * 34 + row * 11 + random() * 8, y: STAND_TOP + 14 + row * 24, color: SHIRTS[Math.floor(random() * SHIRTS.length)], phase: random() * 10, jumps: random() < 0.3 })),
).flat();

/** A stadium in the sun: floodlights, the crowd in the stand, ad boards and a striped pitch. */
export const STADIUM: Backdrop = {
  id: 'stadium',
  sky: ['#79b8e8', '#d2e9f9'],
  ground: { ground: '#5fae55', platform: '#6cba60', edge: '#f4f8f0' },
  far(p) {
    const t = p.t;
    drawClouds(p, 3, 6);
    p.at(DEPTH.far);
    for (const x of [60, FIELD_W - 60]) {
      p.rect(x - 4, GROUND_Y - 300, 8, 200, POLE);
      p.glow(x, GROUND_Y - 300, 120, LAMP_LIGHT);
      p.rect(x - 40, GROUND_Y - 316, 80, 30, LAMP, { radius: 4 });
    }
    p.at(DEPTH.mid);
    p.rect(-200, STAND_TOP - 10, FIELD_W + 400, 12, ROOF);
    p.rect(-200, STAND_TOP, FIELD_W + 400, 220, STAND);
    for (const fan of FANS) {
      const hop = fan.jumps ? Math.max(0, Math.sin(t * 5 + fan.phase)) * 5 : 0;
      p.rect(fan.x, fan.y - hop, 14, 16, fan.color, { radius: 4 });
    }
    // Cameras flashing in the crowd, now and then.
    for (let i = 0; i < 3; i++) {
      if (wave(t, 2.6 + i * 0.7, i * 1.3) > 0.96) p.glow(((i * 467 + Math.floor(t / 3) * 211) % FIELD_W) + 0, STAND_TOP + 30 + i * 20, 18, FLASH);
    }
    // The ad boards round the pitch.
    p.at(DEPTH.edge);
    const boardW = (FIELD_W + 400) / BOARDS.length;
    BOARDS.forEach((color, i) => p.rect(-200 + i * boardW, GROUND_Y - 22, boardW - 4, 22, color));
    p.rect(-200, GROUND_Y - 26, FIELD_W + 400, 4, BOARD_TRIM);
  },
  floor(p) {
    // The pitch mown in stripes, wider towards us.
    p.at(null);
    const top = p.groundY;
    const depth = FIELD_H - top;
    for (let i = 0; i < 10; i += 2) {
      const y0 = top + depth * Math.pow(i / 10, 1.5);
      const y1 = top + depth * Math.pow((i + 1) / 10, 1.5);
      p.rect(0, y0, FIELD_W, y1 - y0, STRIPE);
    }
  },
};
