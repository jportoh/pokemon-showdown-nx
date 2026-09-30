import { Component, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { packTeam } from '@features/teambuilder/data/packed-team';
import { Team } from '@features/teambuilder/models/team';
import { PlayableFormat } from '@shared/data/formats';
import { KeyboardField } from '@shared/components/keyboard-field';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';
import { toId } from '@shared/utils/to-id';

/**
 * Challenges a player by name in the format picked on the Battle page, with the team picked there
 * (none in random formats), in a box over the page (three rows).
 * Sending closes it: the panel then shows the challenge waiting for an answer. The name is typed
 * with the app's on-screen keyboard, whose OK moves on to Send challenge.
 */
@Component({
  imports: [FormField, BackAction, KeyboardField],
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
        {{ error() ?? intro() }}
      </p>
      <app-keyboard-field
        label="Player to challenge"
        describedBy="challenge-status"
        placeholder="Player's name"
        textSize="text-lg"
        [formField]="challengeForm.name"
        [width]="720"
        [height]="44"
        (accepted)="sendButton.focus()"
        class="absolute top-[48px] left-0"
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
  private readonly sendButton = viewChild.required<ElementRef<HTMLButtonElement>>('sendButton');

  /** The challenge went out, or the form was cancelled. */
  readonly closed = output<void>();

  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  /** The Battle page's format and team (null in random formats, or when there's none). */
  readonly format = input.required<PlayableFormat>();
  readonly team = input<Team | null>(null);

  protected readonly intro = computed(() => {
    const format = this.format();
    const team = this.team();
    if (format.randomTeams) return `Challenge a player on Showdown to ${format.label}.`;
    return team ? `Challenge a player to ${format.label} with ${team.name}.` : `Pick a team for ${format.label} first.`;
  });

  private readonly model = signal({ name: '' });
  // Showdown's limit for names.
  protected readonly challengeForm = form(this.model, (path) => maxLength(path.name, 18));
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Never a text field: focusing one opens the console's keyboard, which breaks the navigation under
    // way. The field is one step up.
    afterNextRender(() => this.sendButton().nativeElement.focus());
  }

  protected submit(): void {
    const name = this.model().name.trim();
    this.model.set({ name });
    if (!toId(name)) {
      this.error.set('Enter the name of the player to challenge.');
      return;
    }
    const format = this.format();
    const team = this.team();
    if (!format.randomTeams && !team) {
      this.error.set(`Pick a team for ${format.label} first.`);
      return;
    }
    this.challenges.challenge(name, format.id, team ? packTeam(team.sets) : null);
    this.closed.emit();
  }
}
