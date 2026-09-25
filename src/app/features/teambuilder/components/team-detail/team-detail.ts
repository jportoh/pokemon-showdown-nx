import { Component, ElementRef, afterRenderEffect, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import { TeamSlot } from '@features/teambuilder/components/team-slot/team-slot';
import { MAX_TEAM_SIZE, Team } from '@features/teambuilder/models/team';
import { TEAM_FORMATS } from '@shared/data/formats';

export const MAX_TEAM_NAME_LENGTH = 30;

// The 6 slots in 2 columns x 3 rows: 424x172 cards, 24px from the edges, 24px/12px apart.
const SLOT_POSITIONS = [
  'top-[88px] left-6',
  'top-[88px] left-[472px]',
  'top-[272px] left-6',
  'top-[272px] left-[472px]',
  'top-[456px] left-6',
  'top-[456px] left-[472px]',
];

@Component({
  imports: [TeamSlot, FormRoot, FormField],
  selector: 'app-team-detail',
  host: { class: 'block' },
  // Fixed 920x644 panel (see styles.css): an 88px header (name and format select, or the rename form,
  // plus actions) over the six slot cards. Everything is absolutely placed at fixed positions, and the
  // select has a fixed px size: on Brewser a select whose options are rendered by @for gets a wrong
  // size when its width is a percentage (all seen on device).
  template: `
    <div class="relative h-[644px] w-[920px]">
      <div [class.hidden]="editing()">
        <h2 #heading tabindex="-1" class="absolute top-2 left-6 w-[480px] text-xl font-bold text-white">{{ team()?.name }}</h2>
        <label for="team-format" class="absolute top-[52px] left-6 text-sm text-gray-200">Format</label>
        <select
          #formatSelect
          id="team-format"
          (change)="formatChanged.emit(formatSelect.value)"
          class="absolute top-[44px] left-[84px] h-9 w-[340px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 p-[0_8px] text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          @for (format of formatOptions; track format.id) {
            <option [value]="format.id" [selected]="format.id === team()?.format">{{ format.name }}</option>
          }
        </select>
        <button type="button" (click)="startRename()" [class]="actionClass" class="left-[520px] w-[112px]">Rename</button>
        <button type="button" (click)="export.emit()" [class]="actionClass" class="left-[644px] w-[112px]">Export</button>
        <button
          type="button"
          (click)="onDelete()"
          [class]="actionClass"
          class="left-[768px] w-[128px]"
          [class.bg-red-800]="confirmingDelete()"
          [attr.aria-label]="confirmingDelete() ? 'Confirm deleting ' + team()?.name : 'Delete ' + team()?.name"
        >
          {{ confirmingDelete() ? 'Confirm delete' : 'Delete' }}
        </button>
      </div>

      <form [formRoot]="renameForm" [class.hidden]="!editing()">
        <input
          #nameInput
          type="text"
          aria-label="Team name"
          [attr.aria-describedby]="showNameError() ? 'rename-error' : null"
          [formField]="renameForm.name"
          class="absolute top-3 left-6 h-10 w-[400px] rounded-md border border-gray-400 bg-gray-800 p-[0_12px] text-lg text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        />
        <button type="submit" [class]="actionClass" class="left-[436px] w-[88px]">Save</button>
        <button type="button" (click)="cancelRename()" [class]="actionClass" class="left-[536px] w-[88px]">Cancel</button>
        @if (showNameError()) {
          <p id="rename-error" class="absolute top-[54px] left-6 text-sm text-red-300">{{ renameForm.name().errors()[0]?.message }}</p>
        }
      </form>

      <!-- Every empty slot adds a Pokémon at the end: teams never have gaps. -->
      @for (position of slotPositions; track $index) {
        <button
          type="button"
          class="absolute cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          [class]="position"
          [attr.aria-label]="slotLabel($index)"
          (click)="editSlot.emit(slotIndex($index))"
        >
          <app-team-slot [set]="team()?.sets?.[$index]" />
        </button>
      }
    </div>
  `,
})
export class TeamDetail {
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  readonly team = input<Team | undefined>(undefined);
  readonly renamed = output<string>();
  readonly formatChanged = output<string>();
  readonly export = output<void>();
  /** A slot to edit; the team's length adds a new Pokémon. */
  readonly editSlot = output<number>();
  readonly deleted = output<void>();

  protected readonly slotPositions = SLOT_POSITIONS.slice(0, MAX_TEAM_SIZE);

  protected readonly formatOptions = TEAM_FORMATS;
  protected readonly actionClass =
    'absolute top-[14px] h-9 cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

  // Both reset whenever a different team is shown.
  protected readonly editing = linkedSignal({ source: () => this.team()?.id, computation: () => false });
  protected readonly confirmingDelete = linkedSignal({ source: () => this.team()?.id, computation: () => false });

  private readonly renameModel = signal({ name: '' });
  protected readonly renameForm = form(
    this.renameModel,
    (path) => {
      required(path.name, { message: 'Give the team a name.' });
      maxLength(path.name, MAX_TEAM_NAME_LENGTH, { message: `Use at most ${MAX_TEAM_NAME_LENGTH} characters.` });
    },
    {
      submission: {
        action: async (field) => {
          this.renamed.emit(field.name().value().trim());
          this.editing.set(false);
          this.focusAfterRender = 'heading';
          return undefined;
        },
      },
    },
  );

  // Where focus goes once the next render shows (or hides) the rename form.
  private focusAfterRender: 'heading' | 'input' | null = null;

  constructor() {
    afterRenderEffect(() => {
      this.editing();
      if (this.focusAfterRender === 'input') this.nameInput().nativeElement.focus();
      else if (this.focusAfterRender === 'heading') this.heading().nativeElement.focus();
      this.focusAfterRender = null;
    });
  }

  protected slotIndex(position: number): number {
    return Math.min(position, this.team()?.sets.length ?? 0);
  }

  protected slotLabel(position: number): string {
    const pokemon = this.team()?.sets[position];
    if (!pokemon) return 'Add a Pokémon';
    const name = pokemon.name ? `${pokemon.name} (${pokemon.species})` : pokemon.species;
    return `Edit slot ${position + 1}: ${name}`;
  }

  focusHeading(): void {
    this.heading().nativeElement.focus();
  }

  protected showNameError(): boolean {
    const name = this.renameForm.name();
    return name.touched() && name.invalid();
  }

  protected startRename(): void {
    const name = this.team()?.name ?? '';
    this.renameForm().reset({ name });
    this.confirmingDelete.set(false);
    this.editing.set(true);
    this.focusAfterRender = 'input';
  }

  protected cancelRename(): void {
    this.editing.set(false);
    this.focusAfterRender = 'heading';
  }

  /** Deleting can't be undone, so the first click only asks for confirmation. */
  protected onDelete(): void {
    if (this.confirmingDelete()) this.deleted.emit();
    else this.confirmingDelete.set(true);
  }
}
