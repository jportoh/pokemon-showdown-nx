import { GlRenderer, QuadStyle, Rgba, Texture } from '@core/gl/gl-renderer';
import { BattleCamera } from '@features/battle/gl/battle-camera';
import { FIELD_H, FIELD_W, GROUND_Y } from '@features/battle/gl/field-layout';
import { BattlefieldId } from '@shared/data/battlefields';

/** The ground's colours: the ground itself, and the platforms' top and rim. */
export interface GroundColours {
  ground: string;
  platform: string;
  edge: string;
}

/**
 * A place battles are fought in: the sky, what stands beyond the ground, the ground and the platforms'
 * colours, and what drifts about. Everything is drawn with the renderer's quads (one texture: the
 * scenery sheet), placed by depth so the camera's moves give it parallax. Static pieces are worked out
 * once (module constants); only their few moving parts change each frame.
 */
export interface Backdrop {
  id: BattlefieldId;
  /** The sky from the top of the field down to the horizon, two colours or more. */
  sky: readonly string[];
  ground: GroundColours;
  /** Night or underground: the weather's colour washes over it more lightly, so it doesn't turn pale. */
  dark?: boolean;
  /** What stands beyond the ground (the sun, hills, trees, buildings), over the sky. */
  far(p: BackdropPainter): void;
  /** On the ground, behind the platforms: the sea, the floor's tiles, the pitch's stripes. */
  floor?(p: BackdropPainter): void;
  /** Light things drifting about the field, behind the Pokémon: fireflies, dust, petals. */
  ambient?(p: BackdropPainter): void;
}

/** How deep each layer is, as CAMERA_DEPTHS (ours at 1, the ground's far edge at 3.2): the further, the less it moves. */
export const DEPTH = {
  sky: 9,
  far: 6,
  mid: 4.4,
  edge: 3.2,
} as const;

/** The scenery sheet, 256x128: a disc on the left, a triangle on the right, each with a 2px margin (big enough for the platforms). */
const SHEET_W = 256;
const SHEET_H = 128;
const DISC_UV = [2 / SHEET_W, 2 / SHEET_H, 126 / SHEET_W, 126 / SHEET_H] as const;
const PEAK_UV = [130 / SHEET_W, 2 / SHEET_H, 254 / SHEET_W, 126 / SHEET_H] as const;
/** The triangle upside down: its point at the bottom (icicles, a crystal's lower half). */
const DROP_UV = [130 / SHEET_W, 126 / SHEET_H, 254 / SHEET_W, 2 / SHEET_H] as const;

const sheets = new WeakMap<GlRenderer, Texture>();

/** The scenery sheet for this renderer, made the first time (white, premultiplied, antialiased edges). */
export function scenerySheet(renderer: GlRenderer): Texture {
  const known = sheets.get(renderer);
  if (known) return known;
  const pixels = new Uint8Array(SHEET_W * SHEET_H * 4);
  // The triangle's corners: its point at the top middle, its base along the bottom.
  const corners: [number, number][] = [
    [192, 2],
    [254, 126],
    [130, 126],
  ];
  for (let y = 0; y < SHEET_H; y++) {
    for (let x = 0; x < SHEET_W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside: number;
      if (x < 128) inside = 62 - Math.hypot(px - 64, py - 64);
      else {
        // Distance inside each edge (negative outside); the nearest edge decides.
        inside = Infinity;
        for (let i = 0; i < 3; i++) {
          const [ax, ay] = corners[i];
          const [bx, by] = corners[(i + 1) % 3];
          const length = Math.hypot(bx - ax, by - ay);
          // The corners go clockwise on screen: the inside is on the right of each edge.
          inside = Math.min(inside, ((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / -length);
        }
      }
      const a = Math.round(Math.max(0, Math.min(1, inside + 0.5)) * 255);
      const i = (y * SHEET_W + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = a;
    }
  }
  const sheet = renderer.textureFromPixels(pixels, SHEET_W, SHEET_H, true);
  sheets.set(renderer, sheet);
  return sheet;
}

/**
 * Draws a backdrop's pieces where the camera shows them: `at(depth)` places what follows at that depth
 * (positions are where the rest camera would draw them, field coordinates), `at(null)` fixes it to the
 * screen. Ovals and triangles come from the scenery sheet, so the whole backdrop is one batch.
 */
export class BackdropPainter {
  /** Seconds, for the moving parts. */
  t = 0;
  /** Where the ground meets the sky this frame. */
  groundY = GROUND_Y;
  private ox = 0;
  private oy = 0;
  private s = 1;

  constructor(
    readonly renderer: GlRenderer,
    private readonly sheet: Texture,
    private readonly camera: BattleCamera,
  ) {}

  /** What follows is placed `depth` away (null: on the screen, the camera doesn't move it). */
  at(depth: number | null): this {
    if (depth === null) {
      this.ox = 0;
      this.oy = 0;
      this.s = 1;
      return this;
    }
    // At one depth the camera only scales and shifts: two points give both.
    const a = this.camera.place(0, 0, depth);
    const b = this.camera.place(FIELD_W, 0, depth);
    this.s = (b.x - a.x) / FIELD_W;
    this.ox = a.x;
    this.oy = a.y;
    return this;
  }

  /** A rectangle from its top-left corner. */
  rect(x: number, y: number, w: number, h: number, fill: Rgba, style?: Omit<QuadStyle, 'fill'>): void {
    const s = this.s;
    this.renderer.rect(this.ox + x * s, this.oy + y * s, w * s, h * s, style ? { ...style, fill } : { fill });
  }

  /** An oval round (cx, cy). */
  oval(cx: number, cy: number, rx: number, ry: number, fill: Rgba, additive = false): void {
    this.rect(cx - rx, cy - ry, rx * 2, ry * 2, fill, { texture: this.sheet, uv: DISC_UV, additive });
  }

  /** A triangle `w` wide and `h` tall, its point at the top middle (or at the bottom, `down`). */
  peak(cx: number, top: number, w: number, h: number, fill: Rgba, down = false): void {
    this.rect(cx - w / 2, top, w, h, fill, { texture: this.sheet, uv: down ? DROP_UV : PEAK_UV });
  }

  /** A soft round light, added to what's under it. */
  glow(cx: number, cy: number, r: number, fill: Rgba): void {
    const radius = r * this.s;
    this.rect(cx - r, cy - r, r * 2, r * 2, fill, { radius, softness: radius * 0.9, additive: true });
  }

  /** A straight line `width` thick. */
  line(x1: number, y1: number, x2: number, y2: number, width: number, fill: Rgba): void {
    const length = Math.hypot(x2 - x1, y2 - y1);
    this.rect((x1 + x2) / 2 - length / 2, (y1 + y2) / 2 - width / 2, length, width, fill, { angle: Math.atan2(y2 - y1, x2 - x1) });
  }

  /**
   * A floor's lines in perspective, on the screen from the horizon down (as Trick Room's): `rows` across,
   * closer together towards the horizon, and `columns` running to a point above it, `spacing` apart at the bottom.
   */
  floorLines(rows: number, columns: number, spacing: number, fill: Rgba): void {
    this.at(null);
    const top = this.groundY;
    const depth = FIELD_H - top;
    for (let i = 1; i <= rows; i++) {
      const y = top + depth * (i / rows) * (i / rows);
      this.rect(0, y - 1, FIELD_W, 2, fill);
    }
    const vanishY = top - depth * 1.5;
    const narrowing = (top - vanishY) / (FIELD_H - vanishY);
    for (let i = -columns; i <= columns; i++) {
      const bottomX = FIELD_W / 2 + i * spacing;
      this.line(FIELD_W / 2 + (bottomX - FIELD_W / 2) * narrowing, top, bottomX, FIELD_H, 2, fill);
    }
  }

  /** A rectangle shading from `top` to `bottom` (the renderer's gradients run sideways: it's turned a quarter). */
  gradient(x: number, y: number, w: number, h: number, top: Rgba, bottom: Rgba): void {
    const s = this.s;
    const cx = this.ox + (x + w / 2) * s;
    const cy = this.oy + (y + h / 2) * s;
    this.renderer.rect(cx - (h * s) / 2, cy - (w * s) / 2, h * s, w * s, { fill: top, fillEnd: bottom, angle: Math.PI / 2 });
  }
}

/** The same numbers every time for the same seed: static pieces (stars, windows, trees) placed "at random". */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..1, then back to 0, `period` seconds round. */
export function wave(t: number, period: number, phase = 0): number {
  return 0.5 + 0.5 * Math.sin(((t / period) * 2 + phase) * Math.PI);
}
