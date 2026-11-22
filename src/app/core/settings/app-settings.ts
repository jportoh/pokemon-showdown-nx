import { Service, signal } from '@angular/core';
import { readJson, writeJson } from '@core/persistence/device-storage';
import { PLAYABLE_FORMATS, TEAM_FORMATS } from '@shared/data/formats';

export type ThemeId = 'zafiro' | 'noche' | 'grafito' | 'esmeralda' | 'pokeball' | 'ocaso';

/** Light (the default) or dark colours: each theme has both. */
export type Appearance = 'light' | 'dark';

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

export interface Settings {
  theme: ThemeId;
  appearance: Appearance;
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
  /** Music volume, 0 (off) to 100, in VOLUME_STEP steps. */
  musicVolume: number;
  /** Sound effects' and cries' volume, 0 (off) to 100, in VOLUME_STEP steps. */
  soundVolume: number;
}

/** The volumes Settings steps through: off, 10 %, 20 % … 100 %. */
export const VOLUME_STEP = 10;

const STORAGE_KEY = 'psb.settings.v1';

const DEFAULTS: Settings = {
  theme: 'zafiro',
  appearance: 'light',
  battleFormat: PLAYABLE_FORMATS[0].id,
  teamFormat: TEAM_FORMATS[0].id,
  allowSpectators: true,
  saveReplays: true,
  rememberName: false,
  autoLogin: false,
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
    battleFormat: PLAYABLE_FORMATS.some((format) => format.id === settings.battleFormat) ? settings.battleFormat : DEFAULTS.battleFormat,
    teamFormat: TEAM_FORMATS.some((format) => format.id === settings.teamFormat) ? settings.teamFormat : DEFAULTS.teamFormat,
    allowSpectators: settings.allowSpectators !== false,
    saveReplays: settings.saveReplays !== false,
    rememberName: settings.rememberName === true,
    autoLogin: settings.autoLogin === true,
    musicVolume: validVolume(settings.musicVolume, DEFAULTS.musicVolume),
    soundVolume: validVolume(settings.soundVolume, DEFAULTS.soundVolume),
  };
}

/** A stored volume on the VOLUME_STEP grid, or the default when it isn't a number. */
function validVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value / VOLUME_STEP) * VOLUME_STEP));
}
