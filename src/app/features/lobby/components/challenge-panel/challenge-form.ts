import { Component, ElementRef, afterNextRender, inject, output, signal, viewChild } from '@angular/core';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { isEnterKey } from '@core/input/console-keys';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { BackAction } from '@shared/directives/back-action';
import { toId } from '@shared/utils/to-id';

/** Challenges go out in a random format only: a challenge can't carry one of our teams yet. */
const CHALLENGE_FORMAT = 'gen9randombattle';

/**
 * Challenges a player by name to a Random Battle, laid out over the challenge panel's three rows.
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
        class="absolute top-[8px] left-[24px] block h-7 w-[512px] truncate text-sm leading-7"
        [class]="error() ? 'text-red-300' : 'text-gray-300'"
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
        class="absolute top-[38px] left-[24px] h-8 w-[512px] rounded-md border border-gray-400 bg-gray-800 p-[0_12px] text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      />
      <button
        type="button"
        class="absolute top-[72px] left-[24px] h-9 w-[244px] cursor-pointer rounded-md border border-blue-300 bg-blue-700 text-lg font-bold hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        (click)="submit()"
      >
        Send challenge
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
export class ChallengeForm {
  private readonly challenges = inject(ShowdownChallenges);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  /** The challenge went out, or the form was cancelled. */
  readonly closed = output<void>();

  private readonly model = signal({ name: '' });
  // Showdown's limit for names.
  protected readonly challengeForm = form(this.model, (path) => maxLength(path.name, 18));
  protected readonly error = signal<string | null>(null);

  constructor() {
    afterNextRender(() => this.nameInput().nativeElement.focus());
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
