import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { BattleFieldScene } from '@features/battle/gl/battle-field-scene';
import { GlSprites } from '@features/battle/gl/gl-sprites';
import { SpriteBitmaps } from '@features/battle/gl/sprite-bitmaps';
import { GlRenderer } from '@features/gl-home/gl/gl-renderer';
import { TextTextures, discTexture } from '@features/gl-home/gl/gl-textures';

const FIELD_W = 985;
const FIELD_H = 500;

/**
 * The WebGL battle field on a canvas of its own, 985x500, for the battle screen while the player's
 * own battles still have their command panel and side column in the DOM (watching a battle, the whole
 * screen is one canvas: GlBattleScreen). It only hosts BattleFieldScene.
 */
@Component({
  selector: 'app-gl-battle-field',
  host: { class: 'block h-[500px] w-[985px]' },
  template: `
    <canvas #canvas aria-hidden="true" class="block h-[500px] w-[985px]" [attr.width]="width" [attr.height]="height"></canvas>
    @if (failure(); as message) {
      <p role="alert" class="absolute top-[220px] left-[150px] block h-[60px] w-[685px] rounded-md border-2 border-white bg-[#1f2937] text-center text-lg leading-[56px] text-white">WebGL failed: {{ message }}</p>
    }
  `,
})
export class GlBattleField {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly scene = new BattleFieldScene();
  private readonly scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  protected readonly width = Math.round(FIELD_W * this.scale);
  protected readonly height = Math.round(FIELD_H * this.scale);
  protected readonly failure = signal<string | null>(null);

  constructor() {
    let renderer: GlRenderer | null = null;
    let text: TextTextures | null = null;
    let sprites: GlSprites | null = null;
    let frame = 0;
    afterNextRender(() => {
      try {
        renderer = new GlRenderer(this.canvasRef().nativeElement, FIELD_W, FIELD_H);
      } catch (error) {
        this.failure.set(String(error));
        return;
      }
      const ready = renderer;
      text = new TextTextures(ready, this.scale, getComputedStyle(document.body).fontFamily || 'Roboto, sans-serif');
      sprites = new GlSprites(ready, this.bitmaps);
      this.scene.attach(ready, text, sprites, discTexture(ready));
      let last = performance.now();
      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        sprites!.startFrame();
        ready.beginPlain([0, 0, 0, 1]);
        this.scene.draw(ready, now, dt);
        ready.end();
      };
      frame = requestAnimationFrame(loop);
    });
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(frame);
      sprites?.dispose();
      text?.dispose();
      renderer?.dispose();
    });
  }
}
