// PNG decoding and encoding for the build scripts (no dependencies): what Showdown's sprites are and
// what the bundled sheets are written as.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** A PNG's pixels, straight RGBA (8-bit palette, grey or RGB(A); what Showdown's sprites are). */
export function decodePng(bytes) {
  let width = 0, height = 0, depth = 0, type = 0, palette = null, alphas = null;
  const idat = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const name = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (name === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12] !== 0) throw new Error('interlaced');
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') alphas = data;
    else if (name === 'IDAT') idat.push(data);
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || (type === 3 ? depth > 8 : depth !== 8)) throw new Error(`unsupported PNG (type ${type}, depth ${depth})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, (channels * depth) / 8);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1) + 1;
    const filter = raw[start - 1];
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? raw[start + i - bpp] : 0;
      const up = y > 0 ? raw[start + i - stride - 1] : 0;
      const corner = y > 0 && i >= bpp ? raw[start + i - stride - 1 - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      raw[start + i] = (raw[start + i] + add) & 255;
    }
  }
  const key = alphas && (type === 0 || type === 2) ? [1, 3, 5].slice(0, type === 0 ? 1 : 3).map((i) => alphas[i]) : null;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let r, g, b, a;
      if (type === 3) {
        const index = depth === 8 ? raw[row + x] : (raw[row + ((x * depth) >> 3)] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        [r, g, b] = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]];
        a = alphas && index < alphas.length ? alphas[index] : 255;
      } else {
        const i = row + x * channels;
        if (type === 0 || type === 4) {
          r = g = b = raw[i];
          a = type === 4 ? raw[i + 1] : key && r === key[0] ? 0 : 255;
        } else {
          [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]];
          a = type === 6 ? raw[i + 3] : key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
        }
      }
      // Clear pixels all alike, so they compress to nothing.
      if (a === 0) r = g = b = 0;
      pixels.set([r, g, b, a], out);
    }
  }
  return { width, height, pixels };
}

/** An RGBA PNG, each row with the filter that leaves the smallest values (the usual heuristic). */
export function encodePng(width, height, pixels) {
  const stride = width * 4;
  const out = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let best = Infinity;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const left = i >= 4 ? row[i - 4] : 0;
        const up = above ? above[i] : 0;
        const corner = above && i >= 4 ? above[i - 4] : 0;
        let predicted = 0;
        if (filter === 1) predicted = left;
        else if (filter === 2) predicted = up;
        else if (filter === 3) predicted = (left + up) >> 1;
        else if (filter === 4) {
          const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
        }
        const value = (row[i] - predicted) & 255;
        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < best) {
        best = score;
        out[y * (stride + 1)] = filter;
        candidate.copy(out, y * (stride + 1) + 1);
      }
    }
  }
  const chunk = (name, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(name, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
