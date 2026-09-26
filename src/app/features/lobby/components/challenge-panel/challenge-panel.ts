import { Component, computed, inject } from '@angular/core';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';

/**
 * Our name on Showdown (random for each connection, with a button for another one, for when it's
 * taken) and the challenges other players send us (the oldest first), with Accept and Reject.
 * Accepting opens the battle (see App). Formats that need a team of ours can only be rejected for now.
 * A fixed 560x116 card with absolutely placed rows: its content changes while it's shown, and on
 * Brewser only normal-flow wrappers toggle reliably.
 */
@Component({
  selector: 'app-challenge-panel',
  host: { class: 'block h-[116px] w-[560px]' },
  template: `
    <section aria-label="Challenges" class="relative h-[116px] w-[560px] rounded-3xl bg-card text-white">
      <p role="status" class="absolute top-[8px] left-[24px] block h-7 w-[380px] truncate text-base leading-7 text-gray-300">
        @if (name(); as name) {
          Your name on Showdown: <strong class="font-bold text-white">{{ name }}</strong>
        } @else {
          {{ statusText() }}
        }
      </p>
      @if (canRename()) {
        <!-- For when the name is taken or blocked: another random one. -->
        <button
          type="button"
          class="absolute top-[8px] left-[416px] h-7 w-[120px] cursor-pointer rounded-md border border-gray-400 bg-gray-600 text-sm font-bold hover:bg-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label="Get another random name"
          (click)="login.newName()"
        >
          New name
        </button>
      }
      @if (challenge(); as challenge) {
        <div>
          <p class="absolute top-[40px] left-[24px] block h-7 w-[512px] truncate text-lg leading-7 font-bold">
            {{ challenge.from }} wants to battle: {{ challenge.formatName }}{{ others() }}
          </p>
          @if (challenge.needsTeam) {
            <p class="absolute top-[74px] left-[24px] block h-8 w-[244px] text-sm leading-8 text-gray-300">Needs a team: not supported yet</p>
          } @else {
            <button
              type="button"
              class="absolute top-[72px] left-[24px] h-9 w-[244px] cursor-pointer rounded-md border border-blue-300 bg-blue-700 text-lg font-bold hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              [attr.aria-label]="'Accept the challenge from ' + challenge.from"
              (click)="challenges.accept(challenge)"
            >
              Accept
            </button>
          }
          <button
            type="button"
            class="absolute top-[72px] left-[280px] h-9 w-[256px] cursor-pointer rounded-md border border-gray-400 bg-gray-600 text-lg font-bold hover:bg-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
  protected readonly login = inject(ShowdownLogin);
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
    return 'Getting a name on Showdown…';
  });

  /** Our name once the server calls us by it, for other players to challenge. */
  protected readonly name = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && this.connection.state().status === 'connected' ? login.name : null;
  });

  /** Another name can be asked for once connected, unless one is being claimed right now. */
  protected readonly canRename = computed(
    () => this.connection.state().status === 'connected' && ['named', 'unavailable'].includes(this.login.state().status),
  );

  private readonly problem = computed(() => {
    const login = this.login.state();
    return login.status === 'unavailable' ? login.error : this.challenges.error();
  });

  protected readonly hintText = computed(
    () => this.problem() ?? 'Other players can challenge this name to a Random Battle. Challenges show here.',
  );

  protected readonly hintClass = computed(() => (this.problem() ? 'text-red-300' : 'text-gray-300'));
}
