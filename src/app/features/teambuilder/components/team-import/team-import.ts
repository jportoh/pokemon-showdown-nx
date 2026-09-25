import { Component, ElementRef, output, signal, viewChild } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required, validate } from '@angular/forms/signals';
import { MAX_TEAM_NAME_LENGTH } from '@features/teambuilder/components/team-detail/team-detail';
import { parseTeamPaste } from '@features/teambuilder/data/showdown-paste';
import { PokemonSet } from '@features/teambuilder/models/team';
import { DEFAULT_TEAM_FORMAT } from '@shared/data/formats';
import { ScrollRegion } from '@shared/directives/scroll-region';

export interface ImportedTeam {
  name: string;
  format: string;
  sets: PokemonSet[];
}

const PLACEHOLDER = `Garchomp @ Rocky Helmet
Ability: Rough Skin
Tera Type: Steel
EVs: 252 HP / 4 Def / 252 Spe
Jolly Nature
- Stealth Rock
- Earthquake
- Spikes
- Dragon Tail`;

@Component({
  imports: [FormRoot, FormField, ScrollRegion],
  selector: 'app-team-import',
  host: { class: 'block' },
  // Fixed 920x644 panel with plain block content (Brewser layout rules, see styles.css). Spacing uses
  // fixed-height blocks rather than margins.
  template: `
    <form [formRoot]="importForm" class="block h-[644px] w-[920px] p-6">
      <h2 class="h-10 text-xl font-bold text-white">Import a team</h2>

      <label for="import-name" class="block h-7 text-base text-gray-200">Team name</label>
      <div class="h-[68px]">
        <input
          #nameInput
          id="import-name"
          type="text"
          [attr.aria-describedby]="fieldError('name') ? 'import-name-error' : null"
          [formField]="importForm.name"
          class="block h-10 w-[400px] rounded-md border border-gray-400 bg-gray-800 p-[0_12px] text-lg text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        />
        @if (fieldError('name'); as error) {
          <p id="import-name-error" class="text-sm leading-6 text-red-300">{{ error }}</p>
        }
      </div>

      <label for="import-paste" class="block h-7 text-base text-gray-200">
        Team in Showdown's text format (Teambuilder → Import/Export)
      </label>
      <div class="h-[380px]">
        <textarea
          id="import-paste"
          appScrollRegion
          spellcheck="false"
          [attr.placeholder]="placeholder"
          [attr.aria-describedby]="fieldError('paste') ? 'import-paste-error' : null"
          [formField]="importForm.paste"
          class="block h-[348px] w-[872px] rounded-md border border-gray-400 bg-gray-800 p-[8px_12px] font-mono text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        ></textarea>
        @if (fieldError('paste'); as error) {
          <p id="import-paste-error" class="text-sm leading-6 text-red-300">{{ error }}</p>
        }
      </div>

      <div class="relative h-10">
        <button
          type="submit"
          class="absolute top-0 left-0 h-10 w-[120px] cursor-pointer rounded-md border border-blue-300 bg-blue-700 text-base text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Import
        </button>
        <button
          type="button"
          (click)="cancelled.emit()"
          class="absolute top-0 left-[132px] h-10 w-[120px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Cancel
        </button>
      </div>
    </form>
  `,
})
export class TeamImport {
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  readonly imported = output<ImportedTeam>();
  readonly cancelled = output<void>();

  protected readonly placeholder = PLACEHOLDER;

  private readonly model = signal({ name: '', paste: '' });
  protected readonly importForm = form(
    this.model,
    (path) => {
      required(path.name, { message: 'Give the team a name.' });
      maxLength(path.name, MAX_TEAM_NAME_LENGTH, { message: `Use at most ${MAX_TEAM_NAME_LENGTH} characters.` });
      required(path.paste, { message: 'Paste a team exported from Showdown.' });
      validate(path.paste, ({ value }) =>
        value().trim() && parseTeamPaste(value()).sets.length === 0
          ? { kind: 'noPokemon', message: 'No Pokémon found. Paste the text from Showdown\'s Import/Export.' }
          : undefined,
      );
    },
    {
      submission: {
        action: async (field) => {
          const { name, paste } = field().value();
          const parsed = parseTeamPaste(paste);
          this.imported.emit({ name: name.trim(), format: DEFAULT_TEAM_FORMAT, sets: parsed.sets });
          this.importForm().reset({ name: '', paste: '' });
          return undefined;
        },
      },
    },
  );

  /** Starts a fresh import: clears the form and focuses the name field. */
  open(): void {
    this.importForm().reset({ name: '', paste: '' });
    this.nameInput().nativeElement.focus();
  }

  protected fieldError(field: 'name' | 'paste'): string | undefined {
    const state = this.importForm[field]();
    return state.touched() && state.invalid() ? state.errors()[0]?.message : undefined;
  }
}
