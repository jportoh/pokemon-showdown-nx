import { Component, ElementRef, afterNextRender, computed, effect, inject, output, signal, viewChild } from '@angular/core';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { isEnterKey } from '@core/input/console-keys';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_INPUT, RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/**
 * Connects to Showdown, over a fixed 980x416 area (the home screen's login box): first as a guest (a
 * random name), or below it with the player's own name once the connection is ready: a registered
 * name with its password, a free one with the password left empty. B closes it. It closes itself only
 * once the server calls us by a name (the guest's or the player's), so the menu is never shown while
 * the connection is still on its way. The values are read from the inputs themselves: the console's
 * on-screen keyboard may fill them in without the input events that keep the form model up to date.
 */
@Component({
  imports: [FormField, BackAction],
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
      <input
        #nameInput
        type="text"
        autocomplete="username"
        aria-label="Showdown name"
        aria-describedby="login-status"
        placeholder="Name"
        [formField]="loginForm.name"
        (keydown)="onEnter($event)"
        [class]="inputClass"
        class="absolute top-[220px] left-0 h-16 w-[482px]"
      />
      <input
        #passwordInput
        type="password"
        autocomplete="current-password"
        aria-label="Password (empty for an unregistered name)"
        aria-describedby="login-status"
        placeholder="Password"
        [formField]="loginForm.password"
        (keydown)="onEnter($event)"
        [class]="inputClass"
        class="absolute top-[220px] left-[498px] h-16 w-[482px]"
      />
      <button
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
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly guestButton = viewChild.required<ElementRef<HTMLButtonElement>>('guestButton');

  /** Backed out (B), or connected with a name. */
  readonly closed = output<void>();

  // The retro input's text, larger for this box.
  protected readonly inputClass = RETRO_INPUT.replace('text-base', 'text-2xl');
  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  private readonly model = signal({ name: '', password: '' });
  // Showdown's limit for names.
  protected readonly loginForm = form(this.model, (path) => maxLength(path.name, 18));
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

  protected connectAsGuest(): void {
    if (!this.canConnectAsGuest()) return;
    this.submitted.set(false);
    this.login.connectAsGuest();
  }

  protected onEnter(event: KeyboardEvent): void {
    if (!isEnterKey(event)) return;
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    const name = this.nameInput().nativeElement.value.trim();
    const password = this.passwordInput().nativeElement.value;
    this.model.set({ name, password });
    this.submitted.set(true);
    this.login.logIn(name, password);
  }
}
