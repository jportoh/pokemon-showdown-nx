/**
 * Raw audio: `PSBPCM1` and a zero byte, the sample rate and the number of samples (32-bit little
 * endian), then mono 16-bit samples. The native .nro's build stores the synthesized sounds and themes
 * this way (scripts/build-nro.mjs), rendered ahead with the same code as at run time
 * (synth-pieces): synthesizing them took seconds of the console's CPU while loading.
 */
export const RAW_AUDIO_MAGIC = 'PSBPCM1\0';
const HEADER = 16;

/** Where the native .nro's build puts the pieces it synthesized (scripts/build-nro.mjs). */
export const RENDERED_AUDIO_DIR = 'audio/synth/';

/** Mono samples (-1 to 1) as raw audio. */
export function encodeRawAudio(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(HEADER + samples.length * 2);
  for (let i = 0; i < RAW_AUDIO_MAGIC.length; i++) bytes[i] = RAW_AUDIO_MAGIC.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, rate, true);
  view.setUint32(12, samples.length, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(HEADER + i * 2, Math.round(sample * 32767), true);
  }
  return bytes;
}

/** Raw audio's samples and rate, or null when `bytes` isn't raw audio. */
export function decodeRawAudio(bytes: ArrayBuffer): { samples: Float32Array; rate: number } | null {
  if (bytes.byteLength < HEADER) return null;
  const head = new Uint8Array(bytes, 0, HEADER);
  for (let i = 0; i < RAW_AUDIO_MAGIC.length; i++) if (head[i] !== RAW_AUDIO_MAGIC.charCodeAt(i)) return null;
  const view = new DataView(bytes, 0, HEADER);
  const rate = view.getUint32(8, true);
  const length = view.getUint32(12, true);
  if (bytes.byteLength < HEADER + length * 2) return null;
  // Into a plain array, copied into an AudioBuffer in one call (its channel data, written a sample at
  // a time, was slow on the console).
  const source = new Int16Array(bytes, HEADER, length);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = source[i] / 32768;
  return { samples, rate };
}
