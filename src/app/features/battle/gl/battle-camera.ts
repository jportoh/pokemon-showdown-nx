import { SlotKey } from '@features/battle/models/battle';
import { CAMERA_DEPTHS, CAMERA_TUNING, CameraEasing } from './camera-tuning';
import { FIELD_W, Stand } from './field-layout';

/** What the camera looks at: the turn playing, one of ours choosing, or a target being picked. */
export type CameraFocus = { kind: 'rest' } | { kind: 'choose'; slot: SlotKey } | { kind: 'target'; slot: SlotKey | null };

export const REST_FOCUS: CameraFocus = { kind: 'rest' };

/** A pinhole camera: its distance (tz, forwards), its focal length (f) and its shift (tx, ty). */
interface Lens {
  tz: number;
  f: number;
  tx: number;
  ty: number;
}

/** How a Pokémon looks this frame: lit as the one choosing, or darkened (0..1 each). */
export interface SlotLook {
  glow: number;
  dim: number;
}

const CENTER_X = FIELD_W / 2;
const { own: D_OWN, foe: D_FOE, horizonY: H0 } = CAMERA_DEPTHS;

const EASINGS: Record<CameraEasing, (t: number) => number> = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  linear: (t) => t,
};

/**
 * The lens that draws ours at `own` and the opponent's at `foe` (in x). A thing at depth d is drawn
 * f / (d - tz) times its size; ours are nearer, so they never come out smaller than theirs.
 */
function lens(own: number, foe: number): Pick<Lens, 'tz' | 'f'> {
  const ratio = Math.min(foe / own, 0.97);
  const tz = (D_OWN - ratio * D_FOE) / (1 - ratio);
  return { tz, f: own * (D_OWN - tz) };
}

const REST: Lens = { ...lens(CAMERA_TUNING.rest.own, CAMERA_TUNING.rest.foe), tx: 0, ty: 0 };

/** Where the rest camera sees (x, y) at depth d, in the world. */
function world(x: number, y: number, d: number): { X: number; Y: number } {
  return { X: ((x - CENTER_X) * (d - REST.tz)) / REST.f, Y: ((y - H0) * (d - REST.tz)) / REST.f };
}

function project(lensNow: Lens, x: number, y: number, d: number): { x: number; y: number; k: number } {
  const w = world(x, y, d);
  const k = lensNow.f / (d - lensNow.tz);
  return { x: CENTER_X + k * (w.X - lensNow.tx), y: H0 + k * (w.Y - lensNow.ty), k };
}

export const depthOf = (slot: SlotKey): number => (slot.startsWith('p1') ? D_OWN : D_FOE);

/**
 * The battle field's camera (see camera-tuning.ts). At rest, ours stand nearer and look bigger; while
 * we choose, it comes close to our side, the chooser lit and its partner darkened; picking a target,
 * it backs off onto the opponent's. Moving between them it shifts the camera itself, so every layer
 * (Pokémon, platforms, ground, clouds) moves by its depth: parallax. Everything is placed through
 * `project`, in field coordinates, where the rest camera drew it.
 */
export class BattleCamera {
  private from: Lens = REST;
  private to: Lens = REST;
  private lens: Lens = REST;
  private start = 0;
  private focusKey = 'rest';
  private fromLooks = new Map<SlotKey, SlotLook>();
  private toLooks = new Map<SlotKey, SlotLook>();
  private progress = 1;

  /** Points the camera at `focus` (each frame; it moves only when the focus changes). */
  aim(focus: CameraFocus, stands: Record<SlotKey, Stand>, now: number): void {
    const key = focus.kind === 'rest' ? 'rest' : `${focus.kind}:${focus.slot ?? ''}:${Object.keys(stands).length}`;
    if (key === this.focusKey) return;
    this.focusKey = key;
    this.from = this.lens;
    this.fromLooks = new Map([...this.toLooks.keys()].map((slot) => [slot, this.look(slot)]));
    this.to = this.lensFor(focus, stands);
    this.toLooks = looksFor(focus, Object.keys(stands));
    this.start = now;
    this.progress = 0;
  }

  /** Moves the camera to where it is at `now`. */
  update(now: number): void {
    const t = CAMERA_TUNING.durationMs > 0 ? Math.min(1, (now - this.start) / CAMERA_TUNING.durationMs) : 1;
    const e = EASINGS[CAMERA_TUNING.easing](t);
    this.progress = e;
    const { from, to } = this;
    this.lens = { tz: from.tz + (to.tz - from.tz) * e, f: from.f + (to.f - from.f) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
  }

  /** Where a thing the rest camera drew at (x, y) at depth d is now, and its size in x (96px each). */
  project(x: number, y: number, d: number): { x: number; y: number; k: number } {
    return project(this.lens, x, y, d);
  }

  /** As `project`, its size as a share of the rest camera's (1 at rest). */
  place(x: number, y: number, d: number): { x: number; y: number; scale: number } {
    const p = project(this.lens, x, y, d);
    return { x: p.x, y: p.y, scale: p.k / (REST.f / (d - REST.tz)) };
  }

  look(slot: SlotKey): SlotLook {
    const from = this.fromLooks.get(slot) ?? NO_LOOK;
    const to = this.toLooks.get(slot) ?? NO_LOOK;
    const e = this.progress;
    return { glow: from.glow + (to.glow - from.glow) * e, dim: from.dim + (to.dim - from.dim) * e };
  }

  private lensFor(focus: CameraFocus, stands: Record<SlotKey, Stand>): Lens {
    if (focus.kind === 'rest') return REST;
    const tuning = focus.kind === 'choose' ? CAMERA_TUNING.choosing : CAMERA_TUNING.target;
    const { tz, f } = lens(tuning.own, tuning.foe);
    // Picking a target frames the opponent's side: on the target when it's one of theirs.
    const framed = focus.kind === 'choose' ? focus.slot : focus.slot?.startsWith('p2') ? focus.slot : Object.keys(stands).find((slot) => slot.startsWith('p2'));
    const stand = framed ? stands[framed] : undefined;
    if (!stand || !framed) return { tz, f, tx: 0, ty: 0 };
    const d = depthOf(framed);
    const w = world(stand.x, stand.y, d);
    return { tz, f, tx: CAMERA_TUNING.pan * w.X, ty: w.Y - ((tuning.feetY - H0) * (d - tz)) / f };
  }
}

const NO_LOOK: SlotLook = { glow: 0, dim: 0 };

function looksFor(focus: CameraFocus, slots: SlotKey[]): Map<SlotKey, SlotLook> {
  const dim = CAMERA_TUNING.dimOthers ? 1 : 0;
  const looks = new Map<SlotKey, SlotLook>();
  // The chooser or the target is lit; the rest of ours darken.
  for (const slot of slots) {
    if (focus.kind === 'rest') looks.set(slot, NO_LOOK);
    else if (slot === focus.slot) looks.set(slot, { glow: 1, dim: 0 });
    else looks.set(slot, { glow: 0, dim: slot.startsWith('p1') ? dim : 0 });
  }
  return looks;
}
