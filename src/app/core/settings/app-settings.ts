import { Service, signal } from '@angular/core';
import { OFFICIAL_SOUNDTRACKS, OfficialSoundtrackId } from '@core/audio/official-music';
import { readJson, writeJson } from '@core/persistence/device-storage';
import { BATTLEFIELD_CHOICES, BattlefieldChoice } from '@shared/data/battlefields';
import { TEAM_FORMATS, TEAM_PLAY_FORMATS } from '@shared/data/formats';
import type { Appearance, ThemeId } from '@core/gl/ui/palettes';

/** The themes (palettes.ts) and the appearances: light (the default) or dark colours, each theme has both. */
export type { Appearance, ThemeId };

/** The appearances, in the order Settings steps through them. */
export const APPEARANCES: readonly { id: Appearance; name: string }[] = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
];

export interface Theme {
  id: ThemeId;
  name: string;
}

/** The colour themes, in the order Settings steps through them. Their colours are in GlTheme. */
export const THEMES: readonly Theme[] = [
  { id: 'zafiro', name: 'Sapphire' },
  { id: 'noche', name: 'Night' },
  { id: 'grafito', name: 'Graphite' },
  { id: 'esmeralda', name: 'Emerald' },
  { id: 'pokeball', name: 'Poké Ball' },
  { id: 'ocaso', name: 'Sunset' },
];

/** The soundtrack (the menus', team preview's and a battle's end music): the app's own themes, or official tracks from the games (official-music.ts). */
export type SoundtrackId = 'custom' | OfficialSoundtrackId;

/** The soundtracks Settings steps through: the app's own, and each official one that has a menu track. Soundtrack plays them. */
export const SOUNDTRACKS: readonly { id: SoundtrackId; name: string }[] = (
  [
    { id: 'custom', name: 'Custom' },
    { id: 'champions', name: 'Champions' },
    { id: 'classic', name: 'Classic' },
  ] as const
).filter((soundtrack) => soundtrack.id === 'custom' || OFFICIAL_SOUNDTRACKS[soundtrack.id].menu.length > 0);

export interface Settings {
  theme: ThemeId;
  appearance: Appearance;
  /** Where battles are fought: a field picked for each battle, or always the same one. */
  battlefield: BattlefieldChoice;
  /** The format the Battle page starts on. */
  battleFormat: string;
  /** The format new teams are built for. */
  teamFormat: string;
  /** Others may watch our battles; off makes each one invite-only. */
  allowSpectators: boolean;
  /** Each battle we play is saved to Showdown's replay server as it ends (the battle history lists them). */
  saveReplays: boolean;
  /** The login box starts with the name last logged in with. */
  rememberName: boolean;
  /** The app logs in to the saved registered name when it starts (its password saved on the SD card). */
  autoLogin: boolean;
  /** The music of the menus, team preview and a battle's end (battles pick among every battle track). */
  soundtrack: SoundtrackId;
  /** Music volume, 0 (off) to 100, in VOLUME_STEP steps. */
  musicVolume: number;
  /** Sound effects' and cries' volume, 0 (off) to 100, in VOLUME_STEP steps. */
  soundVolume: number;
}

/** The volumes Settings steps through: off, 10 %, 20 % … 100 %. */
export const VOLUME_STEP = 10;

/** Its file on the console (device-storage); the update gate reads the theme from it too (native/loader/gate-screen.ts). */
const STORAGE_KEY = 'psb.settings.v1';

const DEFAULTS: Settings = {
  theme: 'zafiro',
  appearance: 'light',
  battlefield: 'random',
  battleFormat: TEAM_PLAY_FORMATS[0].id,
  teamFormat: TEAM_FORMATS[0].id,
  allowSpectators: true,
  saveReplays: true,
  rememberName: false,
  autoLogin: false,
  soundtrack: 'custom',
  musicVolume: 60,
  soundVolume: 80,
};

/** The player's settings, kept on the device. The screens read the theme's palette from GlTheme. */
@Service()
export class AppSettings {
  private readonly settingsSignal = signal<Settings>(loadSettings());

  readonly settings = this.settingsSignal.asReadonly();

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.settingsSignal()[key] === value) return;
    this.settingsSignal.update((settings) => ({ ...settings, [key]: value }));
    writeJson(STORAGE_KEY, this.settingsSignal());
  }
}

/** Stored settings over the defaults; values the app no longer offers go back to theirs. */
function loadSettings(): Settings {
  const stored = readJson<Partial<Settings> | null>(STORAGE_KEY, null);
  if (!stored || typeof stored !== 'object') return DEFAULTS;
  const settings = { ...DEFAULTS, ...stored };
  // Plum became Graphite (a neutral theme), in the same place in the list.
  if ((settings.theme as string) === 'ciruela') settings.theme = 'grafito';
  return {
    theme: THEMES.some((theme) => theme.id === settings.theme) ? settings.theme : DEFAULTS.theme,
    appearance: APPEARANCES.some((appearance) => appearance.id === settings.appearance) ? settings.appearance : DEFAULTS.appearance,
    battlefield: BATTLEFIELD_CHOICES.some((field) => field.id === settings.battlefield) ? settings.battlefield : DEFAULTS.battlefield,
    // The Battle page's: a random format saved before they had their own page goes back to the default.
    battleFormat: TEAM_PLAY_FORMATS.some((format) => format.id === settings.battleFormat) ? settings.battleFormat : DEFAULTS.battleFormat,
    teamFormat: TEAM_FORMATS.some((format) => format.id === settings.teamFormat) ? settings.teamFormat : DEFAULTS.teamFormat,
    allowSpectators: settings.allowSpectators !== false,
    saveReplays: settings.saveReplays !== false,
    rememberName: settings.rememberName === true,
    autoLogin: settings.autoLogin === true,
    soundtrack: SOUNDTRACKS.some((soundtrack) => soundtrack.id === settings.soundtrack) ? settings.soundtrack : DEFAULTS.soundtrack,
    musicVolume: validVolume(settings.musicVolume, DEFAULTS.musicVolume),
    soundVolume: validVolume(settings.soundVolume, DEFAULTS.soundVolume),
  };
}

/** A stored volume on the VOLUME_STEP grid, or the default when it isn't a number. */
function validVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value / VOLUME_STEP) * VOLUME_STEP));
}
