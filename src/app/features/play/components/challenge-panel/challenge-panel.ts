import { Component, computed, inject, input, output } from '@angular/core';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { formatLabel } from '@shared/data/formats';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/**
 * Online play on the Battle page, under BATTLE!: a button to challenge a player by name (the page
 * opens the form in a box), to cancel the challenge we sent, or to answer one left for later (the
 * page shows challenges in a box as they arrive); then our name on Showdown once connected from the
 * home screen (a guest's is random, with a button for another one, for when it's taken) and a line on
 * what's going on. A fixed 410x148 area of absolutely placed rows, meant for a retro box: its content
 * changes while it's shown, and on Brewser only normal-flow wrappers toggle reliably.
 */
@Component({
  selector: 'app-challenge-panel',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[148px] w-[410px]' },
  template: `
    <section aria-label="Challenges" class="relative block h-[148px] w-[410px] text-retro-ink">
      @if (challenges.outgoing(); as outgoing) {
        <button
          type="button"
          [class]="primaryClass"
          class="absolute top-0 left-0 h-[52px] w-[410px] text-2xl"
          [attr.aria-label]="'Cancel the challenge to ' + outgoing.to"
          (click)="challenges.cancelChallenge()"
        >
          Cancel challenge
        </button>
      } @else if (postponed() > 0) {
        <button type="button" [class]="primaryClass" class="absolute top-0 left-0 h-[52px] w-[410px] text-2xl" (click)="answer.emit()">
          Answer challenge{{ postponed() > 1 ? 's (' + postponed() + ')' : '' }}
        </button>
      } @else {
        <button
          type="button"
          [class]="secondaryClass"
          class="absolute top-0 left-0 h-[52px] w-[410px] text-2xl"
          [disabled]="!name()"
          (click)="challengePlayer.emit()"
        >
          Challenge a player
        </button>
      }
      <!-- Label and name as separate blocks on the button's 32px line: inline, Brewser drops the space
           between them and sets the two font sizes on different baselines. -->
      <p role="status" class="absolute top-[66px] left-0 block h-8 w-[290px] text-lg leading-8 text-retro-muted">
        @if (name(); as name) {
          <span class="absolute top-0 left-0 block h-8 leading-8">Name:</span>
          <strong class="absolute top-0 left-[72px] block h-8 w-[218px] truncate text-xl leading-8 font-bold text-retro-ink">{{
            name
          }}</strong>
        } @else {
          <span class="block h-8 w-[290px] truncate leading-8">{{ statusText() }}</span>
        }
      </p>
      @if (canRename()) {
        <!-- A guest's name is random: another one, for when it's taken or blocked. -->
        <button
          type="button"
          [class]="secondaryClass"
          class="absolute top-[66px] left-[300px] h-8 w-[110px] text-base"
          aria-label="Get another random name"
          (click)="login.newName()"
        >
          New name
        </button>
      }
      <p class="absolute top-[104px] left-0 block h-11 w-[410px] overflow-hidden text-sm leading-[22px]" [class]="hintClass()">
        {{ hintText() }}
      </p>
    </section>
  `,
})
export class ChallengePanel {
  private readonly connection = inject(ShowdownConnection);
  protected readonly login = inject(ShowdownLogin);
  protected readonly challenges = inject(ShowdownChallenges);
  private readonly search = inject(ShowdownSearch);

  /** Challenges received and left for later. */
  readonly postponed = input(0);
  /** Opens the form to challenge a player. */
  readonly challengePlayer = output<void>();
  /** Shows the challenges left for later again. */
  readonly answer = output<void>();

  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

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
    // The ladder search's refusal (BATTLE! has no room for it) shows here too.
    return login.status === 'unavailable' ? login.error : (this.search.error() ?? this.challenges.error());
  });

  protected readonly hintText = computed(() => {
    const outgoing = this.challenges.outgoing();
    if (this.login.state().status === 'offline') return 'Connect from the menu to send and receive challenges.';
    const problem = this.problem();
    if (problem) return problem;
    if (outgoing) return `Waiting for ${outgoing.to} to accept your ${formatLabel(outgoing.format)} challenge…`;
    if (this.postponed() > 0) return `${this.challenges.incoming()[0]?.from ?? 'A player'} is waiting for your answer.`;
    return 'Players can challenge this name, or challenge one yourself in the format picked.';
  });

  protected readonly hintClass = computed(() => (this.problem() ? 'font-bold text-retro-danger' : 'text-retro-muted'));
}
