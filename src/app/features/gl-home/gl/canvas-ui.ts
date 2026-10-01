import { CanvasAction } from '@core/input/keyboard-navigation';
import { GlRenderer, Rgba, rgba } from './gl-renderer';
import { TEXT_PAD, TextStyle, TextTextures } from './gl-textures';

export type Align = 'left' | 'center' | 'right';

/**
 * Text on a canvas: drawn with its middle at `cy`, from `x` (or centred on it, or ending at it), cut
 * with an ellipsis past `maxWidth`. Returns how wide it came out.
 */
export function drawText(
  renderer: GlRenderer,
  text: TextTextures,
  value: string,
  x: number,
  cy: number,
  style: TextStyle,
  color: Rgba,
  options: { align?: Align; maxWidth?: number } = {},
): number {
  if (!value) return 0;
  const shown = options.maxWidth !== undefined ? text.fit(value, style, options.maxWidth) : value;
  const texture = text.get(shown, style);
  if (!texture) return 0;
  const width = texture.width - TEXT_PAD * 2;
  const align = options.align ?? 'left';
  const left = align === 'left' ? x : align === 'center' ? x - width / 2 : x - width;
  renderer.image(texture, left - TEXT_PAD, cy - texture.height / 2, 1, color);
  return width;
}

/** A control a canvas screen draws: where it is and what A does on it. */
export interface UiControl {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accept?: () => void;
  /** Pressed with a click only: the d-pad never lands on it (as data-kb-skip). */
  skip?: boolean;
}

/** The yellow focus ring of the whole app (styles.css: 3px #facc15 inside the control). */
export const FOCUS_RING: Rgba = rgba('#facc15');

/**
 * Focus for a screen drawn on a canvas, which has no DOM to focus: every frame, the screen declares
 * its controls as it draws them (`control`), and the controller moves between the last frame's ones
 * by where they are, as the DOM's spatial navigation does (`move`). A presses the focused one. A
 * control that goes away hands focus to the nearest one left, where it was.
 */
export class CanvasFocus {
  focused: string | null = null;
  private building: UiControl[] = [];
  private controls: UiControl[] = [];
  private lastBox: UiControl | null = null;

  /** Before drawing a frame. */
  begin(): void {
    this.building = [];
  }

  /** Declares a control drawn this frame; true when it has the focus. */
  control(control: UiControl): boolean {
    this.building.push(control);
    return control.id === this.focused;
  }

  /** After drawing a frame: the focus follows its control, or recovers when the control has gone. */
  end(): void {
    this.controls = this.building;
    const current = this.controls.find((c) => c.id === this.focused);
    if (current) {
      this.lastBox = current;
      return;
    }
    if (this.focused !== null && this.lastBox && this.controls.length > 0) {
      const from = this.lastBox;
      this.focused = nearest(this.controls, centre(from)).id;
    }
  }

  focus(id: string | null): void {
    this.focused = id;
  }

  has(id: string): boolean {
    return this.controls.some((c) => c.id === id);
  }

  /** The d-pad: the nearest control that way; false when there's none (or nothing to move from). */
  move(direction: 'up' | 'down' | 'left' | 'right', among?: (control: UiControl) => boolean): boolean {
    const candidates = this.controls.filter((c) => !c.skip && (!among || among(c)));
    const current = this.controls.find((c) => c.id === this.focused);
    if (!current) {
      if (candidates.length === 0) return false;
      this.focused = candidates[0].id;
      return true;
    }
    let best: UiControl | null = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (candidate.id === current.id) continue;
      const score = directionalScore(current, candidate, direction);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) return false;
    this.focused = best.id;
    return true;
  }

  /** A: presses the focused control. */
  accept(): boolean {
    const control = this.controls.find((c) => c.id === this.focused);
    if (!control?.accept) return false;
    control.accept();
    return true;
  }

  /** A click or tap (web): focuses and presses the control under it. */
  click(x: number, y: number): boolean {
    const control = this.controls.find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
    if (!control) return false;
    this.focused = control.id;
    control.accept?.();
    return true;
  }

  /** The mouse over a control (web): it takes the focus. */
  hover(x: number, y: number): void {
    const control = this.controls.find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
    if (control) this.focused = control.id;
  }
}

/** Whether an action is a direction. */
export function isDirection(action: CanvasAction): action is 'up' | 'down' | 'left' | 'right' {
  return action === 'up' || action === 'down' || action === 'left' || action === 'right';
}

function centre(box: UiControl): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function nearest(controls: readonly UiControl[], point: { x: number; y: number }): UiControl {
  let best = controls[0];
  let bestDistance = Infinity;
  for (const control of controls) {
    const c = centre(control);
    const distance = Math.hypot(c.x - point.x, c.y - point.y);
    if (distance < bestDistance) {
      best = control;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * How good a move from `from` to `to` is that way (lower is better; Infinity when it isn't that way):
 * the gap along the direction, plus three times the distance across it (none while they overlap), so
 * a control in line wins over a nearer one off to the side.
 */
function directionalScore(from: UiControl, to: UiControl, direction: 'up' | 'down' | 'left' | 'right'): number {
  const a = centre(from);
  const b = centre(to);
  const horizontal = direction === 'left' || direction === 'right';
  const ahead = direction === 'right' ? b.x - a.x : direction === 'left' ? a.x - b.x : direction === 'down' ? b.y - a.y : a.y - b.y;
  if (ahead <= 1) return Infinity;
  const gap = horizontal
    ? Math.max(0, direction === 'right' ? to.x - (from.x + from.w) : from.x - (to.x + to.w))
    : Math.max(0, direction === 'down' ? to.y - (from.y + from.h) : from.y - (to.y + to.h));
  const across = horizontal
    ? Math.max(0, Math.max(from.y, to.y) - Math.min(from.y + from.h, to.y + to.h))
    : Math.max(0, Math.max(from.x, to.x) - Math.min(from.x + from.w, to.x + to.w));
  const offCentre = horizontal ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
  return gap + across * 3 + offCentre * 0.1;
}
