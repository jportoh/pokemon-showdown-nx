import { Service, signal } from '@angular/core';
import { readJson, writeJson } from '@core/persistence/device-storage';
import { PLAYABLE_FORMATS, TEAM_FORMATS } from '@shared/data/formats';

export type ThemeId = 'zafiro' | 'noche' | 'ciruela' | 'esmeralda' | 'pokeball' | 'ocaso';

export interface Theme {
  id: ThemeId;
  name: string;
}

/** The colour themes, in the order Settings steps through them. Their colours are in GlTheme. */
export const THEMES: readonly Theme[] = [
  { id: 'zafiro', name: 'Sapphire' },
  { id: 'noche', name: 'Night' },
  { id: 'ciruela', name: 'Plum' },
  { id: 'esmeralda', name: 'Emerald' },
  { id: 'pokeball', name: 'Poké Ball' },
  { id: 'ocaso', name: 'Sunset' },
];

export interface Settings {
  theme: ThemeId;
  /** The format the Battle page starts on. */
  battleFormat: string;
  /** The format new teams are built for. */
  teamFormat: string;
  /** Others may watch our battles; off makes each one invite-only. */
  allowSpectators: boolean;
  /** The login box starts with the name last logged in with. */
  rememberName: boolean;
  /** The app logs in to the saved registered name when it starts (its password saved on the SD card). */
  autoLogin: boolean;
}

const STORAGE_KEY = 'psb.settings.v1';

const DEFAULTS: Settings = {
  theme: 'zafiro',
  battleFormat: PLAYABLE_FORMATS[0].id,
  teamFormat: TEAM_FORMATS[0].id,
  allowSpectators: true,
  rememberName: false,
  autoLogin: false,
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
  return {
    theme: THEMES.some((theme) => theme.id === settings.theme) ? settings.theme : DEFAULTS.theme,
    battleFormat: PLAYABLE_FORMATS.some((format) => format.id === settings.battleFormat) ? settings.battleFormat : DEFAULTS.battleFormat,
    teamFormat: TEAM_FORMATS.some((format) => format.id === settings.teamFormat) ? settings.teamFormat : DEFAULTS.teamFormat,
    allowSpectators: settings.allowSpectators !== false,
    rememberName: settings.rememberName === true,
    autoLogin: settings.autoLogin === true,
  };
}
