import { Component, computed, input } from '@angular/core';

export type PixelIconName = 'battle' | 'random' | 'teambuilder' | 'replays' | 'chats' | 'live' | 'settings';

/** Each pixel's colour by letter; "." is transparent. */
const COLORS: Record<string, string> = {
  k: '#22333b',
  r: '#c2452f',
  w: '#ffffff',
  g: '#9aa9ae',
  b: '#4f86c6',
  y: '#f2c14e',
  m: '#5fae8e',
};

/** 16x16 pixel art, a row per string. */
const ICONS: Record<PixelIconName, readonly string[]> = {
  // A Poké Ball.
  battle: [
    '.....kkkkkk.....',
    '...kkrrrrrrkk...',
    '..krrrrrrrrrrk..',
    '.krrrrrrrrrwwrk.',
    '.krrrrrrrrrrwrk.',
    'krrrrrrrrrrrrrrk',
    'krrrrkkkkkkrrrrk',
    'kkkkkkwwwwkkkkkk',
    'kwwwwkwwwwkwwwwk',
    'kwwwwkkkkkkwwwwk',
    'kwwwwwwwwwwwwwwk',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwgk.',
    '..kwwwwwwwwggk..',
    '...kkggggggkk...',
    '.....kkkkkk.....',
  ],
  // Two crossed swords, points up. No dark outline: it would vanish on the panels.
  random: [
    '................',
    '.wg..........gw.',
    '..wg........gw..',
    '...wg......gw...',
    '....wg....gw....',
    '.....wg..gw.....',
    '......wggw......',
    '.......wg.......',
    '...y..gwwg..y...',
    '....y.w..w.y....',
    '.....y....y.....',
    '...rr.y..y.rr...',
    '...rr..yy..rr...',
    '.yy..........yy.',
    '.yy..........yy.',
    '................',
  ],
  // The PC where teams are kept, a Poké Ball on its screen.
  teambuilder: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kbbbbbbbbbbbbk.',
    '.kbwwbbbbbbbbbk.',
    '.kbwbbbbbbbbbbk.',
    '.kbbbbrrbbbbbbk.',
    '.kbbbrrrrbbbbbk.',
    '.kbbbwwwwbbbbbk.',
    '.kbbbbwwbbbbbbk.',
    '.kbbbbbbbbbbbbk.',
    '.kkkkkkkkkkkkkk.',
    '......kggk......',
    '......kggk......',
    '...kkkkkkkkkk...',
    '...kggggggggk...',
    '...kkkkkkkkkk...',
  ],
  // A TV playing a recording.
  replays: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kmmmmmmmmmmmmk.',
    '.kmmmmmmmmmmmmk.',
    '.kmmmmkmmmmmmmk.',
    '.kmmmmkkmmmmmmk.',
    '.kmmmmkykmmmmmk.',
    '.kmmmmkyykmmmmk.',
    '.kmmmmkykmmmmmk.',
    '.kmmmmkkmmmmmmk.',
    '.kmmmmkmmmmmmmk.',
    '.kmmmmmmmmmmmmk.',
    '.kkkkkkkkkkkkkk.',
    '.kggggggggggggk.',
    '.kkkkkkkkkkkkkk.',
    '....kk....kk....',
  ],
  // A TV with an antenna, on air (the red dot). The antenna is grey: dark would vanish on the panels.
  live: [
    '....g......g....',
    '.....g....g.....',
    '......g..g......',
    '.kkkkkkkkkkkkkk.',
    '.kbbbbbbbbbbbbk.',
    '.kbwbbbbbbbbbbk.',
    '.kbbbbbbbbbbbbk.',
    '.kbbbbbbbbbbbbk.',
    '.kbbbbbbbbbbbbk.',
    '.kbbbbbbbbbbbbk.',
    '.kbbbbbbbbbrrbk.',
    '.kbbbbbbbbbrrbk.',
    '.kkkkkkkkkkkkkk.',
    '.kggggggggggggk.',
    '.kkkkkkkkkkkkkk.',
    '..kk........kk..',
  ],
  // A speech bubble.
  chats: [
    '................',
    '...kkkkkkkkkk...',
    '..kwwwwwwwwwwk..',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwkkwkkwkkwwk.',
    '.kwwkkwkkwkkwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '..kwwwwwwwwwwk..',
    '...kkwwkkkkkk...',
    '.....kwk........',
    '....kwk.........',
    '...kk...........',
    '................',
    '................',
  ],
  // A gear, lit from the top left, with a dark rim round its hole.
  settings: [
    '......wwwg......',
    '......wwgg......',
    '..www.wggg.ggg..',
    '..wwwwgggggggg..',
    '..wwwggggggggg..',
    '...wggkkkkggg...',
    'wwwggkk..kkggggg',
    'wwgggk....kggggg',
    'wggggk....kggggg',
    'gggggkk..kkggggg',
    '...gggkkkkggg...',
    '..gggggggggggg..',
    '..gggggggggggg..',
    '..ggg.gggg.ggg..',
    '......gggg......',
    '......gggg......',
  ],
};

/** One path per colour, each run of same-coloured pixels in a row as a rectangle: few DOM nodes. */
function toPaths(rows: readonly string[]): { color: string; d: string }[] {
  const byColor = new Map<string, string>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const letter = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === letter) end++;
      if (letter !== '.') byColor.set(letter, `${byColor.get(letter) ?? ''}M${x} ${y}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  return [...byColor].map(([letter, d]) => ({ color: COLORS[letter], d }));
}

/** A 16x16 pixel-art icon, scaled up without smoothing. Decorative: its label goes next to it. */
@Component({
  selector: 'app-pixel-icon',
  host: { class: 'block' },
  template: `
    <svg aria-hidden="true" viewBox="0 0 16 16" shape-rendering="crispEdges" class="block" [attr.width]="size()" [attr.height]="size()">
      @for (path of paths(); track path.color) {
        <path [attr.d]="path.d" [attr.fill]="path.color" />
      }
    </svg>
  `,
})
export class PixelIcon {
  readonly name = input.required<PixelIconName>();
  /** Shown size in px; multiples of 16 keep the pixels even. */
  readonly size = input(48);

  protected readonly paths = computed(() => toPaths(ICONS[this.name()]));
}
