import { Component, DestroyRef, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Rgba, Texture, mixRgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { maskTexture } from '@core/gl/gl-textures';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { PageBar } from '@core/gl/ui/page-bar';
import { UiContext, focusRing, label, retroBox } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { AppSettings, THEMES, VOLUME_STEP } from '@core/settings/app-settings';
import { SavedLogin } from '@features/connection/saved-login';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { PLAYABLE_FORMATS, TEAM_FORMATS, formatLabel } from '@shared/data/formats';

type SettingId = 'theme' | 'musicVolume' | 'soundVolume' | 'battleFormat' | 'teamFormat' | 'allowSpectators' | 'rememberName' | 'autoLogin' | 'replays';

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

/** The rows' box and each row in it. */
const BOX = { x: 32, y: 100, w: 1216, h: 596 };
const ROW_X = BOX.x + 24;
const ROW_W = 1162;
const ROW_H = 76;
const ROW_STEP = 84;
/** Rows shown at once, big enough to read: the list scrolls under them, with arrows when there's more. */
const ROWS_SHOWN = 6;
const rowY = (index: number): number => BOX.y + 20 + index * ROW_STEP;
/** Rows slide in one after another on arrival; the page fades out on leaving. */
const INTRO_MS = 320;
const LEAVE_MS = 180;
/** A changed value flashes this long. */
const FLASH_MS = 400;
/** The value's ◀ ▶: 4x7 pixels each, drawn 4 times bigger (16x28). */
const LEFT_ROWS = ['...x', '..xx', '.xxx', 'xxxx', '.xxx', '..xx', '...x'];
const RIGHT_ROWS = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];

/** The row focused when coming back from a page Settings opened (the replays). */
let returnRow: SettingId = 'theme';

/**
 * Settings, drawn on the stage: a list of rows, each with its value on the right. A changes it (the
 * next value, or on/off), and so do left/right (back for left); the theme applies at once. The last
 * row opens the replays, whose B comes back here. B goes back to the menu.
 */
@Component({
  selector: 'app-settings-scene',
  template: '',
})
export class SettingsScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bar = inject(PageBar);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly appSettings = inject(AppSettings);
  private readonly login = inject(ShowdownLogin);
  private readonly saved = inject(SavedLogin);

  private readonly focus = new CanvasFocus();

  private readonly rows = computed((): SettingRow[] => {
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
        id: 'musicVolume',
        label: 'Music',
        detail: settings.musicVolume ? 'The menus\' theme and the battle music.' : 'No music.',
        value: volumeLabel(settings.musicVolume),
        kind: 'cycle',
        steppable: true,
      },
      {
        id: 'soundVolume',
        label: 'Sound effects',
        detail: settings.soundVolume ? 'The buttons\' sounds and the Pokémon\'s cries in battle.' : 'No sounds or cries.',
        value: volumeLabel(settings.soundVolume),
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

  // Drawing state, outside Angular.
  private leftArrow: Texture | null = null;
  private rightArrow: Texture | null = null;
  private readonly start = performance.now();
  private readonly focusAnim = new Map<SettingId, number>();
  private readonly changedAt = new Map<SettingId, number>();
  private leaving: { at: number; then: () => void } | null = null;
  /** The first row shown. */
  private rowStart = 0;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.stage.whenReady(({ renderer }) => {
      this.leftArrow = maskTexture(renderer, LEFT_ROWS);
      this.rightArrow = maskTexture(renderer, RIGHT_ROWS);
    });
    this.focus.focus(`row-${returnRow}`);
    returnRow = 'theme';
    inject(DestroyRef).onDestroy(() => {
      hide();
      this.stage.whenReady(({ renderer }) => {
        for (const texture of [this.leftArrow, this.rightArrow]) if (texture) renderer.deleteTexture(texture);
      });
    });
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    if (action === 'back') {
      this.leave('/');
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  private activate(row: SettingRow): void {
    if (row.kind === 'link') {
      returnRow = row.id;
      this.leave('/replays');
      return;
    }
    this.change(row, 1);
  }

  /** Fades out, then opens `path` (the menu focuses the Settings tile). */
  private leave(path: string): void {
    if (this.leaving) return;
    this.leaving = {
      at: performance.now(),
      then: () => {
        void this.router.navigateByUrl(path);
      },
    };
  }

  /** Steps a row's value; false when there's nothing to change (so left/right move the focus as usual). */
  private change(row: SettingRow, step: 1 | -1): boolean {
    if (row.disabled || row.kind === 'link') return false;
    const settings = this.appSettings.settings();
    switch (row.id) {
      case 'theme':
        this.appSettings.set('theme', cycle(THEMES.map((t) => t.id), settings.theme, step));
        break;
      case 'musicVolume':
      case 'soundVolume':
        this.appSettings.set(row.id, cycle(VOLUMES, settings[row.id], step));
        break;
      case 'battleFormat':
        this.appSettings.set('battleFormat', cycle(PLAYABLE_FORMATS.map((f) => f.id), settings.battleFormat, step));
        break;
      case 'teamFormat':
        if (TEAM_FORMATS.length < 2) return false;
        this.appSettings.set('teamFormat', cycle(TEAM_FORMATS.map((f) => f.id), settings.teamFormat, step));
        break;
      case 'allowSpectators':
        this.appSettings.set('allowSpectators', !settings.allowSpectators);
        break;
      case 'rememberName':
        this.saved.setRememberName(!settings.rememberName);
        break;
      case 'autoLogin':
        this.login.setAutoLogin(!settings.autoLogin);
        break;
      default:
        return false;
    }
    this.changedAt.set(row.id, performance.now());
    return true;
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now, dt } = frame;
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    this.bar.draw(ctx, { title: 'Settings', icon: 'settings', back: () => this.leave('/') });
    retroBox(ctx, BOX);
    const ease = 1 - Math.exp(-dt * 16);
    const rows = this.rows();
    const focusedIndex = rows.findIndex((row) => this.focus.focused === `row-${row.id}`);
    if (focusedIndex !== -1) this.revealRow(focusedIndex, rows.length);
    const end = Math.min(rows.length, this.rowStart + ROWS_SHOWN);
    rows.slice(this.rowStart, end).forEach((row, shown) => {
      const i = this.rowStart + shown;
      const intro = clamp01((now - this.start - shown * 40) / INTRO_MS);
      const arrive = 1 - Math.pow(1 - intro, 3);
      const target = this.focus.focused === `row-${row.id}` ? 1 : 0;
      const f = (this.focusAnim.get(row.id) ?? target) + (target - (this.focusAnim.get(row.id) ?? target)) * ease;
      this.focusAnim.set(row.id, f);
      this.drawRow(ctx, row, rowY(shown), f, arrive, {
        up: i === this.rowStart && i > 0 ? rows[i - 1].id : null,
        down: i === end - 1 && i < rows.length - 1 ? rows[i + 1].id : null,
      });
    });
    if (this.rowStart > 0) label(ctx, '▲ more', BOX.x + BOX.w / 2, BOX.y + 8, { size: 16, bold: true }, p.accentText, { align: 'center' });
    if (end < rows.length) label(ctx, `▼ ${rows.length - end} more`, BOX.x + BOX.w / 2, BOX.y + BOX.h - 26, { size: 20, bold: true }, p.accentText, { align: 'center' });
    if (this.leaving) {
      const t = clamp01((now - this.leaving.at) / LEAVE_MS);
      renderer.rect(0, 0, STAGE_W, 720, { fill: withAlpha(p.bg, t) });
      if (t >= 1) {
        const then = this.leaving.then;
        this.leaving = null;
        then();
      }
    }
    this.focus.end();
    renderer.end();
  }

  /** Moves the rows' window so row `index` shows. */
  private revealRow(index: number, count: number): void {
    if (index < this.rowStart) this.rowStart = index;
    if (index >= this.rowStart + ROWS_SHOWN) this.rowStart = index - ROWS_SHOWN + 1;
    this.rowStart = Math.max(0, Math.min(this.rowStart, count - ROWS_SHOWN));
  }

  /** `beyond`: the row up or down past the window's edge, which the d-pad goes on to (the window follows). */
  private drawRow(ctx: UiContext, row: SettingRow, y: number, f: number, arrive: number, beyond: { up: SettingId | null; down: SettingId | null }): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const box = { x: ROW_X, y, w: ROW_W, h: ROW_H };
    const focused = ctx.focus.control({
      id: `row-${row.id}`,
      ...box,
      accept: () => this.activate(row),
      move: (direction) => {
        if (direction === 'left' || direction === 'right') return this.change(row, direction === 'right' ? 1 : -1);
        const next = beyond[direction];
        if (!next) return false;
        ctx.focus.focus(`row-${next}`);
        return true;
      },
    });
    const alpha = arrive;
    const x = box.x + (1 - arrive) * 32;
    const a = (color: Rgba): Rgba => withAlpha(color, alpha);
    renderer.rect(x, y, ROW_W, ROW_H, { fill: a(mixRgba(p.button, p.select, f)), stroke: a(p.rim), radius: 8, border: 2 });

    label(ctx, row.label, x + 22, y + 24, { size: 28, bold: true }, a(row.disabled ? p.muted : p.ink), { maxWidth: 640 });
    label(ctx, row.detail, x + 22, y + 54, { size: 19 }, a(p.muted), { maxWidth: 720 });

    // The value, flashing white for a moment when it changes, its ◀ ▶ nudging the way it went.
    const valueColor = row.disabled ? p.muted : row.kind === 'toggle' ? (row.on ? p.teal : p.muted) : p.accentText;
    const flash = 1 - clamp01((now - (this.changedAt.get(row.id) ?? -Infinity)) / FLASH_MS);
    const pop = 1 + 0.12 * flash * flash;
    const valueStyle = { size: 28, bold: true };
    const shown = ctx.text.fit(row.value, valueStyle, 320);
    const texture = ctx.text.get(shown, valueStyle);
    if (texture) {
      const cx = x + 954;
      const cy = y + ROW_H / 2;
      renderer.image(texture, cx - (texture.width * pop) / 2, cy - (texture.height * pop) / 2, pop, a(mixRgba(valueColor, [1, 1, 1, 1], flash * 0.6)));
    }
    const arrowColor = a(mixRgba(p.muted, p.accentText, f));
    const nudge = Math.max(0, Math.sin((now / 1000) * 6)) * 3 * f;
    if (row.steppable && this.leftArrow) renderer.image(this.leftArrow, x + 762 - nudge, y + (ROW_H - 28) / 2, 4, arrowColor);
    if ((row.steppable || row.kind === 'link') && this.rightArrow) renderer.image(this.rightArrow, x + 1126 + nudge, y + (ROW_H - 28) / 2, 4, arrowColor);
    if (focused) focusRing(ctx, { ...box, x }, 8);
  }
}

/** The volumes to step through: 0 (Off) to 100. */
const VOLUMES = Array.from({ length: 100 / VOLUME_STEP + 1 }, (_, i) => i * VOLUME_STEP);

function volumeLabel(volume: number): string {
  return volume ? `${volume}%` : 'Off';
}

/** The value `step` places after `current` in `values`, wrapping around. */
function cycle<T>(values: readonly T[], current: T, step: 1 | -1): T {
  const index = values.indexOf(current);
  return values[(index + step + values.length) % values.length];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
