import { Component, computed, input, linkedSignal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';

const SPRITES_URL = 'https://play.pokemonshowdown.com/sprites';

/**
 * A Pokémon's sprite from Showdown (96x96 PNGs; play.pokemonshowdown.com is allow-listed in the
 * Brewser submission). One plain image per Pokémon: Brewser doesn't cut icons out of a sprite sheet
 * correctly (it ignores background-position and scales the sheet, seen on device). Decorative: the
 * name is always shown next to it. Some sprites have no back view (the Megas new in Champions, such as
 * Golisopod-Mega): those fall back to the front one. Loaded eagerly: sprites come and go in battle,
 * and one still loading when it should appear popped in on the console.
 */
@Component({
  selector: 'app-pokemon-sprite',
  imports: [NgOptimizedImage],
  host: { class: 'block' },
  template: `
    @if (url(); as src) {
      <img [ngSrc]="src" [width]="size()" [height]="size()" loading="eager" alt="" class="block" (error)="backMissing.set(true)" />
    }
  `,
})
export class PokemonSprite {
  /** Showdown's sprite file name ("arcanine-hisui"); empty shows nothing. */
  readonly sprite = input('');
  /** Shown size in px: 96 is the sprites' own size, 48 exactly half. */
  readonly size = input(96);
  /** Seen from behind, as the player's own Pokémon in battle. */
  readonly back = input(false);

  /** The back sprite failed to load; starts over with every sprite. */
  protected readonly backMissing = linkedSignal({ source: this.sprite, computation: () => false });

  protected readonly url = computed(() =>
    this.sprite() ? spriteUrl(this.sprite(), this.back() && !this.backMissing()) : '',
  );
}

/** A sprite's URL, from its file name; for preloading as well as showing. */
export function spriteUrl(sprite: string, back = false): string {
  return `${SPRITES_URL}/${back ? 'gen5-back' : 'gen5'}/${sprite}.png`;
}
