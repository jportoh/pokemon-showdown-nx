import { Service, inject } from '@angular/core';
import { AudioEngine, MusicTrack } from '@core/audio/audio-engine';

interface BattleTrack {
  url: string;
  /** Where the loop starts and ends, in ms: the intro plays once (Showdown's own client's values). */
  loopStart: number;
  loopEnd: number;
}

const AUDIO_URL = 'https://play.pokemonshowdown.com/audio';

/** The battle music, from Showdown's server (allow-listed): one picked at random for each battle. */
const TRACKS: readonly BattleTrack[] = [
  { url: `${AUDIO_URL}/hgss-johto-trainer.mp3`, loopStart: 23731, loopEnd: 125086 },
  { url: `${AUDIO_URL}/bw-trainer.mp3`, loopStart: 14629, loopEnd: 110109 },
  { url: `${AUDIO_URL}/xy-trainer.mp3`, loopStart: 7802, loopEnd: 82469 },
  { url: `${AUDIO_URL}/sm-trainer.mp3`, loopStart: 8323, loopEnd: 89230 },
];

/**
 * The music of battles (played, watched live or replayed). The tracks' mp3 files (2–3 MB each) are
 * downloaded once, in the background after the loading screen (prefetch), and kept as they come; only
 * the battle's own is decoded (~1.2 s on the console, probe S1), as decoded it takes ~45 MB, and it's
 * let go when the battle closes. The music before it is ready stays (the menu theme, or team
 * preview's). Team preview has a theme of its own, and every battle ends on the victory or the defeat
 * theme (watched ones on the victory's).
 *
 * Showdown's server sends no CORS headers for audio, so in a browser the downloads fail and battles
 * keep the menu theme; the console's engine doesn't enforce CORS.
 */
@Service()
export class BattleMusic {
  private readonly audio = inject(AudioEngine);

  /** Each track's download, by URL (its bytes, or null if it failed). */
  private readonly files = new Map<string, Promise<ArrayBuffer | null>>();
  /** Changes with every battle and when it closes, so a late decode for an older one is dropped. */
  private battle = 0;
  /** Where the battle is: its track plays only during the battle itself, once decoded. */
  private phase: 'preview' | 'battle' | 'over' = 'battle';
  private track: MusicTrack | null = null;

  /** Starts downloading every track (once). */
  prefetch(): void {
    for (const track of TRACKS) this.download(track);
  }

  /** A battle opened: its track is decoded, to play once the battle itself is on. */
  async start(): Promise<void> {
    const battle = ++this.battle;
    this.phase = 'battle';
    this.track = null;
    const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    const bytes = await this.download(track);
    // decodeAudioData takes the bytes over: a copy keeps the download for the next battle.
    const buffer = bytes && battle === this.battle ? await this.audio.decode(bytes.slice(0)) : null;
    if (!buffer || battle !== this.battle) return;
    this.track = { id: `battle-${battle}`, buffer, loopStart: track.loopStart / 1000, loopEnd: track.loopEnd / 1000 };
    if (this.phase === 'battle') this.audio.playMusic(this.track);
  }

  /** Team preview: its own theme until the battle starts. */
  preview(): void {
    if (this.phase === 'over') return;
    this.phase = 'preview';
    this.audio.playBattleTheme('preview');
  }

  /** The battle starts (after team preview): its track, as soon as it's decoded. */
  begin(): void {
    if (this.phase !== 'preview') return;
    this.phase = 'battle';
    if (this.track) this.audio.playMusic(this.track);
  }

  /** The battle ended (in team preview too): the victory or the defeat theme, in place of its music. */
  end(won: boolean): void {
    this.battle++;
    this.phase = 'over';
    this.track = null;
    this.audio.playBattleTheme(won ? 'victory' : 'defeat');
  }

  /** The battle closed: back to the menu theme. */
  stop(): void {
    this.battle++;
    this.phase = 'battle';
    this.track = null;
    this.audio.playMenuTheme();
  }

  private download(track: BattleTrack): Promise<ArrayBuffer | null> {
    let file = this.files.get(track.url);
    if (!file) {
      file = fetch(track.url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null);
      // A failed download is tried again next battle.
      void file.then((bytes) => bytes || this.files.delete(track.url));
      this.files.set(track.url, file);
    }
    return file;
  }
}
