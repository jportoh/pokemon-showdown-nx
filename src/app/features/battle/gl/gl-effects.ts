import { GlRenderer, Rgba, rgba } from '@core/gl/gl-renderer';
import { SlotKey } from '@features/battle/models/battle';
import { FIELD_H, FIELD_W } from '@features/battle/gl/field-layout';
import { maskOf } from '@core/gl/ui/masks';
import { BERRY, BERRY_BITTEN, BERRY_HALF, BERRY_LEAVES, EffectShape, POW, SPARKLE, STAR, mirrored } from '@features/battle/gl/effect-shapes';
import { IMPACT_PIECES, Piece, typeEffect } from '@features/battle/gl/type-effects';

/**
 * Bright type colours for the effects, as RGB triplets (the renderer takes an alpha with each).
 */
export const EFFECT_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  normal: [200, 200, 170],
  fire: [240, 128, 48],
  water: [104, 144, 240],
  electric: [248, 208, 48],
  grass: [120, 200, 80],
  ice: [152, 216, 216],
  fighting: [224, 64, 48],
  poison: [180, 80, 180],
  ground: [224, 192, 104],
  flying: [168, 144, 240],
  psychic: [248, 88, 136],
  bug: [168, 184, 32],
  rock: [184, 160, 56],
  ghost: [128, 96, 168],
  dragon: [112, 56, 248],
  dark: [112, 88, 72],
  steel: [184, 184, 208],
  fairy: [238, 153, 172],
};
export const DEFAULT_COLOR = [230, 230, 230] as const;

/** A point on the field (px from its top left corner). */
export interface EffectPoint {
  x: number;
  y: number;
}

/** Where a special move flies to, and whether it lands there (a miss just fades on arrival). */
export interface EffectTarget {
  slot: SlotKey;
  at: EffectPoint;
  hit: boolean;
}

// Lengths at normal speed (a move's log step lasts 1100 ms); the speed divides them.
const CHARGE_MS = 240;
const LAUNCH_AT = 0.7;
const FLIGHT_MS = 340;
const IMPACT_MS = 380;
const AURA_RING_MS = 460;
const AURA_RING_GAP_MS = 180;
const AURA_SPARK_MS = 640;
const BEAM_ORBS = 12;
const BEAM_GAP_MS = 25;
const BEAM_FLIGHT_MS = 240;
const WAVE_RINGS = 3;
const WAVE_GAP_MS = 90;
const WAVE_FLIGHT_MS = 380;
const FLURRY_OFFSETS = [
  [-0.12, -0.1],
  [0.12, 0],
  [-0.02, 0.12],
] as const;
const FLURRY_GAP_MS = 120;
const CLAP_MS = 160;
const ROOM_MS = 800;
const ROOM_COLORS: Readonly<Record<string, Rgba>> = { trickroom: [168 / 255, 85 / 255, 247 / 255, 1] };
const SHIELD_MS = 900;
const SHIELD_COLOR: Rgba = [103 / 255, 232 / 255, 249 / 255, 1];
const GROUND_DELAY_MS = 200;
const PILLAR_OFFSETS = [-0.2, 0, 0.2] as const;
const PILLAR_GAP_MS = 60;
const PILLAR_MS = 420;
const PSY_RINGS = 3;
const PSY_GAP_MS = 110;
const PSY_MS = 320;
const ROCK_OFFSETS = [-0.22, 0.12, -0.04, 0.24] as const;
const ROCK_GAP_MS = 90;
const ROCK_FALL_MS = 260;
const ROCK_COLOR: Rgba = [150 / 255, 120 / 255, 80 / 255, 1];
const DUST_MS = 520;
const DUST_COLOR: Rgba = [140 / 255, 100 / 255, 55 / 255, 1];
const GUSTS = 6;
const GUST_GAP_MS = 90;
const GUST_MS = 440;
const GUST_COLOR: Rgba = [210 / 255, 230 / 255, 255 / 255, 1];
const STAT_STREAKS = 5;
const STAT_STREAK_MS = 620;
const STAT_WAVE_GAP_MS = 200;
const STAT_UP_COLOR: Rgba = [70 / 255, 210 / 255, 100 / 255, 1];
const STAT_DOWN_COLOR: Rgba = [240 / 255, 70 / 255, 60 / 255, 1];
const CONFUSION_MS = 1000;
const CONFUSION_STARS = 3;
const CONFUSION_TURNS = 2;
const STAR_COLOR: Rgba = [1, 0.88, 0.29, 1];
const POW_MS = 460;
const POW_COLOR: Rgba = [1, 0.95, 0.62, 1];
const FLASH_MS = 220;
const BUBBLES = 6;
const BUBBLE_MS = 620;
const BLOT_MS = 520;
const BLOT_COLOR: Rgba = [0.12, 0.06, 0.16, 1];
const PUFFS = 14;
const PUFF_MS = 520;
const PUFF_COLORS: readonly Rgba[] = [
  [0.95, 0.95, 0.95, 1],
  [0.82, 0.82, 0.86, 1],
];
const WHITE: Rgba = [1, 1, 1, 1];
/** A berry eaten: how long it shows, when its three bites come (shares of it) and the glint after. */
const BERRY_MS = 1150;
const BERRY_BITES = [0.4, 0.6, 0.8] as const;
const BERRY_GLOW_MS = 500;
const BERRY_LEAF: Rgba = [0.36, 0.78, 0.3, 1];
const BERRY_FRAMES = [BERRY, BERRY_BITTEN, BERRY_HALF] as const;
const BERRY_FRAMES_LEFT = BERRY_FRAMES.map(mirrored);
/** The berries' own colours (the rest are red, as most are). */
const BERRY_COLORS: Readonly<Record<string, string>> = {
  sitrusberry: '#f7d23c',
  oranberry: '#4a82f0',
  lumberry: '#7ad84e',
  chestoberry: '#6a5ae0',
  pechaberry: '#ff9ac8',
  rawstberry: '#3ccab8',
  aspearberry: '#f0e070',
  persimberry: '#ff9a3c',
  leppaberry: '#ff6a3c',
  magoberry: '#ff8ac0',
  wikiberry: '#9a6ae8',
  aguavberry: '#7ad08a',
  iapapaberry: '#f7d23c',
  salacberry: '#5ad05a',
  ganlonberry: '#6a6ad8',
  apicotberry: '#4a8ae8',
  petayaberry: '#ff70a8',
  starfberry: '#ffb0d0',
  keeberry: '#ffd23c',
  marangaberry: '#4a8ae8',
};
const FIELD_WIDTH = FIELD_W;
const FIELD_HEIGHT = FIELD_H;

/** A berry's colour, by its name ("Sitrus Berry"). */
export function berryColor(item: string): Rgba {
  return rgba(BERRY_COLORS[item.toLowerCase().replace(/[^a-z]/g, '')] ?? '#e8404a');
}

/** A move's type as a colour for light (bright, unlike the type rows' colours). */
export function effectColor(type: string): Rgba {
  const [r, g, b] = EFFECT_COLORS[type.toLowerCase()] ?? DEFAULT_COLOR;
  return [r / 255, g / 255, b / 255, 1];
}

/** A small round piece moving on its own: sparks, trails, dust, motes. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Acceleration down (gravity, px/s²); negative rises. */
  gravity: number;
  /** Share of speed kept per second. */
  drag: number;
  age: number;
  life: number;
  size: number;
  /** Size at the end of its life (grows for dust, shrinks for sparks). */
  endSize: number;
  color: Rgba;
  alpha: number;
  additive: boolean;
  /** A pixel shape (`size` is then its height); a soft round light without one. */
  shape?: EffectShape;
  angle: number;
  /** Radians/s. */
  spin: number;
  /** Side to side drift, px/s. */
  sway: number;
  /** Points the way it flies. */
  aim: boolean;
}

/** Something drawn over a set time: `draw` gets the progress 0..1. */
interface Tween {
  start: number;
  duration: number;
  draw: (renderer: GlRenderer, progress: number) => void;
  done?: () => void;
}

interface Scheduled {
  at: number;
  run: () => void;
}

/**
 * The move effects of the WebGL field: what MoveEffects does with radial-gradient boxes, drawn here
 * with real light (additive glows), many more particles and smooth scaling. Everything runs on the
 * field's own clock (`update` each frame), and the scene's `speed` divides every length.
 */
export class GlEffects {
  private now = 0;
  private particles: Particle[] = [];
  private tweens: Tween[] = [];
  private scheduled: Scheduled[] = [];
  /** The replay speed: every length is divided by it. */
  speed = 1;

  get particleCount(): number {
    return this.particles.length;
  }

  stop(): void {
    this.particles = [];
    this.tweens = [];
    this.scheduled = [];
  }

  /** Advances the clock (ms), runs what's due and moves the particles. */
  update(now: number, dt: number): void {
    this.now = now;
    if (this.scheduled.length > 0) {
      const due = this.scheduled.filter((s) => s.at <= now);
      this.scheduled = this.scheduled.filter((s) => s.at > now);
      due.forEach((s) => s.run());
    }
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt * 1000;
      if (p.age >= p.life) continue;
      const keep = Math.pow(p.drag, dt);
      p.vx *= keep;
      p.vy = p.vy * keep + p.gravity * dt;
      p.x += (p.vx + (p.sway ? Math.cos(p.age / 160) * p.sway : 0)) * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      alive.push(p);
    }
    this.particles = alive;
  }

  /** Draws the tweens and particles; `hidden` (something covers the field) only ends the tweens that are due. */
  draw(renderer: GlRenderer, hidden = false): void {
    const live: Tween[] = [];
    const finished: Tween[] = [];
    for (const tween of this.tweens) {
      const progress = Math.min(1, (this.now - tween.start) / tween.duration);
      if (progress < 0) {
        live.push(tween);
        continue;
      }
      if (!hidden) tween.draw(renderer, progress);
      (progress >= 1 ? finished : live).push(tween);
    }
    this.tweens = live;
    if (hidden) {
      finished.forEach((tween) => tween.done?.());
      return;
    }
    for (const p of this.particles) {
      const t = p.age / p.life;
      const size = p.size + (p.endSize - p.size) * t;
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      if (!p.shape) glowDot(renderer, p.x, p.y, size, p.color, p.alpha * fade, p.additive);
      else drawShape(renderer, p.shape, p.x, p.y, size, p.color, p.alpha * fade, p.aim ? Math.atan2(p.vy, p.vx) + Math.PI / 2 : p.angle, p.additive);
    }
    finished.forEach((tween) => tween.done?.());
  }

  /** Runs `run` after `ms` (at normal speed). */
  later(ms: number, run: () => void): void {
    if (ms <= 0) run();
    else this.scheduled.push({ at: this.now + ms / this.speed, run });
  }

  tween(ms: number, draw: Tween['draw'], done?: () => void, delayMs = 0): void {
    this.tweens.push({ start: this.now + delayMs / this.speed, duration: Math.max(1, ms / this.speed), draw, done });
  }

  particle(p: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'color'>): void {
    this.particles.push({
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 1,
      age: 0,
      size: 4,
      endSize: 0,
      alpha: 1,
      additive: true,
      angle: 0,
      spin: 0,
      sway: 0,
      aim: false,
      ...p,
      life: (p.life ?? 400) / this.speed,
    });
  }

  /** Sparks flying out of a point. */
  burst(at: EffectPoint, color: Rgba, count: number, speedPx: number, size: number, life = 420): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speedPx * (0.5 + Math.random() * 0.7) * this.speed;
      this.particle({
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        drag: 0.05,
        gravity: 300 * this.speed * this.speed,
        size: size * (0.6 + Math.random() * 0.6),
        endSize: 0,
        color: Math.random() < 0.3 ? WHITE : color,
        life: life * (0.7 + Math.random() * 0.6),
      });
    }
  }

  /** Where a hit lands: a flash, a ring, and what its type throws (flames, drops, leaves…). */
  impact(at: EffectPoint, type: string, size: number, light = false): void {
    this.hitAt(at, type, size / 240, light);
  }

  /** Pieces thrown out of a point: `count` of them, for a Pokémon of scale `k`. */
  pieces(at: EffectPoint, piece: Piece, count: number, k: number): void {
    for (let i = 0; i < count; i++) {
      const angle = piece.direction === undefined ? Math.random() * Math.PI * 2 : piece.direction + (Math.random() * 2 - 1) * (piece.spread ?? Math.PI);
      const v = piece.speed * k * (0.5 + Math.random() * 0.7) * this.speed;
      const scatter = (piece.scatter ?? 0) * k;
      const size = piece.size * k * (0.8 + Math.random() * 0.4);
      this.particle({
        x: at.x + (Math.random() - 0.5) * scatter,
        y: at.y + (Math.random() - 0.5) * scatter,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        gravity: (piece.gravity ?? 0) * k * this.speed * this.speed,
        drag: piece.drag ?? 0.3,
        size,
        endSize: piece.endSize === undefined ? size : piece.endSize * k,
        color: piece.colors[Math.floor(Math.random() * piece.colors.length)],
        life: piece.life * (0.7 + Math.random() * 0.6),
        shape: piece.shape,
        angle: piece.spin ? Math.random() * Math.PI * 2 : 0,
        spin: (piece.spin ?? 0) * (Math.random() * 2 - 1) * this.speed,
        sway: (piece.sway ?? 0) * k * this.speed * (Math.random() < 0.5 ? -1 : 1),
        aim: piece.aim ?? false,
        additive: !!piece.glow,
      });
    }
  }

  /**
   * Confusion: stars circle over the Pokémon's head (`head`, the top middle of its sprite), the ones
   * behind it dimmer and smaller.
   */
  confusion(head: EffectPoint, size: number): void {
    const k = size / 240;
    const rx = 76 * k;
    const ry = 20 * k;
    this.tween(CONFUSION_MS, (r, p) => {
      const fade = Math.max(0, Math.min(1, p / 0.12, (1 - p) / 0.2));
      for (let i = 0; i < CONFUSION_STARS; i++) {
        const a = p * Math.PI * 2 * CONFUSION_TURNS + (i / CONFUSION_STARS) * Math.PI * 2;
        const front = (Math.sin(a) + 1) / 2;
        const x = head.x + Math.cos(a) * rx;
        const y = head.y + Math.sin(a) * ry;
        const height = (30 + 12 * front) * k;
        glowDot(r, x, y, height * 0.8, STAR_COLOR, 0.4 * fade * (0.4 + 0.6 * front), true);
        drawShape(r, STAR, x, y, height, STAR_COLOR, fade * (0.5 + 0.5 * front), Math.sin(p * 9 + i * 2) * 0.35, false);
      }
    });
  }

  /**
   * A berry eaten: it pops up at `at`, in front of the Pokémon (which looks towards `facing`, 1 right
   * or -1 left), and goes in three bites from its side, crumbs falling at each (`bitten` with the
   * bite, 0 to 2), the last one in a glint of its colour.
   */
  berry(at: EffectPoint, facing: 1 | -1, size: number, item: string, bitten: (bite: number) => void): void {
    const k = size / 240;
    const color = berryColor(item);
    const frames = facing < 0 ? BERRY_FRAMES : BERRY_FRAMES_LEFT;
    const height = 50 * k;
    const leafHeight = 20 * k;
    this.tween(BERRY_MS, (r, p) => {
      const bites = BERRY_BITES.filter((when) => p >= when).length;
      if (bites >= BERRY_BITES.length) return;
      const pop = backOut(Math.min(1, p / 0.16));
      // Each bite squashes it for a moment, as a mouthful is taken.
      const since = bites > 0 ? (p - BERRY_BITES[bites - 1]) / 0.08 : 1;
      const squash = since < 1 ? 0.18 * Math.sin(since * Math.PI) : 0;
      const bob = Math.sin(p * Math.PI * 6) * 3 * k;
      const x = at.x;
      const y = at.y + bob;
      const h = height * pop * (1 - squash);
      const fade = Math.min(1, p / 0.08);
      drawShape(r, frames[bites], x, y, h, color, fade);
      // A glint on its skin, and the leaves on top.
      if (bites === 0) glowDot(r, x + 12 * facing * k, y - 10 * k, 5 * k * pop, WHITE, 0.9 * fade, false);
      drawShape(r, BERRY_LEAVES, x + (bites === 2 ? 8 * facing : 0) * k, y - h / 2 - leafHeight * 0.3, leafHeight * pop, BERRY_LEAF, fade);
    });
    BERRY_BITES.forEach((when, bite) => {
      this.later(BERRY_MS * when, () => {
        const last = bite === BERRY_BITES.length - 1;
        bitten(bite);
        this.pieces({ x: at.x - 16 * facing * k, y: at.y }, { colors: [color, WHITE], size: 7, endSize: 3, speed: 150, direction: -Math.PI / 2, spread: 1.2, gravity: 900, drag: 0.5, life: 520 }, last ? 12 : 6, k);
        if (!last) return;
        this.pieces(at, { shape: SPARKLE, colors: [WHITE, color], size: 22, endSize: 4, speed: 220, drag: 0.1, life: 520, spin: 3 }, 7, k);
        this.tween(BERRY_GLOW_MS, (r, p) => glowDot(r, at.x, at.y, (50 + 80 * p) * k, color, 0.5 * (1 - p), true));
      });
    });
  }

  /** A puff of smoke over a Pokémon, hiding it as it changes (its substitute coming or going). */
  puff(at: EffectPoint, size: number): void {
    const k = size / 240;
    for (let i = 0; i < PUFFS; i++) {
      const angle = (i / PUFFS) * Math.PI * 2 + Math.random() * 0.4;
      const v = (90 + Math.random() * 90) * k * this.speed;
      this.particle({
        x: at.x + Math.cos(angle) * 30 * k,
        y: at.y + Math.sin(angle) * 30 * k,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v * 0.7 - 40 * k * this.speed,
        drag: 0.15,
        size: 34 * k,
        endSize: 56 * k,
        color: PUFF_COLORS[i % PUFF_COLORS.length],
        alpha: 0.9,
        additive: false,
        life: PUFF_MS * (0.8 + Math.random() * 0.4),
      });
    }
    this.tween(PUFF_MS * 0.5, (r, p) => {
      const radius = (50 + 50 * p) * k;
      r.rect(at.x - radius, at.y - radius, radius * 2, radius * 2, { fill: withAlpha(WHITE, 0.85 * (1 - p)), radius, softness: radius * 0.5 });
    });
  }

  /** Confusion over: the stars fly off its head, with a glint. */
  confusionEnd(head: EffectPoint, size: number): void {
    const k = size / 240;
    for (let i = 0; i < CONFUSION_STARS; i++) {
      const a = (i / CONFUSION_STARS) * Math.PI * 2 - Math.PI / 2;
      const v = 260 * k * this.speed;
      this.particle({
        x: head.x + Math.cos(a) * 76 * k,
        y: head.y + Math.sin(a) * 20 * k,
        vx: Math.cos(a) * v,
        vy: -200 * k * this.speed,
        gravity: 700 * k * this.speed * this.speed,
        size: 36 * k,
        endSize: 20 * k,
        color: STAR_COLOR,
        life: 700,
        shape: STAR,
        spin: (i - 1) * 6 * this.speed,
        additive: false,
      });
    }
    this.pieces(head, { shape: SPARKLE, colors: [WHITE, STAR_COLOR], size: 22, endSize: 4, speed: 200, drag: 0.1, life: 480, spin: 3 }, 6, k);
    this.tween(FLASH_MS, (r, p) => glowDot(r, head.x, head.y, (30 + 60 * p) * k, WHITE, 0.7 * (1 - p), true));
  }

  /**
   * A special move: an orb gathers at its user (light drawn in), then flies to each target in an arc
   * leaving a trail, bursting where it hits (`arrived` per target); a beam streams orbs, a wave rolls
   * rings, pillars burst out under the targets, or rings close in on them.
   */
  projectiles(from: EffectPoint, targets: readonly EffectTarget[], type: string, size: number, arrived: (target: EffectTarget) => void, kind: 'orb' | 'beam' | 'wave' | 'erupt' | 'psywave'): void {
    const k = size / 240;
    const color = effectColor(type);
    if (kind === 'erupt' || kind === 'psywave') {
      for (const target of targets) {
        if (kind === 'erupt') this.pillars(target, type, k, () => arrived(target));
        else this.closingRings(target, type, k, () => arrived(target));
      }
      return;
    }
    // Gathering: light drawn into the user.
    this.tween(CHARGE_MS, (r, p) => glowDot(r, from.x, from.y, 26 * k * easeOut(p), mix(WHITE, color, 0.4), 0.9, true));
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = (60 + Math.random() * 40) * k;
      const life = CHARGE_MS * (0.7 + Math.random() * 0.3);
      this.particle({
        x: from.x + Math.cos(angle) * distance,
        y: from.y + Math.sin(angle) * distance,
        vx: (-Math.cos(angle) * distance * 1000 * this.speed) / life,
        vy: (-Math.sin(angle) * distance * 1000 * this.speed) / life,
        size: 5 * k,
        endSize: 2 * k,
        color,
        life,
      });
    }
    this.later(CHARGE_MS * LAUNCH_AT, () => {
      for (const target of targets) {
        if (kind === 'beam') this.beam(from, target, type, k, () => arrived(target));
        else if (kind === 'wave') this.wave(from, target, type, k, () => arrived(target));
        else this.orb(from, target, type, k, () => arrived(target));
      }
    });
  }

  private orb(from: EffectPoint, target: EffectTarget, type: string, k: number, arrived: () => void): void {
    const color = effectColor(type);
    const trail = typeEffect(type)?.trail;
    const arc = 50 * k;
    this.tween(
      FLIGHT_MS,
      (r, p) => {
        const e = easeInOut(p);
        const x = from.x + (target.at.x - from.x) * e;
        const y = from.y + (target.at.y - from.y) * e - Math.sin(Math.PI * e) * arc;
        // A solid core in its colour (light alone washes out on the bright field), lit from inside.
        glowDot(r, x, y, 20 * k, color, 0.95, false);
        glowDot(r, x, y, 30 * k, color, 0.55, true);
        glowDot(r, x, y, 11 * k, WHITE, 1, true);
        // Its type's pieces trail behind it (flames, drops, leaves…); sparks for an unknown type.
        if (trail) this.pieces({ x, y }, trail, Math.random() < 0.6 ? 1 : 2, k);
        else this.particle({ x, y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, size: 9 * k, endSize: 0, color, life: 260 });
      },
      () => {
        if (target.hit) this.hitAt(target.at, type, k);
        else this.tween(220, (r, p) => glowDot(r, target.at.x, target.at.y, 24 * k * (1 + p), color, 0.6 * (1 - p), true));
        arrived();
      },
    );
  }

  private beam(from: EffectPoint, target: EffectTarget, type: string, k: number, arrived: () => void): void {
    const color = effectColor(type);
    for (let i = 0; i < BEAM_ORBS; i++) {
      const last = i === BEAM_ORBS - 1;
      this.tween(
        BEAM_FLIGHT_MS,
        (r, p) => {
          const x = from.x + (target.at.x - from.x) * p;
          const y = from.y + (target.at.y - from.y) * p;
          glowDot(r, x, y, 14 * k, color, 0.9, false);
          glowDot(r, x, y, 22 * k, color, 0.5, true);
          glowDot(r, x, y, 8 * k, WHITE, 0.9, true);
        },
        last
          ? () => {
              if (target.hit) this.hitAt(target.at, type, k);
              arrived();
            }
          : undefined,
        i * BEAM_GAP_MS,
      );
    }
  }

  private wave(from: EffectPoint, target: EffectTarget, type: string, k: number, arrived: () => void): void {
    const color = effectColor(type);
    for (let i = 0; i < WAVE_RINGS; i++) {
      const last = i === WAVE_RINGS - 1;
      this.tween(
        WAVE_FLIGHT_MS,
        (r, p) => {
          const x = from.x + (target.at.x - from.x) * p;
          const y = from.y + (target.at.y - from.y) * p;
          ring(r, x, y, (20 + 60 * p) * k, 6 * k, color, 0.9 - 0.5 * p);
        },
        last
          ? () => {
              if (target.hit) this.hitAt(target.at, type, k, true);
              arrived();
            }
          : undefined,
        i * WAVE_GAP_MS,
      );
    }
  }

  /** A hit landing: a flash and a ring in the type's colour, its pieces and its flourish. */
  private hitAt(at: EffectPoint, type: string, k: number, light = false): void {
    const color = effectColor(type);
    const scale = light ? 0.7 : 1;
    this.tween(IMPACT_MS * 0.6, (r, p) => glowDot(r, at.x, at.y, (18 + 44 * p) * k * scale, mix(WHITE, color, p), 1 - p, true));
    this.tween(IMPACT_MS, (r, p) => ring(r, at.x, at.y, (12 + 70 * easeOut(p)) * k * scale, (5 - 3 * p) * k, color, 1 - p));
    const effect = typeEffect(type);
    if (!effect) {
      this.burst(at, color, light ? 8 : 16, 380 * k, 7 * k);
      return;
    }
    const count = Math.round(IMPACT_PIECES * (light ? 0.5 : 1));
    for (const piece of effect.impact) this.pieces(at, piece, count, k);
    switch (effect.flourish) {
      case 'pow':
        this.pow(at, color, k * scale);
        break;
      case 'flash':
        this.tween(FLASH_MS, (r, p) => glowDot(r, at.x, at.y, (70 + 50 * p) * k * scale, mix(WHITE, color, 0.3), 0.9 * (1 - p), true));
        break;
      case 'bubbles':
        this.bubbles(at, color, k, light ? BUBBLES / 2 : BUBBLES);
        break;
      case 'blot':
        this.tween(BLOT_MS, (r, p) => {
          const radius = (30 + 70 * easeOut(p)) * k * scale;
          r.rect(at.x - radius, at.y - radius, radius * 2, radius * 2, { fill: withAlpha(BLOT_COLOR, 0.6 * (1 - p)), radius, softness: radius * 0.6 });
        });
        break;
      case 'rings':
        for (let i = 0; i < 3; i++) {
          this.tween(IMPACT_MS, (r, p) => ring(r, at.x, at.y, (20 + 90 * easeOut(p)) * k * scale, 4 * k, color, 1 - p), undefined, i * 90);
        }
        break;
      case 'frost':
        this.tween(IMPACT_MS, (r, p) => ring(r, at.x, at.y, (16 + 80 * easeOut(p)) * k * scale, (9 - 6 * p) * k, WHITE, 0.9 * (1 - p)));
        break;
      case 'dust':
        this.dustAt({ x: at.x, y: at.y + 50 * k }, k, light ? 5 : 10);
        break;
    }
  }

  /** A blow's spiky "pow", popping out and fading. */
  private pow(at: EffectPoint, color: Rgba, k: number): void {
    const fill = mix(POW_COLOR, color, 0.25);
    this.tween(POW_MS, (r, p) => {
      const grow = p < 0.3 ? backOut(p / 0.3) : 1;
      const fade = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
      drawShape(r, POW, at.x, at.y, 84 * k * grow, fill, fade, 0, false);
    });
  }

  /** Bubbles rising off a hit, wobbling. */
  private bubbles(at: EffectPoint, color: Rgba, k: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const x = at.x + (Math.random() - 0.5) * 120 * k;
      const y = at.y + (Math.random() - 0.2) * 60 * k;
      const radius = (7 + Math.random() * 8) * k;
      const phase = Math.random() * Math.PI * 2;
      this.tween(
        BUBBLE_MS,
        (r, p) => {
          const bx = x + Math.sin(phase + p * 9) * 8 * k;
          const by = y - 110 * k * easeOut(p);
          const alpha = p < 0.85 ? 0.9 : (1 - p) / 0.15;
          ring(r, bx, by, radius, 2.5 * k, mix(WHITE, color, 0.4), alpha);
          glowDot(r, bx - radius * 0.35, by - radius * 0.35, radius * 0.3, WHITE, alpha, true);
        },
        undefined,
        i * 60,
      );
    }
  }

  /** Pillars of the type's colour burst out of the ground under the target. */
  private pillars(target: EffectTarget, type: string, k: number, arrived: () => void): void {
    const color = effectColor(type);
    const feet = target.at.y + 90 * k;
    PILLAR_OFFSETS.forEach((offset, i) => {
      const x = target.at.x + offset * 240 * k;
      this.tween(
        PILLAR_MS,
        (r, p) => {
          const rise = easeOut(Math.min(1, p * 2));
          const height = 190 * k * rise;
          const fade = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
          r.rect(x - 16 * k, feet - height, 32 * k, height, { fill: withAlpha(color, 0.75 * fade), radius: 16 * k, softness: 8 * k, additive: true });
          r.rect(x - 6 * k, feet - height, 12 * k, height, { fill: withAlpha(WHITE, 0.8 * fade), radius: 6 * k, additive: true });
          if (Math.random() < 0.5) this.particle({ x: x + (Math.random() - 0.5) * 30 * k, y: feet - height, vy: -200 * k, size: 6 * k, color, life: 300 });
        },
        i === 1
          ? () => {
              if (target.hit) this.hitAt(target.at, type, k);
              arrived();
            }
          : undefined,
        GROUND_DELAY_MS + i * PILLAR_GAP_MS,
      );
    });
  }

  /** Rings closing in on the target (Psychic). */
  private closingRings(target: EffectTarget, type: string, k: number, arrived: () => void): void {
    const color = effectColor(type);
    for (let i = 0; i < PSY_RINGS; i++) {
      const last = i === PSY_RINGS - 1;
      this.tween(
        PSY_MS,
        (r, p) => ring(r, target.at.x, target.at.y, (110 - 90 * easeIn(p)) * k, (3 + 5 * p) * k, color, 0.3 + 0.7 * p),
        last
          ? () => {
              if (target.hit) this.hitAt(target.at, type, k);
              arrived();
            }
          : undefined,
        GROUND_DELAY_MS + i * PSY_GAP_MS,
      );
    }
  }

  /** A rush's trail: light shed along the lunge. `position` gives where the user is at a progress. */
  trail(position: (progress: number) => EffectPoint, type: string, size: number, ms: number): void {
    const k = size / 240;
    const color = effectColor(type);
    this.tween(ms, (r, p) => {
      const at = position(p);
      glowDot(r, at.x, at.y, 46 * k * (1 - p), color, 0.35, true);
      for (let i = 0; i < 2; i++) {
        this.particle({ x: at.x + (Math.random() - 0.5) * 60 * k, y: at.y + (Math.random() - 0.5) * 80 * k, size: 10 * k, endSize: 0, color, life: 300 });
      }
    });
  }

  /** A run of light hits around the target's body. */
  flurry(at: EffectPoint, type: string, size: number, first: () => void): void {
    FLURRY_OFFSETS.forEach(([dx, dy], i) =>
      this.later(i * FLURRY_GAP_MS, () => {
        this.impact({ x: at.x + dx * size, y: at.y + dy * size }, type, size, true);
        if (i === 0) first();
      }),
    );
  }

  /** Two orbs slam together on the target. */
  clap(at: EffectPoint, type: string, size: number, met: () => void): void {
    const k = size / 240;
    const color = effectColor(type);
    const reach = 130 * k;
    this.tween(
      CLAP_MS,
      (r, p) => {
        const e = easeIn(p);
        for (const side of [-1, 1]) {
          const x = at.x + side * reach * (1 - e);
          glowDot(r, x, at.y, 26 * k, color, 0.6, true);
          glowDot(r, x, at.y, 11 * k, WHITE, 1, true);
        }
      },
      () => {
        this.impact(at, type, size);
        met();
      },
    );
  }

  /** Rocks fall on the target, one after another, and break into dust. */
  rocks(at: EffectPoint, hit: boolean, size: number, landed: () => void): void {
    const k = size / 240;
    ROCK_OFFSETS.forEach((offset, i) => {
      const x = at.x + offset * size;
      const endY = at.y + (i % 2 === 0 ? -0.05 : 0.08) * size;
      const startY = endY - 300 * k;
      const radius = (22 + (i % 2) * 8) * k;
      this.tween(
        ROCK_FALL_MS,
        (r, p) => {
          const y = startY + (endY - startY) * easeIn(p);
          r.rect(x - radius, y - radius, radius * 2, radius * 2, {
            fill: ROCK_COLOR,
            stroke: [0.35, 0.27, 0.18, 1],
            radius: radius * 0.45,
            border: 3 * k,
            angle: p * 4 + i,
          });
        },
        () => {
          this.dustAt({ x, y: endY }, k, 8);
          if (i === 0 && hit) landed();
        },
        i * ROCK_GAP_MS,
      );
    });
  }

  /** Dust rising at the feet of everyone an earthquake hits. */
  dust(points: readonly EffectPoint[], size: number): void {
    const k = size / 240;
    for (const at of points) this.dustAt({ x: at.x, y: at.y + 90 * k }, k, 18);
  }

  private dustAt(at: EffectPoint, k: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI + Math.random() * Math.PI;
      const v = (60 + Math.random() * 120) * k * this.speed;
      this.particle({
        x: at.x + (Math.random() - 0.5) * 80 * k,
        y: at.y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v * 0.6,
        drag: 0.2,
        size: 10 * k,
        endSize: 26 * k,
        color: DUST_COLOR,
        alpha: 0.7,
        additive: false,
        life: DUST_MS * (0.7 + Math.random() * 0.5),
      });
    }
  }

  /** Tailwind: streaks of wind sweeping across a band of the field. */
  gusts(towardsRight: boolean, top: number, bottom: number, size: number): void {
    const k = size / 240;
    for (let i = 0; i < GUSTS; i++) {
      const y = top + Math.random() * (bottom - top);
      const length = (140 + Math.random() * 80) * k;
      this.tween(
        GUST_MS,
        (r, p) => {
          const travel = (FIELD_WIDTH + length) * easeInOut(p);
          const x = towardsRight ? -length + travel : FIELD_WIDTH - travel;
          const fade = Math.sin(Math.PI * p);
          r.rect(x, y - 3 * k, length, 6 * k, { fill: withAlpha(GUST_COLOR, 0.7 * fade), radius: 3 * k, softness: 3 * k, additive: true });
        },
        undefined,
        i * GUST_GAP_MS,
      );
    }
  }

  /** A room: the whole field pulses twice in its colour. */
  roomPulse(move: string, type: string): void {
    const color = ROOM_COLORS[move.toLowerCase().replace(/[^a-z]/g, '')] ?? effectColor(type);
    this.tween(ROOM_MS, (r, p) => {
      const pulse = Math.abs(Math.sin(p * Math.PI * 2));
      r.rect(0, 0, FIELD_WIDTH, FIELD_HEIGHT, { fill: withAlpha(color, 0.45 * pulse) });
      r.rect(0, 0, FIELD_WIDTH, FIELD_HEIGHT, { fill: [0, 0, 0, 0], stroke: withAlpha(color, pulse), border: 10, softness: 1 });
    });
  }

  /** A protection: a bubble pulses around the Pokémon, with light running round it. */
  shield(at: EffectPoint, size: number): void {
    const k = size / 240;
    const radius = 110 * k;
    this.tween(SHIELD_MS, (r, p) => {
      const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 6 - Math.PI / 2);
      const fade = p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
      const grow = easeOut(Math.min(1, p * 4));
      r.rect(at.x - radius * grow, at.y - radius * grow, radius * 2 * grow, radius * 2 * grow, {
        fill: withAlpha(SHIELD_COLOR, (0.12 + 0.18 * pulse) * fade),
        stroke: withAlpha(SHIELD_COLOR, (0.6 + 0.4 * pulse) * fade),
        radius: radius * grow,
        border: 4 * k,
        additive: true,
      });
      const angle = p * Math.PI * 4;
      glowDot(r, at.x + Math.cos(angle) * radius * grow, at.y + Math.sin(angle) * radius * grow, 14 * k, WHITE, fade, true);
    });
  }

  /** Wide Guard and the like: a barrier pulses across the side. */
  wall(points: readonly EffectPoint[], size: number): void {
    if (points.length === 0) return;
    const k = size / 240;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const left = Math.min(...xs) - 120 * k;
    const right = Math.max(...xs) + 120 * k;
    const y = ys.reduce((a, b) => a + b, 0) / ys.length;
    this.tween(SHIELD_MS, (r, p) => {
      const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 6 - Math.PI / 2);
      const fade = p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
      r.rect(left, y - 120 * k, right - left, 240 * k, {
        fill: withAlpha(SHIELD_COLOR, (0.1 + 0.15 * pulse) * fade),
        stroke: withAlpha(SHIELD_COLOR, (0.6 + 0.4 * pulse) * fade),
        radius: 24 * k,
        border: 4 * k,
        additive: true,
      });
    });
  }

  /** A status move: rings spread around the Pokémon and sparks rise from it. */
  aura(at: EffectPoint, type: string, size: number): void {
    const k = size / 240;
    const color = effectColor(type);
    for (let i = 0; i < 2; i++) {
      this.tween(AURA_RING_MS, (r, p) => ring(r, at.x, at.y, (24 + 90 * easeOut(p)) * k, 5 * k, color, 1 - p), undefined, i * AURA_RING_GAP_MS);
    }
    const trail = typeEffect(type)?.trail;
    for (let i = 0; i < 10; i++) {
      // Its type's pieces rise around it (flames, leaves, glints…), or plain sparks.
      if (trail) {
        const from = { x: at.x + (Math.random() - 0.5) * 140 * k, y: at.y + (Math.random() - 0.2) * 80 * k };
        this.later(i * 40, () => this.pieces(from, { ...trail, speed: 140, direction: -Math.PI / 2, spread: 0.3, scatter: 0, life: AURA_SPARK_MS }, 1, k));
        continue;
      }
      this.later(i * 40, () =>
        this.particle({
          x: at.x + (Math.random() - 0.5) * 140 * k,
          y: at.y + (Math.random() - 0.2) * 80 * k,
          vy: -140 * k * this.speed,
          size: 7 * k,
          endSize: 2 * k,
          color: Math.random() < 0.3 ? WHITE : color,
          life: AURA_SPARK_MS,
        }),
      );
    }
  }

  /** A stat stage changed: streaks of light rise (raised, green) or fall (lowered, red), in two waves. */
  statChange(at: EffectPoint, raised: boolean, size: number): void {
    const k = size / 240;
    const color = raised ? STAT_UP_COLOR : STAT_DOWN_COLOR;
    for (let wave = 0; wave < 2; wave++) {
      for (let i = 0; i < STAT_STREAKS; i++) {
        const x = at.x + ((i / (STAT_STREAKS - 1)) * 2 - 1) * 70 * k + (Math.random() - 0.5) * 16 * k;
        const startY = at.y + (raised ? 60 : -90) * k + (Math.random() - 0.5) * 30 * k;
        this.tween(
          STAT_STREAK_MS,
          (r, p) => {
            const y = startY + (raised ? -1 : 1) * 150 * k * easeOut(p);
            const fade = Math.sin(Math.PI * p);
            r.rect(x - 5 * k, y - 28 * k, 10 * k, 56 * k, { fill: withAlpha(color, 0.9 * fade), radius: 5 * k, softness: 4 * k, additive: true });
          },
          undefined,
          wave * STAT_WAVE_GAP_MS + i * 30,
        );
      }
    }
  }
}

/**
 * A pixel shape (effect-shapes) tinted `color`, about `height` px tall (whole screen pixels per
 * shape pixel, so it stays crisp), centred on (x, y) and turned `angle` radians; its outline darker.
 */
export function drawShape(renderer: GlRenderer, shape: EffectShape, x: number, y: number, height: number, color: Rgba, alpha: number, angle = 0, additive = false): void {
  if (height < 1 || alpha <= 0.01) return;
  const px = Math.max(1, Math.round(height / shape.height));
  const w = shape.width * px;
  const h = shape.height * px;
  renderer.rect(x - w / 2, y - h / 2, w, h, { fill: withAlpha(color, alpha), texture: maskOf(renderer, shape.fill), angle, additive });
  if (shape.ink.length > 0) {
    const ink: Rgba = [color[0] * 0.3, color[1] * 0.3, color[2] * 0.3, 1];
    renderer.rect(x - w / 2, y - h / 2, w, h, { fill: withAlpha(ink, alpha), texture: maskOf(renderer, shape.ink), angle, additive });
  }
}

/** A soft round light (or a plain disc without `additive`). */
export function glowDot(renderer: GlRenderer, x: number, y: number, radius: number, color: Rgba, alpha: number, additive: boolean): void {
  if (radius <= 0.2 || alpha <= 0.01) return;
  renderer.rect(x - radius, y - radius, radius * 2, radius * 2, { fill: withAlpha(color, alpha), radius, softness: additive ? radius * 0.9 : 1, additive });
}

/** A circle's outline, `width` thick: light by default, or solid (`additive` false) where light would wash out. */
export function ring(renderer: GlRenderer, x: number, y: number, radius: number, width: number, color: Rgba, alpha: number, additive = true): void {
  if (radius <= 0.5 || alpha <= 0.01) return;
  renderer.rect(x - radius, y - radius, radius * 2, radius * 2, { fill: [0, 0, 0, 0], stroke: withAlpha(color, alpha), radius, border: Math.max(1, width), additive });
}

/** The colour at `alpha` times its own, clamped to 0..1. */
export function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * Math.max(0, Math.min(1, alpha))];
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Out and back: 0 → 1 at the middle → 0. */
export function outAndBack(progress: number): number {
  return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
}

/** Overshoots a little before settling (a pop). */
export function backOut(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

export function easeIn(t: number): number {
  return t * t * t;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
