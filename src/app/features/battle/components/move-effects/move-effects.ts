import { Component, DestroyRef, ElementRef, inject } from '@angular/core';
import { stepAnimation } from '@features/battle/animation/step-animation';
import { SlotKey } from '@features/battle/models/battle';

/**
 * Pieces kept mounted: enough for a spread wave's two impacts (2 × 7) and its rings still rolling
 * (2 × 3), with a few to spare. Hidden ones cost nothing.
 */
const POOL_SIZE = 24;

// Lengths at normal speed (a move's log step lasts 1100 ms); the replay speed divides them.
/** A special move gathers at its user… */
const CHARGE_MS = 240;
/** …and flies to each target, leaving once the charge is most of the way through. */
const LAUNCH_AT = 0.7;
const FLIGHT_MS = 340;
const IMPACT_MS = 380;
const AURA_RING_MS = 460;
const AURA_RING_GAP_MS = 180;
const AURA_SPARK_MS = 640;
const IMPACT_SPARKS = 5;
const AURA_SPARKS = 4;
/** A beam: a stream of orbs, one every BEAM_GAP_MS, each crossing in BEAM_FLIGHT_MS. */
const BEAM_ORBS = 12;
const BEAM_GAP_MS = 25;
const BEAM_FLIGHT_MS = 240;
/** A wave: rings rolling out one after another, growing as they go. */
const WAVE_RINGS = 3;
const WAVE_GAP_MS = 90;
const WAVE_FLIGHT_MS = 380;
/** A rush's trail: orbs lagging behind the user, each this much later along its lunge. */
const TRAIL_ORBS = 4;
const TRAIL_LAG = 0.06;
/** A flurry: light hits landing one after another around the target's body. */
const FLURRY_OFFSETS = [
  [-0.12, -0.1],
  [0.12, 0],
  [-0.02, 0.12],
] as const;
const FLURRY_GAP_MS = 120;
/** A clap: two orbs from either side meeting on the target. */
const CLAP_MS = 160;
/** A room: the whole field pulses twice in its colour (Trick Room in the violet of its frame). */
const ROOM_MS = 800;
const ROOM_PULSES = 2;
const ROOM_OPACITY = 0.45;
const ROOM_COLORS: Readonly<Record<string, Rgb>> = { trickroom: [168, 85, 247] };
/** A protection: a shield (or the side's barrier) pulses three times. */
const SHIELD_MS = 900;
const SHIELD_PULSES = 3;
const SHIELD_FILL = [165, 243, 252] as const;
const SHIELD_EDGE = [103, 232, 249] as const;
/** Moves that don't fly (pillars, closing rings) start once the user's glow has begun. */
const GROUND_DELAY_MS = 200;
/** Pillars bursting out of the ground: three, a little apart in time. */
const PILLAR_OFFSETS = [-0.2, 0, 0.2] as const;
const PILLAR_GAP_MS = 60;
const PILLAR_MS = 420;
/** Psychic: rings closing in on the target. */
const PSY_RINGS = 3;
const PSY_GAP_MS = 110;
const PSY_MS = 320;
/** Falling rocks: where each lands across the target's body, one after another. */
const ROCK_OFFSETS = [-0.22, 0.12, -0.04, 0.24] as const;
const ROCK_GAP_MS = 90;
const ROCK_FALL_MS = 260;
const ROCK_GRADIENT =
  'radial-gradient(circle, rgba(222, 200, 160, 1) 0%, rgba(150, 120, 80, 1) 45%, rgba(110, 88, 60, 1) 60%, rgba(110, 88, 60, 0) 68%)';
/** Earthquake: dust puffs at the feet of every Pokémon it hits. */
const DUST_MS = 520;
const DUST_COLOR = [140, 100, 55] as const;
/** Tailwind: gusts sweeping across the side, towards the other one. */
const GUSTS = 6;
const GUST_GAP_MS = 90;
const GUST_MS = 440;
const GUST_COLOR = [210, 230, 255] as const;
/** Stat changes: streaks rising (raised) or falling (lowered), in two waves, green and red as the stage chips. */
const STAT_STREAKS = 5;
const STAT_STREAK_MS = 620;
const STAT_WAVE_GAP_MS = 200;
const STAT_UP_COLOR = [70, 210, 100] as const;
const STAT_DOWN_COLOR = [240, 70, 60] as const;

/**
 * Bright type colours for the effects (the rows' colours in type-colors are darkened for white text).
 * RGB triplets, since the gradients need them with an alpha (Brewser's support for #rrggbbaa is unknown).
 */
const EFFECT_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
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
const DEFAULT_COLOR = [230, 230, 230] as const;
/** The field's size, which the host covers. */
const FIELD_WIDTH = 985;
const FIELD_HEIGHT = 500;

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

type Rgb = readonly [number, number, number];

/**
 * A move's visual effect over the field, in its type's colour: a burst with sparks where a hit lands,
 * an orb that gathers at a special move's user and flies to each target, rings and rising sparks
 * around the Pokémon a status move affects; and the patterns some moves have of their own (see
 * move-patterns): beams, waves, trails, flurries, claps, rooms, shields and barriers, pillars,
 * closing rings, falling rocks, dust and gusts. Every shape is a radial-gradient box (probe N2: they
 * render, and `border-radius` circles don't; a box sized by width/height grows fine where a scale()
 * transform gets clipped). The pieces are always mounted and hidden with display, since re-creating
 * DOM stutters on the console; frames move them by left/top on requestAnimationFrame.
 */
@Component({
  selector: 'app-move-effects',
  host: { class: 'absolute top-0 left-0 block h-[500px] w-[985px]', 'aria-hidden': 'true' },
  template: `
    @for (piece of pieces; track piece) {
      <div class="absolute top-0 left-0 hidden h-0 w-0"></div>
    }
  `,
})
export class MoveEffects {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly pieces = Array.from({ length: POOL_SIZE }, (_, i) => i);
  private readonly busy = new Set<HTMLElement>();
  private readonly running = new Set<() => void>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Stops every effect and hides its pieces (a new move replaces the last one's). */
  stop(): void {
    this.running.forEach((stop) => stop());
    this.running.clear();
    this.busy.forEach((piece) => hide(piece));
    this.busy.clear();
  }

  /**
   * A hit landing: a ring bursting out of a flash, with sparks flying off. `size` is the sprite's; a
   * `light` hit (one of a flurry) is smaller, with two sparks.
   */
  impact(at: EffectPoint, type: string, size: number, speed: number, light = false): void {
    const rgb = colorOf(type);
    const ms = IMPACT_MS / speed;
    const scale = light ? 0.6 : 1;
    const sparks = light ? 2 : IMPACT_SPARKS;
    this.run(ms, gradient(rgb, 'ring'), (piece, p) => place(piece, at.x, at.y, size * scale * (0.2 + 0.55 * p), 1 - p));
    this.run(ms, gradient(rgb, 'orb'), (piece, p) => place(piece, at.x, at.y, size * scale * (0.45 - 0.25 * p), p < 0.5 ? 1 - p * 2 : 0));
    for (let i = 0; i < sparks; i++) {
      const angle = (i / sparks) * 2 * Math.PI - Math.PI / 2 + (light ? Math.PI / 4 : 0);
      this.run(ms, gradient(rgb, 'spark'), (piece, p) => {
        const reach = size * scale * 0.42 * easeOut(p);
        place(piece, at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach, size * 0.11, 1 - p * p);
      });
    }
  }

  /**
   * A special move: an orb gathers at the user, then one flies to each target along a low arc (a
   * 'beam' streams orbs there instead; a 'wave' rolls rings out, with no gathering). `arrived` is
   * called for each target as the attack gets there, after the impact starts on the ones it hits.
   */
  projectiles(
    from: EffectPoint,
    targets: readonly EffectTarget[],
    type: string,
    size: number,
    speed: number,
    arrived: (target: EffectTarget) => void,
    style: 'orb' | 'beam' | 'wave' | 'erupt' | 'psywave' = 'orb',
  ): void {
    const rgb = colorOf(type);
    const land = (target: EffectTarget) => {
      if (target.hit) this.impact(target.at, type, size, speed);
      arrived(target);
    };
    if (style === 'wave') {
      targets.forEach((target) => this.wave(from, target, rgb, size, speed, () => land(target)));
      return;
    }
    if (style === 'erupt' || style === 'psywave') {
      this.after(GROUND_DELAY_MS / speed, () =>
        targets.forEach((target) =>
          style === 'erupt' ? this.pillars(target.at, rgb, size, speed, () => land(target)) : this.psyRings(target.at, rgb, size, speed, () => land(target)),
        ),
      );
      return;
    }
    const chargeMs = CHARGE_MS / speed;
    this.run(chargeMs, gradient(rgb, 'orb'), (piece, p) => {
      const grow = Math.min(1, p / LAUNCH_AT);
      place(piece, from.x, from.y, size * 0.34 * grow, p < LAUNCH_AT ? 1 : (1 - p) / (1 - LAUNCH_AT));
    });
    this.after(chargeMs * LAUNCH_AT, () => {
      for (const target of targets) {
        if (style === 'beam') {
          this.beam(from, target, rgb, size, speed, () => land(target));
          continue;
        }
        const { at } = target;
        const lift = Math.hypot(at.x - from.x, at.y - from.y) * 0.18;
        this.run(
          FLIGHT_MS / speed,
          gradient(rgb, 'orb'),
          (piece, p) => {
            const x = from.x + (at.x - from.x) * p;
            const y = from.y + (at.y - from.y) * p - 4 * lift * p * (1 - p);
            place(piece, x, y, size * 0.27, target.hit || p < 0.8 ? 1 : (1 - p) * 5);
          },
          () => land(target),
        );
      }
    });
  }

  /**
   * Orbs trailing a rushing user: they follow its lunge (`dx`, `dy` at the far end, out and back over
   * `ms`) a little behind it, fading as it comes back.
   */
  trail(from: EffectPoint, dx: number, dy: number, type: string, size: number, ms: number, speed: number): void {
    const rgb = colorOf(type);
    for (let k = 1; k <= TRAIL_ORBS; k++) {
      this.run(ms / speed, gradient(rgb, 'orb'), (piece, p) => {
        const lagged = Math.max(0, p - k * TRAIL_LAG);
        const amount = lagged < 0.5 ? lagged * 2 : (1 - lagged) * 2;
        const fade = (1 - (k - 1) / TRAIL_ORBS) * (p < 0.5 ? 1 : (1 - p) * 2);
        place(piece, from.x + dx * amount, from.y + dy * amount, size * 0.3 * (1 - k * 0.12), p < k * TRAIL_LAG ? 0 : fade);
      });
    }
  }

  /** A quick run of light hits around the target's body; `first` runs as the first lands. */
  flurry(at: EffectPoint, type: string, size: number, speed: number, first: () => void): void {
    FLURRY_OFFSETS.forEach(([x, y], i) =>
      this.after((i * FLURRY_GAP_MS) / speed, () => {
        this.impact({ x: at.x + x * size, y: at.y + y * size }, type, size, speed, true);
        if (i === 0) first();
      }),
    );
  }

  /** Two orbs slam together on the target from either side; `met` runs as they meet, after its impact starts. */
  clap(at: EffectPoint, type: string, size: number, speed: number, met: () => void): void {
    const rgb = colorOf(type);
    for (const side of [-1, 1]) {
      this.run(
        CLAP_MS / speed,
        gradient(rgb, 'orb'),
        (piece, p) => place(piece, at.x + side * size * 0.5 * (1 - p * p), at.y, size * 0.24, 1),
        side === 1
          ? () => {
              this.impact(at, type, size, speed);
              met();
            }
          : undefined,
      );
    }
  }

  /**
   * Rock Slide: rocks fall one after another onto the target, each landing with a small burst when it
   * hits; `landed` runs as the first gets there.
   */
  rocks(at: EffectPoint, type: string, hit: boolean, size: number, speed: number, landed: () => void): void {
    const rock = size * 0.2;
    // From just inside the field's top edge at most: nothing clips what spills out on the console.
    const top = Math.max(rock / 2, at.y - size * 0.9);
    ROCK_OFFSETS.forEach((offset, i) =>
      this.after((i * ROCK_GAP_MS) / speed, () => {
        const x = at.x + offset * size;
        const bottom = at.y + (i % 2 ? 0.08 : -0.04) * size;
        this.run(
          ROCK_FALL_MS / speed,
          ROCK_GRADIENT,
          (piece, p) => place(piece, x, top + (bottom - top) * p * p, rock * (i % 2 ? 0.85 : 1), 1),
          () => {
            if (hit) this.impact({ x, y: bottom }, type, size, speed, true);
            if (i === 0) landed();
          },
        );
      }),
    );
  }

  /** Earthquake: dust puffs up at the feet of each Pokémon it shakes. */
  dust(points: readonly EffectPoint[], size: number, speed: number): void {
    const background = gradient(DUST_COLOR, 'spark');
    for (const at of points) {
      for (const side of [-1, 1]) {
        this.run(DUST_MS / speed, background, (piece, p) =>
          place(piece, at.x + side * size * (0.12 + 0.25 * p), at.y + size * (0.32 - 0.12 * p), size * (0.24 + 0.26 * p), 1 - p),
        );
      }
    }
  }

  /**
   * Tailwind: gusts sweep across the user's side, between `top` and `bottom`, towards the other side
   * (left to right for the player's).
   */
  gusts(towardsRight: boolean, top: number, bottom: number, size: number, speed: number): void {
    const width = size * 0.6;
    const height = size * 0.06;
    const background = `radial-gradient(rgba(255, 255, 255, 0.95) 0%, ${rgba(GUST_COLOR, 0.8)} 40%, ${rgba(GUST_COLOR, 0)} 70%)`;
    // Inside the field from end to end: nothing clips what spills out on the console.
    const start = width / 2;
    const end = FIELD_WIDTH - width / 2;
    for (let i = 0; i < GUSTS; i++) {
      const y = top + ((i * 0.618) % 1) * (bottom - top);
      this.after((i * GUST_GAP_MS) / speed, () =>
        this.run(GUST_MS / speed, background, (piece, p) => {
          const x = towardsRight ? start + (end - start) * p : end - (end - start) * p;
          placeBox(piece, x, y, width, height, p < 0.2 ? p / 0.2 : p > 0.8 ? (1 - p) / 0.2 : 1);
        }),
      );
    }
  }

  /** A room (Trick Room…): the whole field pulses in its colour. */
  roomPulse(move: string, type: string, speed: number): void {
    const rgb = ROOM_COLORS[move.toLowerCase().replace(/[^a-z]/g, '')] ?? colorOf(type);
    this.run(ROOM_MS / speed, rgba(rgb, 1), (piece, p) =>
      placeBox(piece, FIELD_WIDTH / 2, FIELD_HEIGHT / 2, FIELD_WIDTH, FIELD_HEIGHT, ROOM_OPACITY * Math.abs(Math.sin(p * ROOM_PULSES * Math.PI))),
    );
  }

  /** Protect (and the like): a shield pulses around the Pokémon. */
  shield(at: EffectPoint, size: number, speed: number): void {
    this.shieldPulse(at, size * 0.83, size * 0.83, 'circle', speed);
  }

  /** Wide Guard (and the like): a barrier pulses across the side, over all its Pokémon. */
  wall(points: readonly EffectPoint[], size: number, speed: number): void {
    if (points.length === 0) return;
    const xs = points.map((point) => point.x);
    const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    this.shieldPulse(centre, Math.max(...xs) - Math.min(...xs) + size * 0.9, size * 0.8, 'ellipse', speed);
  }

  private shieldPulse(at: EffectPoint, width: number, height: number, shape: 'circle' | 'ellipse', speed: number): void {
    // A see-through fill with a bright edge; an ellipse is the gradient's own shape on a wide box.
    const form = shape === 'circle' ? 'circle, ' : '';
    const background = `radial-gradient(${form}${rgba(SHIELD_FILL, 0.35)} 0%, ${rgba(SHIELD_FILL, 0.5)} 55%, ${rgba(SHIELD_EDGE, 1)} 64%, rgba(255, 255, 255, 1) 67%, ${rgba(SHIELD_EDGE, 0)} 71%)`;
    this.run(SHIELD_MS / speed, background, (piece, p) => placeBox(piece, at.x, at.y, width, height, Math.abs(Math.sin(p * SHIELD_PULSES * Math.PI))));
  }

  /** Pillars bursting up from the ground under the target; `landed` runs as the first peaks. */
  private pillars(at: EffectPoint, rgb: Rgb, size: number, speed: number, landed: () => void): void {
    // Tall ellipses (the gradient's own shape on a narrow box), standing on the Pokémon's feet.
    const background = `radial-gradient(rgba(255, 255, 255, 1) 0%, ${rgba(rgb, 1)} 40%, ${rgba(rgb, 0)} 70%)`;
    const feet = at.y + size * 0.3;
    PILLAR_OFFSETS.forEach((offset, i) =>
      this.after((i * PILLAR_GAP_MS) / speed, () =>
        this.run(
          PILLAR_MS / speed,
          background,
          (piece, p) => {
            const height = size * 0.75 * (p < 0.5 ? p * 2 : 1);
            placeBox(piece, at.x + offset * size, feet - height / 2, size * 0.16, Math.max(1, height), p < 0.6 ? 1 : (1 - p) / 0.4);
          },
        ),
      ),
    );
    this.after((PILLAR_MS * 0.5) / speed, landed);
  }

  /** Rings closing in on the target; `landed` runs as the first one closes. */
  private psyRings(at: EffectPoint, rgb: Rgb, size: number, speed: number, landed: () => void): void {
    for (let i = 0; i < PSY_RINGS; i++) {
      this.after((i * PSY_GAP_MS) / speed, () =>
        this.run(
          PSY_MS / speed,
          gradient(rgb, 'ring'),
          (piece, p) => place(piece, at.x, at.y, size * (1.05 - 0.8 * p), 0.3 + 0.7 * p),
          i === 0 ? landed : undefined,
        ),
      );
    }
  }

  /** A stream of orbs flying straight to the target; `landed` runs as the last one gets there. */
  private beam(from: EffectPoint, target: EffectTarget, rgb: Rgb, size: number, speed: number, landed: () => void): void {
    const { at } = target;
    for (let i = 0; i < BEAM_ORBS; i++) {
      this.after((i * BEAM_GAP_MS) / speed, () =>
        this.run(
          BEAM_FLIGHT_MS / speed,
          gradient(rgb, 'orb'),
          (piece, p) => place(piece, from.x + (at.x - from.x) * p, from.y + (at.y - from.y) * p, size * 0.26, target.hit || p < 0.8 ? 1 : (1 - p) * 5),
          i === BEAM_ORBS - 1 ? landed : undefined,
        ),
      );
    }
  }

  /** Rings rolling out to the target, growing as they go; `landed` runs as the first one gets there. */
  private wave(from: EffectPoint, target: EffectTarget, rgb: Rgb, size: number, speed: number, landed: () => void): void {
    const { at } = target;
    for (let i = 0; i < WAVE_RINGS; i++) {
      this.after((i * WAVE_GAP_MS) / speed, () =>
        this.run(
          WAVE_FLIGHT_MS / speed,
          gradient(rgb, 'ring'),
          (piece, p) => place(piece, from.x + (at.x - from.x) * p, from.y + (at.y - from.y) * p, size * (0.25 + 0.45 * p), 1 - 0.6 * p),
          i === 0 ? landed : undefined,
        ),
      );
    }
  }

  /** A status move taking effect: two rings spread out from the Pokémon and sparks drift up. */
  aura(at: EffectPoint, type: string, size: number, speed: number): void {
    const rgb = colorOf(type);
    for (let ring = 0; ring < 2; ring++) {
      this.after((ring * AURA_RING_GAP_MS) / speed, () =>
        this.run(AURA_RING_MS / speed, gradient(rgb, 'ring'), (piece, p) => place(piece, at.x, at.y, size * (0.25 + 0.65 * p), 1 - p)),
      );
    }
    for (let i = 0; i < AURA_SPARKS; i++) {
      const offset = ((i + 0.5) / AURA_SPARKS - 0.5) * size * 0.6;
      const delay = ((i % 2) * AURA_RING_GAP_MS) / speed;
      this.after(delay, () =>
        this.run(AURA_SPARK_MS / speed - delay, gradient(rgb, 'spark'), (piece, p) =>
          place(piece, at.x + offset, at.y + size * 0.25 - size * 0.55 * p, size * 0.1, p < 0.7 ? 1 : (1 - p) / 0.3),
        ),
      );
    }
  }

  /**
   * A stat stage raised (streaks of green light rising over the Pokémon) or lowered (red ones
   * falling).
   */
  statChange(at: EffectPoint, raised: boolean, size: number, speed: number): void {
    const rgb = raised ? STAT_UP_COLOR : STAT_DOWN_COLOR;
    const background = `radial-gradient(rgba(255, 255, 255, 1) 0%, ${rgba(rgb, 1)} 40%, ${rgba(rgb, 0)} 70%)`;
    const width = size * 0.07;
    const height = size * 0.26;
    const travel = size * 0.5;
    for (let i = 0; i < STAT_STREAKS; i++) {
      // Spread across the body, every other one a little later, so they rise (or fall) in waves.
      const x = at.x + ((i + 0.5) / STAT_STREAKS - 0.5) * size * 0.62;
      const delay = ((i % 2) * STAT_WAVE_GAP_MS) / speed;
      this.after(delay, () =>
        this.run(STAT_STREAK_MS / speed, background, (piece, p) => {
          const y = at.y + (raised ? travel / 2 - travel * p : -travel / 2 + travel * p);
          const opacity = p < 0.2 ? p / 0.2 : p > 0.75 ? (1 - p) / 0.25 : 1;
          placeBox(piece, x, y, width, height, opacity);
        }),
      );
    }
  }

  /** Animates one free piece (none left: the effect just shows fewer pieces), freeing it at the end. */
  private run(ms: number, background: string, frame: (piece: HTMLElement, progress: number) => void, done?: () => void): void {
    const piece = this.take();
    if (!piece) {
      this.after(ms, () => done?.());
      return;
    }
    piece.style.background = background;
    piece.style.display = 'block';
    let stop: () => void = () => undefined;
    const cancel = () => stop();
    this.running.add(cancel);
    stop = stepAnimation(
      ms,
      (progress) => frame(piece, progress),
      () => {
        this.running.delete(cancel);
        this.busy.delete(piece);
        hide(piece);
        done?.();
      },
    );
  }

  /** Calls `fn` after `ms`, counted in animation frames (setTimeout runs slow on the console). */
  private after(ms: number, fn: () => void): void {
    let stop: () => void = () => undefined;
    const cancel = () => stop();
    this.running.add(cancel);
    stop = stepAnimation(
      ms,
      () => undefined,
      () => {
        this.running.delete(cancel);
        fn();
      },
    );
  }

  private take(): HTMLElement | null {
    for (const piece of Array.from(this.host.children) as HTMLElement[]) {
      if (!this.busy.has(piece)) {
        this.busy.add(piece);
        return piece;
      }
    }
    return null;
  }
}

function colorOf(type: string): Rgb {
  return EFFECT_COLORS[type.toLowerCase()] ?? DEFAULT_COLOR;
}

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** An orb (white core), a spark (small hot dot) or a ring (hollow, white edge), in the type's colour. */
function gradient(rgb: Rgb, shape: 'orb' | 'spark' | 'ring'): string {
  const white = 'rgba(255, 255, 255, 1)';
  switch (shape) {
    case 'orb':
      return `radial-gradient(circle, ${white} 0%, ${rgba(rgb, 1)} 38%, ${rgba(rgb, 0)} 70%)`;
    case 'spark':
      return `radial-gradient(circle, ${white} 0%, ${rgba(rgb, 1)} 35%, ${rgba(rgb, 0)} 70%)`;
    case 'ring':
      return `radial-gradient(circle, ${rgba(rgb, 0)} 42%, ${rgba(rgb, 0.9)} 52%, ${white} 58%, ${rgba(rgb, 0.9)} 63%, ${rgba(rgb, 0)} 70%)`;
  }
}

/** Centres a piece on (x, y), `size` wide and high. */
function place(piece: HTMLElement, x: number, y: number, size: number, opacity: number): void {
  placeBox(piece, x, y, size, size, opacity);
}

/** Centres a piece on (x, y), `width` by `height`. */
function placeBox(piece: HTMLElement, x: number, y: number, width: number, height: number, opacity: number): void {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  piece.style.left = `${Math.round(x - w / 2)}px`;
  piece.style.top = `${Math.round(y - h / 2)}px`;
  piece.style.width = `${w}px`;
  piece.style.height = `${h}px`;
  piece.style.opacity = String(Math.round(Math.max(0, Math.min(1, opacity)) * 100) / 100);
}

function hide(piece: HTMLElement): void {
  piece.style.display = 'none';
}

function easeOut(progress: number): number {
  return 1 - (1 - progress) * (1 - progress);
}
