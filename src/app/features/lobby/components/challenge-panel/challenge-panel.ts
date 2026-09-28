import { Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ChallengeForm } from './challenge-form';
import { LoginForm } from './login-form';

/** What the panel shows: our name and challenges, or one of the forms in its place. */
type PanelMode = 'status' | 'login' | 'challenge';

/**
 * Our name on Showdown (random for each connection, with a button for another one, for when it's
 * taken, or the player's own after logging in) and the challenges other players send us (the oldest
 * first), with Accept and Reject. We can challenge a player by name too, and cancel it while it waits.
 * Accepting (either side) opens the battle (see App). Formats that need a team of ours can only be
 * rejected for now. A fixed 560x116 card with absolutely placed rows: its content changes while it's
 * shown, and on Brewser only normal-flow wrappers toggle reliably.
 */
@Component({
  imports: [ChallengeForm, LoginForm],
  selector: 'app-challenge-panel',
  host: { class: 'block h-[116px] w-[560px]' },
  template: `
    <section aria-label="Challenges" class="relative h-[116px] w-[560px] rounded-3xl bg-card text-white">
      @if (mode() === 'login') {
        <div><app-login-form (closed)="closeForm('login')" /></div>
      } @else if (mode() === 'challenge') {
        <div><app-challenge-form (closed)="closeForm('challenge')" /></div>
      } @else {
        <div>
          <p role="status" class="absolute top-[8px] left-[24px] block h-7 w-[380px] truncate text-base leading-7 text-gray-300">
            @if (name(); as name) {
              Your name on Showdown: <strong class="font-bold text-white">{{ name }}</strong>
            } @else {
              {{ statusText() }}
            }
          </p>
          @if (canRename()) {
            <!-- For when the name is taken or blocked: another random one (which logs out of the player's own). -->
            <button
              type="button"
              [class]="smallButtonClass"
              [attr.aria-label]="login.state().ownName ? 'Log out and get a random name' : 'Get another random name'"
              (click)="login.newName()"
            >
              {{ login.state().ownName ? 'Log out' : 'New name' }}
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
                  [class]="primaryButtonClass"
                  [attr.aria-label]="'Accept the challenge from ' + challenge.from"
                  (click)="challenges.accept(challenge)"
                >
                  Accept
                </button>
              }
              <button
                type="button"
                [class]="secondaryButtonClass"
                [attr.aria-label]="'Reject the challenge from ' + challenge.from"
                (click)="challenges.reject(challenge)"
              >
                Reject
              </button>
            </div>
          } @else {
            <div>
              <p class="absolute top-[38px] left-[24px] block h-8 w-[512px] overflow-hidden text-sm leading-4" [class]="hintClass()">
                {{ hintText() }}
              </p>
              @if (challenges.outgoing(); as outgoing) {
                <button
                  type="button"
                  [class]="primaryButtonClass"
                  [attr.aria-label]="'Cancel the challenge to ' + outgoing.to"
                  (click)="challenges.cancelChallenge()"
                >
                  Cancel challenge
                </button>
              } @else {
                <button #challengeButton type="button" [class]="primaryButtonClass" [disabled]="!name()" (click)="mode.set('challenge')">
                  Challenge a player
                </button>
              }
              <button #loginButton type="button" [class]="secondaryButtonClass" [disabled]="!canLogIn()" (click)="mode.set('login')">
                Log in
              </button>
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
  private readonly loginButton = viewChild<ElementRef<HTMLButtonElement>>('loginButton');

  protected readonly mode = signal<PanelMode>('status');

  protected readonly smallButtonClass =
    'absolute top-[8px] left-[416px] h-7 w-[120px] cursor-pointer rounded-md border border-gray-400 bg-gray-600 text-sm font-bold hover:bg-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  protected readonly primaryButtonClass =
    'absolute top-[72px] left-[24px] h-9 w-[244px] cursor-pointer rounded-md border border-blue-300 bg-blue-700 text-lg font-bold enabled:hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-gray-500 disabled:bg-gray-700 disabled:text-gray-300';
  protected readonly secondaryButtonClass =
    'absolute top-[72px] left-[280px] h-9 w-[256px] cursor-pointer rounded-md border border-gray-400 bg-gray-600 text-lg font-bold enabled:hover:bg-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-gray-500 disabled:bg-gray-700 disabled:text-gray-300';

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
    () =>
      this.connection.state().status === 'connected' &&
      ['named', 'unavailable'].includes(this.login.state().status) &&
      !this.login.state().loggingIn,
  );

  /** Logging in needs the server's challenge, which a connection brings: any name claim is done by then. */
  protected readonly canLogIn = computed(() => this.canRename());

  private readonly problem = computed(() => {
    const login = this.login.state();
    return login.status === 'unavailable' ? login.error : (this.challenges.error() ?? login.loginError);
  });

  protected readonly hintText = computed(() => {
    const outgoing = this.challenges.outgoing();
    return (
      this.problem() ??
      (outgoing
        ? `Waiting for ${outgoing.to} to accept the Random Battle…`
        : 'Other players can challenge this name to a Random Battle, or challenge one yourself. Challenges show here.')
    );
  });

  protected readonly hintClass = computed(() => (this.problem() ? 'text-red-300' : 'text-gray-300'));

  /** Back to the name and challenges, with focus on the button that opened the form. */
  protected closeForm(from: Exclude<PanelMode, 'status'>): void {
    this.mode.set('status');
    afterNextRender(
      () => {
        const button = from === 'login' ? this.loginButton() : this.challengeButton();
        (button ?? this.loginButton())?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
