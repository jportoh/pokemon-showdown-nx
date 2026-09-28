import { Component, ElementRef, afterNextRender, computed, effect, inject, output, signal, viewChild } from '@angular/core';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { isEnterKey } from '@core/input/console-keys';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_INPUT, RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/**
 * Logs in to the player's own Showdown name, in three rows over a fixed 560x116 area (the home
 * screen's login box), once the connection is ready, or a guest's random name instead: a registered name with its password, a free one with the password left empty.
 * Closes itself once the server calls us by the name. The values are read from the inputs themselves:
 * the console's on-screen keyboard may fill them in without the input events that keep the form model
 * up to date.
 */
@Component({
  imports: [FormField, BackAction],
  selector: 'app-login-form',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[116px] w-[560px]' },
  template: `
    <div role="group" aria-label="Log in to Showdown" (appBack)="closed.emit()">
      <p
        id="login-status"
        role="status"
        class="absolute top-[4px] left-0 block h-7 w-[560px] truncate text-base leading-7"
        [class]="error() ? 'font-bold text-retro-danger' : 'text-retro-muted'"
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
        class="absolute top-[38px] left-0 h-9 w-[272px]"
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
        class="absolute top-[38px] left-[288px] h-9 w-[272px]"
      />
      <button
        type="button"
        [class]="primaryClass"
        class="absolute top-[80px] left-0 h-9 w-[176px] text-xl"
        [disabled]="!canSubmit()"
        (click)="submit()"
      >
        Log in
      </button>
      <button
        #guestButton
        type="button"
        [class]="secondaryClass"
        class="absolute top-[80px] left-[188px] h-9 w-[212px] text-xl"
        [disabled]="login.state().loggingIn"
        (click)="guest.emit()"
      >
        Connect as guest
      </button>
      <button type="button" [class]="secondaryClass" class="absolute top-[80px] left-[412px] h-9 w-[148px] text-xl" (click)="closed.emit()">
        Cancel
      </button>
    </div>
  `,
})
export class LoginForm {
  protected readonly login = inject(ShowdownLogin);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly guestButton = viewChild.required<ElementRef<HTMLButtonElement>>('guestButton');

  /** Cancelled, or logged in. */
  readonly closed = output<void>();
  /** Connect with a random name instead. */
  readonly guest = output<void>();

  protected readonly inputClass = RETRO_INPUT;
  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  private readonly model = signal({ name: '', password: '' });
  // Showdown's limit for names.
  protected readonly loginForm = form(this.model, (path) => maxLength(path.name, 18));
  /** A login was asked for here: its success closes the form. */
  private readonly submitted = signal(false);

  /** Only an error from a login asked for here: an older one would read as this one's. */
  protected readonly error = computed(() => (this.submitted() ? this.login.state().loginError : null));

  /** The server's challenge is here (`ready`, or `named` to switch names) and no login is under way. */
  protected readonly canSubmit = computed(() => {
    const state = this.login.state();
    return (state.status === 'ready' || state.status === 'named') && !state.loggingIn;
  });

  protected readonly statusText = computed(() => {
    const error = this.error();
    if (error) return error;
    const state = this.login.state();
    if (state.loggingIn) return 'Logging in…';
    if (state.status === 'connecting' || state.status === 'offline') return 'Connecting to Showdown…';
    return 'Leave the password empty for an unregistered name.';
  });

  constructor() {
    // Never a text field: focusing one opens the console's keyboard, which breaks the navigation under
    // way. The fields are one step up.
    afterNextRender(() => this.guestButton().nativeElement.focus());
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
