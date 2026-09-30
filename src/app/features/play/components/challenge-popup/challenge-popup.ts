import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input, linkedSignal, output, untracked, viewChild } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { Challenge, ShowdownChallenges } from '@features/connection/showdown-challenges';
import { packTeam } from '@features/teambuilder/data/packed-team';
import { Team } from '@features/teambuilder/models/team';
import { RetroBox } from '@shared/components/retro-box';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/**
 * A challenge from another player, in a box over the Battle page while it waits for an answer:
 * Accept (in formats played with our own teams, with one of ours for it: the Battle page's, L/R to
 * pick another) or Reject, after a look at the
 * challenger's Trainer Card if the player wants (the page shows it). B leaves it for later:
 * the page keeps a button to come back to it. Focus starts on Accept (or Reject when it can't be accepted),
 * again for each challenge in line. Once accepted, the box stays with "Joining battle…" in place of its
 * buttons (hidden, not removed) until the battle has something to show (see BattleRooms), when App opens it.
 */
@Component({
  imports: [BackAction, RetroBox],
  selector: 'app-challenge-popup',
  host: { class: 'block' },
  template: `
    <app-retro-box [width]="784" [height]="328">
      <div role="alertdialog" aria-labelledby="challenge-popup-title" aria-describedby="challenge-popup-text" class="block" (appBack)="back()">
        <h2 id="challenge-popup-title" class="absolute top-[24px] left-[32px] block h-12 w-[712px] truncate text-4xl leading-[48px] font-bold text-retro-accent-text">
          {{ challenge().from }} wants to battle!
        </h2>
        <p id="challenge-popup-text" class="absolute top-[88px] left-[32px] block h-16 w-[712px] text-xl leading-8">
          {{ challenge().formatName }}{{ others() }}
          <span class="block text-lg text-retro-muted">{{ teamLine() }}</span>
        </p>
        <!--
          The text and the buttons stay mounted and swap with display:none: removing the buttons with
          @if left them painted under "Joining battle…" on the console.
        -->
        <p #joiningText tabindex="-1" role="status" class="absolute top-[196px] left-[32px] block h-8 w-[712px] text-2xl leading-8 font-bold" [class.hidden]="!joining()">
          {{ joining() ? 'Joining battle…' : '' }}
        </p>
        <div class="block" [class.hidden]="joining()">
          @if (canAccept()) {
            <button
              #accept
              type="button"
              [class]="primaryClass"
              class="absolute top-[184px] left-[32px] h-14 w-[344px] text-2xl"
              [attr.aria-label]="'Accept the challenge from ' + challenge().from"
              (click)="acceptChallenge()"
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
          <p class="absolute top-[260px] left-[68px] block h-7 w-[420px] text-base leading-7 text-retro-muted">Answer later</p>
          <button
            #cardButton
            type="button"
            [class]="secondaryClass"
            class="absolute top-[250px] left-[524px] h-11 w-[220px] text-lg"
            [attr.aria-label]="'See the Trainer Card of ' + challenge().from"
            (click)="viewCard.emit()"
          >
            Trainer Card
          </button>
        </div>
      </div>
    </app-retro-box>
  `,
})
export class ChallengePopup {
  protected readonly challenges = inject(ShowdownChallenges);
  private readonly acceptButton = viewChild<ElementRef<HTMLButtonElement>>('accept');
  private readonly rejectButton = viewChild<ElementRef<HTMLButtonElement>>('reject');
  private readonly cardButton = viewChild<ElementRef<HTMLButtonElement>>('cardButton');
  private readonly joiningText = viewChild.required<ElementRef<HTMLElement>>('joiningText');

  readonly challenge = input.required<Challenge>();
  /** How many other challenges wait behind this one. */
  readonly waiting = input(0);
  /** The player's teams for the challenge's format (none in random formats). */
  readonly teams = input<readonly Team[]>([]);
  /** The team picked on the Battle page, taken first when it fits. */
  readonly preferredTeam = input<string | null>(null);
  /** B: the challenge stays, unanswered, and the box closes. */
  readonly later = output<void>();
  /** The challenger's Trainer Card was asked for (the page shows it over the box). */
  readonly viewCard = output<void>();

  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  protected readonly others = computed(() => (this.waiting() > 0 ? ` · ${this.waiting()} more waiting` : ''));

  /** The team to accept with: the Battle page's when it fits, else the first; L/R step through them. */
  private readonly teamIndex = linkedSignal(() => {
    this.challenge().fromId;
    return Math.max(0, this.teams().findIndex((team) => team.id === this.preferredTeam()));
  });
  private readonly team = computed(() => this.teams()[this.teamIndex()] ?? null);

  /** Accepted: waiting for the battle to open. */
  protected readonly joining = computed(() => this.challenges.accepted()?.fromId === this.challenge().fromId);

  protected readonly canAccept = computed(() => !this.challenge().needsTeam || this.team() !== null);

  protected readonly teamLine = computed(() => {
    if (!this.challenge().needsTeam) return 'Showdown hands out the teams.';
    const team = this.team();
    if (!team) return "You have no team for this format.";
    return this.teams().length > 1 ? `With your team ${team.name} · L/R to change` : `With your team ${team.name}`;
  });

  constructor() {
    const navigation = inject(KeyboardNavigation);
    const unregister = [
      navigation.registerButton('buttonL', () => this.cycleTeam(-1)),
      navigation.registerButton('buttonR', () => this.cycleTeam(1)),
    ];
    inject(DestroyRef).onDestroy(() => unregister.forEach((fn) => fn()));
    // Each challenge shown (the first, then the next one in line) starts on its first button.
    afterRenderEffect(() => {
      this.challenge().fromId;
      untracked(() => (this.acceptButton() ?? this.rejectButton())?.nativeElement.focus());
    });
    // Accepted: the buttons hide, so focus goes to the status text instead of staying on a hidden one.
    afterRenderEffect(() => {
      if (this.joining()) untracked(() => this.joiningText().nativeElement.focus());
    });
  }

  protected acceptChallenge(): void {
    const team = this.team();
    this.challenges.accept(this.challenge(), this.challenge().needsTeam && team ? packTeam(team.sets) : null);
  }

  /** B: for later, unless it's accepted already. */
  protected back(): void {
    if (!this.joining()) this.later.emit();
  }

  /** L/R: the previous or next team to accept with (wrapping around), when there's more than one. */
  private cycleTeam(step: 1 | -1): boolean {
    const count = this.teams().length;
    if (!this.challenge().needsTeam || count < 2 || this.joining()) return false;
    this.teamIndex.set((this.teamIndex() + step + count) % count);
    return true;
  }

  /** Back from the challenger's card: on the button that opened it. */
  focusCardButton(): void {
    this.cardButton()?.nativeElement.focus();
  }
}
