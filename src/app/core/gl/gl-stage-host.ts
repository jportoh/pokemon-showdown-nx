import { Component, ElementRef, afterNextRender, inject, viewChild } from '@angular/core';
import { GlStage, STAGE_H, STAGE_W } from './gl-stage';

/**
 * The app's one canvas, at the root (GlStage draws every screen on it). It hides while no screen is
 * open, between routes (styles.css lays it out).
 */
@Component({
  selector: 'app-gl-stage',
  template: `
    <div class="gl-stage" [class.off]="!stage.active()">
      <canvas
        #canvas
        aria-hidden="true"
        [attr.width]="width"
        [attr.height]="height"
      ></canvas>
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
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly width = Math.round(STAGE_W * this.stage.scale);
  protected readonly height = Math.round(STAGE_H * this.stage.scale);

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      // Plain listeners: a template binding would render the app on every mouse move.
      canvas.addEventListener('click', (event) => this.stage.click(event.offsetX, event.offsetY));
      canvas.addEventListener('mousemove', (event) => this.stage.hover(event.offsetX, event.offsetY));
      this.stage.attach(canvas);
    });
  }
}
