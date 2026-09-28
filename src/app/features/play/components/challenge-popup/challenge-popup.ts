import { Component, ElementRef, afterRenderEffect, computed, inject, input, output, untracked, viewChild } from '@angular/core';
import { Challenge, ShowdownChallenges } from '@features/connection/showdown-challenges';
import { RetroBox } from '@shared/components/retro-box';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/**
 * A challenge from another player, in a box over the Battle page while it waits for an answer:
 * Accept (only for formats that bring their own teams, for now) or Reject. B leaves it for later:
 * the page keeps a button to come back to it. Focus starts on Accept (or Reject when it can't be accepted),
 * again for each challenge in line.
 */
@Component({
  imports: [BackAction, RetroBox],
  selector: 'app-challenge-popup',
  host: { class: 'block' },
  template: `
    <app-retro-box [width]="784" [height]="328">
      <div role="alertdialog" aria-labelledby="challenge-popup-title" aria-describedby="challenge-popup-text" class="block" (appBack)="later.emit()">
        <h2 id="challenge-popup-title" class="absolute top-[24px] left-[32px] block h-12 w-[712px] truncate text-4xl leading-[48px] font-bold text-retro-accent-text">
          {{ challenge().from }} wants to battle!
        </h2>
        <p id="challenge-popup-text" class="absolute top-[88px] left-[32px] block h-16 w-[712px] text-xl leading-8">
          {{ challenge().formatName }}{{ others() }}
          <span class="block text-lg text-retro-muted">{{ challenge().needsTeam ? 'Needs a team: not supported yet.' : 'Showdown hands out the teams.' }}</span>
        </p>
        @if (!challenge().needsTeam) {
          <button
            #accept
            type="button"
            [class]="primaryClass"
            class="absolute top-[184px] left-[32px] h-14 w-[344px] text-2xl"
            [attr.aria-label]="'Accept the challenge from ' + challenge().from"
            (click)="challenges.accept(challenge())"
          >
            Accept
          </button>
        }
        <button
          #reject
          type="button"
          [class]="secondaryClass"
          class="absolute top-[184px] left-[400px] h-14 w-[344px] text-2xl"
          [attr.aria-label]="'Reject the challenge from ' + challenge().from"
          (click)="challenges.reject(challenge())"
        >
          Reject
        </button>
        <!-- The shortcut and the label apart: an inline pill before the text threw the centring off on the console. -->
        <span aria-hidden="true" class="absolute top-[262px] left-[32px] block h-6 w-7 rounded-sm bg-retro-select text-center leading-6 font-bold">B</span>
        <p class="absolute top-[260px] left-[68px] block h-7 w-[676px] text-base leading-7 text-retro-muted">Answer later</p>
      </div>
    </app-retro-box>
  `,
})
export class ChallengePopup {
  protected readonly challenges = inject(ShowdownChallenges);
  private readonly acceptButton = viewChild<ElementRef<HTMLButtonElement>>('accept');
  private readonly rejectButton = viewChild.required<ElementRef<HTMLButtonElement>>('reject');

  readonly challenge = input.required<Challenge>();
  /** How many other challenges wait behind this one. */
  readonly waiting = input(0);
  /** B: the challenge stays, unanswered, and the box closes. */
  readonly later = output<void>();

  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  protected readonly others = computed(() => (this.waiting() > 0 ? ` · ${this.waiting()} more waiting` : ''));

  constructor() {
    // Each challenge shown (the first, then the next one in line) starts on its first button.
    afterRenderEffect(() => {
      this.challenge().fromId;
      untracked(() => (this.acceptButton() ?? this.rejectButton()).nativeElement.focus());
    });
  }
}
