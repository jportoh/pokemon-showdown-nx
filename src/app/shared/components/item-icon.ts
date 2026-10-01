import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input, untracked, viewChildren } from '@angular/core';
import { ITEM_ICON_SIZE, ITEM_SHEET_URL, itemIconCell } from '@core/dex/names';
import { ImagePriority, SpriteBitmaps } from '@core/gl/sprite-bitmaps';

/**
 * An item's icon, cut from Showdown's icon sheet on a small canvas (the sheet is downloaded and
 * decoded once for the whole app, see SpriteBitmaps, and each icon is a cell of it: no icon files are
 * bundled). Brewser's CSS can't show a cell of a sheet (it ignores background-position), but a
 * canvas's drawImage takes the cell's coordinates. Nothing shows for an item without an icon.
 * Decorative: the item's name is always given next to it (or in its container's label). One canvas
 * per item, made anew when it changes (Brewser didn't repaint a changed image).
 */
@Component({
  selector: 'app-item-icon',
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    @for (key of keys(); track key) {
      <canvas #canvas class="block" [attr.width]="pixels()" [attr.height]="pixels()" [style.width.px]="size()" [style.height.px]="size()"></canvas>
    }
  `,
})
export class ItemIcon {
  private readonly bitmaps = inject(SpriteBitmaps);

  /** An item's id ("leftovers"); empty shows nothing. */
  readonly item = input('');
  /** Shown size in px (the sheet's icons are 24x24). */
  readonly size = input(48);

  private readonly cell = computed(() => (this.item() ? itemIconCell(this.item()) : null));
  protected readonly keys = computed(() => (this.cell() ? [this.item()] : []));
  /** The canvas's own pixels: as dense as the screen. */
  protected readonly pixels = computed(() => Math.round(this.size() * Math.min(2, Math.max(1, window.devicePixelRatio || 1))));
  private readonly canvases = viewChildren<ElementRef<HTMLCanvasElement>>('canvas');
  private stop: () => void = () => undefined;

  constructor() {
    afterRenderEffect(() => {
      const canvas = this.canvases()[0]?.nativeElement;
      const cell = this.cell();
      const pixels = this.pixels();
      untracked(() => {
        this.stop();
        if (!canvas || !cell) return;
        this.stop = this.bitmaps.whenReady(ITEM_SHEET_URL, ImagePriority.Screen, (sheet) => {
          const context = sheet ? canvas.getContext('2d') : null;
          if (!sheet || !context) return;
          // Pixel art: no smoothing (it would bleed the neighbouring icons in, too).
          context.imageSmoothingEnabled = false;
          context.clearRect(0, 0, pixels, pixels);
          context.drawImage(sheet, cell.x, cell.y, ITEM_ICON_SIZE, ITEM_ICON_SIZE, 0, 0, pixels, pixels);
        });
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }
}
