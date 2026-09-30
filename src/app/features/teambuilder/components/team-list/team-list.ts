import { Component, ElementRef, computed, inject, input, output, viewChild, viewChildren } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { Team } from '@features/teambuilder/models/team';
import { formatName } from '@shared/data/formats';
import { ScrollRegion } from '@shared/directives/scroll-region';

@Component({
  imports: [ScrollRegion],
  selector: 'app-team-list',
  host: { class: 'block bg-retro-panel text-retro-ink' },
  // Fixed 360x644 column (see styles.css): 64px header, 540px scrolling list, 40px footer. Controls sit
  // at fixed absolute positions and rows are plain blocks (Brewser layout rules, seen on device).
  template: `
    <div class="relative h-16 w-[359px] border-b border-retro-rim">
      <h2 id="team-list-title" class="absolute top-[18px] left-4 text-xl font-bold text-retro-ink">Teams</h2>
      <button
        #newTeamButton
        type="button"
        aria-label="New empty team"
        (click)="create.emit()"
        class="absolute top-[14px] left-[259px] h-9 w-[88px] cursor-pointer rounded-md border-2 border-retro-bar bg-retro-accent text-base font-bold text-white hover:bg-retro-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        New
      </button>
    </div>
    <ul appScrollRegion aria-labelledby="team-list-title" class="h-[540px] w-[359px] overflow-y-auto">
      @for (team of newestFirst(); track team.id) {
        <li>
          <button
            #teamButton
            type="button"
            [attr.aria-current]="team.id === selectedId() ? 'true' : null"
            [attr.data-autofocus]="team.id === selectedId() ? '' : null"
            (click)="select.emit(team.id)"
            class="block h-16 w-[359px] cursor-pointer border-b border-retro-rim p-[10px_16px] text-left text-retro-ink hover:bg-retro-select focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
            [class.bg-retro-select]="team.id === selectedId()"
          >
            <span class="block text-base font-bold">{{ team.name }}</span>
            <span class="block text-sm text-retro-muted">{{ summary(team) }}</span>
          </button>
        </li>
      } @empty {
        <li class="p-4 text-base text-retro-muted">No teams yet. Use New to build one.</li>
      }
    </ul>
    <div class="relative h-10 w-[359px] border-t border-retro-rim">
      <p class="absolute top-[10px] left-4 text-sm text-retro-muted">{{ dataSummary }}</p>
    </div>
  `,
})
export class TeamList {
  private readonly newTeamButton = viewChild.required<ElementRef<HTMLButtonElement>>('newTeamButton');
  private readonly teamButtons = viewChildren<ElementRef<HTMLButtonElement>>('teamButton');

  /** In creation order, as stored. */
  readonly teams = input.required<readonly Team[]>();
  readonly selectedId = input<string | null>(null);
  readonly select = output<string>();
  /** A new empty team. */
  readonly create = output<void>();

  /** Listed newest first: the team just built is at the top. */
  protected readonly newestFirst = computed(() => [...this.teams()].reverse());

  /** Which game data the teambuilder uses, and how recent it is. */
  protected readonly dataSummary = dataSummary(inject(ChampionsDex));

  focusNewTeam(): void {
    this.newTeamButton().nativeElement.focus();
  }

  /** Focuses the selected team's row (B from the team goes back to it), or New without one. */
  focusSelected(): void {
    const index = this.newestFirst().findIndex((team) => team.id === this.selectedId());
    const row = this.teamButtons()[index]?.nativeElement;
    if (row) row.focus();
    else this.focusNewTeam();
  }

  /** "4 Pokémon · VGC 2026 Reg M-C": the format without its "[Gen 9 Champions]" prefix, so it fits one line. */
  protected summary(team: Team): string {
    const count = `${team.sets.length} Pokémon`;
    return team.format ? `${count} · ${formatName(team.format).replace(/^\[[^\]]*\]\s*/, '')}` : count;
  }
}

function dataSummary(dex: ChampionsDex): string {
  return `Reg M-C data: ${dex.allSpecies.length} Pokémon · ${dex.generated}`;
}
