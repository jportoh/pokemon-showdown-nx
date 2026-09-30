import { Component, computed, input } from '@angular/core';

export type PixelIconName = 'battle' | 'random' | 'teambuilder' | 'replays' | 'chats' | 'live' | 'settings';

/** Each pixel's colour by letter; "." is transparent. Upper case is a shade darker, P and l a shade lighter. */
const COLORS: Record<string, string> = {
  k: '#22333b',
  r: '#c2452f',
  R: '#8e2a1c',
  P: '#e8806a',
  w: '#ffffff',
  l: '#e4ebee',
  g: '#9aa9ae',
  G: '#75868c',
  d: '#4b5a60',
  b: '#4f86c6',
  B: '#2f5f99',
  c: '#8fbbe8',
  y: '#f2c14e',
  Y: '#c9922a',
  o: '#e8883a',
  m: '#5fae8e',
  M: '#3d7d63',
};

/**
 * 24x24 pixel art, a row per string. Lit from the top left, each shape outlined in k (dark enough to
 * part overlapping shapes, while the panels behind stay as dark).
 */
const ICONS: Record<PixelIconName, readonly string[]> = {
  // Two Poké Balls, a red one and a blue one, clashing under a spark.
  battle: [
    '........................',
    '........................',
    '........................',
    '...........kk...........',
    '..........kook..........',
    '.......k..kook..k.......',
    '......kokkkyykkkok......',
    '.......kyykyykyyk.......',
    '.......kyywwwwyyk.......',
    '.....kkkkwwwwwwkkkk.....',
    '...kkooyywwwwwwyyookk...',
    '.kkPPPPPrwwwwwwcccccckk.',
    'kPPPPPPrrrwwwwccccccbbbk',
    'kPwwPPPrrRRwwccwwcccbbBk',
    'PPPPrkkrRRRyycccckkbbBBB',
    'kkkkkwwkkkkyykkkkwwkkkkk',
    'kkkkwwlkkkkookkkkwwlkkkk',
    'wwwwkkkwwgGoowwwwkkkwggG',
    'wwwwwwwwgGGkkwwwwwwwwgGG',
    'kwwggwgggGk..kwwggwggGGk',
    '.kwggggGGk....kwggggGGk.',
    '..kkGGGkk......kkGGGkk..',
    '....kkk..........kkk....',
    '........................',
  ],
  // Two crossed swords: steel blades, gold guards, red grips.
  random: [
    '........................',
    '..kkk.............kkk...',
    '.kgGGk...........kGGgk..',
    '.klgGGk.........kGGglk..',
    '.kllgGGk.......kGGgllk..',
    '..kllgGGk.....kGGgllk...',
    '...kllgGGk...kGGgllk....',
    '....kllgGGk.kGGgllk.....',
    '.....kllgGGkGGgllk......',
    '......kllgkGGgllk.......',
    '.......klkGGgllk........',
    '.....k..kGGgllk..k......',
    '....kykkGGgllkGkkyk.....',
    '...kyyyGGgllkgGGyyyk....',
    '....kyyygllkllgyyyk.....',
    '.....kyyylk.klyyyk......',
    '....krryyyk.kyyyrrk.....',
    '...krrrkyyykyyykrrrk....',
    '..krrrk.kyk.kyk.krrrk...',
    'kkrrrk...k...k...krrrkk.',
    'YYYrk.............krYYYk',
    'YYYk...............kYYYk',
    'kYYk...............kYYk.',
    '.kk.................kk..',
  ],
  // The PC where teams are kept, a Poké Ball on its screen.
  teambuilder: [
    '........................',
    '..kkkkkkkkkkkkkkkkkkkk..',
    '.klllllllllllllllllllGk.',
    '.klggggggggggggggggggGk.',
    '.klgBBBBBBBkkBBBBBBBgGk.',
    '.klgBcccckkrrkkccccBgGk.',
    '.klgBbbbkrrrrrrkbbbBgGk.',
    '.klgBbbkrrrrrrrRkbbBgGk.',
    '.klgBbbkrrrkkrRRkbbBgGk.',
    '.klgBbbbkkkwwkkkbbbBgGk.',
    '.klgBbbkwwwkkwggkbbBgGk.',
    '.klgBbbkwwwwwwggkbbBgGk.',
    '.klgBbbbkwgggggkbbbBgGk.',
    '.klgBbbbbkkggkkbbbbBgGk.',
    '.klgBBBBBBBkkBBBBBBBgGk.',
    '.klggggggggggggggggggGk.',
    '.kGGGGGGGGGGGGGGGGGGGGk.',
    '..kkkkkkkkGGGGkkkkkkkk..',
    '......kkkkGGGGkkkk......',
    '.....klllllllllllGk.....',
    '.....klggggggggggGk.....',
    '.....kGGGGGGGGGGGGk.....',
    '......kkkkkkkkkkkk......',
    '........................',
  ],
  // A TV playing a recording.
  replays: [
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    'klllllllllllllllllllllGk',
    'klggggggggggggggggggggGk',
    'klgMMMMMMMMMMMMMMMMMMgGk',
    'klgMllllllllllllllllMgGk',
    'klgMmmmmmkkmmmmmmmmmMgGk',
    'klgMmmmmkwwkmmmmmmmmMgGk',
    'klgMmmmmkwwwkkmmmmmmMgGk',
    'klgMmmmmkwwwwwkkmmmmMgGk',
    'klgMmmmmklllllllkmmmMgGk',
    'klgMmmmmklllllkkmmmmMgGk',
    'klgMmmmmklllkkmmmmmmMgGk',
    'klgMmmmmkllkmmmmmmmmMgGk',
    'klgMmmmmmkkmmmmmmmmmMgGk',
    'klgMMMMMMMMMMMMMMMMMMgGk',
    'klggggggggggggggggggggGk',
    'kGGGGGGGGGGGGGGGGGGGGGGk',
    'kGGGGGGGGGGGGGGGGGGGGGGk',
    '.kkkGGGGkkkkkkkkGGGGkkk.',
    '...kGGGGk......kGGGGk...',
    '....kkkk........kkkk....',
    '........................',
  ],
  // A TV with antennas, on air (the red light), a battle on its screen.
  live: [
    '.....krrk......krrk.....',
    '.....krrk......krrk.....',
    '......kkgk....kgkk......',
    '........kgk..kgk........',
    '.........kgkkgk.........',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    'klllllllllllllllllllllGk',
    'klggggggggggggggggggggGk',
    'klgBBBBBBBBBBBBBBgggggGk',
    'klgBccccccccccccBggrrgGk',
    'klgBbbbbbbbbbbbbBggrrgGk',
    'klgBbbbbbbbbyyybBgggggGk',
    'klgBbbwwwbbbyyyyBgggggGk',
    'klgBbwwwwbbbyyyyBggddgGk',
    'klgBbwwwwbbbbbbbBgggggGk',
    'klgBmmmmmmmmmmmmBggddgGk',
    'klgBmmmmmmmmmmmmBgggggGk',
    'klgBmmmmmmmmmmmmBggddgGk',
    'klgBBBBBBBBBBBBBBgggggGk',
    'klggggggggggggggggggggGk',
    'kGGGGGGGGGGGGGGGGGGGGGGk',
    '.kkGGGkkkkkkkkkkkkGGGkk.',
    '..kGGGk..........kGGGk..',
    '...kkk............kkk...',
  ],
  // Two speech bubbles, a blue one behind a white one.
  chats: [
    '.........kbbbbbbbbbbbbk.',
    '........kcccccccccccccck',
    '........kbbbbbbbbbbbbbbk',
    '........kbbbbbbbbbbbbbbk',
    '........kbbbbbbbbbbbbbbk',
    '..kkkkkkkkkkkkkkkbbbbbbk',
    '.kwwwwwwwwwwwwwwwkbbbbbk',
    'kwwwwwwwwwwwwwwwwwkbbbbk',
    'kwwwwwwwwwwwwwwwwgkbbbbk',
    'kwwwwwwwwwwwwwwwwgkbbbbk',
    'kwwwwwwwwwwwwwwwwgkbbbbk',
    'kwwwwddwwddwwddwwgkbbbk.',
    'kwwwwddwwddwwddwwgkbbk..',
    'kwwwwwwwwwwwwwwwwgkkbk..',
    'kwwwwwwwwwwwwwwwwgk.k...',
    'kwwwwwwwwwwwwwwwwgk.....',
    'kwwwwwwwwwwwwwwwwgk.....',
    'kwgggggggggggggggwk.....',
    '.kwwwwwwwwwwwwwwwk......',
    '..kkwwwwkkkkkkkkk.......',
    '...kwwkk................',
    '..kwwk..................',
    '..kwk...................',
    '...k....................',
  ],
  // Two gears, a big grey one and a small gold one.
  settings: [
    '................kyyk.k..',
    '...............kyyykkyk.',
    '..............kkyyyyyyyk',
    '.............kykyoooyyk.',
    '............kyyyookyyYkk',
    '.....kkk...kkkkyok.kyYYY',
    '....klllk.klllkyyykyyYYY',
    '....klllkkklllkyyyyyYYYk',
    '.....klllllllkyyyYYYkkk.',
    '.kk.klllllllggkykkkYYk..',
    'kllkllllllllgggkggkYk...',
    'kllllllldddgggggGGkk....',
    'klllllldkkkgggGGGGk.....',
    '.kkllldk...klGGGkk......',
    '..kllldk...klGGGk.......',
    '.kkllldk...klGGGkk......',
    'klllllggkkklGGGGGGk.....',
    'klllgggglllGGGGGGGk.....',
    'kllkggggGGGGGGGkGGk.....',
    '.kk.kggGGGGGGGk.kk......',
    '.....kgGGGGGGk..........',
    '....kgGGkkkGGGk.........',
    '....kgGGk.kGGGk.........',
    '.....kkk...kkk..........',
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

/** A 24x24 pixel-art icon, scaled up without smoothing. Decorative: its label goes next to it. */
@Component({
  selector: 'app-pixel-icon',
  host: { class: 'block' },
  template: `
    <svg aria-hidden="true" viewBox="0 0 24 24" shape-rendering="crispEdges" class="block" [attr.width]="size()" [attr.height]="size()">
      @for (path of paths(); track path.color) {
        <path [attr.d]="path.d" [attr.fill]="path.color" />
      }
    </svg>
  `,
})
export class PixelIcon {
  readonly name = input.required<PixelIconName>();
  /** Shown size in px; multiples of 24 keep the pixels even. */
  readonly size = input(48);

  protected readonly paths = computed(() => toPaths(ICONS[this.name()]));
}
