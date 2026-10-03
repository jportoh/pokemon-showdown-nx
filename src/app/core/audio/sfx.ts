import { Note, noteFreq } from '@core/audio/chip-synth';

/** The interface's sounds (see KeyboardNavigation, which plays them as the buttons are used). */
export type SoundId = 'move' | 'accept' | 'back' | 'page' | 'hold' | BattleSoundId;

/**
 * Battle sounds: a hit as the games tell its effectiveness (a plain thump, a heavier double one when
 * super effective, a dull tap when not very), and a move starting, by its category.
 */
export type BattleSoundId = 'hit' | 'hitSuper' | 'hitWeak' | 'physical' | 'special' | 'status';

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
  // A physical move: a rush of air.
  physical: [{ at: 0, dur: 0.2, freq: 1800, slideTo: 9000, wave: 'noise', gain: 0.13, decay: 7 }],
  // A special move: energy gathering, two rising sweeps.
  special: [
    { at: 0, dur: 0.24, freq: n('C5'), slideTo: n('C7'), wave: 'pulse12', gain: 0.1, decay: 4 },
    { at: 0.05, dur: 0.22, freq: n('G5'), slideTo: n('G7'), wave: 'pulse25', gain: 0.07, decay: 5 },
  ],
  // A status move: a twinkle up a chord.
  status: [
    { at: 0, dur: 0.07, freq: n('E6'), wave: 'pulse12', gain: 0.1, decay: 18 },
    { at: 0.05, dur: 0.07, freq: n('G#6'), wave: 'pulse12', gain: 0.1, decay: 18 },
    { at: 0.1, dur: 0.07, freq: n('B6'), wave: 'pulse12', gain: 0.1, decay: 18 },
    { at: 0.15, dur: 0.12, freq: n('E7'), wave: 'pulse12', gain: 0.09, decay: 14 },
  ],
};
