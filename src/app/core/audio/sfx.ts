import { Note, noteFreq } from '@core/audio/chip-synth';

/** The interface's sounds (see KeyboardNavigation, which plays them as the buttons are used). */
export type SoundId = 'move' | 'accept' | 'back' | 'page' | 'hold';

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
};
