import { Service, inject } from '@angular/core';
import { AudioEngine } from '@core/audio/audio-engine';

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
 * let go when the battle closes. The menu theme plays until it's ready.
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

  /** Starts downloading every track (once). */
  prefetch(): void {
    for (const track of TRACKS) this.download(track);
  }

  /** A battle opened: its track replaces the menu theme once decoded. */
  async start(): Promise<void> {
    const battle = ++this.battle;
    const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    const bytes = await this.download(track);
    // decodeAudioData takes the bytes over: a copy keeps the download for the next battle.
    const buffer = bytes && battle === this.battle ? await this.audio.decode(bytes.slice(0)) : null;
    if (!buffer || battle !== this.battle) return;
    this.audio.playMusic({ id: `battle-${battle}`, buffer, loopStart: track.loopStart / 1000, loopEnd: track.loopEnd / 1000 });
  }

  /** One of our battles ended: the victory or the defeat theme, in place of its music (or of one still decoding). */
  end(won: boolean): void {
    this.battle++;
    this.audio.playResultTheme(won ? 'victory' : 'defeat');
  }

  /** The battle closed: back to the menu theme. */
  stop(): void {
    this.battle++;
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
