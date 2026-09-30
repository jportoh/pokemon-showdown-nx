import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { pixelArtPaths } from '@shared/components/pixel-icon';

/** A Poké Ball, 24x24, lit from the top left like the menu's icons, its button a 10x10 ring round a 6x6 disc. */
const BALL = [
  '..........kkkk..........',
  '.......kkkrrrrkkk.......',
  '.....kkPPrrrrrrrrkk.....',
  '....kPPrrrrrrrrrrrRk....',
  '...kPwwrrrrrrrrrrrRRk...',
  '..kPwwrrrrrrrrrrrrrRRk..',
  '..kPPrrrrrrrrrrrrrrRRk..',
  '.kPrrrrrrrkkkkrrrrrrRRk.',
  '.kPrrrrrkkkkkkkkrrrrRRk.',
  '.kPrrrrrkkwwwwkkrrrrRRk.',
  'kPrrrrrkkwwwwwlkkrrrRRRk',
  'kkkkkkkkkwwwwllkkkkkkkkk',
  'kkkkkkkkkwwwlllkkkkkkkkk',
  'kwwwwwwkkwwllllkkwggggGk',
  '.kwwwwwwkklllgkkwwggGGk.',
  '.kwwwwwwkkkkkkkkwgggGGk.',
  '.kwwwwwwwwkkkkwwggggGGk.',
  '..kwwwwwwwwwwwwggggGGk..',
  '..kwwwwwwwwwwwgggggGGk..',
  '...kwwwwwwwwwggggGGGk...',
  '....kwwwwwwggggGGGGk....',
  '.....kkwwwggggGGGkk.....',
  '.......kkkggGGkkk.......',
  '..........kkkk..........',
];

/** Where "POKÉMON" starts, right of the ball. */
const TITLE_LEFT = 60;
/** The space between the two words. */
const WORD_GAP = 10;
/** "POKÉMON"'s width if it can't be measured: a generous 0.72em per capital at 32px. */
const FALLBACK_WIDTH = 162;

/**
 * The header's logo: the menu icons' Poké Ball (2x, pixel art), then "POKÉMON" in white and
 * "SHOWDOWN!" in yellow, in the console's own font (bundled fonts don't load on Brewser). The two
 * words are separate boxes: one line mixing coloured inline elements wrapped and misplaced its parts
 * on Brewser. So "SHOWDOWN!" is only created once "POKÉMON" has been drawn and measured, right after
 * it: created in place, never moved (Brewser leaves moved boxes painted where they were).
 */
@Component({
  selector: 'app-showdown-logo',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-19 w-[452px]', role: 'img', 'aria-label': 'Pokémon Showdown' },
  // The ball is placed as the menu's icons are, which show on the console: a positioned box, and in it
  // an svg in normal flow with a fixed viewBox and size (a positioned svg didn't show there).
  template: `
    <span class="absolute top-[14px] left-0 block size-12">
      <svg aria-hidden="true" viewBox="0 0 24 24" shape-rendering="crispEdges" width="48" height="48" class="block size-12">
        @for (path of ball; track path.color) {
          <path [attr.d]="path.d" [attr.fill]="path.color" />
        }
      </svg>
    </span>
    <span #firstWord aria-hidden="true" class="absolute top-[18px] block h-10 text-[32px] leading-10 font-black tracking-[1px] whitespace-nowrap text-white" [style.left.px]="titleLeft">POKÉMON</span>
    @if (secondLeft(); as left) {
      <span aria-hidden="true" class="absolute top-[18px] block h-10 text-[32px] leading-10 font-black tracking-[1px] whitespace-nowrap text-[#f2c14e]" [style.left.px]="left">SHOWDOWN!</span>
    }
  `,
})
export class ShowdownLogo {
  private readonly render = inject(RenderScheduler);
  private readonly firstWord = viewChild.required<ElementRef<HTMLElement>>('firstWord');

  protected readonly ball = pixelArtPaths(BALL);
  protected readonly titleLeft = TITLE_LEFT;
  /** Where "SHOWDOWN!" goes; null until "POKÉMON" is measured. */
  protected readonly secondLeft = signal<number | null>(null);

  constructor() {
    afterNextRender(() => {
      const box = this.firstWord().nativeElement.getBoundingClientRect?.();
      const width = box && box.right - box.left > 0 ? box.right - box.left : FALLBACK_WIDTH;
      this.secondLeft.set(Math.round(TITLE_LEFT + width + WORD_GAP));
      this.render.request();
    });
  }
}
