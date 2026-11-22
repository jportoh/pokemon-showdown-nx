import { Note, noteFreq } from '@core/audio/chip-synth';

/**
 * The menus' music: an original 16-bar loop in D major, written for the app in the style of a GBA
 * game's battle facility (a heroic march: a pulse lead doubled an octave down like brass, a pulse
 * arpeggio, a driving triangle bass, march drums with a snare roll closing each phrase). The borrowed
 * C and B♭ chords give it its epic lift. AudioEngine renders it once while the title screen shows and
 * loops it under every screen but battles.
 */

const BPM = 144;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const SIXTEENTH = BEAT / 4;
const BAR = BEAT * 4;

/** Each bar's chord, as the arpeggio plays it (root, third, fifth). */
const CHORDS: Record<string, readonly string[]> = {
  D: ['D4', 'F#4', 'A4'],
  C: ['C4', 'E4', 'G4'],
  G: ['G3', 'B3', 'D4'],
  Bb: ['Bb3', 'D4', 'F4'],
  A: ['A3', 'C#4', 'E4'],
  'F#m': ['F#3', 'A3', 'C#4'],
  Bm: ['B3', 'D4', 'F#4'],
};
const BASS: Record<string, string> = { D: 'D2', C: 'C2', G: 'G1', Bb: 'Bb1', A: 'A1', 'F#m': 'F#1', Bm: 'B1' };

const PROGRESSION = ['D', 'D', 'C', 'G', 'D', 'D', 'Bb', 'A', 'G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'A'];

/** The lead, a bar a line in eighths: a note, '-' to hold the last one, '.' for silence. */
const MELODY = [
  'A4 - D5 - F#5 - A5 -',
  'A5 - G5 F#5 E5 - F#5 -',
  'G5 - - E5 C5 - E5 G5',
  'D5 - - - B4 - D5 -',
  'A4 - D5 - F#5 - A5 -',
  'D6 - C#6 B5 A5 - F#5 -',
  'F5 - - D5 Bb4 - D5 F5',
  'E5 - - - C#5 - E5 .',
  'B5 - - G5 D5 - G5 B5',
  'C#6 - - A5 E5 - A5 C#6',
  'C#6 - B5 A5 F#5 - A5 -',
  'B5 - - - F#5 - D5 -',
  'G5 - B5 - D6 - B5 G5',
  'A5 - C#6 - E6 - D6 C#6',
  'D6 - - - A5 - F#5 -',
  'A4 - C#5 - E5 - G5 .',
];

/** The bars whose last beat is a snare roll (each phrase's end). */
const ROLLS = new Set([7, 15]);

/** Every note of the loop, bar by bar (AudioEngine renders it a few notes at a time). */
export function menuThemeNotes(): Note[] {
  const notes: Note[] = [];
  PROGRESSION.forEach((chord, bar) => {
    const start = bar * BAR;
    // Lead: each note lasts until the next note or rest, doubled an octave down (the brass).
    const steps = MELODY[bar].split(' ');
    steps.forEach((step, i) => {
      if (step === '-' || step === '.') return;
      let length = 1;
      while (steps[i + length] === '-') length++;
      const at = start + i * EIGHTH;
      const dur = length * EIGHTH * 0.95;
      const freq = noteFreq(step);
      notes.push({ at, dur, freq, wave: 'pulse25', gain: 0.1, decay: 1.2, vibrato: true });
      notes.push({ at, dur, freq: freq / 2, wave: 'pulse50', gain: 0.045, decay: 1.6 });
    });
    // Arpeggio: up and down the chord in sixteenths, quietly.
    const tones = CHORDS[chord];
    const pattern = [0, 1, 2, 1];
    for (let i = 0; i < 16; i++) {
      notes.push({ at: start + i * SIXTEENTH, dur: SIXTEENTH * 0.8, freq: noteFreq(tones[pattern[i % 4]]), wave: 'pulse12', gain: 0.03, decay: 12 });
    }
    // Bass: the root driving in eighths, up the octave on the off-beats.
    const root = noteFreq(BASS[chord]);
    for (let i = 0; i < 8; i++) {
      notes.push({ at: start + i * EIGHTH, dur: EIGHTH * 0.8, freq: i % 2 ? root * 2 : root, wave: 'triangle', gain: 0.21, decay: 3.5 });
    }
    // Drums: a march (kick on 1 and 3, snare on 2 and 4, hats on the off-beats), a roll closing each phrase.
    for (let beat = 0; beat < 4; beat++) {
      const at = start + beat * BEAT;
      if (beat === 3 && ROLLS.has(bar)) {
        for (let i = 0; i < 4; i++) notes.push({ at: at + i * SIXTEENTH, dur: 0.08, freq: 6000, wave: 'noise', gain: 0.05 + i * 0.012, decay: 26 });
        continue;
      }
      if (beat % 2 === 0) notes.push({ at, dur: 0.09, freq: 160, slideTo: 50, wave: 'triangle', gain: 0.26, decay: 30 });
      else notes.push({ at, dur: 0.12, freq: 6000, wave: 'noise', gain: 0.08, decay: 22 });
      notes.push({ at: at + EIGHTH, dur: 0.03, freq: 14000, wave: 'noise', gain: 0.025, decay: 60 });
    }
  });
  return notes;
}

/** The loop's length in seconds (it's played whole, over and over). */
export const MENU_THEME_SECONDS = PROGRESSION.length * BAR;
