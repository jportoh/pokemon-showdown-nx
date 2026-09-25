// Just enough PNG for cutting Showdown's item icon sheet into one file per item (Brewser can't show
// a cell of a sprite sheet: it ignores background-position). Reads 8-bit RGB (with a tRNS colour)
// or RGBA non-interlaced images, and writes RGBA.

import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a PNG into `{ width, height, pixels }`, pixels being RGBA bytes row by row. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let header;
  let transparent = null;
  const data = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    } else if (type === 'tRNS') {
      transparent = [body.readUInt16BE(0), body.readUInt16BE(2), body.readUInt16BE(4)];
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.interlace !== 0 || (header.color !== 2 && header.color !== 6)) {
    throw new Error('only 8-bit non-interlaced RGB/RGBA PNGs are supported');
  }

  const { width, height } = header;
  const channels = header.color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
      rows[y * stride + x] = (line[x] + predict(filter, left, up, upLeft)) & 0xff;
    }
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = [rows[i * channels], rows[i * channels + 1], rows[i * channels + 2]];
    const clear = transparent !== null && r === transparent[0] && g === transparent[1] && b === transparent[2];
    pixels.set([r, g, b, channels === 4 ? rows[i * 4 + 3] : clear ? 0 : 255], i * 4);
  }
  return { width, height, pixels };
}

function predict(filter, left, up, upLeft) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}

/** Cuts a `size`x`size` cell out of an image, scaled up `scale` times (nearest neighbour, stays crisp). */
export function cropScaled(image, left, top, size, scale) {
  const out = size * scale;
  const pixels = Buffer.alloc(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const from = ((top + Math.floor(y / scale)) * image.width + left + Math.floor(x / scale)) * 4;
      image.pixels.copy(pixels, (y * out + x) * 4, from, from + 4);
    }
  }
  return { width: out, height: out, pixels };
}

/** Whether every pixel is fully transparent (an empty cell). */
export function isBlank(image) {
  for (let i = 3; i < image.pixels.length; i += 4) if (image.pixels[i] !== 0) return false;
  return true;
}

/** Encodes RGBA pixels as a PNG. */
export function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndBody));
  return Buffer.concat([length, typeAndBody, crc]);
}
