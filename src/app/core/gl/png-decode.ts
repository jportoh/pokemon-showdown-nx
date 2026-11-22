import { unzlibSync } from 'fflate';

/** A PNG decoded to RGBA pixels, premultiplied (as the renderer draws them). */
export interface RawImage {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/**
 * Raw images: `PSBRAW1` and a zero byte, the width and the height (32-bit little endian), then the
 * premultiplied RGBA pixels. The native .nro's build stores the big Champions sprite sheets this way
 * (scripts/build-nro.mjs): decoding them in JavaScript held the console's main thread for seconds
 * at a time (test x8), stalling the connection's TLS handshake, which runs there.
 */
export const RAW_MAGIC = 'PSBRAW1\0';
const RAW_HEADER = 16;

/** A raw image's pixels, in place (no copy), or null when `bytes` isn't one. */
export function decodeRaw(bytes: Uint8Array): RawImage | null {
  if (bytes.length < RAW_HEADER) return null;
  for (let i = 0; i < RAW_MAGIC.length; i++) if (bytes[i] !== RAW_MAGIC.charCodeAt(i)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, RAW_HEADER);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  if (bytes.length < RAW_HEADER + width * height * 4) return null;
  return { pixels: bytes.subarray(RAW_HEADER, RAW_HEADER + width * height * 4), width, height };
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Channels per colour type: grey, RGB, palette, grey + alpha, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decodes a PNG in JavaScript. On the console createImageBitmap takes about 100 ms per sprite
 * (test p1), even for Showdown's 1 KB 96x96 ones; here it's an inflate and a pass over the pixels.
 * Covers what the app loads (8-bit palette sprites, the RGB item sheet with its transparent colour); anything else (16-bit, interlaced)
 * gives null, for the browser to decode instead.
 */
export function decodePng(bytes: Uint8Array): RawImage | null {
  if (bytes.length < 33 || SIGNATURE.some((value, i) => bytes[i] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let palette: Uint8Array | null = null;
  let alphas: Uint8Array | null = null;
  const parts: Uint8Array[] = [];
  let size = 0;
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const data = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (name === 'IHDR') {
      width = view.getUint32(16);
      height = view.getUint32(20);
      depth = data[8];
      type = data[9];
      if (data[12] !== 0) return null;
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') alphas = data;
    else if (name === 'IDAT') {
      parts.push(data);
      size += data.length;
    } else if (name === 'IEND') break;
  }
  const channels = CHANNELS[type];
  if (!width || !height || !channels || (type === 3 ? !palette || depth > 8 : depth !== 8)) return null;

  const compressed = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    compressed.set(part, offset);
    offset += part.length;
  }
  const raw = unzlibSync(compressed);
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < (stride + 1) * height) return null;
  unfilter(raw, stride, height, Math.max(1, (channels * depth) / 8));

  // Grey and RGB images name one colour as transparent (Showdown's item sheet: 1,0,0), in 16-bit samples.
  const key = alphas && (type === 0 || type === 2) ? Array.from({ length: type === 0 ? 1 : 3 }, (_, i) => alphas![i * 2 + 1]) : null;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let r: number, g: number, b: number, a: number;
      if (type === 3) {
        const index = depth === 8 ? raw[row + x] : (raw[row + ((x * depth) >> 3)] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        r = palette![index * 3];
        g = palette![index * 3 + 1];
        b = palette![index * 3 + 2];
        a = alphas && index < alphas.length ? alphas[index] : 255;
      } else {
        const i = row + x * channels;
        if (type === 0 || type === 4) {
          r = g = b = raw[i];
          a = type === 4 ? raw[i + 1] : key && r === key[0] ? 0 : 255;
        } else {
          r = raw[i];
          g = raw[i + 1];
          b = raw[i + 2];
          a = type === 6 ? raw[i + 3] : key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
        }
      }
      pixels[out] = (r * a + 127) / 255;
      pixels[out + 1] = (g * a + 127) / 255;
      pixels[out + 2] = (b * a + 127) / 255;
      pixels[out + 3] = a;
    }
  }
  return { pixels, width, height };
}

/** Undoes each row's filter in place (each row starts with its filter's byte). */
function unfilter(raw: Uint8Array, stride: number, height: number, bpp: number): void {
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const filter = raw[row];
    const start = row + 1;
    const above = start - stride - 1;
    for (let i = 0; i < stride; i++) {
      const at = start + i;
      const left = i >= bpp ? raw[at - bpp] : 0;
      const up = y > 0 ? raw[above + i] : 0;
      const corner = y > 0 && i >= bpp ? raw[above + i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      raw[at] = (raw[at] + add) & 255;
    }
  }
}
