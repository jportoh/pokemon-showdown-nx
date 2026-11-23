import { rgba } from '@core/gl/gl-renderer';
import { FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { Backdrop, BackdropPainter, DEPTH, seeded } from './backdrop';

const CLOUD = rgba('#ffffff', 0.35);
const CLOUD_TOP = rgba('#ffffff', 0.3);
const FAR_HILL = rgba('#a6cf8c');
const NEAR_HILL = rgba('#9cc87e');

/** Rolling hills along the horizon: ovals half sunk in the ground (its rect hides their lower half). */
function hills(seed: number, count: number, rx: number, ry: number, rise: number): { x: number; rx: number; ry: number; y: number }[] {
  const random = seeded(seed);
  const step = (FIELD_W + 400) / count;
  return Array.from({ length: count }, (_, i) => {
    const height = ry * (0.7 + random() * 0.6);
    return { x: -200 + step * (i + 0.5) + (random() - 0.5) * step * 0.4, rx: rx * (0.8 + random() * 0.4), ry: height, y: GROUND_Y + height - rise * (0.7 + random() * 0.5) };
  });
}

const FAR_HILLS = hills(3, 7, 230, 70, 46);
const NEAR_HILLS = hills(8, 6, 260, 60, 22);

/** Clouds drifting across the sky, far off (they barely move with the camera). */
export function drawClouds(p: BackdropPainter, count: number, speed = 8): void {
  p.at(DEPTH.sky);
  for (let i = 0; i < count; i++) {
    const w = 260 + i * 60;
    const x = ((p.t * (speed + i * 4) + i * 300) % (FIELD_W + w)) - w;
    const y = 40 + ((i * 67) % 180);
    p.oval(x + w / 2, y + w * 0.16, w / 2, w * 0.16, CLOUD);
    p.oval(x + w / 2, y + w * 0.07, w * 0.25, w * 0.15, CLOUD_TOP);
  }
}

/** The classic field: a pale sky, drifting clouds and two rows of soft green hills. */
export const MEADOW: Backdrop = {
  id: 'meadow',
  sky: ['#b9dff2', '#d8ecc0'],
  ground: { ground: '#b0d890', platform: '#90c070', edge: '#6a9a50' },
  far(p) {
    drawClouds(p, 4);
    p.at(DEPTH.far);
    for (const hill of FAR_HILLS) p.oval(hill.x, hill.y, hill.rx, hill.ry, FAR_HILL);
    p.at(DEPTH.mid);
    for (const hill of NEAR_HILLS) p.oval(hill.x, hill.y, hill.rx, hill.ry, NEAR_HILL);
  },
};
