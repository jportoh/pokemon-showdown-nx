import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { AppSettings, THEMES } from '@core/settings/app-settings';
import { SavedLogin } from '@features/connection/saved-login';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { RetroBox } from '@shared/components/retro-box';
import { PLAYABLE_FORMATS, TEAM_FORMATS, formatLabel } from '@shared/data/formats';

type SettingId = 'theme' | 'battleFormat' | 'teamFormat' | 'allowSpectators' | 'rememberName' | 'autoLogin' | 'replays';

interface SettingRow {
  id: SettingId;
  label: string;
  detail: string;
  value: string;
  /** Cycles through values (A, left/right), switches on and off, or opens a page. */
  kind: 'cycle' | 'toggle' | 'link';
  /** A switch that's on. */
  on?: boolean;
  /** More than one value to step through (the ◀ ▶ triangles show). */
  steppable?: boolean;
  /** Can't be changed here (the reason is its detail). */
  disabled?: boolean;
}

/** The row focused when coming back from a page Settings opened (the replays). */
let returnRow: SettingId = 'theme';

/**
 * Settings: a list of rows, each with its value on the right. A changes it (the next value, or on/off),
 * and so do left/right (the adjuster, see KeyboardNavigation); the theme applies at once. The last row
 * opens the replays, whose B comes back here. Fixed 1280x644, the rows at fixed positions (Brewser).
 */
@Component({
  imports: [RetroBox],
  selector: 'app-settings-page',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px] text-retro-ink' },
  template: `
    <app-retro-box class="absolute top-[24px] left-[32px]" [width]="1216" [height]="596">
      <div role="group" aria-label="Settings" class="block">
        @for (row of rows(); track row.id; let i = $index) {
          <button
            #rowButton
            type="button"
            class="absolute left-[24px] h-[68px] w-[1162px] cursor-pointer rounded-lg border-2 border-retro-rim bg-retro-button text-left hover:bg-retro-select"
            [style.top.px]="20 + i * 78"
            [attr.data-setting]="row.id"
            [attr.data-autofocus]="row.id === autofocusRow ? '' : null"
            [attr.role]="row.kind === 'toggle' ? 'switch' : null"
            [attr.aria-checked]="row.kind === 'toggle' ? row.on : null"
            [attr.aria-disabled]="row.disabled ? true : null"
            [attr.aria-label]="row.kind === 'toggle' ? row.label : row.label + ': ' + row.value"
            [attr.aria-describedby]="'setting-' + row.id"
            (click)="activate(row)"
          >
            <span aria-hidden="true" class="absolute top-[6px] left-[22px] block h-8 w-[640px] text-2xl leading-8 font-bold" [class.text-retro-muted]="row.disabled">{{ row.label }}</span>
            <span [id]="'setting-' + row.id" class="absolute top-[38px] left-[22px] block h-6 w-[700px] truncate text-base leading-6 text-retro-muted">{{ row.detail }}</span>
            <!-- Pixel triangles: Brewser draws the ◀ ▶ glyphs as orange emoji. -->
            <span class="block" [class.hidden]="!row.steppable">
              <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[18px] left-[762px] h-7 w-4 fill-retro-muted"><path d="M3 0h1v7h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z" /></svg>
            </span>
            <span
              aria-hidden="true"
              class="absolute top-[16px] left-[794px] block h-8 w-[320px] truncate text-center text-2xl leading-8 font-bold"
              [class]="row.disabled ? 'text-retro-muted' : row.kind === 'toggle' && row.on ? 'text-retro-teal' : row.kind === 'toggle' ? 'text-retro-muted' : 'text-retro-accent-text'"
              >{{ row.value }}</span
            >
            <span class="block" [class.hidden]="!row.steppable && row.kind !== 'link'">
              <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[18px] left-[1126px] h-7 w-4 fill-retro-muted"><path d="M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" /></svg>
            </span>
          </button>
        }
      </div>
    </app-retro-box>
  `,
})
export class SettingsPage {
  private readonly router = inject(Router);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly appSettings = inject(AppSettings);
  private readonly login = inject(ShowdownLogin);
  private readonly saved = inject(SavedLogin);
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('rowButton');

  /** The row focus starts on: the replays' when coming back from them, otherwise the first. */
  protected readonly autofocusRow = returnRow;

  protected readonly rows = computed((): SettingRow[] => {
    const settings = this.appSettings.settings();
    const theme = THEMES.find((t) => t.id === settings.theme) ?? THEMES[0];
    const savedFor = this.saved.savedFor();
    const rememberedName = this.saved.name();
    return [
      {
        id: 'theme',
        label: 'Theme',
        detail: `The app's colours, ${THEMES.indexOf(theme) + 1} of ${THEMES.length}. They change as you pick them.`,
        value: theme.name,
        kind: 'cycle',
        steppable: true,
      },
      {
        id: 'battleFormat',
        label: 'Battle format',
        detail: 'The format the Battle page starts on.',
        value: formatLabel(settings.battleFormat),
        kind: 'cycle',
        steppable: PLAYABLE_FORMATS.length > 1,
      },
      {
        id: 'teamFormat',
        label: 'Teambuilder format',
        detail: TEAM_FORMATS.length > 1 ? 'The format new teams are built for.' : 'The format new teams are built for (the only one for now).',
        value: formatLabel(settings.teamFormat),
        kind: 'cycle',
        steppable: TEAM_FORMATS.length > 1,
      },
      {
        id: 'allowSpectators',
        label: 'Allow spectators',
        detail: settings.allowSpectators
          ? 'Anyone can watch your battles.'
          : 'Your battles are invite-only: only the players (and staff) can join.',
        value: settings.allowSpectators ? 'On' : 'Off',
        kind: 'toggle',
        on: settings.allowSpectators,
      },
      {
        id: 'rememberName',
        label: 'Remember my name',
        detail: !settings.rememberName
          ? 'The login box starts empty.'
          : rememberedName
            ? `The login box starts with ${rememberedName}.`
            : 'Your name is kept the next time you log in.',
        value: settings.rememberName ? 'On' : 'Off',
        kind: 'toggle',
        on: settings.rememberName,
      },
      {
        id: 'autoLogin',
        label: 'Log in automatically',
        detail: !this.saved.canSavePassword
          ? 'Only on the console: the password is kept in a file on its SD card.'
          : !settings.autoLogin
            ? 'For a registered name. Off, your password is never saved.'
            : savedFor
              ? `Logs in as ${savedFor} on start. The password is in a file on the SD card.`
              : 'Log in once with your password to save it (in a file on the SD card).',
        value: settings.autoLogin ? 'On' : 'Off',
        kind: 'toggle',
        on: settings.autoLogin,
        disabled: !this.saved.canSavePassword,
      },
      {
        id: 'replays',
        label: 'Replays',
        detail: 'The latest public battles of each format.',
        value: 'Open',
        kind: 'link',
      },
    ];
  });

  constructor() {
    returnRow = 'theme';
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Left and right change the value in place, as A does (back for left).
      const unregister = this.buttons().map((button) => {
        const element = button.nativeElement;
        return this.navigation.registerAdjuster(element, (step) => {
          const row = this.rows().find((r) => r.id === element.getAttribute('data-setting'));
          return row ? this.change(row, step) : false;
        });
      });
      destroyRef.onDestroy(() => unregister.forEach((fn) => fn()));
    });
  }

  protected activate(row: SettingRow): void {
    if (row.kind === 'link') {
      returnRow = row.id;
      this.navigation.focusPageAfterNavigation();
      void this.router.navigateByUrl('/replays');
      return;
    }
    this.change(row, 1);
  }

  /** Steps a row's value; false when there's nothing to change (so left/right move focus as usual). */
  private change(row: SettingRow, step: 1 | -1): boolean {
    if (row.disabled || row.kind === 'link') return false;
    const settings = this.appSettings.settings();
    switch (row.id) {
      case 'theme':
        this.appSettings.set('theme', cycle(THEMES.map((t) => t.id), settings.theme, step));
        return true;
      case 'battleFormat':
        this.appSettings.set('battleFormat', cycle(PLAYABLE_FORMATS.map((f) => f.id), settings.battleFormat, step));
        return true;
      case 'teamFormat':
        if (TEAM_FORMATS.length < 2) return false;
        this.appSettings.set('teamFormat', cycle(TEAM_FORMATS.map((f) => f.id), settings.teamFormat, step));
        return true;
      case 'allowSpectators':
        this.appSettings.set('allowSpectators', !settings.allowSpectators);
        return true;
      case 'rememberName':
        this.saved.setRememberName(!settings.rememberName);
        return true;
      case 'autoLogin':
        this.login.setAutoLogin(!settings.autoLogin);
        return true;
      default:
        return false;
    }
  }
}

/** The value `step` places after `current` in `values`, wrapping around. */
function cycle<T>(values: readonly T[], current: T, step: 1 | -1): T {
  const index = values.indexOf(current);
  return values[(index + step + values.length) % values.length];
}
