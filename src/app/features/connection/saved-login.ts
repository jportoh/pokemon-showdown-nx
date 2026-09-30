import { Service, inject, signal } from '@angular/core';
import { canStorePrivately, readJson, readPrivateJson, removePrivate, writeJson, writePrivateJson } from '@core/persistence/device-storage';
import { AppSettings } from '@core/settings/app-settings';

/** A registered name and its password, saved for logging in when the app starts. */
export interface SavedCredentials {
  name: string;
  password: string;
}

const NAME_KEY = 'psb.login-name.v1';
/** Only ever in the app's file on the SD card (see writePrivateJson). */
const CREDENTIALS_KEY = 'psb.login.v1';

/**
 * What Settings lets the app keep of a login: the name, for the login box ("Remember my name"), and
 * a registered name's password, to log in when the app starts ("Log in automatically"). The password
 * is written only to the app's file on the SD card, only while that setting is on, and deleted when
 * it's turned off.
 */
@Service()
export class SavedLogin {
  private readonly settings = inject(AppSettings);
  private readonly nameSignal = signal(this.settings.settings().rememberName ? readJson(NAME_KEY, '') : '');
  private readonly savedForSignal = signal(this.settings.settings().autoLogin ? (readPrivateJson<SavedCredentials | null>(CREDENTIALS_KEY, null)?.name ?? '') : '');

  /** The name the login box starts with (empty unless it's remembered). */
  readonly name = this.nameSignal.asReadonly();
  /** The registered name whose password is saved, if any. */
  readonly savedFor = this.savedForSignal.asReadonly();
  /** Passwords can be saved only on the console (in a file on its SD card). */
  readonly canSavePassword = canStorePrivately();

  /** What to log in with when the app starts, if the player asked for it. */
  credentials(): SavedCredentials | null {
    if (!this.settings.settings().autoLogin) return null;
    const saved = readPrivateJson<SavedCredentials | null>(CREDENTIALS_KEY, null);
    return saved && typeof saved.name === 'string' && saved.name && typeof saved.password === 'string' && saved.password ? saved : null;
  }

  /** Logged in to the player's own name (a registered one has its password): kept as the settings say. */
  loggedIn(name: string, password: string): void {
    const { rememberName, autoLogin } = this.settings.settings();
    if (rememberName) {
      writeJson(NAME_KEY, name);
      this.nameSignal.set(name);
    }
    if (autoLogin && password && writePrivateJson(CREDENTIALS_KEY, { name, password } satisfies SavedCredentials)) {
      this.savedForSignal.set(name);
    }
  }

  setRememberName(on: boolean): void {
    this.settings.set('rememberName', on);
    if (on) return;
    writeJson(NAME_KEY, '');
    this.nameSignal.set('');
    // Logging in by itself needs the name.
    this.setAutoLogin(false);
  }

  /** On, the current login (if it's a registered one) is saved at once: `current` is what it was made with. */
  setAutoLogin(on: boolean, current: SavedCredentials | null = null): void {
    if (on && !this.canSavePassword) return;
    this.settings.set('autoLogin', on);
    if (!on) {
      removePrivate(CREDENTIALS_KEY);
      this.savedForSignal.set('');
      return;
    }
    this.settings.set('rememberName', true);
    if (current) this.loggedIn(current.name, current.password);
  }
}
