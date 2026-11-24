import { RawImage } from './png-decode';

/** A pixel this see-through or more doesn't count (a soft edge); as scripts/sprite-tops.mjs. */
const MIN_ALPHA = 24;
/** Only small images are measured (sprites, dolls): a sheet's sprites have theirs in sprite-sheets.json. */
const MAX_PIXELS = 192 * 192;

/**
 * Where an image's picture starts, as a share of its height (0-1): its first row with a pixel that
 * shows. The battle field puts labels just over a Pokémon's head with it (a sprite's box is mostly
 * empty above a small or a back sprite). Undefined for big images, or when its pixels can't be read.
 */
export function pictureTop(image: RawImage | TexImageSource, width: number, height: number): number | undefined {
  if (width * height > MAX_PIXELS || height === 0) return undefined;
  const pixels = 'pixels' in image ? image.pixels : readPixels(image, width, height);
  if (!pixels) return undefined;
  for (let row = 0; row < height; row++) {
    const start = row * width * 4 + 3;
    for (let x = 0; x < width; x++) if (pixels[start + x * 4] >= MIN_ALPHA) return row / height;
  }
  return undefined;
}

/** A browser's decoded image, read back through a canvas (the console's come as pixels already). */
function readPixels(image: TexImageSource, width: number, height: number): Uint8ClampedArray | null {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image as CanvasImageSource, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
}
