import { Component, ElementRef, afterNextRender, inject, viewChild } from '@angular/core';
import { GlStage, STAGE_H, STAGE_W } from './gl-stage';

/**
 * The app's one canvas, at the root under everything (GlStage draws on it). Shown while a screen
 * drawn on it is open; pages still in the DOM paint over the stage meanwhile, and the canvas hides
 * (a wrapper toggled by display, which Brewser toggles reliably).
 */
@Component({
  selector: 'app-gl-stage',
  host: { class: 'absolute top-0 left-0 block' },
  template: `
    <div class="block" [class.hidden]="!stage.active()">
      <canvas
        #canvas
        aria-hidden="true"
        class="block h-[720px] w-[1280px]"
        [attr.width]="width"
        [attr.height]="height"
      ></canvas>
      @if (stage.failure(); as message) {
        <p role="alert" class="absolute top-[320px] left-[240px] block h-[60px] w-[800px] rounded-md border-2 border-white bg-[#1f2937] text-center text-lg leading-[56px] text-white">
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
