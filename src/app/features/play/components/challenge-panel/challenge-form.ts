import { Component, ElementRef, afterNextRender, inject, output, signal, viewChild } from '@angular/core';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { isEnterKey } from '@core/input/console-keys';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_INPUT, RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';
import { toId } from '@shared/utils/to-id';

/** Challenges go out in a random format only: a challenge can't carry one of our teams yet. */
const CHALLENGE_FORMAT = 'gen9randombattle';

/**
 * Challenges a player by name to a Random Battle, in a box over the Battle page (three rows).
 * Sending closes it: the panel then shows the challenge waiting for an answer. The name is read
 * from the input itself (the on-screen keyboard may skip the input events).
 */
@Component({
  imports: [FormField, BackAction],
  selector: 'app-challenge-form',
  host: { class: 'block' },
  template: `
    <div role="group" aria-label="Challenge a player" (appBack)="closed.emit()">
      <p
        id="challenge-status"
        role="status"
        class="absolute top-0 left-0 block h-8 w-[720px] truncate text-lg leading-8"
        [class]="error() ? 'font-bold text-retro-danger' : 'text-retro-muted'"
      >
        {{ error() ?? 'Challenge a player on Showdown to a Gen 9 Random Battle.' }}
      </p>
      <input
        #nameInput
        type="text"
        aria-label="Player to challenge"
        aria-describedby="challenge-status"
        placeholder="Player's name"
        [formField]="challengeForm.name"
        (keydown)="onEnter($event)"
        [class]="inputClass"
        class="absolute top-[48px] left-0 h-11 w-[720px] text-lg"
      />
      <button #sendButton type="button" [class]="primaryClass" class="absolute top-[108px] left-0 h-11 w-[352px] text-2xl" (click)="submit()">
        Send challenge
      </button>
      <button
        type="button"
        [class]="secondaryClass"
        class="absolute top-[108px] left-[368px] h-11 w-[352px] text-2xl"
        (click)="closed.emit()"
      >
        Cancel
      </button>
    </div>
  `,
})
export class ChallengeForm {
  private readonly challenges = inject(ShowdownChallenges);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
  private readonly sendButton = viewChild.required<ElementRef<HTMLButtonElement>>('sendButton');

  /** The challenge went out, or the form was cancelled. */
  readonly closed = output<void>();

  protected readonly inputClass = RETRO_INPUT;
  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  private readonly model = signal({ name: '' });
  // Showdown's limit for names.
  protected readonly challengeForm = form(this.model, (path) => maxLength(path.name, 18));
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Never a text field: focusing one opens the console's keyboard, which breaks the navigation under
    // way. The field is one step up.
    afterNextRender(() => this.sendButton().nativeElement.focus());
  }

  protected onEnter(event: KeyboardEvent): void {
    if (!isEnterKey(event)) return;
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    const name = this.nameInput().nativeElement.value.trim();
    this.model.set({ name });
    if (!toId(name)) {
      this.error.set('Enter the name of the player to challenge.');
      return;
    }
    this.challenges.challenge(name, CHALLENGE_FORMAT);
    this.closed.emit();
  }
}
