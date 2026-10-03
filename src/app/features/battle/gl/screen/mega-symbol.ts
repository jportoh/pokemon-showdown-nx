import { GlRenderer, Texture } from '@core/gl/gl-renderer';

/**
 * The Mega Evolution symbol, 48px: the dark helix drop (traced from the official symbol, "x" set) on
 * a rainbow sphere (its hue turning round it, pink at the top, lighter towards the middle).
 */
const HELIX: readonly string[] = [
  '................................................',
  '................................................',
  '................................................',
  '..........................x.....................',
  '.......................xxxx.....................',
  '.....................xxxxxx.....................',
  '...................xxxxxxxx.....................',
  '.................xxxxxxxxxx.....................',
  '................xxxxxxxxxxx.....................',
  '..............xxxxxxx...xxx.....................',
  '.............xxxxxx.....xxxx....................',
  '............xxxxxx......xxxx....................',
  '...........xxxxxxxxx.....xxxx...................',
  '..........xxxxxxxxxxxx...xxxx...................',
  '..........xxxx..xxxxxxxx..xxxx..................',
  '.........xxxx.....xxxxxxxxxxxx..................',
  '.........xxxx.......xxxxxxxxxxx.................',
  '........xxxxxxx.......xxxxxxxxxx................',
  '........xxxxxxxx........xxxxxxxxxx..............',
  '........xxxxxxxxxx........xxxxxxxxx.............',
  '........xxxxxxxxxxxx........xxxxxxxx............',
  '........xxxx..xxxxxxxx........xxxxxx............',
  '.........xxx....xxxxxxxx.........xxxx...........',
  '.........xxxx.....xxxxxxxxx.......xxxx..........',
  '..........xxxxx.....xxxxxxxxxx.....xxxx.........',
  '..........xxxxxx......xxxxxxxxxxx..xxxx.........',
  '...........xxxxxxx.......xxxxxxxxxxxxxx.........',
  '............xxxxxxxx.......xxxxxxxxxxxxx........',
  '.............xxxxxxxxx.......xxxxxxxxxxx........',
  '..............xxxxxxxxxxx........xxxxxxx........',
  '...............xxxxxxxxxxxxx........xxxx........',
  '................xxxxxxxxxxxxxx.....xxxx.........',
  '.................xxxxxxxxxxxxxxxx..xxxx.........',
  '..................xxxxx.xxxxxxxxxxxxxxx.........',
  '...................xxxx....xxxxxxxxxxx..........',
  '....................xxxx......xxxxxxx...........',
  '....................xxxx.......xxxxx............',
  '.....................xxxx.....xxxxx.............',
  '.....................xxxx...xxxxxxx.............',
  '.....................xxxx..xxxxxx...............',
  '......................xxxxxxxxxx................',
  '......................xxxxxxxx..................',
  '......................xxxxxx....................',
  '......................xxxx......................',
  '......................xx........................',
  '................................................',
  '................................................',
  '................................................',
];

const HELIX_INK = [31, 38, 44];

/** The symbol as a texture, smoothed when scaled (premultiplied, its edge faded out). */
export function megaSymbolTexture(renderer: GlRenderer): Texture {
  const size = HELIX.length;
  const r = size / 2;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const d = Math.hypot(dx, dy);
      const alpha = Math.max(0, Math.min(1, r - d));
      if (alpha === 0) continue;
      let rgb: number[];
      if (HELIX[y][x] === 'x') {
        rgb = HELIX_INK;
      } else {
        // Pastel, lighter towards the middle: pink at the top, yellow on the right, green at the
        // foot, blue on the left.
        const turn = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360;
        rgb = hsl(sphereHue(turn), 0.72, 0.66 + 0.26 * (1 - d / r) ** 1.5);
      }
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(rgb[0] * alpha);
      pixels[i + 1] = Math.round(rgb[1] * alpha);
      pixels[i + 2] = Math.round(rgb[2] * alpha);
      pixels[i + 3] = Math.round(255 * alpha);
    }
  }
  return renderer.textureFromPixels(pixels, size, size, true);
}

/** The hue round the sphere, clockwise from the top (degrees). */
const HUES: readonly (readonly [number, number])[] = [
  [0, 320],
  [60, 345],
  [100, 415],
  [180, 480],
  [270, 560],
  [360, 690],
];

function sphereHue(turn: number): number {
  const k = HUES.findIndex(([at]) => at >= turn);
  if (k <= 0) return HUES[0][1] % 360;
  const [a, ha] = HUES[k - 1];
  const [b, hb] = HUES[k];
  return (ha + ((turn - a) / (b - a)) * (hb - ha)) % 360;
}

/** HSL (hue in degrees, the rest 0 to 1) as 0–255 RGB. */
function hsl(hue: number, saturation: number, light: number): number[] {
  const a = saturation * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}
