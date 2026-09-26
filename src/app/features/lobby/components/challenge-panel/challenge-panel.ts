import { Component, computed, inject } from '@angular/core';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';

/**
 * Our name on Showdown and the challenges other players send us (the oldest first), with Accept and
 * Reject. Accepting opens the battle (see App). Formats that need a team of ours can only be rejected
 * for now. A fixed 560x116 card with absolutely placed rows: its content changes while it's shown, and
 * on Brewser only normal-flow wrappers toggle reliably.
 */
@Component({
  selector: 'app-challenge-panel',
  host: { class: 'block h-[116px] w-[560px]' },
  template: `
    <section aria-label="Challenges" class="relative h-[116px] w-[560px] rounded-3xl bg-card text-white">
      <p role="status" class="absolute top-[12px] left-[24px] block h-6 w-[512px] truncate text-sm leading-6 text-gray-300">
        {{ statusText() }}
      </p>
      @if (challenge(); as challenge) {
        <div>
          <p class="absolute top-[36px] left-[24px] block h-7 w-[512px] truncate text-lg leading-7 font-bold">
            {{ challenge.from }} wants to battle: {{ challenge.formatName }}{{ others() }}
          </p>
          @if (challenge.needsTeam) {
            <p class="absolute top-[72px] left-[24px] block h-8 w-[244px] text-sm leading-8 text-gray-300">Needs a team: not supported yet</p>
          } @else {
            <button
              type="button"
              class="absolute top-[68px] left-[24px] h-10 w-[244px] cursor-pointer rounded-md border border-blue-300 bg-blue-700 text-lg font-bold hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              [attr.aria-label]="'Accept the challenge from ' + challenge.from"
              (click)="challenges.accept(challenge)"
            >
              Accept
            </button>
          }
          <button
            type="button"
            class="absolute top-[68px] left-[280px] h-10 w-[256px] cursor-pointer rounded-md border border-gray-400 bg-gray-600 text-lg font-bold hover:bg-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            [attr.aria-label]="'Reject the challenge from ' + challenge.from"
            (click)="challenges.reject(challenge)"
          >
            Reject
          </button>
        </div>
      } @else {
        <div>
          <p class="absolute top-[40px] left-[24px] block h-[64px] w-[512px] overflow-hidden text-base leading-6" [class]="hintClass()">
            {{ hintText() }}
          </p>
        </div>
      }
    </section>
  `,
})
export class ChallengePanel {
  private readonly connection = inject(ShowdownConnection);
  private readonly login = inject(ShowdownLogin);
  protected readonly challenges = inject(ShowdownChallenges);

  protected readonly challenge = computed(() => this.challenges.incoming()[0] ?? null);

  protected readonly others = computed(() => {
    const more = this.challenges.incoming().length - 1;
    return more > 0 ? ` (+${more} more)` : '';
  });

  protected readonly statusText = computed(() => {
    const login = this.login.state();
    if (login.status === 'unavailable') return 'Online battles unavailable';
    if (this.connection.state().status !== 'connected') return 'Connecting to Showdown…';
    if (login.status === 'named') return `Playing on Showdown as ${login.name}`;
    return 'Getting a name on Showdown…';
  });

  private readonly problem = computed(() => {
    const login = this.login.state();
    return login.status === 'unavailable' ? login.error : this.challenges.error();
  });

  protected readonly hintText = computed(
    () => this.problem() ?? 'Other players can challenge this name to a Random Battle. Challenges show here.',
  );

  protected readonly hintClass = computed(() => (this.problem() ? 'text-red-300' : 'text-gray-300'));
}
