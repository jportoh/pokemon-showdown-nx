import { Service, inject, signal } from '@angular/core';
import { AudioEngine, MusicTrack } from '@core/audio/audio-engine';
import { OFFICIAL_BATTLE_TRACKS } from '@core/audio/official-music';
import { Soundtrack } from '@core/audio/soundtrack';

interface BattleTrack {
  url: string;
  /** Where the loop starts and ends, in ms: the intro plays once (Showdown's own client's values). */
  loopStart: number;
  loopEnd: number;
}

/**
 * The battle music, bundled, mono, 24 kHz, cut just past the loop's end: Showdown's tracks
 * (public/audio/battle, made by scripts/update-battle-music.mjs) and the official ones that aren't
 * Showdown's (public/audio/music, made by scripts/update-soundtracks.mjs). One is picked at random for
 * each battle.
 */
const TRACKS: readonly BattleTrack[] = [
  { url: 'audio/battle/hgss-johto-trainer.ogg', loopStart: 23731, loopEnd: 125086 },
  { url: 'audio/battle/bw-trainer.ogg', loopStart: 14629, loopEnd: 110109 },
  { url: 'audio/battle/xy-trainer.ogg', loopStart: 7802, loopEnd: 82469 },
  { url: 'audio/battle/sm-trainer.ogg', loopStart: 8323, loopEnd: 89230 },
  ...OFFICIAL_BATTLE_TRACKS.map(({ url, loopStart, loopEnd }) => ({ url, loopStart: loopStart * 1000, loopEnd: loopEnd * 1000 })),
];

/** The tracks are kept decoded in mono at about this rate: ~12 MB each in place of ~45 MB. */
const KEPT_RATE = 24000;
/** Kept past the loop's end, so the loop never runs into the buffer's end. */
const TAIL_S = 0.1;
/** Tracks the preload decodes at once: two took ~4 s off the loading screen's ~20 (test-m4). */
const PRELOAD_DECODES = 2;

/**
 * The music of battles (played, watched live or replayed). Every track is decoded while the loading
 * screen shows (preload), where a stutter costs nothing, and kept decoded (in mono at KEPT_RATE: ~10 MB
 * a track, as the output decodes them at its own rate), so a battle's music starts with no work
 * at all. A battle picks among the tracks ready; one the preload missed (the loading screen gave up
 * waiting) is loaded when a battle needs it: at the search or the challenge (prepareNext), or as the
 * battle opens. The music before it is ready stays (the menus', or team preview's). Team preview
 * has music of its own, and every battle ends on the victory or the defeat music (watched ones on
 * the victory's): the soundtrack's (Soundtrack), whose menu music comes back as the battle closes.
 */
@Service()
export class BattleMusic {
  private readonly audio = inject(AudioEngine);
  private readonly soundtrack = inject(Soundtrack);

  /** Each track's reading and decoding, by URL (null if it failed: tried again next time). */
  private readonly loads = new Map<string, Promise<AudioBuffer | null>>();
  /** The tracks decoded, by URL. */
  private readonly ready = new Map<string, AudioBuffer>();
  private preloading = false;
  /** Changes with every battle and when it closes, so a late decode for an older one is dropped. */
  private battle = 0;
  /** Where the battle is: its track plays only during the battle itself, once decoded. */
  private phase: 'preview' | 'battle' | 'over' = 'battle';
  private track: MusicTrack | null = null;
  /** The next battle's track, picked (and loading, if it wasn't ready) since its search or challenge. */
  private next: BattleTrack | null = null;

  /** How many tracks the preload is done with, loaded or failed (the loading screen's bar). */
  readonly preloaded = signal(0);
  readonly trackCount = TRACKS.length;
  /** When (performance.now) each track's preload read and decode finished, for the diagnostics. */
  readonly preloadTimes = TRACKS.map(() => ({ downloaded: 0, decoded: 0 }));
  /** How the preload decodes, for the diagnostics. */
  readonly preloadMode = `bundled, ${PRELOAD_DECODES} at once`;

  /**
   * Every track, from the loading screen: the files all at once, PRELOAD_DECODES decodes at a time
   * (Showdown's own mp3s took 2–3.5 s each on the console, test-m2; a decoded track takes ~25 MB until
   * reduced).
   */
  preload(): void {
    if (this.preloading) return;
    this.preloading = true;
    const downloads = TRACKS.map((track, i) =>
      download(track.url).then((bytes) => {
        this.preloadTimes[i].downloaded = performance.now();
        return bytes;
      }),
    );
    let next = 0;
    const decodeNext = async (): Promise<void> => {
      for (let i = next++; i < TRACKS.length; i = next++) {
        await this.load(TRACKS[i], downloads[i]);
        this.preloadTimes[i].decoded = performance.now();
        this.preloaded.update((count) => count + 1);
      }
    };
    for (let i = 0; i < PRELOAD_DECODES; i++) void decodeNext();
  }

  /**
   * Picks the next battle's track when a search starts or a challenge is sent or accepted, while the
   * player waits: a ready one, or else one loaded now (the preload missed them all).
   */
  prepareNext(): void {
    this.next ??= this.pick();
    void this.load(this.next);
  }

  /** A battle opened: its track plays once the battle itself is on (at once, if it's ready). */
  async start(): Promise<void> {
    const battle = ++this.battle;
    this.phase = 'battle';
    this.track = null;
    this.soundtrack.leave();
    // The track picked for it, unless it isn't ready and another is (the preload finished since).
    const next = this.next;
    this.next = null;
    const track = next && (this.ready.has(next.url) || this.ready.size === 0) ? next : this.pick();
    const buffer = this.ready.get(track.url) ?? (await this.load(track));
    if (!buffer || battle !== this.battle) return;
    this.track = { id: `battle-${battle}`, buffer, loopStart: track.loopStart / 1000, loopEnd: track.loopEnd / 1000 };
    if (this.phase === 'battle') this.audio.playMusic(this.track);
  }

  /** Team preview: its own music (the soundtrack's) until the battle starts. */
  preview(): void {
    if (this.phase === 'over') return;
    this.phase = 'preview';
    this.soundtrack.leave();
    this.soundtrack.playTheme('preview');
  }

  /** The battle starts (after team preview): its track, as soon as it's decoded. */
  begin(): void {
    if (this.phase !== 'preview') return;
    this.phase = 'battle';
    if (this.track) this.audio.playMusic(this.track);
  }

  /** The battle ended (in team preview too): the soundtrack's victory or defeat music, in place of its music. */
  end(won: boolean): void {
    this.battle++;
    this.phase = 'over';
    this.track = null;
    this.soundtrack.playTheme(won ? 'victory' : 'defeat');
    this.soundtrack.prepareNext();
  }

  /** The battle closed: back to the menus' music, the soundtrack's next track. */
  stop(): void {
    this.battle++;
    this.phase = 'battle';
    this.track = null;
    this.soundtrack.playMenu(true);
  }

  /** A track at random, among the ready ones if any is. */
  private pick(): BattleTrack {
    const ready = TRACKS.filter((track) => this.ready.has(track.url));
    const from = ready.length > 0 ? ready : TRACKS;
    return from[Math.floor(Math.random() * from.length)];
  }

  /** Reads (unless `bytes` are on their way) and decodes a track, once, and keeps it reduced. */
  private load(track: BattleTrack, bytes?: Promise<ArrayBuffer | null>): Promise<AudioBuffer | null> {
    let loading = this.loads.get(track.url);
    if (!loading) {
      loading = (bytes ?? download(track.url))
        .then((file) => (file ? this.audio.decode(file) : null))
        .then((buffer) => buffer && this.audio.reduce(buffer, KEPT_RATE, track.loopEnd / 1000 + TAIL_S));
      void loading.then((buffer) => (buffer ? this.ready.set(track.url, buffer) : this.loads.delete(track.url)));
      this.loads.set(track.url, loading);
    }
    return loading;
  }
}

function download(url: string): Promise<ArrayBuffer | null> {
  return fetch(url)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .catch(() => null);
}
