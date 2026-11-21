// Texture uploads from canvases and images, for the native .nro.
//
// nx.js's WebGL2 only uploads raw pixel arrays natively; for a canvas or an image its JavaScript
// copies the source into a new OffscreenCanvas and reads that back, and it ignores
// UNPACK_PREMULTIPLY_ALPHA_WEBGL, which the app's renderer relies on (its blending expects
// premultiplied colour). Here the context's upload methods read the pixels themselves (straight from
// the canvas shim's own surface, without the extra copy), premultiply them when asked, and pass the
// engine an array.

import { nativeStats, timed } from './native-stats';

const PREMULTIPLY_ALPHA = 0x9241; // UNPACK_PREMULTIPLY_ALPHA_WEBGL

/** `owned`: a fresh array nothing else holds, which can be premultiplied in place. */
type Pixels = { data: Uint8Array; width: number; height: number; owned: boolean };
/** The 2D context behind a canvas shim (null while nothing has drawn on it), or undefined for other sources. */
type CanvasContextOf = (source: object) => OffscreenCanvasRenderingContext2D | null | undefined;

let scratch: OffscreenCanvas | null = null;

function isSource(value: unknown): value is { width: number; height: number } {
  return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value) && typeof (value as { width?: unknown }).width === 'number';
}

function readPixels(source: { width: number; height: number }, contextOf: CanvasContextOf): Pixels {
  const { width, height } = source;
  nativeStats.pixels += width * height;
  const own = contextOf(source);
  if (own === null) return { data: new Uint8Array(width * height * 4), width, height, owned: true };
  if (source instanceof ImageData) return { data: bytes(source), width, height, owned: false };
  return timed(nativeStats.readPixels, () => {
    let image: ImageData;
    if (own) image = own.getImageData(0, 0, width, height);
    else {
      if (!scratch || scratch.width !== width || scratch.height !== height) scratch = new OffscreenCanvas(width, height);
      const context = scratch.getContext('2d')!;
      context.clearRect(0, 0, width, height);
      context.drawImage(source as CanvasImageSource, 0, 0);
      image = context.getImageData(0, 0, width, height);
    }
    return { data: bytes(image), width, height, owned: true };
  });
}

function bytes(image: ImageData): Uint8Array {
  return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

/** Straight RGBA to premultiplied, in place when the array is ours. */
function premultiply(data: Uint8Array, inPlace: boolean): Uint8Array {
  return timed(nativeStats.premultiply, () => {
    const out = inPlace ? data : new Uint8Array(data);
    for (let i = 3; i < out.length; i += 4) {
      const alpha = out[i];
      if (alpha === 255) continue;
      if (alpha === 0) {
        out[i - 3] = 0;
        out[i - 2] = 0;
        out[i - 1] = 0;
        continue;
      }
      out[i - 3] = (out[i - 3] * alpha + 127) / 255;
      out[i - 2] = (out[i - 2] * alpha + 127) / 255;
      out[i - 1] = (out[i - 1] * alpha + 127) / 255;
    }
    return out;
  });
}

export function patchUploads(gl: WebGL2RenderingContext, contextOf: CanvasContextOf): void {
  let premultiplyOn = false;
  const premultiplyName = (gl as { UNPACK_PREMULTIPLY_ALPHA_WEBGL?: number }).UNPACK_PREMULTIPLY_ALPHA_WEBGL ?? PREMULTIPLY_ALPHA;
  const pixelStorei = gl.pixelStorei.bind(gl);
  const texImage2D = gl.texImage2D.bind(gl) as (...args: unknown[]) => void;
  const texSubImage2D = gl.texSubImage2D.bind(gl) as (...args: unknown[]) => void;
  const prepare = (pixels: Pixels) => (premultiplyOn ? premultiply(pixels.data, pixels.owned) : pixels.data);
  const upload = (run: () => void) => timed(nativeStats.upload, run);

  const patched = gl as unknown as Record<string, unknown>;
  patched['pixelStorei'] = (name: number, value: number | boolean) => {
    // Kept here and applied in JavaScript; the engine always gets straight pixels.
    if (name === premultiplyName) premultiplyOn = !!value;
    else pixelStorei(name, value as number);
  };
  patched['texImage2D'] = (...args: unknown[]) => {
    const last = args[args.length - 1];
    if (args.length === 6 && isSource(last)) {
      const [target, level, internalFormat, format, type] = args;
      const pixels = readPixels(last, contextOf);
      const data = prepare(pixels);
      upload(() => texImage2D(target, level, internalFormat, pixels.width, pixels.height, 0, format, type, data));
    } else if (args.length === 9 && premultiplyOn && last instanceof Uint8Array) {
      const data = premultiply(last, false);
      upload(() => texImage2D(...args.slice(0, 8), data));
    } else texImage2D(...args);
  };
  patched['texSubImage2D'] = (...args: unknown[]) => {
    const last = args[args.length - 1];
    if (args.length === 7 && isSource(last)) {
      const [target, level, x, y, format, type] = args;
      const pixels = readPixels(last, contextOf);
      const data = prepare(pixels);
      upload(() => texSubImage2D(target, level, x, y, pixels.width, pixels.height, format, type, data));
    } else if (args.length === 9 && premultiplyOn && last instanceof Uint8Array) {
      const data = premultiply(last, false);
      upload(() => texSubImage2D(...args.slice(0, 8), data));
    } else texSubImage2D(...args);
  };
}
