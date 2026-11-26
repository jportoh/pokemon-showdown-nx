import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Texture, rgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, StageFrame } from '@core/gl/gl-stage';
import { iconTexture, pixelTexture } from '@core/gl/gl-textures';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { UiContext, keysLegend, label } from '@core/gl/ui/retro-kit';
import { CanvasAction } from '@core/input/keyboard-navigation';
import { AppSettings } from '@core/settings/app-settings';
import { connectingText, connectionNotice, troubleChip } from '@features/connection/connection-notice';
import { SavedLogin } from '@features/connection/saved-login';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { BALL } from '@features/home/gl/logo-ball';
import { HOME_LOGO, logoMark } from '@features/home/gl/logo-layout';
import {
  Chip,
  NamePlate,
  drawField,
  drawGround,
  drawNamePlate,
  drawPlatformTrainer,
  drawRoundButton,
  drawSlantedButton,
  drawSprite,
  drawSwitch,
} from '@core/gl/ui/menu-kit';
import { HOME_MENU_ITEMS, HomeMenu } from '@features/home/state/home-menu';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { LadderRatings } from '@features/trainer-card/state/ladder-ratings';
import { toId } from '@shared/utils/to-id';

/** The screen comes in on arrival; on leaving its right side slides out and the menu's buttons come in. */
const INTRO_MS = 420;
const LEAVE_MS = 260;

/**
 * The entry screen's steps: welcome (a remembered name: its trainer, one button to continue), the three
 * ways in (doors: a guest, a login, offline), and the login form (name and password).
 */
type Step = 'welcome' | 'doors' | 'form';

/** The three ways in, as the menu's slanted buttons; their colours are the menu items'. */
const DOORS = [
  { id: 'door-guest', title: 'CONNECT AS GUEST', icon: 'chats', colours: 'random', art: 'pikachu', y: 110 },
  { id: 'door-login', title: 'LOG IN', icon: 'battle', colours: 'teambuilder', art: 'lucario', y: 284 },
  { id: 'door-offline', title: 'PLAY OFFLINE', icon: 'teambuilder', colours: 'settings', art: 'snorlax', y: 458 },
] as const;
const DOOR = { x: 520, w: 700, h: 156 };
const FORM = { x: 520, y: 110, w: 700, h: 504 };

/**
 * The entry screen, between the title and the menu, built like the menu (the lit side, the trainer on
 * their platform with a name plate, slanted buttons), so entering the menu only brings its buttons in.
 * A returning player (a remembered name) is welcomed: their last trainer, the password, one button to
 * continue, and the other ways in under it. Otherwise three doors: connect as a guest, log in (the
 * form takes the doors' place: name, password, remember me, log in automatically), or play offline (the
 * Teambuilder and Settings work without a connection). B goes back from the form. The menu opens once
 * the server calls us by a name; logging out of the menu comes back here.
 */
@Component({
  selector: 'app-start-scene',
  template: '',
})
export class StartScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly login = inject(ShowdownLogin);
  private readonly connection = inject(ShowdownConnection);
  private readonly saved = inject(SavedLogin);
  private readonly settings = inject(AppSettings);
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly ladder = inject(LadderRatings);
  private readonly menu = inject(HomeMenu);

  private readonly focus = new CanvasFocus();

  /** The name Settings remembers ('' if none): the welcome step's. */
  private readonly remembered = this.saved.name();
  private readonly step = signal<Step>(this.remembered ? 'welcome' : 'doors');
  /** Where B goes back to from the form. */
  private formFrom: Step = 'doors';
  private readonly name = signal(this.remembered);
  private readonly password = signal('');
  /** "Remember me": on unless turned off here (the welcome needs a remembered name). */
  private readonly rememberName = signal(true);
  private readonly autoLogin = signal(this.settings.settings().autoLogin);
  /**
   * A login was asked for here: its answer (an error, or the name) is ours to show. So is an automatic
   * login's that brought us here (refused, or the login server out of reach): the footer says why.
   */
  private readonly submitted = signal(this.login.state().mode === 'login' && this.login.state().loginError !== null);

  private readonly guestConnecting = computed(() => {
    const state = this.login.state();
    return state.mode === 'guest' && (state.status === 'connecting' || state.status === 'naming');
  });
  /** Attempts to connect keep failing (no network, Showdown out of reach): the guest's door tries again at once. */
  private readonly canRetry = computed(() => {
    const connection = this.connection.state();
    return connection.trouble !== null && connection.status !== 'connected' && connection.status !== 'offline';
  });
  /** The server's challenge is here and nothing is under way. */
  private readonly canSubmit = computed(() => {
    const state = this.login.state();
    const hasChallenge = state.status === 'ready' || state.status === 'named' || state.status === 'unavailable';
    return hasChallenge && !state.loggingIn && !this.guestConnecting();
  });
  private readonly guestError = computed(() => {
    const state = this.login.state();
    return state.mode === 'guest' && state.status === 'unavailable' ? state.error : null;
  });
  /**
   * How the login is going, for the footer (an error in red), worked out each frame: "slow to answer"
   * and the next try's countdown move with time. On the doors, only the connection's trouble or
   * slowness (a door's own hint otherwise).
   */
  private loginStatus(): { text: string; error: boolean } | null {
    const state = this.login.state();
    const connection = this.connection.state();
    const now = Date.now();
    if (this.canRetry()) return { text: connectionNotice(connection, state, now) ?? '', error: false };
    const connecting = connection.status !== 'connected' && (state.status === 'connecting' || state.status === 'offline' || this.guestConnecting());
    if (this.step() === 'doors') {
      const text = connecting ? connectingText(connection, now) : '';
      return text && text !== 'Connecting to Showdown…' ? { text, error: false } : null;
    }
    const error = this.submitted() ? state.loginError : null;
    if (error) return { text: error, error: true };
    // Guest from the welcome (the doors say it on the guest's chip): why no name could be had.
    const guestError = this.guestError();
    if (guestError) return { text: guestError, error: true };
    if (state.loggingIn) return { text: 'Logging in…', error: false };
    if (connecting) return { text: connectingText(connection, now), error: false };
    return null;
  }

  /** The remembered name's ratings, for the welcome's name plate. */
  private readonly ratings = computed(() => {
    const state = this.ladder.state();
    return state.userId === toId(this.remembered) ? state : null;
  });

  private ball: Texture | null = null;
  private readonly icons = new Map<string, Texture>();
  private readonly start = performance.now();
  /** Each control's eased focus, by id. */
  private readonly anims = new Map<string, number>();
  private leavingAt = 0;
  private left = false;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.stage.whenReady(({ renderer }) => {
      this.ball = pixelTexture(renderer, BALL);
      for (const door of DOORS) this.icons.set(door.icon, iconTexture(renderer, door.icon, false));
    });
    // The connection starts now, so the server's challenge is here by the time a name is typed.
    if (this.login.state().status !== 'named') this.login.startLogin();
    if (this.remembered) this.ladder.load(toId(this.remembered));
    this.focus.focus(this.remembered ? 'welcome-continue' : 'door-guest');
    // On to the menu once the server calls us by a name: a guest's, ours after logging in here, or the
    // automatic login's finishing while this screen shows.
    effect(() => {
      const state = this.login.state();
      if (state.status === 'named' && !(this.submitted() && state.loggingIn)) this.enter();
    });
    inject(DestroyRef).onDestroy(() => {
      hide();
      this.stage.whenReady(({ renderer }) => {
        for (const texture of [this.ball, ...this.icons.values()]) if (texture) renderer.deleteTexture(texture);
      });
    });
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leavingAt) return true;
    if (action === 'back') {
      if (this.step() === 'form') this.toStep(this.formFrom, this.formFrom === 'welcome' ? 'welcome-other' : 'door-login');
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  private toStep(step: Step, focusId: string): void {
    this.step.set(step);
    this.focus.focus(focusId);
  }

  /** The login form, with this name (the remembered one, or empty for another). */
  private openForm(name: string): void {
    this.formFrom = this.step();
    this.name.set(name);
    this.password.set('');
    this.submitted.set(false);
    this.toStep('form', name ? 'form-password' : 'form-name');
  }

  private connectAsGuest(): void {
    if (this.canRetry()) {
      this.connection.retryNow();
      return;
    }
    if (this.guestConnecting() || this.login.state().loggingIn) return;
    this.submitted.set(false);
    this.login.connectAsGuest();
  }

  private playOffline(): void {
    this.login.cancelLogin();
    this.menu.offlineChosen.set(true);
    this.enter();
  }

  private submit(name: string): void {
    // While attempts keep failing, Continue and LOG IN try again at once (the footer says why).
    if (this.canRetry()) {
      this.connection.retryNow();
      return;
    }
    const trimmed = name.trim();
    if (!this.canSubmit() || !trimmed) return;
    // Remember me: kept (or forgotten) before the login, which saves the name as Settings say.
    if (this.rememberName() !== this.settings.settings().rememberName) this.saved.setRememberName(this.rememberName());
    this.name.set(trimmed);
    this.submitted.set(true);
    this.login.logIn(trimmed, this.password());
  }

  private editName(): void {
    this.keyboard.open({
      label: 'Showdown name',
      value: this.name(),
      maxLength: 18,
      done: (value) => {
        if (value === null) return;
        this.name.set(value);
        this.focus.focus('form-password');
      },
    });
  }

  /** The password, then the focus on `next` (the button that logs in). */
  private editPassword(next: string): void {
    this.keyboard.open({
      label: 'Password (empty for an unregistered name)',
      value: this.password(),
      maxLength: 300,
      masked: true,
      done: (value) => {
        if (value === null) return;
        this.password.set(value);
        this.focus.focus(next);
      },
    });
  }

  /** Off to the menu: "Log in automatically" as chosen (it saves the logged-in name's password), then the menu comes in. */
  private enter(): void {
    if (this.leavingAt) return;
    const state = this.login.state();
    if (state.status === 'named') {
      if (this.submitted() && state.registered && this.saved.canSavePassword && this.autoLogin() !== this.settings.settings().autoLogin) {
        this.login.setAutoLogin(this.autoLogin());
      }
      this.menu.offlineChosen.set(false);
    }
    this.menu.fromEntry.set(true);
    this.leavingAt = performance.now();
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now, dt } = frame;
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    const ease = 1 - Math.exp(-dt * 14);
    const time = performance.now();
    const arrive = 1 - Math.pow(1 - Math.min(1, (time - this.start) / INTRO_MS), 3);
    const out = this.leavingAt ? Math.min(1, (time - this.leavingAt) / LEAVE_MS) : 0;

    drawGround(ctx, arrive);
    this.drawLogo(ctx);
    this.drawTrainer(ctx, now / 1000, this.leavingAt ? 1 : arrive);

    // The right side: sliding in on arrival, out on leaving (the menu's buttons take its place).
    const slide = (1 - arrive) * 60 + out * out * 80;
    const alpha = arrive * (1 - out);
    if (this.leavingAt) this.focus.trap();
    const step = this.step();
    if (step === 'welcome') this.drawWelcome(ctx, ease, slide, alpha);
    else if (step === 'doors') this.drawDoors(ctx, ease, slide, alpha);
    else this.drawForm(ctx, ease, slide, alpha);
    this.drawFooter(ctx, alpha);

    this.focus.end();
    renderer.end();
    if (out >= 1 && !this.left) {
      this.left = true;
      void this.router.navigateByUrl('/', { replaceUrl: true });
    }
  }

  /** A control's eased focus. */
  private eased(id: string, ease: number): number {
    const previous = this.anims.get(id) ?? 0;
    const value = previous + ((this.focus.focused === id ? 1 : 0) - previous) * ease;
    this.anims.set(id, value);
    return value;
  }

  /** The logo where the menu has it (and where the title's lands). */
  private drawLogo(ctx: UiContext): void {
    const p = ctx.palette;
    const logo = HOME_LOGO;
    const mark = logoMark(ctx.images, logo.markSize);
    if (mark) ctx.renderer.rect(logo.markX, logo.markY, logo.markSize, logo.markSize, { fill: [1, 1, 1, 1], texture: mark });
    const width = label(ctx, 'POKÉMON', logo.textX, logo.textCy, logo.style, p.logoInk);
    label(ctx, 'SHOWDOWN!', logo.textX + width + logo.gap, logo.textCy, logo.style, p.logo);
  }

  /** Who's playing: the remembered (or typed) name's last trainer, or a stranger's silhouette. */
  private drawTrainer(ctx: UiContext, time: number, arrive: number): void {
    const step = this.step();
    const name = step === 'welcome' ? this.remembered : step === 'form' ? this.name() : '';
    const known = name ? this.login.knownAvatar(name) : '';
    const avatar = ctx.images.pixelArt(avatarUrl(known));
    drawPlatformTrainer(ctx, { avatar, ball: this.ball, f: 0, arrive, time, dim: !known });
    drawNamePlate(ctx, this.plate(), arrive);
  }

  private plate(): NamePlate {
    const step = this.step();
    if (step === 'doors') return { name: "Who's playing?", status: '', chips: [{ text: 'Choose how to enter', tone: 'muted' }] };
    if (step === 'form') return { name: this.name() || 'Your name', status: '', chips: [{ text: this.name() ? 'Logging in' : 'Type your name', tone: 'muted' }] };
    const chips: Chip[] = [];
    const ratings = this.ratings();
    if (ratings && ratings.ratings.length > 0) {
      const wins = ratings.ratings.reduce((total, r) => total + r.wins, 0);
      const losses = ratings.ratings.reduce((total, r) => total + r.losses, 0);
      chips.push({ text: `★ ${ratings.ratings[0].elo}`, tone: 'muted' });
      if (wins + losses > 0) chips.push({ text: `${Math.round((wins / (wins + losses)) * 100)}% wins`, tone: 'muted' });
    } else {
      chips.push({ text: 'Welcome back', tone: 'muted' });
    }
    return { name: this.remembered, status: 'Last name used', chips };
  }

  /** The three ways in, as the menu's buttons. */
  private drawDoors(ctx: UiContext, ease: number, slide: number, alpha: number): void {
    const p = ctx.palette;
    DOORS.forEach((door, i) => {
      const box = { x: DOOR.x, y: door.y, w: DOOR.w, h: DOOR.h };
      const accept = i === 0 ? () => this.connectAsGuest() : i === 1 ? () => this.openForm(this.remembered) : () => this.playOffline();
      this.focus.control({ id: door.id, ...box, accept });
      const item = HOME_MENU_ITEMS.find((it) => it.id === door.colours);
      drawSlantedButton(ctx, {
        ...box,
        x: box.x + slide * (1 + i * 0.3),
        f: this.eased(door.id, ease),
        alpha,
        title: door.title,
        titleSize: 34,
        icon: this.icons.get(door.icon),
        plate: item ? rgba(item.plate[p.appearance]) : p.rim,
        chips: [this.doorChip(i)],
        art: (b, artAlpha, grow) => {
          const size = 150 * grow;
          drawSprite(ctx, door.art, b.x + b.w - 30 - size, b.y + b.h - size + 14, size, artAlpha);
        },
      });
    });
  }

  private doorChip(index: number): Chip {
    if (index === 0) {
      if (this.guestConnecting()) return { text: 'Connecting…', tone: 'alert' };
      const error = this.guestError();
      if (error) return { text: error, tone: 'error' };
      if (this.canRetry()) return { text: troubleChip(this.connection.state()), tone: 'error' };
      return { text: 'A random name · battle and chat now', tone: 'muted' };
    }
    if (index === 1) return { text: this.remembered ? `Last time: ${this.remembered}` : 'Your name, avatar and ratings', tone: 'muted' };
    return { text: 'Teambuilder and Settings', tone: 'muted' };
  }

  /** The login form in the doors' place: name, password, remember me, log in automatically, LOG IN. */
  private drawForm(ctx: UiContext, ease: number, slide: number, alpha: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const x = FORM.x + slide;
    const tint = HOME_MENU_ITEMS.find((it) => it.id === 'teambuilder');
    renderer.rect(x, FORM.y + 12, FORM.w, FORM.h, { fill: [0, 0, 0, 0.2 * alpha], radius: 22, softness: 30 });
    renderer.rect(x, FORM.y, FORM.w, FORM.h, {
      fill: withAlpha(p.panel, alpha),
      fillEnd: withAlpha(tint ? rgba(tint.plate[p.appearance]) : p.panel, alpha),
      stroke: withAlpha(p.rim, alpha),
      border: 1,
      radius: 22,
    });
    const icon = this.icons.get('battle');
    if (icon) renderer.image(icon, x + 40, FORM.y + 26, 2, [1, 1, 1, alpha]);
    label(ctx, 'LOG IN', x + 100, FORM.y + 50, { size: 34, bold: true }, withAlpha(p.ink, alpha));
    label(ctx, 'Your own name: your avatar, ratings and battle history.', x + 42, FORM.y + 96, { size: 17 }, withAlpha(p.muted, alpha), { maxWidth: FORM.w - 80 });

    drawField(ctx, 'form-name', { x: x + 40, y: FORM.y + 146, w: 620, h: 60 }, {
      label: 'NAME',
      value: this.name(),
      placeholder: 'Your Showdown name',
      edit: () => this.editName(),
    });
    drawField(ctx, 'form-password', { x: x + 40, y: FORM.y + 244, w: 620, h: 60 }, {
      label: 'PASSWORD',
      value: this.password(),
      placeholder: 'Empty for an unregistered name',
      masked: true,
      edit: () => this.editPassword('form-submit'),
    });
    drawSwitch(ctx, 'form-remember', x + 30, FORM.y + 324, 'Remember me', this.rememberName(), () => this.rememberName.update((on) => !on));
    if (this.saved.canSavePassword) {
      drawSwitch(ctx, 'form-auto', x + 300, FORM.y + 324, 'Log in automatically', this.autoLogin(), () => this.autoLogin.update((on) => !on));
    }
    const box = { x: x + 46, y: FORM.y + 392, w: 600, h: 84 };
    this.focus.control({ id: 'form-submit', ...box, accept: () => this.submit(this.name()) });
    const ready = this.canSubmit() && this.name().trim() !== '';
    drawSlantedButton(ctx, {
      ...box,
      f: this.eased('form-submit', ease),
      alpha: alpha * (ready || this.canRetry() ? 1 : 0.5),
      title: this.canRetry() ? 'TRY AGAIN NOW' : this.login.state().loggingIn ? 'LOGGING IN…' : 'LOG IN',
      titleSize: 30,
      plate: p.accent,
      primary: true,
    });
  }

  /** A returning player: their name, the password, one button to continue; the other ways in under it. */
  private drawWelcome(ctx: UiContext, ease: number, slide: number, alpha: number): void {
    const p = ctx.palette;
    const x = 528 + slide;
    label(ctx, 'WELCOME BACK', x, 128, { size: 16, bold: true }, withAlpha(p.muted, alpha));
    label(ctx, this.remembered, x - 2, 168, { size: 50, bold: true }, withAlpha(p.ink, alpha), { maxWidth: 690 });
    drawField(ctx, 'welcome-password', { x, y: 236, w: 692, h: 60 }, {
      label: 'PASSWORD',
      value: this.password(),
      placeholder: 'Empty for an unregistered name',
      masked: true,
      edit: () => this.editPassword('welcome-continue'),
    });
    const box = { x: x + 6, y: 324, w: 680, h: 106 };
    this.focus.control({ id: 'welcome-continue', ...box, accept: () => this.submit(this.remembered) });
    drawSlantedButton(ctx, {
      ...box,
      f: this.eased('welcome-continue', ease),
      alpha: alpha * (this.canSubmit() || this.canRetry() ? 1 : 0.5),
      title: this.canRetry() ? 'TRY AGAIN NOW' : this.login.state().loggingIn ? 'LOGGING IN…' : `CONTINUE AS ${this.remembered.toUpperCase()}`,
      titleSize: 30,
      plate: p.accent,
      primary: true,
      art: (b, artAlpha, grow) => drawSprite(ctx, 'lucario', b.x + b.w - 150, b.y + b.h - 128 * grow + 12, 128 * grow, artAlpha * 0.6),
    });
    if (this.saved.canSavePassword) drawSwitch(ctx, 'welcome-auto', x - 4, 448, 'Log in automatically next time', this.autoLogin(), () => this.autoLogin.update((on) => !on));
    // OR, and the other ways in.
    ctx.renderer.rect(x, 520, 316, 2, { fill: withAlpha(p.rim, alpha) });
    label(ctx, 'OR', x + 346, 521, { size: 15, bold: true }, withAlpha(p.muted, alpha), { align: 'center' });
    ctx.renderer.rect(x + 376, 520, 316, 2, { fill: withAlpha(p.rim, alpha) });
    drawRoundButton(ctx, 'welcome-other', { x, y: 552, w: 220, h: 52 }, 'Another name', () => this.openForm(''));
    drawRoundButton(ctx, 'welcome-guest', { x: x + 236, y: 552, w: 220, h: 52 }, this.guestConnecting() ? 'Connecting…' : 'Guest', () => this.connectAsGuest());
    drawRoundButton(ctx, 'welcome-offline', { x: x + 472, y: 552, w: 220, h: 52 }, 'Play offline', () => this.playOffline());
  }

  /** Under the right side: what the focused control does (or how the login is going), and the buttons. */
  private drawFooter(ctx: UiContext, alpha: number): void {
    const p = ctx.palette;
    const y = 680;
    const status = this.loginStatus();
    const hint = status?.text ?? HINTS[this.focus.focused ?? ''] ?? '';
    // The connection's story can take two lines (why, and when it tries again).
    const lines = ctx.text.wrap(hint, { size: 16 }, 520).slice(0, 2);
    lines.forEach((line, i) => label(ctx, line, 520, y + (i - (lines.length - 1) / 2) * 20, { size: 16, bold: status?.error ?? false }, withAlpha(status?.error ? p.danger : p.muted, alpha), { maxWidth: 520 }));
    const focused = this.focus.focused ?? '';
    const keys: [string, string][] = [['A', focused.endsWith('-name') || focused.endsWith('-password') ? 'Type' : 'Select']];
    if (this.step() === 'form') keys.push(['B', 'Back']);
    // Right-aligned, the last one at the edge.
    keysLegend(ctx, keys, 1232, y, { color: withAlpha(p.ink, alpha) });
  }
}

/** What each control does, under the right side. */
const HINTS: Record<string, string> = {
  'door-guest': 'Play now with a random name.',
  'door-login': 'Use your own name and keep your ratings.',
  'door-offline': 'Build teams and change settings without a connection.',
  'form-name': 'The on-screen keyboard opens on A.',
  'form-password': 'A registered name needs its password.',
  'form-remember': 'Next time, this screen welcomes you by name.',
  'form-auto': 'The password stays on this console, in the app’s own file.',
  'form-submit': 'Log in and open the menu.',
  'welcome-password': 'A registered name needs its password.',
  'welcome-continue': 'Log in and open the menu.',
  'welcome-auto': 'The password stays on this console, in the app’s own file.',
  'welcome-other': 'Log in with a different name.',
  'welcome-guest': 'Play now with a random name.',
  'welcome-offline': 'Build teams and change settings without a connection.',
};
