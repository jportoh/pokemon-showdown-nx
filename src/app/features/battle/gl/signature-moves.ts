import { GlRenderer, Rgba, rgba } from '@core/gl/gl-renderer';
import { ANGER, BLAZE, FANGS, FEATHER, FIST, FLAME, FOOT, HAND, HEART, NOTE, POW, ROCK, SHARD, SLEEPY_Z, SPARKLE, STAR, SWORD, WISP, mirrored } from '@features/battle/gl/effect-shapes';
import {
  EffectPoint,
  GlEffects,
  backOut,
  drawShape,
  easeIn,
  easeInOut,
  easeOut,
  effectColor,
  glowDot,
  mix,
  outAndBack,
  ring,
  withAlpha,
} from '@features/battle/gl/gl-effects';
import { ContactMark } from '@features/battle/gl/move-patterns';
import { MoveStage, StageActor, StageTarget } from '@features/battle/gl/move-stage';
import { typeEffect } from '@features/battle/gl/type-effects';
import { toId } from '@shared/utils/to-id';

/**
 * The most used moves' own animations (VGC and Battle Stadium Singles, Smogon's usage stats of
 * 2026-09), each made for its move like the games' own: Swords Dance's swords, Draco Meteor's
 * meteors, Taunt's vein of anger… Every one fits in a move's time on screen (about a second at
 * normal speed), and the hits blink as they land. Also the contact moves' marks (a fist, a foot,
 * jaws, claws, a blade's cut) and the draining moves' lights flying back.
 */
type Signature = (stage: MoveStage) => void;

const WHITE: Rgba = [1, 1, 1, 1];
const STEEL: Rgba = rgba('#dfe6f5');
const DRAGON: Rgba = rgba('#7a48ff');
const DRAGON_FIRE: Rgba = rgba('#ff5a3c');
const DARK: Rgba = rgba('#3a2448');
const DARK_GLOW: Rgba = rgba('#8a4cc8');
const PINK: Rgba = rgba('#ff70a8');
const ORANGE: Rgba = rgba('#ff8a1e');
const HEAL: Rgba = rgba('#5ad870');
const FEATHERS: readonly Rgba[] = [WHITE, rgba('#e8d8b0'), rgba('#c8b088')];
const SKIN: Rgba = rgba('#ffe0c0');
const SPOTLIGHT: Rgba = rgba('#fff3b0');
const POWDER: readonly Rgba[] = [rgba('#ff9a3c'), rgba('#ffc860')];
const NOTES: readonly Rgba[] = [rgba('#ff70a8'), rgba('#5aa0ff'), rgba('#ffd23c')];
const ANGRY: Rgba = rgba('#e02828');
const SLEEPY: Rgba = rgba('#a8d8ff');
const GHOSTS: readonly Rgba[] = [rgba('#8a60c0'), rgba('#a878e0'), rgba('#6a40a0')];
const WISPS: readonly Rgba[] = [rgba('#6a8cff'), rgba('#b090ff'), rgba('#c8e0ff')];
const ROCKS: readonly Rgba[] = [rgba('#a08850'), rgba('#7a6440'), rgba('#c0a868')];
const SCREENS: Readonly<Record<string, readonly Rgba[]>> = {
  reflect: [rgba('#8cb8ff')],
  lightscreen: [rgba('#ffe066')],
  auroraveil: [rgba('#7ee8d8'), rgba('#ff9ad8'), rgba('#ffe066')],
};
const SHADOW: Rgba = rgba('#4a2a70');
const AURA: Rgba = rgba('#4a8cff');
const FOCUS: Rgba = rgba('#ffb03c');
const WIND: Rgba = rgba('#e8e4ff');
const SLUDGE: Rgba = rgba('#9a40b0');
const FIRE: readonly Rgba[] = [rgba('#ff8a1e'), rgba('#ffd23c'), rgba('#ff4b1e')];
const MYSTIC: readonly Rgba[] = [rgba('#ff5ab4'), rgba('#ff9ad8'), rgba('#c040ff')];
const BOLT: Rgba = rgba('#ffe23c');
const GOLD: Rgba = rgba('#ffd23c');
const BRAWL: readonly Rgba[] = [rgba('#e8e0ea'), rgba('#f4c8dc')];
/** A bite: the jaws open until BITE_OPEN of it, are shut at BITE_SHUT and let go at BITE_LET_GO. */
const BITE_MS = 560;
const BITE_OPEN = 0.24;
const BITE_SHUT = 0.36;
const BITE_LET_GO = 0.66;
/** When the jaws are shut on the target, from the bite's start: the hit lands then. */
export const BITE_SNAP_MS = BITE_MS * BITE_SHUT;
const FLASH_MS = 220;
/** Helping Hand: this many claps, in this long. */
const CLAPS = 3;
const CLAP_MS = 900;
/** The right hand of the pair (HAND is a left one, thumb in). */
const HAND_RIGHT = mirrored(HAND);

// ---------------------------------------------------------------- helpers

/** A soft, solid disc (light washes out on the bright field, so most effects cover rather than add). */
function softDisc(r: GlRenderer, x: number, y: number, radius: number, color: Rgba, alpha: number, softness = 0.5): void {
  if (radius <= 0.5 || alpha <= 0.01) return;
  r.rect(x - radius, y - radius, radius * 2, radius * 2, { fill: withAlpha(color, alpha), radius, softness: radius * softness });
}

/** A straight streak from (x1, y1) to (x2, y2). */
function streak(r: GlRenderer, x1: number, y1: number, x2: number, y2: number, width: number, color: Rgba, alpha: number, additive = false): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1 || alpha <= 0.01) return;
  r.rect((x1 + x2) / 2 - length / 2, (y1 + y2) / 2 - width / 2, length, width, { fill: withAlpha(color, alpha), radius: width / 2, angle: Math.atan2(y2 - y1, x2 - x1), additive });
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Fades in over the first `fadeIn` and out over the last `fadeOut` of a progress. */
const fadeInOut = (p: number, fadeIn = 0.1, fadeOut = 0.2): number => clamp01(Math.min(p / fadeIn, (1 - p) / fadeOut));
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A point between `from` and `to` at `t`, lifted into an arc `height` px high. */
function arcPoint(from: EffectPoint, to: EffectPoint, t: number, height: number): EffectPoint {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - Math.sin(Math.PI * t) * height };
}

/** A flickering flame with a pale core (a plain flame in blue or pink reads as a drop). */
function flame(r: GlRenderer, x: number, y: number, height: number, color: Rgba, alpha: number): void {
  drawShape(r, WISP, x, y, height, color, alpha);
  drawShape(r, FLAME, x, y + height * 0.15, height * 0.5, mix(color, WHITE, 0.65), alpha);
}

/** Healing: a green glow wells up round the Pokémon and glints rise off it. */
function heal(s: MoveStage, actor: StageActor): void {
  const { fx } = s;
  const { at, k } = actor;
  fx.tween(600, (r, p) => softDisc(r, at.x, at.y, (60 + 40 * easeOut(p)) * k, HEAL, 0.45 * Math.sin(Math.PI * p), 0.8));
  fx.pieces(at, { shape: SPARKLE, colors: [HEAL, WHITE], size: 20, endSize: 6, speed: 120, direction: -Math.PI / 2, spread: 0.5, drag: 0.4, life: 700, scatter: 120, spin: 2 }, 10, k);
  s.animate(actor.slot, 600, (v, p) => (v.bright = 1 + 0.6 * Math.sin(Math.PI * p)));
}

/** Each target that's hit: the hit lands, with its type's burst. */
function landOn(s: MoveStage, target: StageTarget, type: string, shake = false, light = false): void {
  if (!target.hit) return;
  s.hit(target, shake);
  s.fx.impact(target.at, type, target.size, light);
}

/** A ball flown from the user to each target (drawn by `draw`), landing with `land`. */
function fly(s: MoveStage, ms: number, height: number, draw: (r: GlRenderer, at: EffectPoint, p: number) => void, land: (target: StageTarget) => void, delay = 0): void {
  for (const target of s.targets) {
    s.fx.tween(ms, (r, p) => draw(r, arcPoint(s.user.at, target.at, easeInOut(p), height * s.user.k), p), () => land(target), delay);
  }
}

// ---------------------------------------------------------------- status moves on the user

/** Two swords circle the user, then cross over its head with a glint. */
const swordsDance: Signature = (s) => {
  const { fx, user } = s;
  const { at, head, k } = user;
  const ms = 950;
  s.animate(user.slot, ms, (v, p) => {
    v.dy = -Math.abs(Math.sin(p * Math.PI * 3)) * 10;
    v.bright = 1 + 0.8 * clamp01((p - 0.75) / 0.1) * (1 - p) * 4;
  });
  const crossAt = { x: head.x, y: head.y - 40 * k };
  fx.tween(ms, (r, p) => {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const orbit = (q: number): { x: number; y: number; front: number } => {
        const a = q * Math.PI * 3 + i * Math.PI;
        return { x: at.x + Math.cos(a) * 95 * k, y: at.y - 10 * k + Math.sin(a) * 28 * k, front: (Math.sin(a) + 1) / 2 };
      };
      let x: number;
      let y: number;
      let angle: number;
      let front = 1;
      if (p < 0.6) {
        const o = orbit(p / 0.6);
        ({ x, y, front } = o);
        angle = (o.x - at.x) / (95 * k) * 0.4;
      } else {
        const o = orbit(1);
        const q = easeOut((p - 0.6) / 0.4);
        x = lerp(o.x, crossAt.x + side * 8 * k, q);
        y = lerp(o.y, crossAt.y, q);
        angle = lerp(side * 0.4, -side * 0.55, q);
      }
      drawShape(r, SWORD, x, y, 100 * k, STEEL, (0.55 + 0.45 * front) * fadeInOut(p, 0.08, 0.1), angle);
    }
  });
  fx.later(ms * 0.85, () => {
    fx.pieces(crossAt, { shape: SPARKLE, colors: [WHITE, STEEL], size: 30, endSize: 6, speed: 180, drag: 0.1, life: 420, spin: 4 }, 6, k);
    fx.tween(240, (r, p) => glowDot(r, crossAt.x, crossAt.y, (20 + 50 * p) * k, WHITE, 0.9 * (1 - p), true));
  });
};

/** The user dances while red and purple flames spiral up round it. */
const dragonDance: Signature = (s) => {
  const { fx, user } = s;
  const { at, k } = user;
  const ms = 1000;
  s.animate(user.slot, ms, (v, p) => {
    v.dx = Math.sin(p * Math.PI * 4) * 12;
    v.dy = -Math.abs(Math.sin(p * Math.PI * 4)) * 6;
  });
  fx.tween(ms, (r, p) => {
    const fade = fadeInOut(p, 0.1, 0.15);
    for (let i = 0; i < 8; i++) {
      const q = (p * 1.6 + i / 8) % 1;
      const a = q * Math.PI * 4 + i;
      const front = (Math.sin(a) + 1) / 2;
      const x = at.x + Math.cos(a) * 100 * k;
      const y = at.y + 80 * k - q * 200 * k;
      flame(r, x, y, (34 + 20 * front) * k, i % 2 ? DRAGON : DRAGON_FIRE, fade * (0.45 + 0.55 * front) * Math.sin(Math.PI * q));
    }
  });
};

/** Dark rings close in on the user's head, and its eyes glint. */
const nastyPlot: Signature = (s) => {
  const { fx, user } = s;
  const { head, k } = user;
  for (let i = 0; i < 3; i++) {
    fx.tween(420, (r, p) => ring(r, head.x, head.y, (120 - 100 * easeIn(p)) * k, (4 + 3 * p) * k, i % 2 ? DARK_GLOW : DARK, 0.3 + 0.6 * p, false), undefined, i * 150);
  }
  fx.later(720, () => {
    const eye = { x: head.x, y: head.y + 20 * user.k };
    fx.tween(260, (r, p) => drawShape(r, SPARKLE, eye.x, eye.y, (20 + 30 * Math.sin(Math.PI * p)) * k, WHITE, 1 - p * 0.5, p * 2));
    s.glow(user.slot);
  });
};

/** Calm rings spread from the user's head, and glints drift off. */
const calmMind: Signature = (s) => {
  const { fx, user } = s;
  const { head, k } = user;
  for (let i = 0; i < 3; i++) {
    fx.tween(600, (r, p) => ring(r, head.x, head.y, (20 + 120 * easeOut(p)) * k, 4 * k, PINK, 0.85 * (1 - p), false), undefined, i * 200);
  }
  s.animate(user.slot, 1000, (v, p) => (v.bright = 1 + 0.5 * Math.sin(Math.PI * p)));
  fx.pieces(head, { shape: SPARKLE, colors: [PINK, WHITE], size: 18, endSize: 4, speed: 120, drag: 0.2, life: 800, spin: 2 }, 6, k);
};

/** The user flexes twice: bursts of power pop at its sides. */
const bulkUp: Signature = (s) => {
  const { fx, user } = s;
  const { at, k } = user;
  s.animate(user.slot, 900, (v, p) => {
    const flex = Math.max(0, Math.sin(p * Math.PI * 4));
    v.dy = -flex * 8;
    v.bright = 1 + 0.5 * flex;
  });
  for (let i = 0; i < 2; i++) {
    fx.later(110 + i * 450, () => {
      for (const side of [-1, 1]) {
        const point = { x: at.x + side * 80 * k, y: at.y - 10 * k };
        fx.tween(320, (r, p) => drawShape(r, POW, point.x, point.y, 50 * k * (p < 0.3 ? backOut(p / 0.3) : 1), mix(ORANGE, WHITE, 0.3), 1 - clamp01((p - 0.5) / 0.5)));
        fx.pieces(point, { colors: [ORANGE, WHITE], size: 10, endSize: 0, speed: 320, direction: side > 0 ? 0 : Math.PI, spread: 0.5, drag: 0.1, life: 320, glow: true }, 5, k);
      }
    });
  }
};

/** Feathers drift down round the user, and it heals. */
const roost: Signature = (s) => {
  const { fx, user } = s;
  const { at, k } = user;
  for (let i = 0; i < 9; i++) {
    fx.later(i * 60, () =>
      fx.pieces({ x: at.x + (Math.random() - 0.5) * 220 * k, y: at.y - 150 * k }, { shape: FEATHER, colors: FEATHERS, size: 38, speed: 110, direction: Math.PI / 2, spread: 0.3, gravity: 40, drag: 0.5, life: 850, spin: 3, sway: 70 }, 1, k),
    );
  }
  fx.later(380, () => heal(s, user));
};

/** Light is drawn into the user from all round, and it heals. */
const recover: Signature = (s) => {
  const { fx, user } = s;
  const { at, k } = user;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const distance = (110 + Math.random() * 40) * k;
    const delay = Math.random() * 160;
    fx.tween(
      360,
      (r, p) => {
        const e = easeIn(p);
        const x = at.x + Math.cos(angle) * distance * (1 - e);
        const y = at.y + Math.sin(angle) * distance * (1 - e);
        softDisc(r, x, y, 7 * k, i % 3 ? HEAL : WHITE, 0.95, 0.4);
      },
      undefined,
      delay,
    );
  }
  fx.later(460, () => heal(s, user));
};

// ---------------------------------------------------------------- status moves on others

/** The user cheers its ally on: two hands clap over the ally, which lights up (Helping Hand). */
const helpingHand: Signature = (s) => {
  const { fx, user } = s;
  s.animate(user.slot, 500, (v, p) => (v.dy = -Math.sin(Math.PI * p) * 18));
  s.targets.forEach((ally, index) => {
    const { head, k } = ally;
    const y = head.y - 20 * k;
    const height = 72 * k;
    fx.tween(CLAP_MS, (r, p) => {
      const grow = p < 0.12 ? backOut(p / 0.12) : 1;
      // Apart, then together at each clap (a quick close, a slower open).
      const beat = (p * CLAPS) % 1;
      const apart = beat < 0.35 ? 1 - easeIn(beat / 0.35) : easeOut((beat - 0.35) / 0.65);
      const gap = (14 + 46 * (p < 0.12 ? 1 : apart)) * k;
      const tilt = 0.25 + 0.2 * apart;
      const fade = fadeInOut(p, 0.05, 0.15);
      drawShape(r, HAND, head.x - gap, y, height * grow, SKIN, fade, tilt);
      drawShape(r, HAND_RIGHT, head.x + gap, y, height * grow, SKIN, fade, -tilt);
    });
    for (let i = 0; i < CLAPS; i++) {
      fx.later(CLAP_MS * ((i + 0.35) / CLAPS), () => {
        if (index === 0) s.sound('clap');
        fx.tween(160, (r, p) => glowDot(r, head.x, y, (16 + 40 * p) * k, WHITE, 0.85 * (1 - p), true));
        fx.pieces({ x: head.x, y }, { shape: SPARKLE, colors: [rgba('#ffe066'), WHITE], size: 16, endSize: 4, speed: 200, direction: -Math.PI / 2, spread: 1.4, drag: 0.15, life: 360, spin: 3 }, 3, k);
      });
    }
    fx.later(CLAP_MS * 0.9, () => {
      s.glow(ally.slot);
      fx.pieces(ally.at, { shape: SPARKLE, colors: [rgba('#ffe066'), WHITE], size: 22, endSize: 6, speed: 180, drag: 0.15, life: 500, spin: 3 }, 8, k);
    });
  });
};

/** A spotlight falls on the user, which waves for attention; Rage Powder throws powder round it too. */
function spotlight(powder: boolean): Signature {
  return (s) => {
    const { fx, user } = s;
    const { at, feet, k } = user;
    const ms = 1000;
    s.animate(user.slot, ms, (v, p) => (v.dx = Math.sin(p * Math.PI * 6) * 6 * (1 - p)));
    fx.tween(ms, (r, p) => {
      const fade = fadeInOut(p, 0.12, 0.25);
      const width = 170 * k;
      r.rect(at.x - width / 2, 0, width, feet.y, { fill: withAlpha(SPOTLIGHT, 0.32 * fade), softness: 30 * k });
      r.rect(at.x - width * 0.6, feet.y - 18 * k, width * 1.2, 36 * k, { fill: withAlpha(SPOTLIGHT, 0.5 * fade), radius: 18 * k, softness: 10 * k });
    });
    if (!powder) return;
    for (let i = 0; i < 18; i++) {
      fx.later(i * 40, () => {
        const angle = Math.random() * Math.PI * 2;
        const radius = (60 + Math.random() * 50) * k;
        fx.particle({
          x: at.x + Math.cos(angle) * radius,
          y: at.y + Math.sin(angle) * radius * 0.6,
          vx: -Math.sin(angle) * 160 * k * fx.speed,
          vy: Math.cos(angle) * 100 * k * fx.speed - 40 * k * fx.speed,
          size: 11 * k,
          endSize: 4 * k,
          color: pick(POWDER),
          additive: false,
          life: 650,
        });
      });
    }
  };
}

/** Music notes rise over the target, which bounces along (Encore). */
const encore: Signature = (s) => {
  const { fx, user } = s;
  s.animate(user.slot, 500, (v, p) => (v.dy = -Math.abs(Math.sin(p * Math.PI * 2)) * 10));
  for (const target of s.targets) {
    for (let i = 0; i < 6; i++) {
      fx.later(i * 110, () => fx.pieces(target.head, { shape: NOTE, colors: NOTES, size: 40, speed: 130, direction: -Math.PI / 2, spread: 0.9, gravity: -30, drag: 0.5, life: 850, sway: 40, scatter: 40 }, 1, target.k));
    }
    s.animate(target.slot, 900, (v, p) => (v.dy = -Math.abs(Math.sin(p * Math.PI * 4)) * 10 * (1 - p * 0.5)));
  }
};

/** The user jeers and a vein of anger pops over the target twice, which shakes (Taunt). */
const taunt: Signature = (s) => {
  const { fx, user } = s;
  s.animate(user.slot, 500, (v, p) => (v.dx = Math.sin(p * Math.PI * 4) * 8));
  for (const target of s.targets) {
    const { head, k } = target;
    const at = { x: head.x + 40 * k, y: head.y - 10 * k };
    fx.tween(
      800,
      (r, p) => {
        const local = p < 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
        const grow = local < 0.3 ? backOut(local / 0.3) : 1;
        drawShape(r, ANGER, at.x, at.y, 64 * k * grow, ANGRY, local < 0.75 ? 1 : 1 - (local - 0.75) / 0.25);
      },
      undefined,
      150,
    );
    s.animate(target.slot, 700, (v, p) => (v.dx = Math.sin(p * Math.PI * 8) * 5 * (1 - p)));
  }
};

/** A big bubble floats over to the target and pops; sleepy Zs rise off it (Yawn). */
const yawn: Signature = (s) => {
  const { fx, user } = s;
  s.animate(user.slot, 600, (v, p) => (v.dy = Math.sin(Math.PI * p) * 8));
  for (const target of s.targets) {
    const k = user.k;
    fx.tween(
      650,
      (r, p) => {
        const at = arcPoint(user.head, target.head, easeInOut(p), 40 * k);
        const radius = 28 * k * (0.5 + 0.5 * clamp01(p * 3));
        const x = at.x + Math.sin(p * 12) * 6 * k;
        softDisc(r, x, at.y, radius, SLEEPY, 0.3);
        ring(r, x, at.y, radius, 3 * k, mix(SLEEPY, WHITE, 0.3), 0.95, false);
        softDisc(r, x - radius * 0.35, at.y - radius * 0.35, radius * 0.22, WHITE, 0.9);
      },
      () => {
        fx.pieces(target.head, { colors: [WHITE, SLEEPY], size: 8, endSize: 0, speed: 220, drag: 0.1, life: 320 }, 10, target.k);
        for (let i = 0; i < 3; i++) {
          fx.later(i * 150, () =>
            fx.pieces({ x: target.head.x + 20 * target.k, y: target.head.y }, { shape: SLEEPY_Z, colors: [SLEEPY], size: 30 + i * 8, speed: 70, direction: -Math.PI / 2 - 0.4, spread: 0.2, drag: 0.6, life: 800, sway: 25 }, 1, target.k),
          );
        }
      },
    );
  }
};

/** Three ghostly wisps circle the user, then drift to the target (Will-O-Wisp). */
const willOWisp: Signature = (s) => {
  const { fx, user } = s;
  const { at, k } = user;
  for (const target of s.targets) {
    for (let i = 0; i < 3; i++) {
      const color = WISPS[i];
      const last = i === 2;
      fx.tween(
        900,
        (r, p) => {
          const a = clamp01(p / 0.4) * Math.PI * 2 + (i * Math.PI * 2) / 3;
          const orbit = { x: at.x + Math.cos(a) * 75 * k, y: at.y - 20 * k + Math.sin(a) * 25 * k };
          const q = easeInOut(clamp01((p - 0.4 - i * 0.06) / (0.5 - i * 0.06)));
          const point = q > 0 ? arcPoint(orbit, target.at, q, 50 * k) : orbit;
          const flicker = 1 + 0.15 * Math.sin(p * 40 + i);
          glowDot(r, point.x, point.y, 30 * k, color, 0.45, true);
          flame(r, point.x, point.y, 46 * k * flicker, color, fadeInOut(p, 0.1, 0.05));
        },
        last
          ? () => {
              fx.pieces(target.at, { shape: FLAME, colors: WISPS, size: 30, endSize: 10, speed: 90, direction: -Math.PI / 2, spread: 1.2, gravity: -120, drag: 0.4, life: 600, sway: 40, scatter: 50 }, 8, target.k);
              s.animate(target.slot, 400, (v, p) => (v.bright = 1 + 1.2 * (1 - p)));
            }
          : undefined,
      );
    }
  }
};

/** Dark taunting rings roll out to the target, which recoils (Parting Shot). */
const partingShot: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  s.animate(user.slot, 500, (v, p) => (v.dy = -Math.sin(Math.PI * p) * 12));
  for (const target of s.targets) {
    for (let i = 0; i < 3; i++) {
      fx.tween(
        380,
        (r, p) => {
          const x = lerp(user.at.x, target.at.x, p);
          const y = lerp(user.at.y, target.at.y, p);
          ring(r, x, y, (20 + 60 * p) * k, 6 * k, i % 2 ? DARK_GLOW : DARK, 0.9 - 0.4 * p, false);
        },
        i === 2
          ? () => {
              const away = Math.sign(target.at.x - user.at.x) || 1;
              s.animate(target.slot, 500, (v, p) => (v.dx = away * 20 * outAndBack(p)));
            }
          : undefined,
        i * 90,
      );
    }
  }
};

/** Pointed stones rise off the user and float down round the other side (Stealth Rock). */
const stealthRock: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  const foes = s.foes.length > 0 ? s.foes : s.targets;
  if (foes.length === 0) return;
  const left = Math.min(...foes.map((f) => f.feet.x)) - 70 * foes[0].k;
  const right = Math.max(...foes.map((f) => f.feet.x)) + 70 * foes[0].k;
  const ground = Math.max(...foes.map((f) => f.feet.y));
  const rise = { x: user.at.x, y: user.at.y - 130 * k };
  for (let j = 0; j < 5; j++) {
    const land = { x: lerp(left, right, j / 4), y: ground - 20 * foes[0].k - (j % 2) * 16 * foes[0].k };
    const spin = (j % 2 ? 1 : -1) * 3;
    fx.tween(
      880,
      (r, p) => {
        let point: EffectPoint;
        if (p < 0.3) point = { x: lerp(user.at.x, rise.x + (j - 2) * 20 * k, easeOut(p / 0.3)), y: lerp(user.at.y, rise.y, easeOut(p / 0.3)) };
        else point = arcPoint({ x: rise.x + (j - 2) * 20 * k, y: rise.y }, land, easeInOut(clamp01((p - 0.3) / 0.55)), 60 * k);
        const hover = p > 0.85 ? Math.sin((p - 0.85) * 40) * 3 * k : 0;
        drawShape(r, SHARD, point.x, point.y + hover, 44 * lerp(k, foes[0].k, clamp01((p - 0.3) / 0.55)), ROCKS[j % ROCKS.length], fadeInOut(p, 0.08, 0.1), p * spin);
      },
      () => fx.pieces(land, { colors: ROCKS, size: 8, endSize: 14, speed: 60, direction: -Math.PI / 2, spread: 1.2, drag: 0.3, life: 400 }, 3, foes[0].k),
      j * 50,
    );
  }
};

/** A pane of light rises over the user's side and a shine sweeps across it (Reflect, Light Screen, Aurora Veil). */
function screen(colors: readonly Rgba[]): Signature {
  return (s) => {
    const { fx, user } = s;
    const k = user.k;
    const side = s.allies.length > 0 ? s.allies : [user];
    const left = Math.min(...side.map((a) => a.at.x)) - 120 * k;
    const right = Math.max(...side.map((a) => a.at.x)) + 120 * k;
    const top = Math.min(...side.map((a) => a.head.y)) - 40 * k;
    const bottom = Math.max(...side.map((a) => a.feet.y)) + 10 * k;
    const height = bottom - top;
    fx.tween(1000, (r, p) => {
      const grow = easeOut(clamp01(p / 0.25));
      const fade = p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
      const h = height * grow;
      const y = bottom - h;
      // Its colour, or the aurora's shifting through theirs.
      const shift = (p * 2 * colors.length) % colors.length;
      const color = mix(colors[Math.floor(shift)], colors[(Math.floor(shift) + 1) % colors.length], shift % 1);
      r.rect(left, y, right - left, h, { fill: withAlpha(color, 0.26 * fade), stroke: withAlpha(mix(color, WHITE, 0.3), 0.95 * fade), border: 4 * k, radius: 10 * k });
      // The shine: a bright band sweeping left to right.
      const shine = lerp(left - 40 * k, right + 40 * k, clamp01((p - 0.2) / 0.6));
      if (shine > left && shine < right - 24 * k) r.rect(shine, y + 4 * k, 24 * k, Math.max(0, h - 8 * k), { fill: withAlpha(WHITE, 0.55 * fade), softness: 8 * k });
    });
  };
}

// ---------------------------------------------------------------- special moves

/** A dark ball gathers, wobbles over and bursts in shadow (Shadow Ball). */
const shadowBall: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  s.glow(user.slot);
  const ball = (r: GlRenderer, at: EffectPoint, radius: number, p: number): void => {
    softDisc(r, at.x, at.y, radius * 1.35, DARK_GLOW, 0.5, 0.7);
    softDisc(r, at.x, at.y, radius, SHADOW, 1, 0.15);
    softDisc(r, at.x - radius * 0.2, at.y - radius * 0.2, radius * 0.55, DARK, 1, 0.3);
    for (let i = 0; i < 3; i++) {
      const a = p * 14 + (i * Math.PI * 2) / 3;
      drawShape(r, FLAME, at.x + Math.cos(a) * radius * 1.1, at.y + Math.sin(a) * radius * 1.1, radius * 0.9, WISPS[1], 0.85, a + Math.PI / 2);
    }
  };
  fx.tween(300, (r, p) => ball(r, user.at, 28 * k * easeOut(p), p));
  const trail = typeEffect('ghost')?.trail;
  fly(
    s,
    380,
    30,
    (r, at, p) => {
      const wobble = { x: at.x, y: at.y + Math.sin(p * 18) * 8 * k };
      ball(r, wobble, 28 * k, p);
      if (trail && Math.random() < 0.6) fx.pieces(wobble, trail, 1, k);
    },
    (target) => landOn(s, target, 'ghost'),
    280,
  );
};

/** An orb shoots up off the field, and meteors rain down on the targets (Draco Meteor). */
const dracoMeteor: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  s.glow(user.slot);
  fx.tween(300, (r, p) => {
    const y = lerp(user.at.y, -40, easeIn(p));
    glowDot(r, user.at.x, y, 30 * k, DRAGON, 0.95, false);
    glowDot(r, user.at.x, y, 14 * k, WHITE, 1, true);
  });
  for (const target of s.targets) {
    for (let j = 0; j < 4; j++) {
      const land = { x: target.at.x + (j % 2 ? 1 : -1) * (14 + j * 12) * target.k, y: target.at.y + (j - 1.5) * 12 * target.k };
      const from = { x: land.x + 220 * target.k, y: -60 };
      fx.tween(
        330,
        (r, p) => {
          const e = easeIn(p);
          const x = lerp(from.x, land.x, e);
          const y = lerp(from.y, land.y, e);
          glowDot(r, x, y, 34 * target.k, DRAGON_FIRE, 0.5, true);
          drawShape(r, ROCK, x, y, 40 * target.k, j % 2 ? DRAGON : mix(DRAGON, DRAGON_FIRE, 0.5), 1, p * 6);
          fx.pieces({ x, y }, { shape: FLAME, colors: [DRAGON, DRAGON_FIRE, rgba('#ffd23c')], size: 22, endSize: 6, speed: 60, gravity: -100, life: 280, scatter: 14 }, 1, target.k);
        },
        () => {
          if (target.hit) fx.impact(land, 'dragon', target.size * 0.8, true);
          if (j === 0) s.hit(target);
          if (j === 3) s.shake(260);
        },
        300 + j * 110,
      );
    }
  }
};

/** A blue sphere curves round to its target, rings pulsing about it (Aura Sphere). */
const auraSphere: Signature = (s) => {
  const { fx, user } = s;
  const { at, k } = user;
  for (let i = 0; i < 3; i++) {
    fx.tween(240, (r, p) => ring(r, at.x, at.y, (90 - 70 * easeIn(p)) * k, 4 * k, AURA, 0.4 + 0.5 * p, false), undefined, i * 70);
  }
  for (const target of s.targets) {
    const side = (target.at.y - at.y) * 0.4;
    fx.tween(
      420,
      (r, p) => {
        const e = easeInOut(p);
        const bend = Math.sin(Math.PI * e) * (90 * k + side);
        const x = lerp(at.x, target.at.x, e);
        const y = lerp(at.y, target.at.y, e) + bend;
        softDisc(r, x, y, 24 * k, AURA, 1, 0.2);
        softDisc(r, x, y, 12 * k, WHITE, 1, 0.4);
        ring(r, x, y, (30 + 8 * Math.sin(p * 30)) * k, 3 * k, mix(AURA, WHITE, 0.4), 0.9, false);
        if (Math.random() < 0.7) fx.particle({ x, y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, size: 8 * k, endSize: 0, color: AURA, additive: false, life: 260 });
      },
      () => {
        landOn(s, target, 'fighting');
        if (target.hit) for (let i = 0; i < 3; i++) fx.tween(400, (r, p) => ring(r, target.at.x, target.at.y, (20 + 90 * easeOut(p)) * target.k, 5 * target.k, AURA, 1 - p, false), undefined, i * 80);
      },
      260,
    );
  }
};

/** A great sphere of power charges long, then flies straight and bursts big (Focus Blast). */
const focusBlast: Signature = (s) => {
  const { fx, user } = s;
  const { at, k } = user;
  s.animate(user.slot, 450, (v, p) => (v.bright = 1 + 1.2 * p));
  const sphere = (r: GlRenderer, x: number, y: number, radius: number, p: number): void => {
    softDisc(r, x, y, radius * 1.3, FOCUS, 0.5, 0.8);
    softDisc(r, x, y, radius, mix(FOCUS, rgba('#ffe066'), 0.5 + 0.5 * Math.sin(p * 40)), 1, 0.15);
    softDisc(r, x, y, radius * 0.5, WHITE, 1, 0.4);
  };
  fx.tween(420, (r, p) => sphere(r, at.x, at.y - 10 * k, 36 * k * easeOut(p), p));
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = (100 + Math.random() * 40) * k;
    fx.tween(300, (r, p) => softDisc(r, at.x + Math.cos(angle) * distance * (1 - easeIn(p)), at.y - 10 * k + Math.sin(angle) * distance * (1 - easeIn(p)), 6 * k, FOCUS, 0.9), undefined, Math.random() * 120);
  }
  for (const target of s.targets) {
    fx.tween(
      260,
      (r, p) => sphere(r, lerp(at.x, target.at.x, easeIn(p)), lerp(at.y - 10 * k, target.at.y, easeIn(p)), 36 * k, p),
      () => {
        if (!target.hit) return;
        s.hit(target, true);
        fx.impact(target.at, 'fighting', target.size * 1.4);
        fx.tween(300, (r, p) => glowDot(r, target.at.x, target.at.y, (60 + 140 * p) * target.k, mix(WHITE, FOCUS, 0.4), 0.9 * (1 - p), true));
        s.shake(260);
      },
      420,
    );
  }
};

/** A whirlwind twists up round each target (Hurricane). */
const hurricane: Signature = (s) => {
  const { fx, user } = s;
  s.glow(user.slot);
  for (const target of s.targets) {
    const { feet, k } = target;
    fx.tween(
      850,
      (r, p) => {
        const fade = fadeInOut(p, 0.15, 0.25);
        const height = 230 * k * easeOut(clamp01(p / 0.3));
        for (let i = 0; i < 9; i++) {
          const t = i / 8;
          const y = feet.y - t * height;
          const rx = (22 + 95 * t) * k;
          const ry = rx * 0.26;
          const x = target.at.x + Math.sin(p * 22 + i * 0.9) * 12 * k * (1 + t);
          r.rect(x - rx, y - ry, rx * 2, ry * 2, { fill: [0, 0, 0, 0], stroke: withAlpha(i % 2 ? WIND : WHITE, 0.85 * fade), radius: ry, border: 4 * k });
        }
        if (Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          fx.particle({ x: target.at.x + Math.cos(a) * 80 * k, y: feet.y - Math.random() * height, vx: -Math.sin(a) * 300 * k, vy: -80 * k, size: 18 * k, endSize: 12 * k, color: WHITE, additive: false, shape: FEATHER, life: 400, spin: 8 });
        }
      },
      undefined,
      120,
    );
    fx.later(420, () => s.hit(target, true));
  }
};

/** A blob of sludge arcs over and splatters (Sludge Bomb). */
const sludgeBomb: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  s.glow(user.slot);
  const trail = typeEffect('poison')?.trail;
  fly(
    s,
    430,
    90,
    (r, at, p) => {
      const squash = 1 + 0.15 * Math.sin(p * 20);
      r.rect(at.x - 24 * k * squash, at.y - 24 * k / squash, 48 * k * squash, 48 * k / squash, { fill: SLUDGE, stroke: mix(SLUDGE, [0, 0, 0, 1], 0.5), border: 3 * k, radius: 24 * k / squash });
      softDisc(r, at.x - 8 * k, at.y - 8 * k, 6 * k, WHITE, 0.8);
      if (trail && Math.random() < 0.6) fx.pieces(at, trail, 1, k);
    },
    (target) => {
      landOn(s, target, 'poison');
      if (!target.hit) return;
      const blobs = Array.from({ length: 6 }, () => ({ dx: (Math.random() - 0.5) * 140, dy: (Math.random() - 0.5) * 90, radius: 18 + Math.random() * 16 }));
      fx.tween(560, (r, p) => {
        for (const blob of blobs) softDisc(r, target.at.x + blob.dx * target.k * easeOut(p), target.at.y + blob.dy * target.k * easeOut(p), blob.radius * target.k * (0.6 + 0.4 * easeOut(p)), SLUDGE, 0.9 * (1 - clamp01((p - 0.5) / 0.5)), 0.2);
      });
    },
  );
};

/** Fire flies over and blazes up on the target in the games' five-pointed blaze (Fire Blast). */
const fireBlast: Signature = (s) => {
  const { fx, user } = s;
  s.glow(user.slot);
  const targets = s.targets.map((t) => ({ slot: t.slot, at: t.at, hit: t.hit }));
  fx.projectiles(user.at, targets, 'fire', user.size, (arrived) => {
    const target = s.targets.find((t) => t.slot === arrived.slot);
    if (!target?.hit) return;
    s.hit(target);
    const { at, k } = target;
    fx.tween(650, (r, p) => {
      const grow = p < 0.3 ? backOut(p / 0.3) : 1;
      const flicker = 0.85 + 0.15 * Math.sin(p * 50);
      const fade = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      drawShape(r, BLAZE, at.x, at.y, 150 * k * grow * flicker, mix(FIRE[0], FIRE[1], 0.5 + 0.5 * Math.sin(p * 30)), fade);
    });
    fx.pieces(at, { shape: FLAME, colors: FIRE, size: 34, endSize: 12, speed: 200, direction: -Math.PI / 2, spread: 1.4, gravity: -220, drag: 0.3, life: 650, sway: 40, scatter: 80 }, 10, k);
  }, 'orb');
};

/** A ball of the weather's type flies up off the field, then drops on each target (Weather Ball). */
const weatherBall: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  const color = effectColor(s.type);
  const ball = (r: GlRenderer, x: number, y: number, radius: number): void => {
    softDisc(r, x, y, radius, color, 1, 0.2);
    ring(r, x, y, radius, 3 * k, mix(color, [0, 0, 0, 1], 0.4), 1, false);
    softDisc(r, x - radius * 0.3, y - radius * 0.3, radius * 0.3, WHITE, 0.9);
  };
  fx.tween(300, (r, p) => ball(r, user.at.x, lerp(user.at.y, -40, easeIn(p)), 24 * k));
  for (const target of s.targets) {
    fx.tween(320, (r, p) => ball(r, target.at.x, lerp(-40, target.at.y, easeIn(p)), 24 * target.k), () => landOn(s, target, s.type), 380);
  }
};

/** Spirits rise from the ground round the target, then swoop into it (Last Respects). */
const lastRespects: Signature = (s) => {
  const { fx, user } = s;
  s.glow(user.slot);
  for (const target of s.targets) {
    const { at, feet, k } = target;
    for (let i = 0; i < 5; i++) {
      const start = { x: at.x + (i - 2) * 50 * k, y: feet.y };
      const top = { x: start.x * 1, y: at.y - (60 + (i % 2) * 30) * k };
      fx.tween(
        800,
        (r, p) => {
          const point = p < 0.55 ? { x: start.x + Math.sin(p * 20 + i) * 8 * k, y: lerp(start.y, top.y, easeOut(p / 0.55)) } : arcPoint(top, at, easeIn((p - 0.55) / 0.45), 20 * k);
          const fade = fadeInOut(p, 0.15, 0.05);
          glowDot(r, point.x, point.y, 28 * k, GHOSTS[i % GHOSTS.length], 0.4 * fade, true);
          flame(r, point.x, point.y, 44 * k, GHOSTS[i % GHOSTS.length], fade * 0.95);
        },
        i === 2 ? () => landOn(s, target, 'ghost') : undefined,
        i * 50,
      );
    }
  }
};

/** Pink flames spiral over to the target (Mystical Fire). */
const mysticalFire: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  s.glow(user.slot);
  for (const target of s.targets) {
    for (let i = 0; i < 8; i++) {
      fx.tween(
        460,
        (r, p) => {
          const e = easeInOut(p);
          const swirl = Math.sin(e * Math.PI * 3 + i) * 40 * k * Math.sin(Math.PI * e);
          const x = lerp(user.at.x, target.at.x, e);
          const y = lerp(user.at.y, target.at.y, e) + swirl;
          flame(r, x, y, 42 * k, MYSTIC[i % MYSTIC.length], 1);
        },
        i === 7
          ? () => {
              landOn(s, target, 'fire', false, true);
              if (target.hit) fx.pieces(target.at, { shape: FLAME, colors: MYSTIC, size: 30, endSize: 10, speed: 170, direction: -Math.PI / 2, spread: 1.2, gravity: -200, drag: 0.3, life: 600, sway: 40, scatter: 40 }, 8, target.k);
            }
          : undefined,
        i * 45,
      );
    }
  }
};

/** A jagged bolt cracks from the user to the target (Volt Switch). */
const voltSwitch: Signature = (s) => {
  const { fx, user } = s;
  const k = user.k;
  s.glow(user.slot);
  for (const target of s.targets) {
    fx.tween(
      360,
      (r, p) => {
        const reach = easeOut(clamp01(p / 0.4));
        const fade = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        const segments = 8;
        let last = user.at;
        for (let i = 1; i <= segments; i++) {
          const t = (i / segments) * reach;
          const jitter = i === segments ? 0 : (Math.random() - 0.5) * 50 * k;
          const point = { x: lerp(user.at.x, target.at.x, t) + jitter * 0.4, y: lerp(user.at.y, target.at.y, t) + jitter };
          streak(r, last.x, last.y, point.x, point.y, 9 * k, BOLT, fade);
          streak(r, last.x, last.y, point.x, point.y, 3 * k, WHITE, fade);
          last = point;
        }
      },
      () => landOn(s, target, 'electric'),
    );
  }
};

// ---------------------------------------------------------------- physical moves

/** A dark hand slaps the target, knocking its item flying (Knock Off). */
const knockOff: Signature = (s) => {
  const { fx, user } = s;
  s.lunge(() => {
    for (const target of s.targets) {
      if (!target.hit) continue;
      const { at, k } = target;
      const away = Math.sign(target.at.x - user.at.x) || 1;
      fx.tween(260, (r, p) => drawShape(r, HAND, at.x - away * lerp(110, -30, easeOut(p)) * k, at.y - 10 * k, 92 * k, rgba('#c8b8d8'), 1 - clamp01((p - 0.7) / 0.3), away * (0.8 - 1.6 * p)));
      landOn(s, target, 'dark', true);
      fx.tween(700, (r, p) => {
        const x = at.x + away * 160 * k * p;
        const y = at.y - 140 * k * Math.sin(Math.PI * p * 0.9) + 60 * k * p;
        softDisc(r, x, y, 14 * k, GOLD, 1 - clamp01((p - 0.7) / 0.3), 0.2);
        ring(r, x, y, 14 * k, 3 * k, mix(GOLD, [0, 0, 0, 1], 0.5), 1 - clamp01((p - 0.7) / 0.3), false);
      });
    }
  });
};

/** The user dives into a brawl cloud on the target, stars and hearts popping out (Play Rough). */
const playRough: Signature = (s) => {
  const { fx } = s;
  s.lunge(() => {
    for (const target of s.targets) {
      if (!target.hit) continue;
      const { at, k } = target;
      s.hit(target, true);
      const puffs = Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * Math.PI * 2, radius: 30 + Math.random() * 14 }));
      fx.tween(700, (r, p) => {
        const fade = fadeInOut(p, 0.1, 0.25);
        for (const puff of puffs) {
          const wobble = Math.sin(p * 30 + puff.a * 3) * 8;
          softDisc(r, at.x + Math.cos(puff.a) * (46 + wobble) * k, at.y + Math.sin(puff.a) * (34 + wobble) * k, puff.radius * k, BRAWL[puffs.indexOf(puff) % 2], 0.95 * fade, 0.25);
        }
      });
      for (let i = 0; i < 6; i++) {
        fx.later(i * 100, () => fx.pieces(at, { shape: i % 2 ? HEART : STAR, colors: i % 2 ? [PINK] : [rgba('#ffe066')], size: 24, endSize: 14, speed: 260, drag: 0.2, gravity: 300, life: 500, spin: 5 }, 1, k));
      }
      fx.impact(at, 'fairy', target.size, true);
    }
  });
};

// ---------------------------------------------------------------- contact marks and draining

/**
 * A contact move's mark on its target, over the type's hit: a fist or a foot pops up, jaws snap
 * shut, three claw marks or a blade's cut slash across. Tinted with the type's colour.
 */
export function contactMark(fx: GlEffects, mark: ContactMark, at: EffectPoint, size: number, type: string): void {
  const k = size / 240;
  const tint = mix(WHITE, effectColor(type), 0.35);
  switch (mark) {
    case 'punch':
    case 'kick':
      fx.tween(400, (r, p) => {
        const grow = p < 0.3 ? backOut(p / 0.3) : 1;
        const fade = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        drawShape(r, mark === 'punch' ? FIST : FOOT, at.x, at.y, (mark === 'punch' ? 84 : 96) * k * (0.4 + 0.6 * grow), mark === 'punch' ? mix(SKIN, tint, 0.5) : tint, fade, mark === 'kick' ? -0.35 : 0);
      });
      return;
    case 'bite': {
      // The jaws open wide (a little wider still, winding up), snap shut, clamp on shaking, and let go.
      const height = 63 * k;
      const teeth = mix(WHITE, tint, 0.6);
      fx.tween(BITE_MS, (r, p) => {
        const grow = backOut(clamp01(p / BITE_OPEN));
        const gap = p < BITE_OPEN
          ? 80 * k + 16 * k * (p / BITE_OPEN)
          : p < BITE_SHUT
            ? 96 * k * (1 - easeIn((p - BITE_OPEN) / (BITE_SHUT - BITE_OPEN)))
            : p < BITE_LET_GO ? -3 * k : 26 * k * easeOut((p - BITE_LET_GO) / (1 - BITE_LET_GO));
        const shake = p >= BITE_SHUT && p < BITE_LET_GO ? Math.sin(p * 140) * 5 * k : 0;
        const fade = p < BITE_LET_GO ? 1 : 1 - (p - BITE_LET_GO) / (1 - BITE_LET_GO);
        const scale = 0.6 + 0.4 * grow;
        drawShape(r, FANGS, at.x + shake, at.y - 20 * k - gap, height * scale, teeth, fade);
        drawShape(r, FANGS, at.x - shake, at.y + 20 * k + gap, height * scale, teeth, fade, Math.PI);
      });
      // As they shut: a flash and sparks out of the bite.
      fx.later(BITE_SNAP_MS, () => {
        fx.tween(FLASH_MS, (r, p) => glowDot(r, at.x, at.y, (40 + 90 * p) * k, WHITE, 0.8 * (1 - p), true));
        fx.pieces(at, { shape: SPARKLE, colors: [WHITE, tint], size: 22, endSize: 4, speed: 300, drag: 0.1, life: 380, spin: 4 }, 6, k);
      });
      return;
    }
    case 'claw':
      for (let i = 0; i < 3; i++) {
        fx.tween(
          320,
          (r, p) => {
            const length = 150 * k * easeOut(clamp01(p / 0.5));
            const x = at.x + (i - 1) * 28 * k;
            const fade = p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5;
            const dx = Math.cos(0.95) * length / 2;
            const dy = Math.sin(0.95) * length / 2;
            streak(r, x - dx, at.y - dy, x + dx, at.y + dy, 9 * k, tint, fade);
            streak(r, x - dx, at.y - dy, x + dx, at.y + dy, 3 * k, WHITE, fade);
          },
          undefined,
          i * 45,
        );
      }
      return;
    case 'slash':
      fx.tween(420, (r, p) => {
        const length = 260 * k * easeOut(clamp01(p / 0.4));
        const fade = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
        const dx = Math.cos(-0.6) * length / 2;
        const dy = Math.sin(-0.6) * length / 2;
        streak(r, at.x - dx, at.y - dy, at.x + dx, at.y + dy, 20 * k * (1 - 0.5 * p), tint, fade);
        streak(r, at.x - dx, at.y - dy, at.x + dx, at.y + dy, 7 * k, WHITE, fade);
      });
      fx.pieces(at, { shape: SPARKLE, colors: [WHITE, tint], size: 20, endSize: 4, speed: 260, drag: 0.1, life: 360, spin: 4 }, 5, k);
      return;
  }
}

/** Lights fly back from where a draining move hit to its user (`arrived` as the last one gets there). */
export function drainLights(fx: GlEffects, from: EffectPoint, to: EffectPoint, size: number, arrived: () => void): void {
  const k = size / 240;
  for (let i = 0; i < 8; i++) {
    const bend = (Math.random() - 0.5) * 120 * k;
    fx.tween(
      480,
      (r, p) => {
        const e = easeInOut(p);
        const x = lerp(from.x, to.x, e);
        const y = lerp(from.y, to.y, e) + Math.sin(Math.PI * e) * bend;
        softDisc(r, x, y, 9 * k, HEAL, 0.95, 0.3);
        softDisc(r, x, y, 4 * k, WHITE, 1, 0.3);
      },
      i === 7 ? arrived : undefined,
      120 + i * 45,
    );
  }
}

// ---------------------------------------------------------------- the list

/** Every move with its own animation, by its name. */
const SIGNATURES: ReadonlyArray<readonly [string, Signature]> = [
  ['Swords Dance', swordsDance],
  ['Dragon Dance', dragonDance],
  ['Nasty Plot', nastyPlot],
  ['Calm Mind', calmMind],
  ['Bulk Up', bulkUp],
  ['Roost', roost],
  ['Recover', recover],
  ['Helping Hand', helpingHand],
  ['Follow Me', spotlight(false)],
  ['Rage Powder', spotlight(true)],
  ['Encore', encore],
  ['Taunt', taunt],
  ['Yawn', yawn],
  ['Will-O-Wisp', willOWisp],
  ['Parting Shot', partingShot],
  ['Stealth Rock', stealthRock],
  ['Reflect', screen(SCREENS['reflect'])],
  ['Light Screen', screen(SCREENS['lightscreen'])],
  ['Aurora Veil', screen(SCREENS['auroraveil'])],
  ['Shadow Ball', shadowBall],
  ['Draco Meteor', dracoMeteor],
  ['Aura Sphere', auraSphere],
  ['Focus Blast', focusBlast],
  ['Hurricane', hurricane],
  ['Sludge Bomb', sludgeBomb],
  ['Fire Blast', fireBlast],
  ['Weather Ball', weatherBall],
  ['Last Respects', lastRespects],
  ['Mystical Fire', mysticalFire],
  ['Volt Switch', voltSwitch],
  ['Knock Off', knockOff],
  ['Play Rough', playRough],
];

const BY_MOVE = new Map(SIGNATURES.map(([name, signature]) => [toId(name), signature]));

/** The move's own animation, if it has one. */
export function signatureMove(move: string): Signature | null {
  return BY_MOVE.get(toId(move)) ?? null;
}

/** The moves with their own animation, by name. */
export const SIGNATURE_MOVES: readonly string[] = SIGNATURES.map(([name]) => name);
