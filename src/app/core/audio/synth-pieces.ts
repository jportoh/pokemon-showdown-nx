import { Note, noteSteps, notesLength, renderNote } from '@core/audio/chip-synth';
import { MENU_THEME_SECONDS, menuThemeNotes } from '@core/audio/menu-theme';
import { BattleTheme, battleThemeNotes, battleThemeSeconds } from '@core/audio/battle-themes';
import { SOUNDS, SoundId } from '@core/audio/sfx';

/** Everything the app synthesizes: the interface's and battles' sounds, the menu theme, the battle themes. */
export type SynthPiece = SoundId | 'menu' | BattleTheme;

export const SYNTH_SOUNDS = Object.keys(SOUNDS) as SoundId[];
export const BATTLE_THEMES: readonly BattleTheme[] = ['preview', 'victory', 'defeat'];
/** In the order they're needed: the loading screen waits for the sounds and the menu theme. */
export const SYNTH_PIECES: readonly SynthPiece[] = [...SYNTH_SOUNDS, 'menu', ...BATTLE_THEMES];

function isSound(piece: SynthPiece): piece is SoundId {
  return piece in SOUNDS;
}

/** A piece's length in seconds. */
export function pieceSeconds(piece: SynthPiece): number {
  if (isSound(piece)) return notesLength(SOUNDS[piece]);
  return piece === 'menu' ? MENU_THEME_SECONDS : battleThemeSeconds(piece);
}

/**
 * Synthesizes a piece into `out` (pieceSeconds long at `rate`), yielding every slice of a note so
 * the work can be spread over frames. The same at run time and in the native build's pre-render.
 */
export function* renderPiece(piece: SynthPiece, out: Float32Array, rate: number): Generator<void, void, void> {
  const notes: readonly Note[] = isSound(piece) ? SOUNDS[piece] : piece === 'menu' ? menuThemeNotes() : battleThemeNotes(piece);
  let seed = 1;
  for (const note of notes) {
    // A sound's notes are short: each at once.
    if (isSound(piece)) renderNote(out, rate, note, seed++);
    else yield* noteSteps(out, rate, note, seed++);
  }
}
