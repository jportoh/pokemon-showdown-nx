import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Rgba, Texture, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { iconTexture, maskTexture } from '@core/gl/gl-textures';
import { GlTheme, themeSwatch } from '@core/gl/ui/gl-theme';
import { Chip, drawGround, drawSlantedButton, drawSprite } from '@core/gl/ui/menu-kit';
import { PageBar } from '@core/gl/ui/page-bar';
import { PixelIconName } from '@core/gl/ui/pixel-icons';
import { UiContext, label, pill } from '@core/gl/ui/retro-kit';
import { CanvasAction } from '@core/input/keyboard-navigation';
import { APPEARANCES, AppSettings, THEMES, VOLUME_STEP } from '@core/settings/app-settings';
import { SavedLogin } from '@features/connection/saved-login';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { HOME_MENU_ITEMS } from '@features/home/state/home-menu';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { PLAYABLE_FORMATS, TEAM_FORMATS, formatLabel } from '@shared/data/formats';

type SettingId =
  | 'appearance'
  | 'theme'
  | 'musicVolume'
  | 'soundVolume'
  | 'battleFormat'
  | 'teamFormat'
  | 'allowSpectators'
  | 'saveReplays'
  | 'rememberName'
  | 'autoLogin'
  | 'history'
  | 'replays';

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

/** The settings' groups, as the slanted buttons on the left: each its rows, its colours (a menu item's) and its Pokémon. */
const GROUPS: readonly { title: string; icon: PixelIconName; colours: PixelIconName; art: string; rows: readonly SettingId[] }[] = [
  { title: 'LOOK', icon: 'settings', colours: 'live', art: 'gardevoir', rows: ['appearance', 'theme'] },
  { title: 'SOUND', icon: 'chats', colours: 'chats', art: 'primarina', rows: ['musicVolume', 'soundVolume'] },
  { title: 'BATTLES', icon: 'battle', colours: 'battle', art: 'garchomp', rows: ['battleFormat', 'teamFormat', 'allowSpectators', 'saveReplays'] },
  { title: 'ACCOUNT', icon: 'teambuilder', colours: 'random', art: 'lucario', rows: ['rememberName', 'autoLogin'] },
  { title: 'HISTORY', icon: 'replays', colours: 'teambuilder', art: 'rotom', rows: ['history', 'replays'] },
];
const GROUP = { x: 40, y: 98, w: 420, h: 94, step: 106 };
const PANEL = { x: 500, y: 98, w: 732, h: 518 };
const ROW = { x: 512, y: 168, w: 708, h: 80, step: 90 };
/** The groups slide in one after another on arrival; the page fades out on leaving. */
const INTRO_MS = 380;
const LEAVE_MS = 180;
/** The value's ◀ ▶: 4x7 pixels each, drawn 3 times bigger. */
const LEFT_ROWS = ['...x', '..xx', '.xxx', 'xxxx', '.xxx', '..xx', '...x'];
const RIGHT_ROWS = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];

/** The row focused when coming back from a page Settings opened (the battle history, the replays). */
let returnRow: SettingId | null = null;

/**
 * Settings, drawn on the stage in the menu's style: the groups (Look, Sound, Battles, Account, History)
 * as slanted buttons on the left, each with a chip that sums up its values, and the focused group's
 * settings in a panel on the right, each with its own control (a switch, a volume's bars, the themes'
 * swatches, ◀ value ▶). Right (or A) goes into the group's settings; left/right change a value; A flips
 * a switch or opens a page (the battle history, the replays, whose B comes back here); left on a switch
 * or B goes back to the groups. B on the groups goes back to the menu.
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
  private readonly appSettings = inject(AppSettings);
  private readonly login = inject(ShowdownLogin);
  private readonly saved = inject(SavedLogin);

  private readonly focus = new CanvasFocus();
  /** The group whose settings the panel shows: the focused one, or the one last focused. */
  private readonly shown = signal(0);

  private readonly rows = computed((): SettingRow[] => {
    const settings = this.appSettings.settings();
    const theme = THEMES.find((t) => t.id === settings.theme) ?? THEMES[0];
    const savedFor = this.saved.savedFor();
    const rememberedName = this.saved.name();
    const login = this.login.state();
    const registered = login.status === 'named' && login.registered;
    return [
      {
        id: 'appearance',
        label: 'Appearance',
        detail: settings.appearance === 'light' ? 'Light colours with dark text. It changes as you pick it.' : 'Dark colours with light text. It changes as you pick it.',
        value: APPEARANCES.find((a) => a.id === settings.appearance)?.name ?? APPEARANCES[0].name,
        kind: 'cycle',
        steppable: true,
      },
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
        id: 'saveReplays',
        label: 'Save my replays',
        detail: !settings.saveReplays
          ? 'Your battles aren\'t saved: only the ones saved before show in your history.'
          : settings.allowSpectators
            ? 'Each battle you play is saved, public, on Showdown\'s replay server, for your history.'
            : 'Saved as private while spectators are off: they won\'t show in your history.',
        value: settings.saveReplays ? 'On' : 'Off',
        kind: 'toggle',
        on: settings.saveReplays,
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
        id: 'history',
        label: 'Battle history',
        detail: registered ? 'The battles you have played, with their replays.' : 'Log in with a registered name to see the battles you have played.',
        value: 'Open',
        kind: 'link',
        disabled: !registered,
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

  /** What each group's chip says: its values at a glance. */
  private readonly summaries = computed((): string[] => {
    const settings = this.appSettings.settings();
    const login = this.login.state();
    const appearance = APPEARANCES.find((a) => a.id === settings.appearance)?.name ?? '';
    const theme = THEMES.find((t) => t.id === settings.theme)?.name ?? '';
    const account = login.status === 'named' ? login.name : 'Not logged in';
    const keep = settings.autoLogin ? 'automatic login' : settings.rememberName ? 'name remembered' : 'nothing kept';
    return [
      `${appearance} · ${theme}`,
      `Music ${volumeLabel(settings.musicVolume)} · Effects ${volumeLabel(settings.soundVolume)}`,
      `${formatLabel(settings.battleFormat)} · ${settings.allowSpectators ? 'spectators on' : 'invite only'}`,
      `${account} · ${keep}`,
      'Your battles · replays',
    ];
  });

  // Drawing state, outside Angular.
  private leftArrow: Texture | null = null;
  private rightArrow: Texture | null = null;
  private readonly icons = new Map<PixelIconName, Texture>();
  private readonly start = performance.now();
  private readonly focusAnim = new Map<string, number>();
  private leaving: { at: number; then: () => void } | null = null;

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
      for (const group of GROUPS) this.icons.set(group.icon, iconTexture(renderer, group.icon, false));
    });
    // Back from a page a row opened: on that row, its group shown.
    if (returnRow) {
      const back = returnRow;
      this.shown.set(Math.max(0, GROUPS.findIndex((g) => g.rows.includes(back))));
      this.focus.focus(`row-${back}`);
    } else {
      this.focus.focus('group-0');
    }
    returnRow = null;
    inject(DestroyRef).onDestroy(() => {
      hide();
      this.stage.whenReady(({ renderer }) => {
        for (const texture of [this.leftArrow, this.rightArrow, ...this.icons.values()]) if (texture) renderer.deleteTexture(texture);
      });
    });
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    if (action === 'back') {
      // In a group's settings: back to the group; on the groups: back to the menu.
      if (this.focus.focused?.startsWith('row-')) this.focus.focus(`group-${this.shown()}`);
      else this.leave('/');
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  /** Into a group's settings: its first row. */
  private enterGroup(index: number): void {
    this.shown.set(index);
    this.focus.focus(`row-${GROUPS[index].rows[0]}`);
  }

  private activate(row: SettingRow): void {
    if (row.kind === 'link') {
      if (row.disabled) return;
      returnRow = row.id;
      this.leave(row.id === 'history' ? '/history?from=settings' : '/replays');
      return;
    }
    this.change(row, 1, true);
  }

  /** Fades out, then opens `path` (the menu focuses the Settings button). */
  private leave(path: string): void {
    if (this.leaving) return;
    this.leaving = {
      at: performance.now(),
      then: () => {
        void this.router.navigateByUrl(path);
      },
    };
  }

  /**
   * Steps a row's value; false when there's nothing to change. `wrap` (A) goes round from the last value
   * to the first; the d-pad stops a volume at its ends.
   */
  private change(row: SettingRow, step: 1 | -1, wrap = false): boolean {
    if (row.disabled || row.kind === 'link') return false;
    const settings = this.appSettings.settings();
    switch (row.id) {
      case 'appearance':
        this.appSettings.set('appearance', cycle(APPEARANCES.map((a) => a.id), settings.appearance, step));
        break;
      case 'theme':
        this.appSettings.set('theme', cycle(THEMES.map((t) => t.id), settings.theme, step));
        break;
      case 'musicVolume':
      case 'soundVolume': {
        const next = settings[row.id] + step * VOLUME_STEP;
        this.appSettings.set(row.id, wrap ? cycle(VOLUMES, settings[row.id], step) : Math.max(0, Math.min(100, next)));
        break;
      }
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
      case 'saveReplays':
        this.appSettings.set('saveReplays', !settings.saveReplays);
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
    return true;
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now, dt } = frame;
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    const ease = 1 - Math.exp(-dt * 14);
    const age = now - this.start;
    const intro = (delay: number): number => 1 - Math.pow(1 - clamp01((age - delay) / INTRO_MS), 3);

    drawGround(ctx, 1);
    this.bar.drawHeader(ctx, { title: 'SETTINGS', icon: 'settings', back: () => this.leave('/') });

    // The focused group is the one shown; in its rows, the one last focused stays.
    const focused = this.focus.focused ?? '';
    if (focused.startsWith('group-')) this.shown.set(Number(focused.slice(6)));
    const shown = this.shown();
    const inRows = focused.startsWith('row-');
    const summaries = this.summaries();
    const login = this.login.state();
    const avatar = login.status === 'named' ? ctx.images.pixelArt(avatarUrl(login.avatar)) : null;
    GROUPS.forEach((group, i) => {
      const id = `group-${i}`;
      const box = { x: GROUP.x, y: GROUP.y + i * GROUP.step, w: GROUP.w, h: GROUP.h };
      this.focus.control({
        id,
        ...box,
        accept: () => this.enterGroup(i),
        move: (direction) => {
          if (direction !== 'right') return false;
          this.enterGroup(i);
          return true;
        },
      });
      const arrive = intro(i * 50);
      // The shown group stands out a little while its settings have the focus.
      const nudge = inRows && i === shown ? 14 : 0;
      drawSlantedButton(ctx, {
        ...box,
        x: box.x + nudge - (1 - arrive) * 60,
        f: this.eased(id, ease, inRows && i === shown ? 0.35 : 0),
        alpha: arrive,
        title: group.title,
        titleSize: 24,
        // Account's icon is the player's own trainer, once there's one.
        ...(group.title === 'ACCOUNT' && avatar ? { icon: avatar, iconScale: 0.6 } : { icon: this.icons.get(group.icon) }),
        plate: this.plate(group.colours, p.appearance),
        chips: [{ text: summaries[i], tone: 'muted' } satisfies Chip],
        art: (b, artAlpha, grow) => drawSprite(ctx, group.art, b.x + b.w - 20 - 96 * grow, b.y + b.h - 96 * grow + 10, 96 * grow, artAlpha),
      });
    });

    this.drawPanel(ctx, shown, ease, intro(120));
    this.drawFooter(ctx);

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

  /** A control's eased focus (`rest`: where it settles unfocused). */
  private eased(id: string, ease: number, rest = 0): number {
    const previous = this.focusAnim.get(id) ?? 0;
    const value = previous + ((this.focus.focused === id ? 1 : rest) - previous) * ease;
    this.focusAnim.set(id, value);
    return value;
  }

  private plate(item: PixelIconName, appearance: 'light' | 'dark'): Rgba {
    const found = HOME_MENU_ITEMS.find((it) => it.id === item);
    return found ? rgba(found.plate[appearance]) : this.theme.palette().rim;
  }

  /** The shown group's settings, in a panel with the group's colour. */
  private drawPanel(ctx: UiContext, index: number, ease: number, alpha: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const group = GROUPS[index];
    const { x, y, w, h } = PANEL;
    renderer.rect(x, y + 12, w, h, { fill: [0, 0, 0, 0.2 * alpha], radius: 22, softness: 30 });
    renderer.rect(x, y, w, h, {
      fill: withAlpha(mixRgba(this.plate(group.colours, p.appearance), p.panel, 0.35), alpha),
      fillEnd: withAlpha(p.panel, alpha),
      stroke: withAlpha(p.rim, alpha),
      border: 1,
      radius: 22,
    });
    const icon = this.icons.get(group.icon);
    if (icon) renderer.image(icon, x + 26, y + 16, 1.5, [1, 1, 1, alpha]);
    label(ctx, group.title, x + 72, y + 34, { size: 26, bold: true }, withAlpha(p.ink, alpha));
    const rows = this.rows();
    group.rows.forEach((id, i) => {
      const row = rows.find((r) => r.id === id);
      if (row) this.drawRow(ctx, row, ROW.y + i * ROW.step, this.eased(`row-${id}`, ease), alpha);
    });
  }

  /** One setting: its name and detail, its control at the right. Left/right change it; left on a switch goes back to the groups. */
  private drawRow(ctx: UiContext, row: SettingRow, y: number, f: number, alpha: number): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const box = { x: ROW.x, y, w: ROW.w, h: ROW.h };
    ctx.focus.control({
      id: `row-${row.id}`,
      ...box,
      accept: () => this.activate(row),
      move: (direction) => {
        if (direction === 'up' || direction === 'down') return false;
        const steps = row.kind === 'cycle' && !row.disabled;
        if (steps && this.change(row, direction === 'right' ? 1 : -1)) return true;
        if (direction === 'left') {
          ctx.focus.focus(`group-${this.shown()}`);
          return true;
        }
        return true;
      },
    });
    const a = (color: Rgba, extra = 1): Rgba => withAlpha(color, alpha * extra);
    if (f > 0.01) renderer.rect(box.x, y, box.w, box.h, { fill: a(p.select, f), stroke: a(p.accentText, f), border: 3, radius: 14 });
    label(ctx, row.label, box.x + 22, y + 28, { size: 22, bold: true }, a(row.disabled ? p.muted : p.ink));
    label(ctx, row.detail, box.x + 22, y + 56, { size: 15 }, a(p.muted), { maxWidth: 400 });

    const right = box.x + box.w - 22;
    const cy = y + box.h / 2;
    const nudge = Math.max(0, Math.sin((now / 1000) * 6)) * 3 * f;
    const arrows = (left: number, rightEdge: number): void => {
      const color = a(mixRgba(p.muted, p.accentText, f));
      if (this.leftArrow) renderer.image(this.leftArrow, left - nudge, cy - 10.5, 3, color);
      if (this.rightArrow) renderer.image(this.rightArrow, rightEdge - 12 + nudge, cy - 10.5, 3, color);
    };
    const settings = this.appSettings.settings();
    if (row.id === 'theme') {
      // The six themes' swatches (each its hue over its accent), the chosen one ringed.
      THEMES.forEach((theme, i) => {
        const sx = right - 6 * 40 + i * 40;
        const swatch = themeSwatch(p.appearance, theme.id);
        if (theme.id === settings.theme) renderer.rect(sx - 4, cy - 19, 38, 38, { fill: a(p.accentText), radius: 10 });
        renderer.rect(sx, cy - 15, 30, 30, { fill: a(swatch.accent), radius: 8 });
        renderer.rect(sx, cy - 15, 30, 18, { fill: a(swatch.hue), radius: 8 });
        renderer.rect(sx, cy - 5, 30, 8, { fill: a(swatch.hue) });
      });
    } else if (row.id === 'musicVolume' || row.id === 'soundVolume') {
      // Ten bars rising left to right, lit up to the volume.
      const volume = settings[row.id];
      label(ctx, volumeLabel(volume), right, cy, { size: 20, bold: true }, a(p.ink), { align: 'right' });
      for (let i = 0; i < 10; i++) {
        const bh = 12 + i * 2;
        renderer.rect(right - 70 - (10 - i) * 18, cy + 15 - bh, 14, bh, { fill: a(i < volume / 10 ? p.accent : p.rim), radius: 3 });
      }
    } else if (row.kind === 'toggle') {
      const on = row.on ?? false;
      const sw = { x: right - 58, y: cy - 16, w: 58, h: 32 };
      renderer.rect(sw.x, sw.y, sw.w, sw.h, { fill: a(on ? p.accent : p.rim, row.disabled ? 0.5 : 1), radius: 16 });
      renderer.rect(sw.x + (on ? 30 : 4), sw.y + 4, 24, 24, { fill: a([1, 1, 1, 1], row.disabled ? 0.6 : 1), radius: 12 });
    } else if (row.kind === 'link') {
      label(ctx, 'Open', right - 24, cy, { size: 19, bold: true }, a(row.disabled ? p.muted : p.accentText), { align: 'right' });
      if (this.rightArrow) renderer.image(this.rightArrow, right - 12 + nudge, cy - 10.5, 3, a(row.disabled ? p.muted : p.accentText));
    } else {
      // ◀ value ▶, the value centred between.
      const mid = right - 130;
      label(ctx, row.value, mid, cy, { size: 20, bold: true }, a(row.disabled ? p.muted : p.accentText), { align: 'center', maxWidth: 220 });
      if (row.steppable) arrows(right - 260, right);
    }
  }

  /** Under the page: what the focused setting is for (or the group), and the buttons. */
  private drawFooter(ctx: UiContext): void {
    const p = ctx.palette;
    const y = 668;
    const focused = this.focus.focused ?? '';
    const row = focused.startsWith('row-') ? this.rows().find((r) => `row-${r.id}` === focused) : null;
    label(ctx, row ? row.detail : 'Right or A to change these settings.', 48, y, { size: 16 }, p.muted, { maxWidth: 720 });
    const keys: [string, string][] = row
      ? [[row.kind === 'cycle' ? '◀▶' : 'A', row.kind === 'toggle' ? 'Turn on/off' : row.kind === 'link' ? 'Open' : 'Change'], ['B', 'Groups']]
      : [['A', 'Open'], ['B', 'Menu']];
    let x = 1232;
    for (const [key, text] of [...keys].reverse()) {
      x -= ctx.text.measure(text, { size: 18 });
      label(ctx, text, x, y, { size: 18 }, p.ink);
      x -= 8 + Math.max(36, ctx.text.measure(key, { size: 14, bold: true }) + 14);
      pill(ctx, key, x, y, 28);
      x -= 24;
    }
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
