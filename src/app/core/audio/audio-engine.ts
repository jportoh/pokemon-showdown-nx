import { Service, effect, inject, signal } from '@angular/core';
import { Note, notesLength, renderNote } from '@core/audio/chip-synth';
import { MENU_THEME_SECONDS, menuThemeNotes } from '@core/audio/menu-theme';
import { BattleTheme, battleThemeNotes, battleThemeSeconds } from '@core/audio/battle-themes';
import { SOUND_FILES, SOUNDS, SoundId } from '@core/audio/sfx';
import { AppSettings } from '@core/settings/app-settings';

/** Time per frame for what's synthesized after the loading screen. */
const BACKGROUND_SLICE_MS = 4;
/** How long music takes to fade in or out when it changes. */
const FADE_S = 0.8;

/** A piece of music to loop: the whole buffer, or from loopStart to loopEnd (seconds) after the intro. */
export interface MusicTrack {
  id: string;
  buffer: AudioBuffer;
  loopStart?: number;
  loopEnd?: number;
}

interface Playing {
  id: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type AudioContextClass = typeof AudioContext;

/**
 * The app's sound, all through Web Audio: on the console it runs from launch and decodes mp3, ogg and
 * wav, while <audio> elements never play (probe S1). Two buses, music and sound effects, follow the
 * volumes in Settings.
 *
 * The interface's and battles' sounds and the menu theme are synthesized (chip-synth) while the
 * loading screen shows (prepare), then the battle themes (team preview, victory, defeat) a slice per
 * frame, while the sounds recorded from the games (SOUND_FILES) load. Battles bring their own music
 * and cries (BattleMusic, BattleCries). In a browser the context
 * starts suspended until the first key or click, so anything before that is silent.
 */
@Service()
export class AudioEngine {
  private readonly settings = inject(AppSettings);

  private readonly context: AudioContext | null = createContext();
  private readonly musicBus: GainNode | null = null;
  private readonly soundBus: GainNode | null = null;
  private readonly sounds = new Map<SoundId, AudioBuffer>();
  private menuTheme: MusicTrack | null = null;
  private readonly battleThemes = new Map<BattleTheme, MusicTrack>();
  /** A battle theme asked for before it was synthesized: it plays once it is. */
  private wantedTheme: BattleTheme | null = null;
  private playing: Playing | null = null;
  /** What's still to synthesize, a note at a time: 'ready' once the loading screen's part is done. */
  private job: Iterator<'ready' | void> | null = null;

  /** The interface's sounds and the menu theme are ready (see prepare). */
  readonly ready = signal(false);

  constructor() {
    const context = this.context;
    if (!context) {
      this.ready.set(true);
      return;
    }
    this.musicBus = context.createGain();
    this.soundBus = context.createGain();
    this.musicBus.connect(context.destination);
    this.soundBus.connect(context.destination);
    effect(() => {
      const { musicVolume, soundVolume } = this.settings.settings();
      this.musicBus!.gain.value = loudness(musicVolume);
      this.soundBus!.gain.value = loudness(soundVolume);
    });
    // A browser's autoplay rule: the context can only start from a key or a click.
    const unlock = () => {
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    };
    for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, unlock, true);
    this.job = this.synthesize(context);
  }

  /**
   * Synthesizes the interface's sounds and the menu theme for up to `budgetMs`, from the loading
   * screen's frames (the console's timers are too slow to spread it out with). True once done.
   */
  prepare(budgetMs: number): boolean {
    const job = this.job;
    if (!job || this.ready()) return true;
    const until = performance.now() + budgetMs;
    while (performance.now() < until) {
      const step = job.next();
      if (step.done || step.value === 'ready') {
        this.ready.set(true);
        this.loadFiles();
        this.finishInBackground();
        return true;
      }
    }
    return false;
  }

  /**
   * The battle themes, after the loading screen: a slice each frame (the console's timers are too slow
   * to wait for between slices).
   */
  private finishInBackground(): void {
    const job = this.job;
    if (!job) return;
    const until = performance.now() + BACKGROUND_SLICE_MS;
    while (performance.now() < until) {
      if (job.next().done) {
        this.job = null;
        return;
      }
    }
    nextFrame(() => this.finishInBackground());
  }

  /** The sounds recorded from the games, each in place of its synthesized stand-in once decoded. */
  private loadFiles(): void {
    for (const [id, url] of Object.entries(SOUND_FILES) as [SoundId, string][]) {
      void this.load(url).then((buffer) => buffer && this.sounds.set(id, buffer));
    }
  }

  /** Plays one of the interface's sounds. */
  play(id: SoundId): void {
    const buffer = this.sounds.get(id);
    if (buffer) this.playBuffer(buffer);
  }

  /** Plays a decoded sound (a cry) on the sound effects' bus; `rate` below 1 plays it lower and slower. */
  playBuffer(buffer: AudioBuffer, rate = 1): void {
    const context = this.context;
    if (!context || !this.soundBus || context.state !== 'running') return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(this.soundBus);
    source.start(0);
  }

  /** Back to the menu theme (after a battle, or once the loading screen is done). */
  playMenuTheme(): void {
    if (this.menuTheme) this.playMusic(this.menuTheme);
  }

  /** Team preview's theme, or the victory or the defeat theme: as soon as it's synthesized. */
  playBattleTheme(theme: BattleTheme): void {
    const track = this.battleThemes.get(theme);
    if (track) this.playMusic(track);
    else this.wantedTheme = theme;
  }

  /** Fades the current music out and `track` in; nothing changes if it's already playing. */
  playMusic(track: MusicTrack): void {
    this.wantedTheme = null;
    const context = this.context;
    if (!context || !this.musicBus || this.playing?.id === track.id) return;
    this.stopMusic();
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    source.loop = true;
    if (track.loopEnd) {
      source.loopStart = track.loopStart ?? 0;
      source.loopEnd = track.loopEnd;
    }
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE_S);
    source.connect(gain);
    gain.connect(this.musicBus);
    source.start(0);
    this.playing = { id: track.id, source, gain };
  }

  /** Fades the music out. */
  stopMusic(): void {
    const playing = this.playing;
    const context = this.context;
    if (!playing || !context) return;
    this.playing = null;
    const now = context.currentTime;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
    playing.source.stop(now + FADE_S);
  }

  /** Downloads and decodes a sound or a piece of music; null where that fails (or there's no Web Audio). */
  async load(url: string): Promise<AudioBuffer | null> {
    if (!this.context) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await this.decode(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Decodes audio bytes (the console's engine may answer through the callbacks, the promise, or both). */
  decode(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
    const context = this.context;
    if (!context) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const done = (buffer: AudioBuffer | null) => {
        if (settled) return;
        settled = true;
        resolve(buffer);
      };
      try {
        const promise = context.decodeAudioData(bytes, done, () => done(null));
        promise?.then?.(done, () => done(null));
      } catch {
        done(null);
      }
    });
  }

  /** The synthesis, one note per step: the sounds first, then the menu theme straight into its buffer. */
  private *synthesize(context: AudioContext): Iterator<'ready' | void> {
    const rate = context.sampleRate;
    for (const [id, notes] of Object.entries(SOUNDS) as [SoundId, readonly Note[]][]) {
      const buffer = context.createBuffer(1, Math.ceil(notesLength(notes) * rate), rate);
      const samples = buffer.getChannelData(0);
      for (const note of notes) renderNote(samples, rate, note);
      this.sounds.set(id, buffer);
      yield;
    }
    const theme = context.createBuffer(1, Math.ceil(MENU_THEME_SECONDS * rate), rate);
    const samples = theme.getChannelData(0);
    let seed = 1;
    for (const note of menuThemeNotes()) {
      renderNote(samples, rate, note, seed++);
      yield;
    }
    this.menuTheme = { id: 'menu', buffer: theme };
    yield 'ready';
    for (const id of ['preview', 'victory', 'defeat'] as const) {
      const buffer = context.createBuffer(1, Math.ceil(battleThemeSeconds(id) * rate), rate);
      const channel = buffer.getChannelData(0);
      for (const note of battleThemeNotes(id)) {
        renderNote(channel, rate, note, seed++);
        yield;
      }
      const track = { id, buffer };
      this.battleThemes.set(id, track);
      if (this.wantedTheme === id) this.playMusic(track);
    }
  }
}

/** Runs `fn` on the next frame (or soon, where there are no frames). */
function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
}

function createContext(): AudioContext | null {
  const windowWithWebkit = window as Window & { webkitAudioContext?: AudioContextClass };
  const Context = window.AudioContext ?? windowWithWebkit.webkitAudioContext;
  if (!Context) return null;
  try {
    return new Context();
  } catch {
    return null;
  }
}

/** A Settings volume (0–100) as a gain: squared, as loudness is heard (50 % sounds about half as loud). */
function loudness(volume: number): number {
  const level = volume / 100;
  return level * level;
}
