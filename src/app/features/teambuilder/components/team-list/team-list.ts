import { Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { Team } from '@features/teambuilder/models/team';
import { formatName } from '@shared/data/formats';
import { ScrollRegion } from '@shared/directives/scroll-region';

@Component({
  imports: [ScrollRegion],
  selector: 'app-team-list',
  host: { class: 'block bg-card' },
  // Fixed 360x644 column (see styles.css): 64px header, 540px scrolling list, 40px footer. Controls sit
  // at fixed absolute positions and rows are plain blocks (Brewser layout rules, seen on device).
  template: `
    <div class="relative h-16 w-[359px] border-b border-gray-600">
      <h2 id="team-list-title" class="absolute top-[18px] left-4 text-xl font-bold text-white">Teams</h2>
      <button
        #newTeamButton
        type="button"
        aria-label="New empty team"
        (click)="create.emit()"
        class="absolute top-[14px] left-[163px] h-9 w-[88px] cursor-pointer rounded-md border border-blue-300 bg-blue-700 text-base text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        New
      </button>
      <button
        type="button"
        aria-label="Import a team from text"
        (click)="import.emit()"
        class="absolute top-[14px] left-[259px] h-9 w-[88px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Import
      </button>
    </div>
    <ul appScrollRegion aria-labelledby="team-list-title" class="h-[540px] w-[359px] overflow-y-auto">
      @for (team of teams(); track team.id) {
        <li>
          <button
            type="button"
            [attr.aria-current]="team.id === selectedId() ? 'true' : null"
            (click)="select.emit(team.id)"
            class="block h-16 w-[359px] cursor-pointer border-b border-gray-700 p-[10px_16px] text-left text-white hover:bg-tab-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
            [class.bg-tab-hover]="team.id === selectedId()"
          >
            <span class="block text-base font-bold">{{ team.name }}</span>
            <span class="block text-sm text-gray-300">{{ summary(team) }}</span>
          </button>
        </li>
      } @empty {
        <li class="p-4 text-base text-gray-300">No teams yet. Use New to build one, or Import to paste one from Showdown.</li>
      }
    </ul>
    <div class="relative h-10 w-[359px] border-t border-gray-600">
      <p class="absolute top-[10px] left-4 text-sm text-gray-300">{{ dataSummary }}</p>
    </div>
  `,
})
export class TeamList {
  private readonly newTeamButton = viewChild.required<ElementRef<HTMLButtonElement>>('newTeamButton');

  readonly teams = input.required<readonly Team[]>();
  readonly selectedId = input<string | null>(null);
  readonly select = output<string>();
  /** A new empty team. */
  readonly create = output<void>();
  /** A team from Showdown's text format. */
  readonly import = output<void>();

  /** Which game data the teambuilder uses, and how recent it is. */
  protected readonly dataSummary = dataSummary(inject(ChampionsDex));

  focusNewTeam(): void {
    this.newTeamButton().nativeElement.focus();
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
