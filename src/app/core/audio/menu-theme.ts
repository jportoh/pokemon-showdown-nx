import { Note, noteFreq } from '@core/audio/chip-synth';

/**
 * The menus' music: an original 16-bar loop in C major, written for the app in the style of a GBA
 * game's menu (a pulse lead, a pulse arpeggio, a triangle bass, noise drums). AudioEngine renders it
 * once while the loading screen shows and loops it under every screen but battles.
 */

const BPM = 126;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const SIXTEENTH = BEAT / 4;
const BAR = BEAT * 4;

/** Each bar's chord, as the arpeggio plays it (root, third, fifth). */
const CHORDS: Record<string, readonly string[]> = {
  C: ['C4', 'E4', 'G4'],
  Am: ['A3', 'C4', 'E4'],
  F: ['F3', 'A3', 'C4'],
  G: ['G3', 'B3', 'D4'],
  Dm: ['D4', 'F4', 'A4'],
  Em: ['E4', 'G4', 'B4'],
};
const BASS: Record<string, string> = { C: 'C2', Am: 'A1', F: 'F2', G: 'G1', Dm: 'D2', Em: 'E2' };

const PROGRESSION = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'G'];

/** The lead, a bar a line in eighths: a note, '-' to hold the last one, '.' for silence. */
const MELODY = [
  'E5 . G5 . C6 - B5 A5',
  'A5 - - E5 C5 - E5 -',
  'F5 - A5 - C6 - A5 F5',
  'G5 - - - B4 - D5 -',
  'E5 . G5 . C6 - E6 -',
  'D6 C6 B5 A5 - - E5 -',
  'F5 - A5 - D6 - C6 A5',
  'B5 - - - G5 - - .',
  'A5 - C6 - F6 - E6 D6',
  'D6 - B5 - G5 - B5 D6',
  'E6 - D6 B5 G5 - E5 G5',
  'A5 - - - C6 - B5 A5',
  'F5 - A5 - D6 - F6 -',
  'E6 D6 - B5 G5 - D6 -',
  'C6 - - - G5 - E5 -',
  'D5 - G5 - B5 - D6 .',
];

/** Every note of the loop, bar by bar (AudioEngine renders it a few notes at a time). */
export function menuThemeNotes(): Note[] {
  const notes: Note[] = [];
  PROGRESSION.forEach((chord, bar) => {
    const start = bar * BAR;
    // Lead: each note lasts until the next note or rest.
    const steps = MELODY[bar].split(' ');
    steps.forEach((step, i) => {
      if (step === '-' || step === '.') return;
      let length = 1;
      while (steps[i + length] === '-') length++;
      notes.push({ at: start + i * EIGHTH, dur: length * EIGHTH * 0.95, freq: noteFreq(step), wave: 'pulse25', gain: 0.11, decay: 1.5, vibrato: true });
    });
    // Arpeggio: up and down the chord in sixteenths, quietly.
    const tones = CHORDS[chord];
    const pattern = [0, 1, 2, 1];
    for (let i = 0; i < 16; i++) {
      notes.push({ at: start + i * SIXTEENTH, dur: SIXTEENTH * 0.8, freq: noteFreq(tones[pattern[i % 4]]), wave: 'pulse12', gain: 0.035, decay: 12 });
    }
    // Bass: the root bouncing between octaves in eighths.
    const root = noteFreq(BASS[chord]);
    for (let i = 0; i < 8; i++) {
      notes.push({ at: start + i * EIGHTH, dur: EIGHTH * 0.85, freq: i % 2 ? root * 2 : root, wave: 'triangle', gain: 0.2, decay: 3 });
    }
    // Drums: a kick on 1 and 3, a snare on 2 and 4, soft hats on the off-beats.
    for (let beat = 0; beat < 4; beat++) {
      const at = start + beat * BEAT;
      if (beat % 2 === 0) notes.push({ at, dur: 0.09, freq: 160, slideTo: 50, wave: 'triangle', gain: 0.24, decay: 30 });
      else notes.push({ at, dur: 0.12, freq: 6000, wave: 'noise', gain: 0.07, decay: 22 });
      notes.push({ at: at + EIGHTH, dur: 0.03, freq: 14000, wave: 'noise', gain: 0.025, decay: 60 });
    }
  });
  return notes;
}

/** The loop's length in seconds (it's played whole, over and over). */
export const MENU_THEME_SECONDS = PROGRESSION.length * BAR;
