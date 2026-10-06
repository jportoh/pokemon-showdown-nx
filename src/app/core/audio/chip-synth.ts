/**
 * A tiny chiptune synth in the style of the Game Boy Advance's sound chip: pulse waves of three
 * widths, a triangle and noise, each note with its own envelope. It writes samples straight into an
 * array (an AudioBuffer's channel), so the app's sounds and its menu theme need no audio files.
 */

export type Wave = 'pulse12' | 'pulse25' | 'pulse50' | 'triangle' | 'noise';

export interface Note {
  /** When it starts and how long it's held, in seconds. */
  at: number;
  dur: number;
  /** Its pitch in Hz (for noise, how often the noise changes: higher is hissier). */
  freq: number;
  wave: Wave;
  /** Peak level, 0 to 1. */
  gain: number;
  /** Slides to this pitch over the note (a sweep). */
  slideTo?: number;
  /** How fast it fades while held, per second (0 holds steady; drums fade fast). */
  decay?: number;
  /** A light vibrato on long notes (a lead's). */
  vibrato?: boolean;
}

/** The fade-in and fade-out at a note's ends, which keep it from clicking. */
const ATTACK_S = 0.004;
const RELEASE_S = 0.02;
const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" → 440, "C#5", "Bb3"… */
export function noteFreq(name: string): number {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Bad note ${name}`);
  const semitone = NAMES[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  const midi = 12 * (Number(match[3]) + 1) + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Samples noteSteps writes between yields (~10 ms of sound at 48 kHz). */
const NOTE_CHUNK = 512;

/** Adds one note into `out` (mixing with what's there), at `rate` samples a second. */
export function renderNote(out: Float32Array, rate: number, note: Note, seed = 1): void {
  const steps = noteSteps(out, rate, note, seed);
  while (!steps.next().done);
}

/**
 * renderNote a slice at a time, yielding every NOTE_CHUNK samples: what's synthesized behind the
 * menu can stop when the frame's slice is up. A whole long note at once took far longer than the
 * slice on the console, and the home screen stuttered for seconds after loading (test-w3).
 */
export function* noteSteps(out: Float32Array, rate: number, note: Note, seed = 1): Generator<void, void, void> {
  const start = Math.max(0, Math.round(note.at * rate));
  const length = Math.round(note.dur * rate);
  const end = Math.min(out.length, start + length);
  const attack = ATTACK_S * rate;
  const release = Math.min(RELEASE_S * rate, length / 2);
  const decay = note.decay ?? 0;
  const duty = note.wave === 'pulse12' ? 0.125 : note.wave === 'pulse25' ? 0.25 : 0.5;
  let phase = 0;
  let noise = 0;
  let random = Math.imul(seed, 2654435761) || 1;
  for (let i = start; i < end; i++) {
    const t = (i - start) / rate;
    const progress = (i - start) / length;
    let freq = note.slideTo === undefined ? note.freq : note.freq * Math.pow(note.slideTo / note.freq, progress);
    if (note.vibrato && t > 0.15) freq *= 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t);
    const before = phase;
    phase = (phase + freq / rate) % 1;
    let sample: number;
    if (note.wave === 'noise') {
      // A new random level each time the "phase" wraps: pitched noise, as the GBA's.
      if (phase < before) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        noise = ((random >>> 0) / 0xffffffff) * 2 - 1;
      }
      sample = noise;
    } else if (note.wave === 'triangle') {
      sample = 4 * Math.abs(phase - 0.5) - 1;
    } else {
      sample = phase < duty ? 1 : -1;
    }
    const fromStart = i - start;
    const toEnd = end - i;
    let envelope = decay > 0 ? Math.exp(-decay * t) : 1;
    if (fromStart < attack) envelope *= fromStart / attack;
    if (toEnd < release) envelope *= toEnd / release;
    out[i] += sample * note.gain * envelope;
    if (fromStart % NOTE_CHUNK === NOTE_CHUNK - 1) yield;
  }
}

/** Seconds of `notes`, to the end of the last one. */
export function notesLength(notes: readonly Note[]): number {
  return notes.reduce((length, note) => Math.max(length, note.at + note.dur), 0);
}
