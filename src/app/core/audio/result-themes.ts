import { Note, Wave, noteFreq } from '@core/audio/chip-synth';

/**
 * The end of our own battles: an original victory theme (a bright fanfare in C major) and an original
 * defeat theme (slow, in A minor), 8-bar loops written for the app in the style of a GBA game, as the
 * menu theme. AudioEngine renders them while the loading screen shows; BattleMusic plays one when the
 * battle ends.
 */

interface LoopScore {
  bpm: number;
  /** Each bar's chord (see CHORDS). */
  progression: readonly string[];
  /** The lead, a bar a line in eighths: a note, '-' to hold the last one, '.' for silence. */
  melody: readonly string[];
  lead: Wave;
  /** Drums under it (the victory's), or none. */
  drums: boolean;
  /** The arpeggio's notes per beat: 4 (busy) or 2 (calm). */
  arpeggio: 2 | 4;
}

const CHORDS: Record<string, readonly string[]> = {
  C: ['C4', 'E4', 'G4'],
  F: ['F3', 'A3', 'C4'],
  G: ['G3', 'B3', 'D4'],
  Am: ['A3', 'C4', 'E4'],
  Dm: ['D4', 'F4', 'A4'],
  E: ['E3', 'G#3', 'B3'],
};
const BASS: Record<string, string> = { C: 'C2', F: 'F2', G: 'G1', Am: 'A1', Dm: 'D2', E: 'E2' };

const VICTORY: LoopScore = {
  bpm: 136,
  progression: ['C', 'F', 'G', 'C', 'Am', 'F', 'G', 'C'],
  melody: [
    'G4 C5 E5 G5 - - E5 G5',
    'A5 - - G5 F5 - A5 -',
    'G5 - D5 - B4 - D5 G5',
    'E5 - C5 - G5 - - -',
    'A5 - C6 - E6 - C6 A5',
    'F5 - A5 - C6 - A5 F5',
    'G5 - B5 - D6 - B5 G5',
    'C6 - - - G5 - C6 .',
  ],
  lead: 'pulse25',
  drums: true,
  arpeggio: 4,
};

const DEFEAT: LoopScore = {
  bpm: 80,
  progression: ['Am', 'F', 'Dm', 'E', 'Am', 'Dm', 'E', 'Am'],
  melody: [
    'E5 - - - C5 - A4 -',
    'F5 - - - C5 - A4 -',
    'D5 - F5 - A5 - - F5',
    'E5 - - - G#4 - B4 -',
    'C5 - - B4 A4 - - -',
    'F5 - - E5 D5 - - -',
    'B4 - - - E5 - G#5 -',
    'A5 - - - - - . .',
  ],
  lead: 'pulse50',
  drums: false,
  arpeggio: 2,
};

export type ResultTheme = 'victory' | 'defeat';

/** Every note of the theme's loop. */
export function resultThemeNotes(theme: ResultTheme): Note[] {
  return loopNotes(theme === 'victory' ? VICTORY : DEFEAT);
}

/** The loop's length in seconds (it's played whole, over and over). */
export function resultThemeSeconds(theme: ResultTheme): number {
  const score = theme === 'victory' ? VICTORY : DEFEAT;
  return (score.progression.length * 4 * 60) / score.bpm;
}

function loopNotes(score: LoopScore): Note[] {
  const beat = 60 / score.bpm;
  const eighth = beat / 2;
  const bar = beat * 4;
  const notes: Note[] = [];
  score.progression.forEach((chord, index) => {
    const start = index * bar;
    // Lead: each note lasts until the next note or rest.
    const steps = score.melody[index].split(' ');
    steps.forEach((step, i) => {
      if (step === '-' || step === '.') return;
      let length = 1;
      while (steps[i + length] === '-') length++;
      notes.push({ at: start + i * eighth, dur: length * eighth * 0.95, freq: noteFreq(step), wave: score.lead, gain: 0.11, decay: 1.2, vibrato: true });
    });
    // Arpeggio: up and down the chord, quietly.
    const tones = CHORDS[chord];
    const pattern = [0, 1, 2, 1];
    const count = score.arpeggio * 4;
    const step = bar / count;
    for (let i = 0; i < count; i++) {
      notes.push({ at: start + i * step, dur: step * 0.8, freq: noteFreq(tones[pattern[i % 4]]), wave: 'pulse12', gain: 0.035, decay: 10 });
    }
    // Bass: the root, bouncing between octaves in eighths (held on the beats in the slow one).
    const root = noteFreq(BASS[chord]);
    const bassStep = score.drums ? eighth : beat;
    for (let i = 0; i < bar / bassStep - 0.01; i++) {
      notes.push({ at: start + i * bassStep, dur: bassStep * 0.85, freq: i % 2 ? root * 2 : root, wave: 'triangle', gain: 0.2, decay: 3 });
    }
    if (!score.drums) return;
    // Drums: a kick on 1 and 3, a snare on 2 and 4, hats on the off-beats.
    for (let b = 0; b < 4; b++) {
      const at = start + b * beat;
      if (b % 2 === 0) notes.push({ at, dur: 0.09, freq: 160, slideTo: 50, wave: 'triangle', gain: 0.24, decay: 30 });
      else notes.push({ at, dur: 0.12, freq: 6000, wave: 'noise', gain: 0.07, decay: 22 });
      notes.push({ at: at + eighth, dur: 0.03, freq: 14000, wave: 'noise', gain: 0.025, decay: 60 });
    }
  });
  return notes;
}
