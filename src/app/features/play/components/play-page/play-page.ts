import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ChampionsDex } from '@core/dex/champions-dex';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleSession } from '@features/battle/state/battle-session';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { PlaySelection } from '@features/play/state/play-selection';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { RetroBox } from '@shared/components/retro-box';
import { PLAYABLE_FORMATS } from '@shared/data/formats';
import { RETRO_PRIMARY_BUTTON } from '@shared/ui/retro-classes';
import { spriteId } from '@shared/utils/sprite-id';
import { ChallengeForm } from '../challenge-panel/challenge-form';
import { ChallengePanel } from '../challenge-panel/challenge-panel';
import { ChallengePopup } from '../challenge-popup/challenge-popup';
import { OptionPicker, PickerOption } from '../option-picker/option-picker';
import { TeamPreview } from '../team-preview/team-preview';

/** What opens over the page: a picker, or the form to challenge a player. */
type Overlay = 'format' | 'team' | 'challenge';
/** The control focus goes back to once the page shows again. */
type PageControl = 'format' | 'team' | 'challenge' | 'battle';

/** The format and team selectors: a row with the choice and a ▼ to open its list. */
const SELECTOR_BUTTON =
  'cursor-pointer rounded-md border-2 border-retro-outline bg-retro-button text-left text-retro-ink hover:bg-retro-select';

/**
 * The Battle page: pick a format and a team and start a battle (against the mock server for now), or
 * send and answer challenges on Showdown. On the left, the format and team (each opens a list to pick
 * from; L/R also step through the teams) over the actions; on the right, the team picked, large.
 * Challenges that arrive show in a box over the page, and so do the lists and the form to challenge
 * someone; the page's own controls hide meanwhile (only normal-flow wrappers toggle on Brewser), so the
 * d-pad stays in the box.
 */
@Component({
  imports: [ChallengeForm, ChallengePanel, ChallengePopup, OptionPicker, RetroBox, TeamPreview],
  selector: 'app-play-page',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px] text-retro-ink' },
  template: `
    <div class="block" [class.hidden]="layer() !== 'page'">
      <app-retro-box class="absolute top-[24px] left-[32px]" [width]="440" [height]="296">
        <h2 id="format-title" class="absolute top-[12px] left-[20px] block h-7 text-xl leading-7 font-bold text-retro-muted">FORMAT</h2>
        <button
          #formatButton
          type="button"
          [class]="selectorClass"
          class="absolute top-[44px] left-[12px] h-[84px] w-[410px]"
          aria-describedby="format-title"
          [attr.aria-label]="'Format: ' + format().label + '. Change'"
          (click)="open('format')"
        >
          <span class="absolute top-[10px] left-[18px] block h-8 w-[330px] truncate text-2xl leading-8 font-bold">{{ format().label }}</span>
          <span class="absolute top-[46px] left-[18px] block h-6 w-[330px] truncate text-base leading-6 text-retro-muted">{{ format().detail }}</span>
          <svg aria-hidden="true" viewBox="0 0 7 4" class="absolute top-[34px] left-[366px] h-4 w-7 fill-retro-accent-text"><path d="M0 0h7v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z" /></svg>
        </button>

        <h2 id="team-title" class="absolute top-[148px] left-[20px] block h-7 text-xl leading-7 font-bold text-retro-muted">TEAM</h2>
        <div class="block" [class.hidden]="!canCycle()">
          <!-- The shortcuts to step through the teams. -->
          <span aria-hidden="true" class="absolute top-[148px] left-[282px] block h-7 w-7 rounded-sm bg-retro-select text-center leading-7 font-bold">L</span>
          <!-- Pixel triangles: Brewser draws the ◀ ▶ glyphs as orange emoji. -->
          <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[155px] left-[330px] h-[14px] w-2 fill-retro-muted"><path d="M3 0h1v7h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z" /></svg>
          <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[155px] left-[354px] h-[14px] w-2 fill-retro-muted"><path d="M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" /></svg>
          <span aria-hidden="true" class="absolute top-[148px] left-[382px] block h-7 w-7 rounded-sm bg-retro-select text-center leading-7 font-bold">R</span>
        </div>
        @if (randomTeams()) {
          <div class="absolute top-[180px] left-[12px] block h-[84px] w-[410px] rounded-md border-2 border-retro-rim">
            <span class="absolute top-[10px] left-[18px] block h-8 w-[370px] text-2xl leading-8 font-bold">Random team</span>
            <span class="absolute top-[46px] left-[18px] block h-6 w-[370px] text-base leading-6 text-retro-muted">Showdown hands each player one</span>
          </div>
        } @else if (chosenTeam(); as team) {
          <button
            #teamButton
            type="button"
            [class]="selectorClass"
            class="absolute top-[180px] left-[12px] h-[84px] w-[410px]"
            aria-describedby="team-title"
            [attr.aria-label]="'Team: ' + team.name + '. Change'"
            (click)="open('team')"
          >
            <span class="absolute top-[10px] left-[18px] block h-8 w-[330px] truncate text-2xl leading-8 font-bold">{{ team.name }}</span>
            <span class="absolute top-[46px] left-[18px] block h-6 w-[330px] truncate text-base leading-6 text-retro-muted">{{ teamPosition() }}</span>
            <svg aria-hidden="true" viewBox="0 0 7 4" class="absolute top-[34px] left-[366px] h-4 w-7 fill-retro-accent-text"><path d="M0 0h7v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z" /></svg>
          </button>
        } @else {
          <button #teamButton type="button" [class]="selectorClass" class="absolute top-[180px] left-[12px] h-[84px] w-[410px]" (click)="openTeambuilder()">
            <span class="absolute top-[10px] left-[18px] block h-8 w-[370px] text-2xl leading-8 font-bold">No teams yet</span>
            <span class="absolute top-[46px] left-[18px] block h-6 w-[370px] text-base leading-6 text-retro-muted">Build one in the Teambuilder</span>
          </button>
        }
      </app-retro-box>

      <app-retro-box class="absolute top-[336px] left-[32px]" [width]="440" [height]="284">
        <button
          #battleButton
          type="button"
          data-autofocus
          [class]="primaryClass"
          class="absolute top-[14px] left-[12px] h-24 w-[410px] p-0"
          [disabled]="!canBattle()"
          (click)="battle()"
        >
          <!-- Placed boxes: Brewser leaves a button's element children at its top left. -->
          <span class="absolute top-[8px] left-0 block h-[52px] w-[406px] text-center text-5xl leading-[52px]">BATTLE!</span>
          <span class="absolute top-[60px] left-0 block h-6 w-[406px] text-center font-sans text-base leading-6 font-normal">Practice against the computer</span>
        </button>
        <app-challenge-panel
          #challengePanel
          class="absolute top-[124px] left-[12px]"
          [postponed]="postponedCount()"
          (challengePlayer)="open('challenge')"
          (answer)="postponed.set([])"
        />
      </app-retro-box>

      <app-retro-box class="absolute top-[24px] left-[496px]" [width]="752" [height]="596">
        <h2 class="absolute top-[14px] left-[24px] block h-9 w-[440px] truncate text-3xl leading-9 font-bold">{{ previewTitle() }}</h2>
        <p class="absolute top-[18px] left-[480px] block h-8 w-[236px] truncate text-right text-lg leading-8 text-retro-muted">{{ format().label }}</p>
        <app-team-preview class="absolute top-[68px] left-[15px]" [team]="chosenTeam()" [randomTeams]="randomTeams()" />
      </app-retro-box>
    </div>

    @if (popupChallenge(); as challenge) {
      <app-challenge-popup class="absolute top-[158px] left-[248px]" [challenge]="challenge" [waiting]="waitingBehind()" (later)="postpone(challenge.fromId)" />
    } @else if (overlay() === 'format') {
      <app-option-picker
        class="absolute top-[24px] left-[32px]"
        title="Pick a format"
        [options]="formatOptions"
        [selected]="format().id"
        (picked)="pickFormat($event)"
        (closed)="close()"
      />
    } @else if (overlay() === 'team') {
      <app-option-picker
        class="absolute top-[24px] left-[32px]"
        title="Pick a team"
        [options]="teamOptions()"
        [selected]="chosenTeam()?.id ?? null"
        (picked)="pickTeam($event)"
        (closed)="close()"
      />
    } @else if (overlay() === 'challenge') {
      <app-retro-box class="absolute top-[158px] left-[248px]" [width]="784" [height]="296">
        <h2 class="absolute top-[24px] left-[29px] block h-12 w-[720px] text-4xl leading-[48px] font-bold">Challenge a player</h2>
        <app-challenge-form class="absolute top-[100px] left-[29px]" (closed)="close()" />
      </app-retro-box>
    }
  `,
})
export class PlayPage {
  private readonly router = inject(Router);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly session = inject(BattleSession);
  private readonly teamStore = inject(TeamStore);
  private readonly dex = inject(ChampionsDex);
  private readonly challenges = inject(ShowdownChallenges);
  protected readonly selection = inject(PlaySelection);

  private readonly formatButton = viewChild.required<ElementRef<HTMLButtonElement>>('formatButton');
  private readonly teamButton = viewChild<ElementRef<HTMLButtonElement>>('teamButton');
  private readonly battleButton = viewChild.required<ElementRef<HTMLButtonElement>>('battleButton');
  private readonly challengePanel = viewChild.required('challengePanel', { read: ElementRef<HTMLElement> });

  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly selectorClass = SELECTOR_BUTTON;

  protected readonly format = computed(() => PLAYABLE_FORMATS.find((f) => f.id === this.selection.format()) ?? PLAYABLE_FORMATS[0]);
  protected readonly randomTeams = computed(() => this.format().randomTeams);

  protected readonly formatOptions: readonly PickerOption[] = PLAYABLE_FORMATS.map((format) => ({
    id: format.id,
    title: format.label,
    detail: format.detail,
    category: format.category,
  }));

  /** The player's teams for the format, with at least one Pokémon. */
  protected readonly teams = computed(() =>
    this.teamStore.teams().filter((team) => team.format === this.format().id && team.sets.length > 0),
  );

  protected readonly teamOptions = computed((): PickerOption[] =>
    this.teams().map((team) => ({
      id: team.id,
      title: team.name,
      detail: `${team.sets.length} Pokémon`,
      sprites: team.sets.map((set) => this.dex.mega(set.species, set.item)?.sprite ?? spriteId(set.species)),
    })),
  );

  /** The team picked, or the first one that fits while none is (or the picked one is gone); none with random teams. */
  protected readonly chosenTeam = computed(() => {
    if (this.randomTeams()) return null;
    const teams = this.teams();
    return teams.find((team) => team.id === this.selection.teamId()) ?? teams[0] ?? null;
  });

  protected readonly teamPosition = computed(() => {
    const teams = this.teams();
    const index = teams.findIndex((team) => team.id === this.chosenTeam()?.id);
    return teams.length > 1 ? `${index + 1} of ${teams.length} teams` : 'Your only team for this format';
  });

  protected readonly previewTitle = computed(() => {
    if (this.randomTeams()) return 'Random team';
    return this.chosenTeam()?.name ?? 'No team for this format';
  });

  protected readonly canBattle = computed(() => this.randomTeams() || this.chosenTeam() !== null);
  /** L/R step through the teams. */
  protected readonly canCycle = computed(() => !this.randomTeams() && this.teams().length > 1);

  protected readonly overlay = signal<Overlay | null>(null);
  /** Challenges left for later (by the challenger's ID): no box for them until asked for. */
  protected readonly postponed = signal<readonly string[]>([]);

  private readonly unanswered = computed(() =>
    this.challenges.incoming().filter((challenge) => !this.postponed().includes(challenge.fromId)),
  );
  protected readonly popupChallenge = computed(() => this.unanswered()[0] ?? null);
  protected readonly waitingBehind = computed(() => Math.max(0, this.unanswered().length - 1));
  protected readonly postponedCount = computed(() => this.challenges.incoming().length - this.unanswered().length);

  /** What's on top: a challenge first, then whatever the player opened, else the page itself. */
  protected readonly layer = computed(() => (this.popupChallenge() ? 'popup' : (this.overlay() ?? 'page')));

  /** Where focus goes when the page shows again. */
  private returnTo: PageControl = 'battle';

  constructor() {
    let lastLayer = this.layer();
    afterRenderEffect(() => {
      const layer = this.layer();
      if (layer === 'page' && lastLayer !== 'page') this.focusControl(this.returnTo);
      lastLayer = layer;
    });

    const unregister = [
      this.navigation.registerButton('buttonL', () => this.cycleTeam(-1)),
      this.navigation.registerButton('buttonR', () => this.cycleTeam(1)),
    ];
    inject(DestroyRef).onDestroy(() => unregister.forEach((fn) => fn()));
  }

  protected open(overlay: Overlay): void {
    this.returnTo = overlay;
    this.overlay.set(overlay);
  }

  /** Back to the page, with focus on the control that opened the box. */
  protected close(): void {
    this.overlay.set(null);
  }

  protected pickFormat(id: string): void {
    this.selection.format.set(id);
    this.close();
  }

  protected pickTeam(id: string): void {
    this.selection.teamId.set(id);
    this.close();
  }

  protected postpone(fromId: string): void {
    // Unless another box is open under it, focus goes to the button that brings it back.
    if (this.overlay() === null) this.returnTo = 'challenge';
    this.postponed.update((ids) => [...ids, fromId]);
  }

  /** L/R on the page: the previous or next team for the format (wrapping around). */
  private cycleTeam(step: 1 | -1): boolean {
    if (this.layer() !== 'page' || !this.canCycle()) return false;
    const teams = this.teams();
    const index = teams.findIndex((team) => team.id === this.chosenTeam()?.id);
    this.selection.teamId.set(teams[(index + step + teams.length) % teams.length].id);
    return true;
  }

  private focusControl(control: PageControl): void {
    const target = {
      format: () => this.formatButton().nativeElement,
      team: () => this.teamButton()?.nativeElement,
      challenge: () => this.challengePanel().nativeElement.querySelector('button') ?? undefined,
      battle: () => this.battleButton().nativeElement,
    }[control]();
    // BATTLE! is disabled without a team: the team's button (to the Teambuilder) then.
    const enabled = [target, this.battleButton().nativeElement, this.teamButton()?.nativeElement].find((el) => el && !el.disabled);
    enabled?.focus();
    this.returnTo = 'battle';
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
