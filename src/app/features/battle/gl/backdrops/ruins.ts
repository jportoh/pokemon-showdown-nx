import { Rgba, rgba } from '@core/gl/gl-renderer';
import { FIELD_H, FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { Backdrop, BackdropPainter, DEPTH } from './backdrop';

const DUSK = rgba('#ffd2a0', 0.3);
const FAR_STONE = rgba('#6c5878');
const NEAR_STONE = rgba('#55445f');
const FLUTE = rgba('#000000', 0.12);
const TILES = rgba('#7a6a56', 0.45);
const PETAL = rgba('#ffc1d4', 0.85);

/** A column: base, shaft with its flutes and capital; a broken one ends in a jagged stump. */
function column(p: BackdropPainter, x: number, height: number, width: number, stone: Rgba, broken: boolean): void {
  const top = GROUND_Y - height;
  p.rect(x - 6, GROUND_Y - 12, width + 12, 40, stone);
  p.rect(x, top, width, height, stone);
  for (let i = 1; i < 4; i++) p.rect(x + (width / 4) * i - 1, top + 8, 2, height - 20, FLUTE);
  if (broken) p.peak(x + width * 0.7, top - 18, width * 0.6, 20, stone);
  else p.rect(x - 8, top - 12, width + 16, 14, stone);
}

const FAR_COLUMNS = [
  { x: 40, h: 150, broken: true },
  { x: 130, h: 96, broken: false },
  { x: 900, h: 170, broken: true },
  { x: 990, h: 120, broken: false },
  { x: 1150, h: 70, broken: true },
];

/** A forgotten temple at dusk: columns, some broken, a gate still standing; petals on the wind. */
export const RUINS: Backdrop = {
  id: 'ruins',
  sky: ['#3d3162', '#a0647a', '#efae8a'],
  ground: { ground: '#a8957f', platform: '#bfae96', edge: '#76654f' },
  far(p) {
    p.at(DEPTH.sky);
    p.glow(560, GROUND_Y, 460, DUSK);
    p.at(DEPTH.far);
    for (const c of FAR_COLUMNS) column(p, c.x, c.h, 30, FAR_STONE, c.broken);
    // The gate: two pillars and the lintel across them.
    p.at(DEPTH.mid);
    column(p, 420, 190, 40, NEAR_STONE, false);
    column(p, 600, 190, 40, NEAR_STONE, false);
    p.rect(396, GROUND_Y - 226, 268, 26, NEAR_STONE);
    p.rect(410, GROUND_Y - 236, 150, 10, NEAR_STONE);
    // A fallen drum of a column.
    p.rect(1160, GROUND_Y - 34, 90, 40, NEAR_STONE, { radius: 6 });
  },
  floor(p) {
    p.floorLines(7, 5, 260, TILES);
  },
  ambient(p) {
    p.at(null);
    for (let i = 0; i < 12; i++) {
      const x = ((p.t * (36 + i * 4) + i * 140) % (FIELD_W + 60)) - 30;
      const y = 80 + ((i * 41) % (FIELD_H - 160)) + Math.sin(p.t * 1.5 + i) * 18;
      p.rect(x, y, 9, 5, PETAL, { radius: 2.5, angle: p.t * 2 + i });
    }
  },
};
