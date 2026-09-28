import { Component, computed, inject, linkedSignal } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleSession } from '@features/battle/state/battle-session';
import { PlaySelection } from '@features/play/state/play-selection';
import { Team } from '@features/teambuilder/models/team';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { RetroBox } from '@shared/components/retro-box';
import { PLAYABLE_FORMATS } from '@shared/data/formats';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';
import { spriteId } from '@shared/utils/sprite-id';
import { ChallengePanel } from '../challenge-panel/challenge-panel';

/** Teams listed at once; with more, pages of one less, plus a button for the next page. */
const TEAMS_SHOWN = 4;

/**
 * The Battle page: pick a format and a team and start a battle (against the mock server for now), or
 * answer and send challenges on Showdown. Four retro boxes at fixed positions.
 * The format and team picked are marked with the ▶ cursor; the yellow ring is the controller's focus.
 */
@Component({
  imports: [ChallengePanel, PokemonSprite, RetroBox],
  selector: 'app-play-page',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px] text-retro-ink' },
  template: `
    <app-retro-box class="absolute top-[24px] left-[32px]" [width]="400" [height]="236">
      <h2 id="format-title" class="absolute top-[12px] left-[20px] text-2xl font-bold text-retro-muted">FORMAT</h2>
      <div role="group" aria-labelledby="format-title">
        @for (format of formats; track format.id; let i = $index) {
          <button
            type="button"
            class="absolute left-[12px] h-[72px] w-[364px] cursor-pointer rounded-md text-left hover:bg-retro-select"
            [class.bg-retro-select]="format.id === selection.format()"
            [style.top.px]="52 + i * 80"
            [attr.aria-pressed]="format.id === selection.format()"
            [attr.data-autofocus]="format.id === selection.format() ? '' : null"
            (click)="selection.format.set(format.id)"
          >
            <span class="block" [class.hidden]="!(format.id === selection.format())"><svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[24px] left-[10px] h-7 w-4 fill-retro-accent-text"><path d="M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" /></svg></span>
            <span class="absolute top-[8px] left-[40px] block h-8 w-[316px] truncate text-2xl leading-8 font-bold">{{ format.label }}</span>
            <span class="absolute top-[40px] left-[40px] block h-6 w-[316px] text-sm leading-6 text-retro-muted">
              {{ format.randomTeams ? 'Singles · random teams' : 'Doubles · one of your teams' }}
            </span>
          </button>
        }
      </div>
    </app-retro-box>

    <app-retro-box class="absolute top-[276px] left-[32px]" [width]="400" [height]="344">
      <h2 id="team-title" class="absolute top-[12px] left-[20px] text-2xl font-bold text-retro-muted">TEAM</h2>
      @if (randomTeams()) {
        <p class="absolute top-[60px] left-[20px] block w-[350px] text-lg leading-7">Showdown hands each player a random team for this format.</p>
      } @else if (teams().length === 0) {
        <div>
          <p class="absolute top-[60px] left-[20px] block w-[350px] text-lg leading-7">No teams for this format yet: build one in the Teambuilder.</p>
          <button type="button" [class]="secondaryClass" class="absolute top-[140px] left-[20px] h-11 w-[250px] text-xl" (click)="openTeambuilder()">
            Open Teambuilder
          </button>
        </div>
      } @else {
        <div role="group" aria-labelledby="team-title">
          @for (team of shownTeams(); track team.id; let i = $index) {
            <button
              type="button"
              class="absolute left-[12px] h-[64px] w-[364px] cursor-pointer rounded-md text-left hover:bg-retro-select"
              [class.bg-retro-select]="team.id === chosenTeam()?.id"
              [style.top.px]="48 + i * 68"
              [attr.aria-pressed]="team.id === chosenTeam()?.id"
              [attr.aria-label]="team.name"
              (click)="selection.teamId.set(team.id)"
            >
              <span class="block" [class.hidden]="team.id !== chosenTeam()?.id">
                <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[20px] left-[10px] h-7 w-4 fill-retro-accent-text"><path d="M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" /></svg>
              </span>
              <span class="absolute top-[2px] left-[40px] block h-6 w-[316px] truncate text-lg leading-6 font-bold">{{ team.name }}</span>
              @for (sprite of sprites(team); track $index) {
                <app-pokemon-sprite class="absolute top-[28px]" [style.left.px]="40 + $index * 36" [sprite]="sprite" [size]="32" />
              }
            </button>
          }
          @if (pageCount() > 1) {
            <button
              type="button"
              [class]="secondaryClass"
              class="absolute top-[256px] left-[12px] h-9 w-[364px] text-lg"
              (click)="nextPage()"
            >
              More teams ({{ page() + 1 }}/{{ pageCount() }})
            </button>
          }
        </div>
      }
    </app-retro-box>

    <app-retro-box class="absolute top-[24px] left-[464px]" [width]="784" [height]="236">
      <button
        type="button"
        [class]="primaryClass"
        class="absolute top-[20px] left-[20px] h-[140px] w-[738px]"
        [disabled]="!canBattle()"
        (click)="battle()"
      >
        <span class="block text-6xl leading-[72px]">BATTLE!</span>
        <span class="block font-sans text-lg font-normal">Practice battle against the computer</span>
      </button>
      <p class="absolute top-[176px] left-[20px] block h-8 w-[738px] truncate text-lg leading-8 text-retro-muted">{{ summary() }}</p>
    </app-retro-box>

    <app-retro-box class="absolute top-[276px] left-[464px]" [width]="784" [height]="344">
      <h2 class="absolute top-[12px] left-[20px] text-2xl font-bold text-retro-muted">CHALLENGES</h2>
      <app-challenge-panel class="absolute top-[64px] left-[26px]" />
    </app-retro-box>
  `,
})
export class PlayPage {
  private readonly router = inject(Router);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly session = inject(BattleSession);
  private readonly teamStore = inject(TeamStore);
  protected readonly selection = inject(PlaySelection);

  protected readonly formats = PLAYABLE_FORMATS;
  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  private readonly format = computed(() => PLAYABLE_FORMATS.find((f) => f.id === this.selection.format()) ?? PLAYABLE_FORMATS[0]);
  protected readonly randomTeams = computed(() => this.format().randomTeams);

  /** The player's teams for the format, with at least one Pokémon. */
  protected readonly teams = computed(() =>
    this.teamStore.teams().filter((team) => team.format === this.format().id && team.sets.length > 0),
  );

  /** The team picked, or the first one that fits while none is (or the picked one is gone). */
  protected readonly chosenTeam = computed(() => {
    const teams = this.teams();
    return teams.find((team) => team.id === this.selection.teamId()) ?? teams[0] ?? null;
  });

  private readonly perPage = computed(() => (this.teams().length > TEAMS_SHOWN ? TEAMS_SHOWN - 1 : TEAMS_SHOWN));
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.teams().length / this.perPage())));
  /** Starts on the chosen team's page, and again whenever the format changes. */
  protected readonly page = linkedSignal({
    source: () => this.format().id,
    computation: () => {
      const index = this.teams().findIndex((team) => team.id === this.chosenTeam()?.id);
      return index < 0 ? 0 : Math.floor(index / this.perPage());
    },
  });
  protected readonly shownTeams = computed(() => {
    const start = this.page() * this.perPage();
    return this.teams().slice(start, start + this.perPage());
  });

  protected readonly canBattle = computed(() => this.randomTeams() || this.chosenTeam() !== null);

  protected readonly summary = computed(() => {
    const team = this.randomTeams() ? 'random team' : (this.chosenTeam()?.name ?? 'no team');
    return `${this.format().label} · ${team}`;
  });

  protected sprites(team: Team): string[] {
    return team.sets.map((set) => spriteId(set.species));
  }

  protected nextPage(): void {
    this.page.update((page) => (page + 1) % this.pageCount());
  }

  /** A battle against the mock server, in the format and with the team picked. */
  protected battle(): void {
    if (!this.canBattle()) return;
    if (!this.session.active()) {
      this.session.requestStart(this.format().id, this.randomTeams() ? null : (this.chosenTeam()?.id ?? null));
    }
    void this.router.navigateByUrl('/battle');
  }

  protected openTeambuilder(): void {
    this.navigation.focusPageAfterNavigation();
    void this.router.navigateByUrl('/teambuilder');
  }
}
