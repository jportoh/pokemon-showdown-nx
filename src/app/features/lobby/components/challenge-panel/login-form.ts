import { Component, ElementRef, afterNextRender, computed, effect, inject, output, signal, viewChild } from '@angular/core';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { isEnterKey } from '@core/input/console-keys';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { BackAction } from '@shared/directives/back-action';

/**
 * Logs in to the player's own Showdown name, laid out over the challenge panel's three rows: a
 * registered name with its password, a free one with the password left empty. Closes itself once
 * the server calls us by the name. The values are read from the inputs themselves: the console's
 * on-screen keyboard may fill them in without the input events that keep the form model up to date.
 */
@Component({
  imports: [FormField, BackAction],
  selector: 'app-login-form',
  host: { class: 'block' },
  template: `
    <div role="group" aria-label="Log in to Showdown" (appBack)="closed.emit()">
      <p
        id="login-status"
        role="status"
        class="absolute top-[8px] left-[24px] block h-7 w-[512px] truncate text-sm leading-7"
        [class]="error() ? 'text-red-300' : 'text-gray-300'"
      >
        {{ statusText() }}
      </p>
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
        class="left-[24px] w-[244px]"
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
        class="left-[280px] w-[256px]"
      />
      <button
        type="button"
        class="absolute top-[72px] left-[24px] h-9 w-[244px] cursor-pointer rounded-md border border-blue-300 bg-blue-700 text-lg font-bold hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
        [disabled]="login.state().loggingIn"
        (click)="submit()"
      >
        Log in
      </button>
      <button
        type="button"
        class="absolute top-[72px] left-[280px] h-9 w-[256px] cursor-pointer rounded-md border border-gray-400 bg-gray-600 text-lg font-bold hover:bg-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        (click)="closed.emit()"
      >
        Cancel
      </button>
    </div>
  `,
})
export class LoginForm {
  protected readonly login = inject(ShowdownLogin);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');

  /** Cancelled, or logged in. */
  readonly closed = output<void>();

  protected readonly inputClass =
    'absolute top-[38px] h-8 rounded-md border border-gray-400 bg-gray-800 p-[0_12px] text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

  private readonly model = signal({ name: '', password: '' });
  // Showdown's limit for names.
  protected readonly loginForm = form(this.model, (path) => maxLength(path.name, 18));
  /** A login was asked for here: its success closes the form. */
  private readonly submitted = signal(false);

  /** Only an error from a login asked for here: an older one would read as this one's. */
  protected readonly error = computed(() => (this.submitted() ? this.login.state().loginError : null));

  protected readonly statusText = computed(() => {
    const state = this.login.state();
    const error = this.error();
    if (error) return error;
    if (state.loggingIn) return 'Logging in…';
    return 'Your Showdown name. Leave the password empty if it isn’t registered.';
  });

  constructor() {
    afterNextRender(() => this.nameInput().nativeElement.focus());
    effect(() => {
      const state = this.login.state();
      if (this.submitted() && state.ownName && !state.loggingIn) this.closed.emit();
    });
  }

  protected onEnter(event: KeyboardEvent): void {
    if (!isEnterKey(event)) return;
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    const name = this.nameInput().nativeElement.value.trim();
    const password = this.passwordInput().nativeElement.value;
    this.model.set({ name, password });
    this.submitted.set(true);
    this.login.logIn(name, password);
  }
}
