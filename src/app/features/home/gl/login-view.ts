import { computed, inject, signal } from '@angular/core';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, UiContext, button, label, retroBox, textField } from '@core/gl/ui/retro-kit';
import { SavedLogin } from '@features/connection/saved-login';
import { connectionNotice } from '@features/connection/connection-notice';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';

/** The boxes over the menu: most of the stage under the bar (a retro box, 1088x568 at 96,116). */
export const BOX: Box = { x: 96, y: 116, w: 1088, h: 568 };
/** Where a box's content starts: inside its outline and rim (3px each). */
export const INNER_X = BOX.x + 6;
export const INNER_Y = BOX.y + 6;

/**
 * Connecting to Showdown: first as a guest (a random name), or
 * below it with the player's own name once the connection is ready (a registered name with its
 * password, a free one with the password left empty). The fields type with the canvas keyboard, whose
 * OK moves on: from the name to the password, from the password to Log in. B closes it; it closes
 * itself once the server calls us by a name (`finished`), so the menu never shows while the
 * connection is still on its way. On the entry screen (`offline` given) a third choice skips connecting.
 */
export class LoginView {
  private readonly login = inject(ShowdownLogin);
  private readonly connection = inject(ShowdownConnection);
  private readonly keyboard = inject(CanvasKeyboard);

  readonly firstId = 'login-guest';
  /** The name last logged in with, when Settings remembers it (Showdown's limit: 18 characters). */
  private readonly name = signal(inject(SavedLogin).name());
  private readonly password = signal('');
  /** A login was asked for here: its success closes the box. */
  private readonly submitted = signal(false);

  /** `offline`: the entry screen's "Play offline" next to the guest's button. */
  constructor(
    private readonly focus: CanvasFocus,
    private readonly offline?: () => void,
  ) {}

  private readonly guestConnecting = computed(() => {
    const state = this.login.state();
    return state.mode === 'guest' && (state.status === 'connecting' || state.status === 'naming');
  });

  /** Attempts to connect keep failing (no network, Showdown out of reach): the first button tries again at once. */
  private readonly canRetry = computed(() => {
    const connection = this.connection.state();
    return connection.trouble !== null && connection.status !== 'connected' && connection.status !== 'offline';
  });

  private readonly canConnectAsGuest =computed(() => !this.guestConnecting() && !this.login.state().loggingIn);

  /** Only an error from something asked for here: a login's, or a guest's that found no name. */
  private readonly error = computed(() => {
    const state = this.login.state();
    if (state.mode === 'guest') return state.status === 'unavailable' ? state.error : null;
    return this.submitted() ? state.loginError : null;
  });

  /** The server's challenge is here and nothing is under way. */
  private readonly canSubmit = computed(() => {
    const state = this.login.state();
    const hasChallenge = state.status === 'ready' || state.status === 'named' || state.status === 'unavailable';
    return hasChallenge && !state.loggingIn && !this.guestConnecting();
  });

  private readonly statusText = computed(() => {
    const error = this.error();
    if (error) return error;
    const state = this.login.state();
    // Attempts that keep failing: why, rather than "Connecting…" for ever.
    if (this.canRetry()) return connectionNotice(this.connection.state(), state) ?? '';
    if (this.guestConnecting()) return 'Connecting as a guest…';
    if (state.loggingIn) return 'Logging in…';
    if (state.status === 'connecting' || state.status === 'offline') return 'Connecting to Showdown…';
    return 'Leave the password empty for an unregistered name.';
  });

  /** Connected with a name: the box closes. */
  readonly finished = computed(() => {
    const state = this.login.state();
    const guestNamed = state.mode === 'guest' && state.status === 'named';
    const loggedIn = this.submitted() && state.ownName && !state.loggingIn;
    return guestNamed || loggedIn;
  });

  /** Opening: a fresh attempt (the name stays). */
  reset(): void {
    this.submitted.set(false);
    this.password.set('');
  }

  draw(ctx: UiContext): void {
    const p = ctx.palette;
    retroBox(ctx, BOX);
    label(ctx, 'Connect to Showdown', INNER_X + 48, INNER_Y + 56, { size: 40, bold: true }, p.ink);
    const x = INNER_X + 48;
    const y = INNER_Y + 112;
    const retry = this.canRetry();
    const offline = this.offline;
    if (offline) button(ctx, 'login-offline', { x: x + 676, y, w: 304, h: 80 }, 'Play offline', { size: 30, accept: offline });
    button(ctx, 'login-guest', { x, y, w: offline ? 660 : 980, h: 80 }, retry ? 'Try again now' : this.guestConnecting() ? 'Connecting…' : 'Connect as guest', {
      size: 30,
      accept: () => {
        // While attempts keep failing, it tries again at once rather than waiting for the next try.
        if (this.canRetry()) {
          this.connection.retryNow();
          return;
        }
        if (!this.canConnectAsGuest()) return;
        this.submitted.set(false);
        this.login.connectAsGuest();
      },
    });
    label(ctx, offline ? 'Play straight away with a random name, or build teams without a connection.' : 'Play straight away with a random name.', x, y + 104, { size: 20 }, p.muted, { maxWidth: 980 });
    ctx.renderer.rect(x, y + 148, 980, 3, { fill: p.outline });
    label(ctx, 'Or log in with your own name', x, y + 186, { size: 24, bold: true }, p.ink);
    textField(ctx, 'login-name', { x, y: y + 220, w: 482, h: 64 }, this.name(), {
      placeholder: 'Name',
      edit: () =>
        this.keyboard.open({
          label: 'Showdown name',
          value: this.name(),
          maxLength: 18,
          done: (value) => {
            if (value === null) return;
            this.name.set(value);
            this.focus.focus('login-password');
          },
        }),
    });
    textField(ctx, 'login-password', { x: x + 498, y: y + 220, w: 482, h: 64 }, this.password(), {
      placeholder: 'Password',
      masked: true,
      edit: () =>
        this.keyboard.open({
          label: 'Password (empty for an unregistered name)',
          value: this.password(),
          maxLength: 300,
          masked: true,
          done: (value) => {
            if (value === null) return;
            this.password.set(value);
            if (this.canSubmit()) this.focus.focus('login-submit');
          },
        }),
    });
    button(ctx, 'login-submit', { x, y: y + 300, w: 980, h: 64 }, 'Log in', {
      primary: true,
      size: 30,
      disabled: !this.canSubmit(),
      accept: () => this.submit(),
    });
    label(ctx, this.statusText(), x, y + 398, { size: 20, bold: !!this.error() }, this.error() ? p.danger : p.muted, { maxWidth: 980 });
  }

  private submit(): void {
    if (!this.canSubmit()) return;
    const name = this.name().trim();
    this.name.set(name);
    this.submitted.set(true);
    this.login.logIn(name, this.password());
  }
}

/** Showdown's register form asks "What is this Pokémon?" under a Pikachu: here the answer is picked. */
const ANSWERS = ['Eevee', 'Pikachu', 'Jigglypuff', 'Meowth'] as const;

/**
 * Registering the player's unregistered name: a password twice (the
 * canvas keyboard's OK moves on to the next, then to the answers), Showdown's "What is this
 * Pokémon?" question, and Register. Once registered, the menu shows the Trainer Card in its place; B
 * cancels.
 */
export class RegisterView {
  private readonly login = inject(ShowdownLogin);
  private readonly keyboard = inject(CanvasKeyboard);

  readonly firstId = 'register-answer-0';
  private readonly password = signal('');
  private readonly confirmation = signal('');
  private readonly captcha = signal<string | null>(null);

  constructor(private readonly focus: CanvasFocus) {}

  reset(): void {
    this.password.set('');
    this.confirmation.set('');
    this.captcha.set(null);
  }

  draw(ctx: UiContext): void {
    const p = ctx.palette;
    const state = this.login.state();
    retroBox(ctx, BOX);
    const x = INNER_X + 48;
    label(ctx, 'Register your name', x, INNER_Y + 52, { size: 40, bold: true }, p.ink);
    label(ctx, `Keep "${state.name}" as yours: choose a password for it.`, x, INNER_Y + 102, { size: 20 }, p.muted, { maxWidth: 986 });

    textField(ctx, 'register-password', { x, y: INNER_Y + 136, w: 482, h: 64 }, this.password(), {
      placeholder: 'New password',
      masked: true,
      edit: () =>
        this.keyboard.open({
          label: 'New password',
          value: this.password(),
          maxLength: 300,
          masked: true,
          done: (value) => {
            if (value === null) return;
            this.password.set(value);
            this.focus.focus('register-confirmation');
          },
        }),
    });
    textField(ctx, 'register-confirmation', { x: x + 504, y: INNER_Y + 136, w: 482, h: 64 }, this.confirmation(), {
      placeholder: 'Password again',
      masked: true,
      edit: () =>
        this.keyboard.open({
          label: 'New password again',
          value: this.confirmation(),
          maxLength: 300,
          masked: true,
          done: (value) => {
            if (value === null) return;
            this.confirmation.set(value);
            this.focus.focus(this.firstId);
          },
        }),
    });

    const pikachu = ctx.images.sprite('pikachu', false, ImagePriority.Screen);
    if (pikachu) ctx.renderer.rect(x, INNER_Y + 220, 96, 96, { fill: [1, 1, 1, 1], texture: pikachu });
    label(ctx, 'What is this Pokémon?', x + 116, INNER_Y + 238, { size: 24, bold: true }, p.ink);
    ANSWERS.forEach((answer, i) => {
      button(ctx, `register-answer-${i}`, { x: x + 116 + i * 220, y: INNER_Y + 262, w: 210, h: 56 }, answer, {
        primary: this.captcha() === answer,
        size: 24,
        accept: () => this.captcha.set(answer),
      });
    });

    button(ctx, 'register-submit', { x, y: INNER_Y + 352, w: 986, h: 64 }, state.registering ? 'Registering…' : 'Register', {
      primary: true,
      size: 30,
      disabled: state.registering,
      accept: () => this.login.register(this.password(), this.confirmation(), this.captcha()?.toLowerCase() ?? ''),
    });
    const error = state.registerError;
    label(ctx, error ?? 'From now on you log in to it with this password. B to cancel.', x, INNER_Y + 446, { size: 20, bold: !!error }, error ? p.danger : p.muted, { maxWidth: 986 });
  }
}
