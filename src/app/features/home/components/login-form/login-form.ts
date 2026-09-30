import { Component, ElementRef, afterNextRender, computed, effect, inject, output, signal, viewChild } from '@angular/core';
import { SavedLogin } from '@features/connection/saved-login';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { KeyboardField } from '@shared/components/keyboard-field';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/**
 * Connects to Showdown, over a fixed 980x416 area (the home screen's login box): first as a guest (a
 * random name), or below it with the player's own name once the connection is ready: a registered
 * name with its password, a free one with the password left empty. B closes it. It closes itself only
 * once the server calls us by a name (the guest's or the player's), so the menu is never shown while
 * the connection is still on its way. The fields type with the app's own on-screen keyboard, and OK
 * on it moves on: from the name to the password, from the password to Log in.
 */
@Component({
  imports: [BackAction, KeyboardField],
  selector: 'app-login-form',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[416px] w-[980px]' },
  template: `
    <div role="group" aria-label="Connect to Showdown" (appBack)="closed.emit()">
      <button
        #guestButton
        type="button"
        [class]="secondaryClass"
        class="absolute top-0 left-0 h-20 w-[980px] text-3xl"
        [attr.aria-disabled]="!canConnectAsGuest()"
        aria-describedby="guest-hint login-status"
        (click)="connectAsGuest()"
      >
        {{ guestConnecting() ? 'Connecting…' : 'Connect as guest' }}
      </button>
      <p id="guest-hint" class="absolute top-[88px] left-0 block h-8 w-[980px] text-xl leading-8 text-retro-muted">
        Play straight away with a random name.
      </p>

      <div aria-hidden="true" class="absolute top-[148px] left-0 block h-[3px] w-[980px] bg-retro-outline"></div>
      <p class="absolute top-[168px] left-0 block h-9 w-[980px] text-2xl leading-9 font-bold">Or log in with your own name</p>
      <app-keyboard-field
        [(value)]="name"
        label="Showdown name"
        describedBy="login-status"
        placeholder="Name"
        [maxLength]="18"
        [width]="482"
        [height]="64"
        (accepted)="passwordField.focus()"
        class="absolute top-[220px] left-0"
      />
      <app-keyboard-field
        #passwordField
        [(value)]="password"
        label="Password (empty for an unregistered name)"
        describedBy="login-status"
        placeholder="Password"
        [masked]="true"
        [width]="482"
        [height]="64"
        (accepted)="focusLogIn()"
        class="absolute top-[220px] left-[498px]"
      />
      <button
        #logInButton
        type="button"
        [class]="primaryClass"
        class="absolute top-[300px] left-0 h-16 w-[980px] text-3xl"
        [disabled]="!canSubmit()"
        (click)="submit()"
      >
        Log in
      </button>

      <p
        id="login-status"
        role="status"
        class="absolute top-[380px] left-0 block h-9 w-[980px] truncate text-xl leading-9"
        [class]="error() ? 'font-bold text-retro-danger' : 'text-retro-muted'"
      >
        {{ statusText() }}
      </p>
    </div>
  `,
})
export class LoginForm {
  protected readonly login = inject(ShowdownLogin);
  private readonly guestButton = viewChild.required<ElementRef<HTMLButtonElement>>('guestButton');
  private readonly logInButton = viewChild.required<ElementRef<HTMLButtonElement>>('logInButton');

  /** Backed out (B), or connected with a name. */
  readonly closed = output<void>();

  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  // The name last logged in with, when Settings remembers it. At most 18 characters, Showdown's limit.
  protected readonly name = signal(inject(SavedLogin).name());
  protected readonly password = signal('');
  /** A login was asked for here: its success closes the form. */
  private readonly submitted = signal(false);

  /** A guest's name is on its way. */
  protected readonly guestConnecting = computed(() => {
    const state = this.login.state();
    return state.mode === 'guest' && (state.status === 'connecting' || state.status === 'naming');
  });

  /**
   * Nothing is on its way already. The button stays enabled (only aria-disabled) so it keeps the
   * focus while its connection is under way.
   */
  protected readonly canConnectAsGuest = computed(() => !this.guestConnecting() && !this.login.state().loggingIn);

  /**
   * Only an error from something asked for here: a login's, or a guest's that found no name. An older
   * one would read as this one's.
   */
  protected readonly error = computed(() => {
    const state = this.login.state();
    if (state.mode === 'guest') return state.status === 'unavailable' ? state.error : null;
    return this.submitted() ? state.loginError : null;
  });

  /**
   * The server's challenge is here (`ready`, `named` to switch names, or `unavailable` after a guest
   * found no name) and nothing is under way.
   */
  protected readonly canSubmit = computed(() => {
    const state = this.login.state();
    const hasChallenge = state.status === 'ready' || state.status === 'named' || state.status === 'unavailable';
    return hasChallenge && !state.loggingIn && !this.guestConnecting();
  });

  protected readonly statusText = computed(() => {
    const error = this.error();
    if (error) return error;
    const state = this.login.state();
    if (this.guestConnecting()) return 'Connecting as a guest…';
    if (state.loggingIn) return 'Logging in…';
    if (state.status === 'connecting' || state.status === 'offline') return 'Connecting to Showdown…';
    return 'Leave the password empty for an unregistered name.';
  });

  constructor() {
    // Never a text field: focusing one opens the console's keyboard, which breaks the navigation under
    // way. The guest's button is the first one anyway.
    afterNextRender(() => this.guestButton().nativeElement.focus());
    effect(() => {
      const state = this.login.state();
      const guestNamed = state.mode === 'guest' && state.status === 'named';
      const loggedIn = this.submitted() && state.ownName && !state.loggingIn;
      if (guestNamed || loggedIn) this.closed.emit();
    });
  }

  /** After the password: Log in, unless it can't be pressed yet (focus would be lost on it). */
  protected focusLogIn(): void {
    if (this.canSubmit()) this.logInButton().nativeElement.focus();
  }

  protected connectAsGuest(): void {
    if (!this.canConnectAsGuest()) return;
    this.submitted.set(false);
    this.login.connectAsGuest();
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    const name = this.name().trim();
    this.name.set(name);
    this.submitted.set(true);
    this.login.logIn(name, this.password());
  }
}
