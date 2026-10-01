import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input, linkedSignal, untracked, viewChildren } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { DecodedImage, ImagePriority, SpriteBitmaps } from '@core/gl/sprite-bitmaps';
import { ItemIcon } from '@shared/components/item-icon';
import { spriteUrl } from '@shared/components/pokemon-sprite';

/**
 * EXPERIMENT (feat/webgl-probe): an image of the battle screen drawn on a small canvas from the one
 * SpriteBitmaps decoded, rather than an <img> that decodes it again (test w4: decoding stalls the
 * console). `fallback` takes over when `src` can't be loaded (a missing back sprite). One canvas per
 * image, made anew when it changes, as PokemonSprite does with its <img> (Brewser didn't repaint a
 * changed src). Decorative: the name is always shown next to it.
 */
@Component({
  selector: 'app-shared-image',
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    @for (url of urls(); track url) {
      <canvas #canvas class="block" [attr.width]="size()" [attr.height]="size()" [style.width.px]="size()" [style.height.px]="size()"></canvas>
    }
  `,
})
export class SharedImage {
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly render = inject(RenderScheduler);
  readonly src = input('');
  readonly fallback = input('');
  readonly size = input(96);
  readonly priority = input<ImagePriority>(ImagePriority.Screen);

  private readonly canvases = viewChildren<ElementRef<HTMLCanvasElement>>('canvas');
  /** `src` couldn't be loaded; starts over with every src. */
  private readonly srcMissing = linkedSignal({ source: this.src, computation: () => false });
  private readonly url = computed(() => (this.srcMissing() ? this.fallback() : this.src()));
  protected readonly urls = computed(() => (this.url() ? [this.url()] : []));
  private stop: () => void = () => undefined;

  constructor() {
    afterRenderEffect(() => {
      const canvas = this.canvases()[0]?.nativeElement;
      const url = this.url();
      const size = this.size();
      untracked(() => {
        this.stop();
        if (!canvas || !url) return;
        this.stop = this.bitmaps.whenReady(url, this.priority(), (image) => {
          if (image) draw(canvas, image, size, this.bitmaps.get(url)?.width ?? size);
          else if (url === this.src() && this.fallback()) {
            this.srcMissing.set(true);
            this.render.request();
          }
        });
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }
}

function draw(canvas: HTMLCanvasElement, image: DecodedImage, size: number, width: number): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  // Pixel art scaled up stays sharp; scaled down, smoothing keeps it from breaking up.
  context.imageSmoothingEnabled = size < width;
  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);
}

/** A Pokémon's sprite (Showdown's, by file name), from the shared decoded images. */
@Component({
  selector: 'app-shared-sprite',
  imports: [SharedImage],
  host: { class: 'block' },
  template: `<app-shared-image [src]="src()" [fallback]="fallback()" [size]="size()" />`,
})
export class SharedSprite {
  readonly sprite = input('');
  readonly size = input(96);
  readonly back = input(false);
  protected readonly src = computed(() => (this.sprite() ? spriteUrl(this.sprite(), this.back()) : ''));
  protected readonly fallback = computed(() => (this.sprite() && this.back() ? spriteUrl(this.sprite(), false) : ''));
}

/** An item's icon, as ItemIcon draws it (a cell of Showdown's sheet, decoded once for the whole app). */
@Component({
  selector: 'app-shared-item-icon',
  imports: [ItemIcon],
  host: { class: 'block' },
  template: `<app-item-icon [item]="item()" [size]="size()" />`,
})
export class SharedItemIcon {
  readonly item = input('');
  readonly size = input(48);
}
