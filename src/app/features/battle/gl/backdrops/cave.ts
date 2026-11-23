import { rgba } from '@core/gl/gl-renderer';
import { FIELD_H, FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { Backdrop, DEPTH, seeded, wave } from './backdrop';

const CEILING = rgba('#0b0918');
const WALL = rgba('#221a3a');
const CYAN = rgba('#6fe3ff');
const VIOLET = rgba('#b48cff');
const DUST = [rgba('#c9b8ff'), rgba('#a8f0ff')];

const random = seeded(7);
/** Stalactites hanging from the ceiling. */
const ICICLES = Array.from({ length: 14 }, (_, i) => ({ x: -60 + i * 100 + random() * 60, w: 40 + random() * 50, h: 50 + random() * 110 }));
/** The rock wall's jagged top. */
const CRAGS = Array.from({ length: 16 }, (_, i) => ({ x: -120 + i * 100 + random() * 40, w: 120 + random() * 80, h: 30 + random() * 50 }));
/** Clusters of crystals at the foot of the wall, each glowing in its own time. */
const CLUSTERS = [
  { x: 110, color: CYAN, size: 1 },
  { x: 470, color: VIOLET, size: 0.8 },
  { x: 760, color: CYAN, size: 0.7 },
  { x: 1180, color: VIOLET, size: 1.1 },
];
const CRYSTALS = [
  { dx: -34, w: 32, h: 96 },
  { dx: 0, w: 44, h: 150 },
  { dx: 36, w: 30, h: 80 },
  { dx: 64, w: 22, h: 52 },
];

/** A dark cave: stalactites, a rock wall and crystals beating with a slow light; dust rising in it. */
export const CAVE: Backdrop = {
  id: 'cave',
  sky: ['#120e22', '#2a2148'],
  ground: { ground: '#3a2f55', platform: '#4b3e6e', edge: '#8b6fe0' },
  dark: true,
  far(p) {
    const t = p.t;
    p.at(DEPTH.far);
    p.rect(-200, GROUND_Y - 60, FIELD_W + 400, 200, WALL);
    for (const crag of CRAGS) p.peak(crag.x, GROUND_Y - 60 - crag.h + 2, crag.w, crag.h, WALL);
    p.at(DEPTH.mid);
    CLUSTERS.forEach((cluster, i) => {
      const beat = wave(t, 3.2, i * 0.7);
      p.glow(cluster.x, GROUND_Y - 50 * cluster.size, 190 * cluster.size, [cluster.color[0], cluster.color[1], cluster.color[2], 0.2 + 0.2 * beat]);
      const fill = [cluster.color[0], cluster.color[1], cluster.color[2], 0.7 + 0.25 * beat] as const;
      for (const crystal of CRYSTALS) {
        const x = cluster.x + crystal.dx * cluster.size;
        const w = crystal.w * cluster.size;
        const h = crystal.h * cluster.size;
        // A long point up and a short one down: a crystal standing in the ground.
        p.peak(x, GROUND_Y - 10 - h, w, h * 0.78, fill);
        p.peak(x, GROUND_Y - 10 - h * 0.22, w, h * 0.3, fill, true);
      }
    });
    p.rect(-200, -80, FIELD_W + 400, 84, CEILING);
    for (const icicle of ICICLES) p.peak(icicle.x, 2, icicle.w, icicle.h, CEILING, true);
  },
  ambient(p) {
    p.at(null);
    for (let i = 0; i < 20; i++) {
      const rise = (p.t * (10 + (i % 5) * 4) + i * 53) % (FIELD_H - 60);
      const y = FIELD_H - rise;
      const x = (i * 131 + Math.sin(p.t * 0.6 + i) * 20 + FIELD_W) % FIELD_W;
      const a = Math.min(1, rise / 80, (FIELD_H - 60 - rise) / 80) * 0.6;
      const color = DUST[i % 2];
      p.rect(x - 1.5, y - 1.5, 3, 3, [color[0], color[1], color[2], a], { radius: 1.5 });
    }
  },
};
