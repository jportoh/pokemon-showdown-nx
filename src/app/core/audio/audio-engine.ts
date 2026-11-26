import { Service, effect, inject, signal } from '@angular/core';
import { GlDiagnostics } from '@core/gl/gl-diagnostics';
import { BattleTheme } from '@core/audio/battle-themes';
import { RENDERED_AUDIO_DIR, decodeRawAudio } from '@core/audio/raw-audio';
import { DUCKING_SOUNDS, SOUND_FILES, SoundId } from '@core/audio/sfx';
import { BATTLE_THEMES, SYNTH_PIECES, SynthPiece, pieceSeconds, renderPiece } from '@core/audio/synth-pieces';
import { PLATFORM } from '@core/runtime/platform';
import { AppSettings } from '@core/settings/app-settings';

/** Time per frame for what's synthesized after the loading screen (4 ms left the idle menu at the edge of its frame on the console, test-w6). */
const BACKGROUND_SLICE_MS = 2;
/** How long music takes to fade in or out when it changes. */
const FADE_S = 0.8;
/** A hit lowers the music to this (gain) at once, holds it up to DUCK_HOLD_S, then brings it back over DUCK_RELEASE_S. */
const DUCK_LEVEL = 0.35;
const DUCK_HOLD_S = 0.4;
const DUCK_RELEASE_S = 0.35;

/** A piece of music to loop: the whole buffer, or from loopStart to loopEnd (seconds) after the intro; or, `once`, played through once. */
export interface MusicTrack {
  id: string;
  buffer: AudioBuffer;
  loopStart?: number;
  loopEnd?: number;
  once?: boolean;
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
  private readonly diagnostics = inject(GlDiagnostics);

  private readonly context: AudioContext | null = createContext();
  private readonly musicBus: GainNode | null = null;
  /** After the music bus: lowered for a moment under the hits (see DUCKING_SOUNDS). */
  private readonly duckBus: GainNode | null = null;
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
    this.duckBus = context.createGain();
    this.musicBus.connect(this.duckBus);
    this.duckBus.connect(context.destination);
    this.soundBus.connect(context.destination);
    effect(() => {
      const { musicVolume, soundVolume } = this.settings.settings();
      this.musicBus!.gain.value = loudness(musicVolume);
      this.soundBus!.gain.value = loudness(soundVolume);
    });
    // A browser's autoplay rule: the context can only start from a key, a click or a touch.
    const unlock = () => {
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    };
    for (const type of ['keydown', 'pointerdown', 'touchstart', 'touchend', 'click']) window.addEventListener(type, unlock, true);
    if (PLATFORM !== 'native') {
      this.job = this.synthesize(context);
      return;
    }
    void this.loadRendered(context).then((loaded) => {
      if (!loaded) {
        this.job = this.synthesize(context);
        return;
      }
      this.ready.set(true);
      this.loadFiles();
    });
  }

  /**
   * Synthesizes the interface's sounds and the menu theme for up to `budgetMs`, from the loading
   * screen's frames (the console's timers are too slow to spread it out with). True once done.
   */
  prepare(budgetMs: number): boolean {
    const job = this.job;
    if (this.ready()) return true;
    if (!job) return false; // The native .nro's pieces, still being read.
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
    const started = performance.now();
    const until = started + BACKGROUND_SLICE_MS;
    while (performance.now() < until) {
      if (job.next().done) {
        this.job = null;
        break;
      }
    }
    this.diagnostics.record('audio', performance.now() - started);
    if (!this.job) return;
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
    if (!buffer) return;
    this.playBuffer(buffer);
    if (DUCKING_SOUNDS.has(id)) this.duck(Math.min(buffer.duration, DUCK_HOLD_S));
  }

  /** Lowers the music under a sound `seconds` long, so it stands out, then brings it back. */
  private duck(seconds: number): void {
    const context = this.context;
    const gain = this.duckBus?.gain;
    if (!context || !gain || context.state !== 'running') return;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(DUCK_LEVEL, now + 0.03);
    gain.setValueAtTime(DUCK_LEVEL, now + 0.03 + seconds);
    gain.linearRampToValueAtTime(1, now + 0.03 + seconds + DUCK_RELEASE_S);
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
    source.loop = !track.once;
    if (track.loopEnd && !track.once) {
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

  /** Decodes audio bytes (the console's engine may answer through the callbacks, the promise, or both), or reads raw audio. */
  decode(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
    const context = this.context;
    if (!context) return Promise.resolve(null);
    const raw = decodeRawAudio(bytes);
    if (raw) return Promise.resolve(this.rawBuffer(context, raw));
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

  /** `first` then `second` (both mono, as `reduce` keeps them) in one buffer; null where their rates differ (or there's no Web Audio). */
  join(first: AudioBuffer, second: AudioBuffer): AudioBuffer | null {
    const context = this.context;
    if (!context || first.sampleRate !== second.sampleRate) return null;
    const joined = context.createBuffer(1, first.length + second.length, first.sampleRate);
    const out = joined.getChannelData(0);
    out.set(first.getChannelData(0));
    out.set(second.getChannelData(0), first.length);
    return joined;
  }

  /**
   * A copy of `buffer` in mono, at its rate divided down to about `rate`, and only its first `seconds`:
   * long music kept decoded takes a quarter of the memory or less. Mono at its own rate where the
   * engine refuses the lower one; the buffer itself where there's no Web Audio.
   */
  reduce(buffer: AudioBuffer, rate: number, seconds = buffer.duration): AudioBuffer {
    const context = this.context;
    if (!context) return buffer;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const kept = Math.min(buffer.length, Math.ceil(seconds * buffer.sampleRate));
    for (const step of new Set([Math.max(1, Math.round(buffer.sampleRate / rate)), 1])) {
      let reduced: AudioBuffer;
      try {
        reduced = context.createBuffer(1, Math.floor(kept / step), buffer.sampleRate / step);
      } catch {
        continue;
      }
      const out = reduced.getChannelData(0);
      // Already mono at the rate kept (the native .nro's engine decodes the bundled tracks as they are):
      // a straight copy. The loop below took about a second per track on the console's main thread.
      if (step === 1 && channels.length === 1) {
        out.set(channels[0].subarray(0, out.length));
        return reduced;
      }
      // Each sample, the average of the `step` samples of every channel it stands for.
      const scale = 1 / (step * channels.length);
      for (let i = 0; i < out.length; i++) {
        let sum = 0;
        for (const channel of channels) for (let j = i * step; j < (i + 1) * step; j++) sum += channel[j];
        out[i] = sum * scale;
      }
      return reduced;
    }
    return buffer;
  }

  /** The synthesis a step at a time (a sound, or a slice of a note): the sounds first, then the menu theme, then the battle themes. */
  private *synthesize(context: AudioContext): Iterator<'ready' | void> {
    const rate = context.sampleRate;
    for (const piece of SYNTH_PIECES) {
      const buffer = context.createBuffer(1, Math.ceil(pieceSeconds(piece) * rate), rate);
      yield* renderPiece(piece, buffer.getChannelData(0), rate);
      this.keep(piece, buffer);
      yield piece === 'menu' ? 'ready' : undefined;
    }
  }

  /**
   * The native .nro's pieces, synthesized by its build (raw-audio): read, not synthesized, which
   * took seconds of the console's CPU while loading. False if any is missing (then they're synthesized).
   */
  private async loadRendered(context: AudioContext): Promise<boolean> {
    const pieces = await Promise.all(
      SYNTH_PIECES.map(async (piece) => {
        const response = await fetch(`${RENDERED_AUDIO_DIR}${piece}.pcm`);
        const raw = response.ok ? decodeRawAudio(await response.arrayBuffer()) : null;
        return raw && ([piece, raw] as const);
      }),
    ).catch(() => []);
    if (pieces.length !== SYNTH_PIECES.length || pieces.some((piece) => !piece)) return false;
    for (const piece of pieces) {
      const [id, raw] = piece!;
      this.keep(id, this.rawBuffer(context, raw));
    }
    return true;
  }

  /** Raw audio in an AudioBuffer, copied in one call. */
  private rawBuffer(context: AudioContext, raw: { samples: Float32Array; rate: number }): AudioBuffer {
    const buffer = context.createBuffer(1, raw.samples.length, raw.rate);
    buffer.getChannelData(0).set(raw.samples);
    return buffer;
  }

  /** A piece synthesized (or read): where the app finds it. */
  private keep(piece: SynthPiece, buffer: AudioBuffer): void {
    if (piece === 'menu') this.menuTheme = { id: 'menu', buffer };
    else if ((BATTLE_THEMES as readonly string[]).includes(piece)) {
      const track = { id: piece, buffer };
      this.battleThemes.set(piece as BattleTheme, track);
      if (this.wantedTheme === piece) this.playMusic(track);
    } else this.sounds.set(piece as SoundId, buffer);
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
