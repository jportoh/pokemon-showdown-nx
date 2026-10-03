import { Note, noteFreq } from '@core/audio/chip-synth';

/** The interface's sounds (see KeyboardNavigation, which plays them as the buttons are used). */
export type SoundId = 'move' | 'accept' | 'back' | 'page' | 'hold' | BattleSoundId;

/**
 * Battle sounds: a hit as the games tell its effectiveness (normal, super effective, not very), a move
 * starting, by its category, a stat rising or falling, and a challenge coming in.
 */
export type BattleSoundId = 'hit' | 'hitSuper' | 'hitWeak' | 'physical' | 'special' | 'status' | 'statUp' | 'statDown' | 'challenge';

/**
 * Sounds recorded from the games, bundled with the app (public/audio): Ruby's three hits and the stat
 * changes. Each replaces its synthesized stand-in below once decoded, after the loading screen.
 */
export const SOUND_FILES: Partial<Record<SoundId, string>> = {
  hit: 'audio/hit.wav',
  hitSuper: 'audio/hit-super.wav',
  hitWeak: 'audio/hit-weak.wav',
  statUp: 'audio/stat-up.mp3',
  statDown: 'audio/stat-down.mp3',
};

const n = noteFreq;

/** Each sound as a few chip notes: short, high and soft, like a GBA menu's. */
export const SOUNDS: Record<SoundId, readonly Note[]> = {
  // The cursor: one quick tick.
  move: [{ at: 0, dur: 0.035, freq: n('E6'), wave: 'pulse50', gain: 0.16, decay: 30 }],
  // A choice: two rising notes.
  accept: [
    { at: 0, dur: 0.05, freq: n('B5'), wave: 'pulse25', gain: 0.2 },
    { at: 0.05, dur: 0.09, freq: n('E6'), wave: 'pulse25', gain: 0.2, decay: 14 },
  ],
  // Back: two falling notes, a bit lower.
  back: [
    { at: 0, dur: 0.05, freq: n('G5'), wave: 'pulse25', gain: 0.2 },
    { at: 0.05, dur: 0.08, freq: n('C5'), wave: 'pulse25', gain: 0.2, decay: 14 },
  ],
  // A page or tab (L, R, ZL, ZR): a quick upward sweep.
  page: [{ at: 0, dur: 0.07, freq: n('A5'), slideTo: n('A6'), wave: 'pulse12', gain: 0.18, decay: 10 }],
  // A held button that did something for good (deleting, forfeiting): a falling thud.
  hold: [
    { at: 0, dur: 0.22, freq: n('A4'), slideTo: n('A2'), wave: 'pulse50', gain: 0.2, decay: 8 },
    { at: 0, dur: 0.12, freq: 3000, wave: 'noise', gain: 0.12, decay: 25 },
  ],
  // A hit: a burst of noise over a thump.
  hit: [
    { at: 0, dur: 0.1, freq: 2600, wave: 'noise', gain: 0.3, decay: 28 },
    { at: 0, dur: 0.12, freq: 190, slideTo: 60, wave: 'triangle', gain: 0.34, decay: 18 },
  ],
  // Super effective: louder and longer, a second blow right after the first.
  hitSuper: [
    { at: 0, dur: 0.12, freq: 3600, wave: 'noise', gain: 0.34, decay: 22 },
    { at: 0, dur: 0.14, freq: 230, slideTo: 50, wave: 'triangle', gain: 0.38, decay: 14 },
    { at: 0.08, dur: 0.16, freq: 1800, wave: 'noise', gain: 0.3, decay: 18 },
    { at: 0.08, dur: 0.16, freq: 150, slideTo: 40, wave: 'triangle', gain: 0.34, decay: 12 },
  ],
  // Not very effective: a short, soft tap.
  hitWeak: [
    { at: 0, dur: 0.06, freq: 1500, wave: 'noise', gain: 0.16, decay: 50 },
    { at: 0, dur: 0.07, freq: 140, slideTo: 95, wave: 'triangle', gain: 0.18, decay: 35 },
  ],
  // A physical move: a whoosh of air rising over a low swing (loud enough to be heard over the music).
  physical: [
    { at: 0, dur: 0.26, freq: 1200, slideTo: 9000, wave: 'noise', gain: 0.3, decay: 5 },
    { at: 0, dur: 0.2, freq: n('A3'), slideTo: n('A4'), wave: 'pulse25', gain: 0.12, decay: 8 },
  ],
  // A special move: energy gathering, two rising sweeps and a hiss.
  special: [
    { at: 0, dur: 0.32, freq: n('C5'), slideTo: n('C7'), wave: 'pulse12', gain: 0.22, decay: 3 },
    { at: 0.06, dur: 0.3, freq: n('G5'), slideTo: n('G7'), wave: 'pulse25', gain: 0.16, decay: 4 },
    { at: 0, dur: 0.3, freq: 4000, slideTo: 12000, wave: 'noise', gain: 0.07, decay: 6 },
  ],
  // A status move: a twinkle up a chord.
  status: [
    { at: 0, dur: 0.08, freq: n('E6'), wave: 'pulse12', gain: 0.2, decay: 14 },
    { at: 0.06, dur: 0.08, freq: n('G#6'), wave: 'pulse12', gain: 0.2, decay: 14 },
    { at: 0.12, dur: 0.08, freq: n('B6'), wave: 'pulse12', gain: 0.2, decay: 14 },
    { at: 0.18, dur: 0.16, freq: n('E7'), wave: 'pulse12', gain: 0.18, decay: 10 },
  ],
  // Stand-ins for the recorded ones: a sweep up, or down.
  statUp: [{ at: 0, dur: 0.4, freq: n('C5'), slideTo: n('C7'), wave: 'pulse25', gain: 0.16, decay: 3 }],
  statDown: [{ at: 0, dur: 0.4, freq: n('C7'), slideTo: n('C5'), wave: 'pulse25', gain: 0.16, decay: 3 }],
  // A challenge coming in: a bright three-note call, twice, as a phone ringing.
  challenge: [
    { at: 0, dur: 0.08, freq: n('G5'), wave: 'pulse25', gain: 0.22 },
    { at: 0.08, dur: 0.08, freq: n('C6'), wave: 'pulse25', gain: 0.22 },
    { at: 0.16, dur: 0.16, freq: n('E6'), wave: 'pulse25', gain: 0.22, decay: 8 },
    { at: 0.36, dur: 0.08, freq: n('G5'), wave: 'pulse25', gain: 0.22 },
    { at: 0.44, dur: 0.08, freq: n('C6'), wave: 'pulse25', gain: 0.22 },
    { at: 0.52, dur: 0.24, freq: n('G6'), wave: 'pulse25', gain: 0.22, decay: 6 },
  ],
};
