import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RenderScheduler } from '@core/runtime/render-scheduler';

const SPRITES_URL = 'https://play.pokemonshowdown.com/sprites';

/**
 * A Pokémon's sprite from Showdown (96x96 PNGs; play.pokemonshowdown.com is allow-listed in the
 * Brewser submission). One plain image per Pokémon: Brewser doesn't cut icons out of a sprite sheet
 * correctly (it ignores background-position and scales the sheet, seen on device). Decorative: the
 * name is always shown next to it. Some sprites have no back view (the Megas new in Champions, such as
 * Golisopod-Mega): those fall back to the front one. Loaded eagerly: sprites come and go in battle,
 * and one still loading when it should appear popped in on the console.
 *
 * Every sprite gets its own new <img> (tracked by URL): changing an existing image's src wasn't
 * repainted on Brewser. Until it fires `load`, its box is marked `data-pending`, so an animation can
 * wait for it. Placeholders and keeping the previous sprite over the new one were tried and dropped
 * (device, 2026-09-26): Brewser drew the stacked images in the wrong places.
 */
@Component({
  selector: 'app-pokemon-sprite',
  imports: [NgOptimizedImage],
  host: { class: 'block' },
  template: `
    <div class="block" [style.width.px]="size()" [style.height.px]="size()" [attr.data-pending]="pending() ? '' : null">
      @for (src of urls(); track src) {
        <img
          [ngSrc]="src"
          [width]="size()"
          [height]="size()"
          loading="eager"
          alt=""
          class="block"
          (load)="onLoad(src, $event)"
          (error)="onError(src)"
        />
      }
    </div>
  `,
})
export class PokemonSprite {
  private readonly renderScheduler = inject(RenderScheduler);

  /** Showdown's sprite file name ("arcanine-hisui"); empty shows nothing. */
  readonly sprite = input('');
  /** Shown size in px: 96 is the sprites' own size, 48 exactly half. */
  readonly size = input(96);
  /** Seen from behind, as the player's own Pokémon in battle. */
  readonly back = input(false);

  /** The back sprite failed to load; starts over with every sprite. */
  private readonly backMissing = linkedSignal({ source: this.sprite, computation: () => false });

  private readonly url = computed(() =>
    this.sprite() ? spriteUrl(this.sprite(), this.back() && !this.backMissing()) : '',
  );

  protected readonly urls = computed(() => (this.url() ? [this.url()] : []));

  /** The sprite whose image has loaded; starts over with every sprite. */
  private readonly loaded = linkedSignal({ source: this.url, computation: () => '' });

  protected readonly pending = computed(() => !!this.url() && this.loaded() !== this.url());

  protected onLoad(src: string, event: Event): void {
    if (src !== this.url()) return;
    // Straight on the DOM, so an animation waiting for it doesn't wait for Angular's render too
    // (a few hundred ms later on the console).
    (event.target as HTMLElement).parentElement?.removeAttribute('data-pending');
    this.loaded.set(src);
    this.renderScheduler.request();
  }

  protected onError(src: string): void {
    if (src !== this.url() || !this.back()) return;
    this.backMissing.set(true);
    this.renderScheduler.request();
  }
}

/** A sprite's URL, from its file name; for preloading as well as showing. */
export function spriteUrl(sprite: string, back = false): string {
  return `${SPRITES_URL}/${back ? 'gen5-back' : 'gen5'}/${sprite}.png`;
}
