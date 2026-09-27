import { Component, computed, input, linkedSignal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';

/**
 * An item's icon (48x48 PNGs in public/items, cut from Showdown's icon sheet by
 * `npm run update:champions` and `npm run update:names`): bundled, one file per item, since Brewser
 * can't show a cell of a sprite sheet. Nothing shows for an item without one. Decorative: the item's
 * name is always given next to it (or in its container's label).
 */
@Component({
  selector: 'app-item-icon',
  imports: [NgOptimizedImage],
  host: { class: 'block' },
  template: `
    @if (url(); as src) {
      <img [ngSrc]="src" [width]="size()" [height]="size()" alt="" class="block" (error)="missing.set(true)" />
    }
  `,
})
export class ItemIcon {
  /** An item's id ("leftovers"); empty shows nothing. */
  readonly item = input('');
  /** Shown size in px (the icons are 48x48). */
  readonly size = input(48);

  /** The item has no icon file. */
  protected readonly missing = linkedSignal({ source: this.item, computation: () => false });

  protected readonly url = computed(() => (this.item() && !this.missing() ? `items/${this.item()}.png` : ''));
}
