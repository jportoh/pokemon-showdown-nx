import { Component, computed, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';

const SPRITES_URL = 'https://play.pokemonshowdown.com/sprites/gen5';

/**
 * A Pokémon's sprite from Showdown (96x96 PNGs; play.pokemonshowdown.com is allow-listed in the
 * Brewser submission). One plain image per Pokémon: Brewser doesn't cut icons out of a sprite sheet
 * correctly (it ignores background-position and scales the sheet, seen on device). Decorative: the
 * name is always shown next to it.
 */
@Component({
  selector: 'app-pokemon-sprite',
  imports: [NgOptimizedImage],
  host: { class: 'block' },
  template: `
    @if (url(); as src) {
      <img [ngSrc]="src" [width]="size()" [height]="size()" alt="" class="block" />
    }
  `,
})
export class PokemonSprite {
  /** Showdown's sprite file name ("arcanine-hisui"); empty shows nothing. */
  readonly sprite = input('');
  /** Shown size in px: 96 is the sprites' own size, 48 exactly half. */
  readonly size = input(96);

  protected readonly url = computed(() => (this.sprite() ? `${SPRITES_URL}/${this.sprite()}.png` : ''));
}
