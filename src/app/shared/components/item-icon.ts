import { Component, computed, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';

/**
 * An item's icon (48x48 PNGs in public/items, cut from Showdown's icon sheet by
 * `npm run update:champions`): bundled, one file per item, since Brewser can't show a cell of a
 * sprite sheet. Decorative: the item's name is always shown next to it.
 */
@Component({
  selector: 'app-item-icon',
  imports: [NgOptimizedImage],
  host: { class: 'block' },
  template: `
    @if (url(); as src) {
      <img [ngSrc]="src" width="48" height="48" alt="" class="block" />
    }
  `,
})
export class ItemIcon {
  /** A legal item's id ("leftovers"); empty shows nothing. */
  readonly item = input('');

  protected readonly url = computed(() => (this.item() ? `items/${this.item()}.png` : ''));
}
