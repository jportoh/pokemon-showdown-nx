import { Component, DestroyRef, ElementRef, inject } from '@angular/core';
import { stepAnimation } from '@features/battle/animation/step-animation';
import { SlotKey } from '@features/battle/models/battle';

/**
 * Pieces kept mounted: enough for a spread move's two impacts (2 × 7) plus the charge, and a stat
 * change's streaks alongside.
 */
const POOL_SIZE = 20;

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
 * around the Pokémon a status move affects. Every shape is a radial-gradient box (probe N2: they
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

  /** A hit landing: a ring bursting out of a flash, with sparks flying off. `size` is the sprite's. */
  impact(at: EffectPoint, type: string, size: number, speed: number): void {
    const rgb = colorOf(type);
    const ms = IMPACT_MS / speed;
    this.run(ms, gradient(rgb, 'ring'), (piece, p) => place(piece, at.x, at.y, size * (0.2 + 0.55 * p), 1 - p));
    this.run(ms, gradient(rgb, 'orb'), (piece, p) => place(piece, at.x, at.y, size * (0.45 - 0.25 * p), p < 0.5 ? 1 - p * 2 : 0));
    for (let i = 0; i < IMPACT_SPARKS; i++) {
      const angle = (i / IMPACT_SPARKS) * 2 * Math.PI - Math.PI / 2;
      this.run(ms, gradient(rgb, 'spark'), (piece, p) => {
        const reach = size * 0.42 * easeOut(p);
        place(piece, at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach, size * 0.11, 1 - p * p);
      });
    }
  }

  /**
   * A special move: an orb gathers at the user, then one flies to each target along a low arc.
   * `arrived` is called for each as it gets there, after the impact starts on the ones it hits.
   */
  projectiles(from: EffectPoint, targets: readonly EffectTarget[], type: string, size: number, speed: number, arrived: (target: EffectTarget) => void): void {
    const rgb = colorOf(type);
    const chargeMs = CHARGE_MS / speed;
    this.run(chargeMs, gradient(rgb, 'orb'), (piece, p) => {
      const grow = Math.min(1, p / LAUNCH_AT);
      place(piece, from.x, from.y, size * 0.34 * grow, p < LAUNCH_AT ? 1 : (1 - p) / (1 - LAUNCH_AT));
    });
    this.after(chargeMs * LAUNCH_AT, () => {
      for (const target of targets) {
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
          () => {
            if (target.hit) this.impact(at, type, size, speed);
            arrived(target);
          },
        );
      }
    });
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
