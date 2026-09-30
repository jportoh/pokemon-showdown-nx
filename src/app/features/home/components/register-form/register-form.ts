import { NgOptimizedImage } from '@angular/common';
import { Component, ElementRef, afterNextRender, computed, inject, output, signal, viewChildren } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { KeyboardField } from '@shared/components/keyboard-field';
import { RetroBox } from '@shared/components/retro-box';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/**
 * Showdown's register form asks "What is this Pokémon?" under a Pikachu. Here the player picks the
 * answer from these rather than typing it (one less trip to the on-screen keyboard).
 */
const ANSWERS = ['Eevee', 'Pikachu', 'Jigglypuff', 'Meowth'] as const;

/**
 * Registers the player's unregistered name, over the home screen (1088x568, as the login box): a
 * password twice, Showdown's "What is this Pokémon?" question, and Register. Once the server has the
 * name registered, the home screen shows the Trainer Card in its place (L's box); B cancels.
 * The passwords are typed with the app's on-screen keyboard, whose OK moves on: to the second
 * password, then to the answers.
 */
@Component({
  imports: [BackAction, KeyboardField, NgOptimizedImage, RetroBox],
  selector: 'app-register-form',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[568px] w-[1088px]' },
  template: `
    <app-retro-box [width]="1088" [height]="568">
      <section aria-labelledby="register-title" (appBack)="closed.emit()">
        <h2 id="register-title" class="absolute top-[28px] left-[48px] block h-12 w-[986px] text-[40px] leading-[48px] font-bold">Register your name</h2>
        <p class="absolute top-[88px] left-[48px] block h-7 w-[986px] overflow-hidden text-xl leading-7 whitespace-nowrap text-retro-muted">
          {{ intro() }}
        </p>

        <app-keyboard-field
          [(value)]="password"
          label="New password"
          describedBy="register-status"
          placeholder="New password"
          [masked]="true"
          [width]="482"
          [height]="64"
          (accepted)="confirmationField.focus()"
          class="absolute top-[136px] left-[48px]"
        />
        <app-keyboard-field
          #confirmationField
          [(value)]="confirmation"
          label="New password again"
          describedBy="register-status"
          placeholder="Password again"
          [masked]="true"
          [width]="482"
          [height]="64"
          (accepted)="focusFirstAnswer()"
          class="absolute top-[136px] left-[552px]"
        />

        <img
          ngSrc="https://play.pokemonshowdown.com/sprites/gen5/pikachu.png"
          width="96"
          height="96"
          alt="An Electric-type mouse that is the mascot of the Pokémon franchise."
          class="absolute top-[220px] left-[48px] block size-24 max-w-none"
        />
        <div role="group" aria-labelledby="register-question">
          <p id="register-question" class="absolute top-[222px] left-[164px] block h-8 w-[870px] text-2xl leading-8 font-bold">What is this Pokémon?</p>
          @for (answer of answers; track answer; let i = $index) {
            <button
              #answerButton
              type="button"
              [class]="captcha() === answer ? primaryClass : secondaryClass"
              class="absolute top-[262px] h-14 w-[210px] text-2xl"
              [style.left.px]="164 + i * 220"
              [attr.aria-pressed]="captcha() === answer"
              (click)="captcha.set(answer)"
            >
              {{ answer }}
            </button>
          }
        </div>

        <button
          type="button"
          [class]="primaryClass"
          class="absolute top-[352px] left-[48px] h-16 w-[986px] text-3xl"
          [disabled]="login.state().registering"
          (click)="submit()"
        >
          {{ login.state().registering ? 'Registering…' : 'Register' }}
        </button>
        <p
          id="register-status"
          role="status"
          class="absolute top-[432px] left-[48px] block h-7 w-[986px] overflow-hidden text-xl leading-7 whitespace-nowrap"
          [class]="login.state().registerError ? 'font-bold text-retro-danger' : 'text-retro-muted'"
        >
          {{ login.state().registerError ?? 'From now on you log in to it with this password. B to cancel.' }}
        </p>
      </section>
    </app-retro-box>
  `,
})
export class RegisterForm {
  protected readonly login = inject(ShowdownLogin);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly answerButtons = viewChildren<ElementRef<HTMLButtonElement>>('answerButton');

  /** Cancelled (B). */
  readonly closed = output<void>();

  protected readonly answers = ANSWERS;
  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly captcha = signal<string | null>(null);
  protected readonly intro = computed(() => `Keep "${this.login.state().name}" as yours: choose a password for it.`);

  constructor() {
    // Never a text field (it opens the console's keyboard): the answers, just under the passwords.
    afterNextRender(() => this.focusFirstAnswer());
  }

  protected focusFirstAnswer(): void {
    const first = this.answerButtons()[0];
    if (first) this.navigation.focus(first.nativeElement);
  }

  protected submit(): void {
    this.login.register(this.password(), this.confirmation(), this.captcha()?.toLowerCase() ?? '');
  }
}
