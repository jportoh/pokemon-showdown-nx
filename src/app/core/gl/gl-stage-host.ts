import { Component, DestroyRef, ElementRef, afterNextRender, inject, viewChild } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { GlStage, STAGE_H, STAGE_W } from './gl-stage';
import { PointerInput } from './pointer-input';

/** The densest the canvas gets, in canvas pixels per stage pixel (2560x1440). */
const MAX_SCALE = 2;
/** A screen this close to the stage's size shows it 1:1: a few pixels off (a bar) shouldn't blur it. */
const SNAP = 0.02;

/**
 * The app's one canvas, at the root (GlStage draws every screen on it). It hides while no screen is
 * open, between routes (styles.css lays it out). The scenes always draw a 1280x720 stage; the canvas
 * fills the screen keeping that shape (bands either side when it's another shape), with as many
 * pixels as the screen has: 1920x1080 on a TV (the Switch docked), drawn 1.5 times denser.
 */
@Component({
  selector: 'app-gl-stage',
  template: `
    <div class="gl-stage" [class.off]="!stage.active()">
      <canvas #canvas aria-hidden="true"></canvas>
      @if (stage.failure(); as message) {
        <p role="alert" class="gl-failure">
          WebGL failed: {{ message }}
        </p>
      }
    </div>
  `,
})
export class GlStageHost {
  protected readonly stage = inject(GlStage);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      this.layout(canvas);
      // The host lasts as long as the app: the pointer listeners are never removed. PointerInput
      // measures the canvas on screen, so taps and clicks land right at any size.
      const pointer = new PointerInput(
        canvas,
        (x, y) => this.stage.click(x, y),
        (x, y) => this.stage.hover(x, y),
      );
      pointer.listen();
      this.stage.pointer = pointer;
      // Hold-to-confirm follows a finger held on its button (HoldAction).
      this.navigation.pointer = pointer;
      const resized = () => this.layout(canvas);
      window.addEventListener('resize', resized);
      destroyRef.onDestroy(() => window.removeEventListener('resize', resized));
      this.stage.attach(canvas);
    });
  }

  /** Sizes the canvas to the screen (docking and undocking change it) and tells the stage how dense it is. */
  private layout(canvas: HTMLCanvasElement): void {
    const width = window.innerWidth || STAGE_W;
    const height = window.innerHeight || STAGE_H;
    let fit = Math.min(width / STAGE_W, height / STAGE_H);
    if (Math.abs(fit - 1) < SNAP) fit = 1;
    const cssWidth = Math.round(STAGE_W * fit);
    const cssHeight = Math.round(STAGE_H * fit);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.style.marginLeft = `${Math.max(0, Math.floor((width - cssWidth) / 2))}px`;
    canvas.style.marginTop = `${Math.max(0, Math.floor((height - cssHeight) / 2))}px`;

    // Never below 1: on a small window the browser shrinks a 1280x720 canvas better than WebGL would.
    const scale = Math.min(MAX_SCALE, Math.max(1, fit * (window.devicePixelRatio || 1)));
    const pixelWidth = Math.round(STAGE_W * scale);
    const pixelHeight = Math.round(STAGE_H * scale);
    // Setting the size clears the canvas, so only when it changes (the next frame redraws it).
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    this.stage.setScale(scale);
  }
}
