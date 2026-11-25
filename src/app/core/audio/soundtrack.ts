import { Service, effect, inject, signal, untracked } from '@angular/core';
import { AudioEngine, MusicTrack } from '@core/audio/audio-engine';
import { BattleTheme } from '@core/audio/battle-themes';
import { OFFICIAL_SOUNDTRACKS, OfficialSoundtrack, OfficialSoundtrackId, OfficialTrack } from '@core/audio/official-music';
import { AppSettings, SoundtrackId } from '@core/settings/app-settings';

/** The tracks are kept decoded in mono at about this rate (as the files are made, and as the battle music is kept). */
const KEPT_RATE = 24000;
/** Kept past the loop's end (the files repeat the loop's start there), so the loop never runs into the buffer's end. */
const TAIL_S = 0.1;

/** Where the music is: the title screen (before START), the menus, or a battle (BattleMusic's, with team preview's and the end's from here). */
type Place = 'title' | 'menus' | 'battle';

/**
 * The soundtrack Settings picks (Sound > Soundtrack): the music of the title screen, the menus, team
 * preview and a battle's end (won or lost). Custom is the app's own themes (synthesized: AudioEngine);
 * the others are official tracks from the games, bundled (public/audio/music, made by
 * scripts/update-soundtracks.mjs), with the app's own theme wherever one has no track. The menus'
 * tracks take turns: a random one first, the next each time a battle closes, decoded while the
 * battle's end shows. An end that's a jingle (`once`) goes on into the menus' next track, which keeps
 * playing as the battle closes.
 *
 * Kept decoded: the title screen's track until START, the menu track playing (and the next), team
 * preview's and the end's (~10 MB a minute and a half). The loading screen decodes them (preload),
 * then plays the title screen's (playTitle), and START the menus' (playMenu). Battles take the music
 * (BattleMusic): leave() as one opens, playTheme() for team preview and the end, playMenu() as it
 * closes. A track still decoding plays once it's ready if the music is still where it was asked for
 * (what played before stays meanwhile); team preview's or the end's not ready yet: the app's own
 * theme, that once.
 */
@Service()
export class Soundtrack {
  private readonly audio = inject(AudioEngine);
  private readonly settings = inject(AppSettings);

  /** Each soundtrack's menu track to play: its index, random until it first plays. */
  private readonly turns = new Map<OfficialSoundtrackId, number>();
  /** Each track's reading and decoding, by URL (null if it failed: tried again next time). */
  private readonly loads = new Map<string, Promise<AudioBuffer | null>>();
  /** The tracks decoded, by URL. */
  private readonly ready = new Map<string, AudioBuffer>();
  private place: Place | null = null;
  private id: SoundtrackId = this.settings.settings().soundtrack;

  /** The official menu track playing (or about to): null with the app's own theme. */
  readonly current = signal<OfficialTrack | null>(null);
  /** The loading screen's tracks are decoded (or failed, or there are none to wait for). */
  readonly preloaded = signal(false);

  constructor() {
    // A soundtrack picked in Settings plays at once; its team preview and end tracks decode meanwhile.
    effect(() => {
      const id = this.settings.settings().soundtrack;
      if (id === this.id) return;
      this.id = id;
      untracked(() => {
        if (this.place === 'menus') this.playMenu();
        else if (this.place === 'title') this.playTitle();
        else this.keep([this.menuTrack()]);
        for (const track of this.themes()) void this.load(track);
      });
    });
  }

  /** From the loading screen: the soundtrack's title screen, first menu, team preview and end tracks, decoded while it shows. */
  preload(): void {
    const tracks = [this.music()?.titleScreen, this.menuTrack(), ...this.themes()].filter((track) => !!track);
    void Promise.all(tracks.map((track) => this.load(track))).then(() => this.preloaded.set(true));
  }

  /** The title screen's music, once the loading is done (the app's own menu theme for Custom). */
  playTitle(): void {
    this.place = 'title';
    this.play(this.music()?.titleScreen ?? null, 'title');
  }

  /** The menus' music: from START, and when a battle closes (`next`: the soundtrack's next menu track). */
  playMenu(next = false): void {
    this.place = 'menus';
    const id = this.id;
    if (next && id !== 'custom') this.turns.set(id, this.turn(id) + 1);
    const track = this.menuTrack();
    this.current.set(track);
    this.keep([track]);
    this.play(track, 'menus');
  }

  /** A battle takes the music: a track still decoding won't play over it. */
  leave(): void {
    this.place = 'battle';
  }

  /** Team preview's music, or a battle's end (won or lost): the soundtrack's track if it's decoded, else the app's own theme. */
  playTheme(theme: BattleTheme): void {
    const music = this.music();
    const track = music && music[theme];
    const buffer = track && this.ready.get(track.url);
    if (!track || !buffer) {
      this.audio.playBattleTheme(theme);
      if (track) void this.load(track);
      return;
    }
    if (!track.once) {
      this.audio.playMusic(musicTrack(track, buffer));
      return;
    }
    // A jingle: then the menu track the menus will play (the next, or this one while the next decodes),
    // in one buffer, under that track's name, so it keeps playing as the battle closes.
    const then = [this.menuTrack(1), this.menuTrack()].find((menu) => menu && this.ready.has(menu.url));
    const joined = then && this.audio.join(buffer, this.ready.get(then.url)!);
    if (!then || !joined) {
      this.audio.playMusic({ ...musicTrack(track, buffer), once: true });
      return;
    }
    this.audio.playMusic({ id: `music:${then.url}`, buffer: joined, loopStart: buffer.duration + then.loopStart, loopEnd: buffer.duration + then.loopEnd });
  }

  /** A battle ended: the soundtrack's next menu track decodes now (the end hides the stutter), for when the menus come back. */
  prepareNext(): void {
    const id = this.id;
    if (id === 'custom' || OFFICIAL_SOUNDTRACKS[id].menu.length < 2) return;
    const next = this.menuTrack(1);
    this.keep([this.current(), next]);
    if (next) void this.load(next);
  }

  /** Plays `track` once it's decoded, if the music is still at `place`; the app's own menu theme for none (or one that won't load). */
  private play(track: OfficialTrack | null, place: Place): void {
    if (!track) {
      this.audio.playMenuTheme();
      return;
    }
    void this.load(track).then((buffer) => {
      if (this.place !== place || (place === 'menus' && this.current() !== track)) return;
      if (buffer) this.audio.playMusic(musicTrack(track, buffer));
      else this.audio.playMenuTheme();
    });
  }

  private music(): OfficialSoundtrack | null {
    return this.id === 'custom' ? null : OFFICIAL_SOUNDTRACKS[this.id];
  }

  /** The soundtrack's team preview and end tracks, the ones it has. */
  private themes(): OfficialTrack[] {
    const music = this.music();
    return [music?.preview, music?.victory, music?.defeat].filter((track) => !!track);
  }

  /** The soundtrack's menu track to play, `ahead` turns on; null for the app's own theme. */
  private menuTrack(ahead = 0): OfficialTrack | null {
    const id = this.id;
    if (id === 'custom') return null;
    const tracks = OFFICIAL_SOUNDTRACKS[id].menu;
    return tracks.length ? tracks[(this.turn(id) + ahead) % tracks.length] : null;
  }

  private turn(id: OfficialSoundtrackId): number {
    let turn = this.turns.get(id);
    if (turn === undefined) {
      turn = Math.floor(Math.random() * Math.max(1, OFFICIAL_SOUNDTRACKS[id].menu.length));
      this.turns.set(id, turn);
    }
    return turn;
  }

  /** Lets go of every decoded track but these menu tracks, the soundtrack's team preview and end ones, and the title screen's while it shows. */
  private keep(menu: readonly (OfficialTrack | null)[]): void {
    const title = this.place === 'title' ? this.music()?.titleScreen : null;
    const kept = new Set([...menu, ...this.themes(), title].map((track) => track?.url));
    for (const url of [...this.loads.keys()]) {
      if (kept.has(url)) continue;
      this.loads.delete(url);
      this.ready.delete(url);
    }
  }

  /** Reads and decodes a track, once, and keeps it reduced. */
  private load(track: OfficialTrack): Promise<AudioBuffer | null> {
    let loading = this.loads.get(track.url);
    if (!loading) {
      const seconds = track.once ? Infinity : track.loopEnd + TAIL_S;
      const promise = this.audio.load(track.url).then((buffer) => buffer && this.audio.reduce(buffer, KEPT_RATE, Math.min(seconds, buffer.duration)));
      loading = promise;
      void promise.then((buffer) => {
        // Unless it was let go of meanwhile.
        if (this.loads.get(track.url) !== promise) return;
        if (buffer) this.ready.set(track.url, buffer);
        else this.loads.delete(track.url);
      });
      this.loads.set(track.url, promise);
    }
    return loading;
  }
}

function musicTrack(track: OfficialTrack, buffer: AudioBuffer): MusicTrack {
  return { id: `music:${track.url}`, buffer, loopStart: track.loopStart, loopEnd: track.loopEnd };
}
