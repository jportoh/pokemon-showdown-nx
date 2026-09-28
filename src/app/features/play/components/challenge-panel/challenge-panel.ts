import { Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';
import { ChallengeForm } from './challenge-form';

/**
 * Our name on Showdown once connected from the home screen (a guest's is random, with a button for
 * another one, for when it's taken; or the player's own after logging in) and the challenges other players
 * send us (the oldest first), with Accept and Reject. We can challenge a player by name too, and cancel
 * it while it waits. Accepting (either side) opens the battle (see App). Formats that need a team of
 * ours can only be rejected for now. A fixed 720x152 area of absolutely placed rows, meant for a retro
 * box: its content changes while it's shown, and on Brewser only normal-flow wrappers toggle reliably.
 */
@Component({
  imports: [ChallengeForm],
  selector: 'app-challenge-panel',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[152px] w-[720px]' },
  template: `
    <section aria-label="Challenges" class="relative h-[152px] w-[720px] text-retro-ink">
      @if (challengeFormOpen()) {
        <div><app-challenge-form (closed)="closeForm()" /></div>
      } @else {
        <div>
          <p role="status" class="absolute top-0 left-0 block h-8 w-[540px] truncate text-lg leading-8 text-retro-muted">
            @if (name(); as name) {
              Your name on Showdown: <strong class=" text-xl font-bold text-retro-ink">{{ name }}</strong>
            } @else {
              {{ statusText() }}
            }
          </p>
          @if (canRename()) {
            <!-- A guest's name is random: another one, for when it's taken or blocked. -->
            <button
              type="button"
              [class]="secondaryClass"
              class="absolute top-0 left-[560px] h-8 w-[160px] text-base"
              aria-label="Get another random name"
              (click)="login.newName()"
            >
              New name
            </button>
          }
          @if (challenge(); as challenge) {
            <div>
              <p class="absolute top-[48px] left-0 block h-11 w-[720px] truncate text-2xl leading-[44px] font-bold text-retro-accent-text">
                {{ challenge.from }} wants to battle: {{ challenge.formatName }}{{ others() }}
              </p>
              @if (challenge.needsTeam) {
                <p class="absolute top-[108px] left-0 block h-11 w-[352px] text-base leading-[44px] text-retro-muted">Needs a team: not supported yet</p>
              } @else {
                <button
                  type="button"
                  data-autofocus
                  [class]="primaryClass"
                  class="absolute top-[108px] left-0 h-11 w-[352px] text-2xl"
                  [attr.aria-label]="'Accept the challenge from ' + challenge.from"
                  (click)="challenges.accept(challenge)"
                >
                  Accept
                </button>
              }
              <button
                type="button"
                [class]="secondaryClass"
                class="absolute top-[108px] left-[368px] h-11 w-[352px] text-2xl"
                [attr.aria-label]="'Reject the challenge from ' + challenge.from"
                (click)="challenges.reject(challenge)"
              >
                Reject
              </button>
            </div>
          } @else {
            <div>
              <p class="absolute top-[44px] left-0 block h-[52px] w-[720px] overflow-hidden text-base leading-[26px]" [class]="hintClass()">
                {{ hintText() }}
              </p>
              @if (challenges.outgoing(); as outgoing) {
                <button
                  type="button"
                  [class]="primaryClass"
                  class="absolute top-[108px] left-0 h-11 w-[352px] text-2xl"
                  [attr.aria-label]="'Cancel the challenge to ' + outgoing.to"
                  (click)="challenges.cancelChallenge()"
                >
                  Cancel challenge
                </button>
              } @else {
                <button
                  #challengeButton
                  type="button"
                  [class]="secondaryClass"
                  class="absolute top-[108px] left-0 h-11 w-[352px] text-2xl"
                  [disabled]="!name()"
                  (click)="challengeFormOpen.set(true)"
                >
                  Challenge a player
                </button>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class ChallengePanel {
  private readonly connection = inject(ShowdownConnection);
  private readonly injector = inject(Injector);
  protected readonly login = inject(ShowdownLogin);
  protected readonly challenges = inject(ShowdownChallenges);
  private readonly challengeButton = viewChild<ElementRef<HTMLButtonElement>>('challengeButton');

  protected readonly challengeFormOpen = signal(false);

  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  protected readonly challenge = computed(() => this.challenges.incoming()[0] ?? null);

  protected readonly others = computed(() => {
    const more = this.challenges.incoming().length - 1;
    return more > 0 ? ` (+${more} more)` : '';
  });

  protected readonly statusText = computed(() => {
    const login = this.login.state();
    if (login.status === 'offline') return 'Offline';
    if (login.status === 'unavailable') return 'Online battles unavailable';
    if (this.connection.state().status !== 'connected') return 'Connecting to Showdown…';
    return 'Getting a name on Showdown…';
  });

  /** Our name once the server calls us by it, for other players to challenge. */
  protected readonly name = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && this.connection.state().status === 'connected' ? login.name : null;
  });

  /** A guest can ask for another random name once connected, unless one is being claimed right now. */
  protected readonly canRename = computed(
    () =>
      this.connection.state().status === 'connected' &&
      this.login.state().mode === 'guest' &&
      ['named', 'unavailable'].includes(this.login.state().status),
  );

  private readonly problem = computed(() => {
    const login = this.login.state();
    return login.status === 'unavailable' ? login.error : this.challenges.error();
  });

  protected readonly hintText = computed(() => {
    const outgoing = this.challenges.outgoing();
    if (this.login.state().status === 'offline') {
      return 'Connect from the menu (as a guest or logging in) to send and receive challenges.';
    }
    return (
      this.problem() ??
      (outgoing
        ? `Waiting for ${outgoing.to} to accept the Random Battle…`
        : 'Other players can challenge this name to a Random Battle, or challenge one yourself. Challenges show here.')
    );
  });

  protected readonly hintClass = computed(() => (this.problem() ? 'font-bold text-retro-danger' : 'text-retro-muted'));

  /** Back to the name and challenges, with focus on the button that opened the form. */
  protected closeForm(): void {
    this.challengeFormOpen.set(false);
    afterNextRender(() => this.challengeButton()?.nativeElement.focus(), { injector: this.injector });
  }
}
