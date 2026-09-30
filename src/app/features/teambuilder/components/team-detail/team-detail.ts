import { Component, ElementRef, afterRenderEffect, computed, inject, input, linkedSignal, output, signal, viewChild, viewChildren } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { ChampionsDex } from '@core/dex/champions-dex';
import { TeamSlot } from '@features/teambuilder/components/team-slot/team-slot';
import { MAX_TEAM_SIZE, Team } from '@features/teambuilder/models/team';
import { TEAM_FORMATS, formatLabel } from '@shared/data/formats';
import { KeyboardField } from '@shared/components/keyboard-field';
import { BackAction } from '@shared/directives/back-action';

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
  imports: [TeamSlot, FormField, BackAction, KeyboardField],
  selector: 'app-team-detail',
  host: { class: 'block' },
  // Fixed 920x644 panel (see styles.css): an 88px header (name and format button, or the rename form,
  // plus actions) over the six slot cards. Everything is absolutely placed at fixed positions (seen on
  // device: sizes in percentages go wrong on Brewser).
  template: `
    <div class="relative h-[644px] w-[920px]">
      <div [class.hidden]="editing()">
        <h2 #heading tabindex="-1" class="absolute top-2 left-6 w-[490px] text-xl font-bold text-retro-ink">{{ team()?.name }}</h2>
        <span aria-hidden="true" class="absolute top-[52px] left-6 text-sm text-retro-muted">Format</span>
        <!-- A button that moves to the next format, not a <select>: a native picker can't be driven with the controller. -->
        <button
          type="button"
          (click)="nextFormat()"
          class="absolute top-[44px] left-[84px] h-9 w-[340px] cursor-pointer rounded-md border-2 border-retro-outline bg-retro-button text-base text-retro-ink hover:bg-retro-select focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          [attr.aria-label]="'Format: ' + formatText() + '. Change to the next format'"
        >
          <span aria-hidden="true" class="absolute top-0 left-[10px] block h-8 w-[290px] text-left leading-8">{{ formatText() }}</span>
          <span aria-hidden="true" class="absolute top-0 left-[306px] block h-8 w-5 text-center leading-8">▶</span>
        </button>
        <button type="button" (click)="startRename()" [class]="actionClass" class="left-[528px] w-[100px]">Rename</button>
        <!--
          Validate and Delete are ZL and ZR on the controller, so the d-pad skips them (data-kb-skip).
          Shortcut and label sit apart: an inline pill before the text threw the centring off on the console.
        -->
        <button
          type="button"
          data-kb-skip
          (click)="pressValidate()"
          [class]="actionClass"
          class="left-[640px] w-[124px]"
          [attr.aria-label]="'Validate ' + team()?.name + ' for its format'"
        >
          <span aria-hidden="true" [class]="shortcutClass">ZL</span>
          <span aria-hidden="true" class="absolute top-0 left-[44px] block h-8 w-[70px] text-center leading-8">Validate</span>
        </button>
        <button
          type="button"
          data-kb-skip
          (click)="pressDelete()"
          [class]="confirmingDelete() ? confirmClass : actionClass"
          class="left-[776px] w-[120px]"
          [attr.aria-label]="confirmingDelete() ? 'Confirm deleting ' + team()?.name : 'Delete ' + team()?.name"
        >
          <span aria-hidden="true" [class]="shortcutClass">ZR</span>
          <span aria-hidden="true" class="absolute top-0 left-[44px] block h-8 w-[68px] text-center leading-8">
            {{ confirmingDelete() ? 'Confirm' : 'Delete' }}
          </span>
        </button>
      </div>

      <!--
        Not a <form> with a submit button: on the console, Save did nothing while the plain click
        buttons worked, so Save and Enter are handled directly and read the text from the input.
      -->
      <div role="group" aria-label="Rename team" [class.hidden]="!editing()" (appBack)="cancelRename()">
        <app-keyboard-field
          label="Team name"
          [describedBy]="showNameError() ? 'rename-error' : null"
          textSize="text-lg"
          [formField]="renameForm.name"
          [width]="400"
          [height]="40"
          (accepted)="saveButton.focus()"
          class="absolute top-3 left-6"
        />
        <button #saveButton type="button" (click)="saveRename()" [class]="actionClass" class="left-[436px] w-[88px]">Save</button>
        <button type="button" (click)="cancelRename()" [class]="actionClass" class="left-[536px] w-[88px]">Cancel</button>
        @if (showNameError()) {
          <p id="rename-error" class="absolute top-[54px] left-6 text-sm font-bold text-retro-danger">{{ renameForm.name().errors()[0]?.message }}</p>
        }
      </div>

      <!-- Every empty slot adds a Pokémon at the end: teams never have gaps. -->
      @for (position of slotPositions; track $index) {
        <button
          #slotButton
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
  private readonly dex = inject(ChampionsDex);
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly saveButton = viewChild.required<ElementRef<HTMLButtonElement>>('saveButton');
  private readonly slotButtons = viewChildren<ElementRef<HTMLButtonElement>>('slotButton');

  readonly team = input<Team | undefined>(undefined);
  readonly renamed = output<string>();
  readonly formatChanged = output<string>();
  /** Check the team against its format. */
  readonly validate = output<void>();
  /** A slot to edit; the team's length adds a new Pokémon. */
  readonly editSlot = output<number>();
  readonly deleted = output<void>();

  protected readonly slotPositions = SLOT_POSITIONS.slice(0, MAX_TEAM_SIZE);

  /** The team's format by its short label ("BSS Reg M-C"). */
  protected readonly formatText = computed(() => formatLabel(this.team()?.format ?? ''));
  protected readonly actionClass =
    'absolute top-[14px] h-9 cursor-pointer rounded-md border-2 border-retro-outline bg-retro-button text-base text-retro-ink hover:bg-retro-select focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  /** Delete waiting for its confirmation. */
  protected readonly confirmClass =
    'absolute top-[14px] h-9 cursor-pointer rounded-md border-2 border-retro-bar bg-retro-accent text-base font-bold text-white hover:bg-retro-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  /** The controller button's pill at the start of an action button. */
  protected readonly shortcutClass = 'absolute top-[4px] left-[8px] block h-6 w-8 rounded-sm bg-retro-bg text-center text-sm leading-6 font-bold';

  // Both reset whenever a different team is shown.
  protected readonly editing = linkedSignal({ source: () => this.team()?.id, computation: () => false });
  protected readonly confirmingDelete = linkedSignal({ source: () => this.team()?.id, computation: () => false });

  private readonly renameModel = signal({ name: '' });
  protected readonly renameForm = form(this.renameModel, (path) => {
    required(path.name, { message: 'Give the team a name.' });
    maxLength(path.name, MAX_TEAM_NAME_LENGTH, { message: `Use at most ${MAX_TEAM_NAME_LENGTH} characters.` });
  });

  // Where focus goes once the next render shows (or hides) the rename form.
  private focusAfterRender: 'heading' | 'save' | null = null;

  constructor() {
    afterRenderEffect(() => {
      this.editing();
      // Save rather than the name field: focusing a text field opens the console's keyboard, which
      // breaks the navigation under way. The field is one step left.
      if (this.focusAfterRender === 'save') this.saveButton().nativeElement.focus();
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
    const form = this.dex.mega(pokemon.species, pokemon.item) ?? this.dex.species(pokemon.species);
    const species = form?.name ?? pokemon.species;
    const name = pokemon.name ? `${pokemon.name} (${species})` : species;
    // The card itself isn't read out (the label replaces it), so what it shows is told here.
    const parts = [
      name,
      form?.types.join('/'),
      pokemon.item || 'no item',
      pokemon.ability || 'no ability',
      pokemon.moves.length ? pokemon.moves.join(', ') : 'no moves',
    ];
    return `Edit slot ${position + 1}: ${parts.filter(Boolean).join('. ')}`;
  }

  /** Focuses a slot card (the "Add a Pokémon" one past the end of the team). Call it once the team has rendered. */
  focusSlot(index: number): void {
    this.slotButtons()[this.slotIndex(index)]?.nativeElement.focus();
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
    this.focusAfterRender = 'save';
  }

  protected saveRename(): void {
    this.renameModel.update(({ name }) => ({ name: name.trim() }));
    const name = this.renameForm.name();
    name.markAsTouched();
    if (name.invalid()) return;
    this.renamed.emit(name.value());
    this.editing.set(false);
    this.focusAfterRender = 'heading';
  }

  protected cancelRename(): void {
    this.editing.set(false);
    this.focusAfterRender = 'heading';
  }

  /** Moves the team to the next format teams can be built for (after the last, the first again). */
  protected nextFormat(): void {
    const current = TEAM_FORMATS.findIndex((format) => format.id === this.team()?.format);
    this.formatChanged.emit(TEAM_FORMATS[(current + 1) % TEAM_FORMATS.length].id);
  }

  /** ZL, or a click: checks the team, except while it's being renamed. Returns whether it did. */
  pressValidate(): boolean {
    if (!this.team() || this.editing()) return false;
    this.validate.emit();
    return true;
  }

  /**
   * ZR, or a click. Deleting can't be undone, so the first press only asks for confirmation. Does
   * nothing while the team is being renamed; returns whether it did anything.
   */
  pressDelete(): boolean {
    if (!this.team() || this.editing()) return false;
    if (this.confirmingDelete()) this.deleted.emit();
    else this.confirmingDelete.set(true);
    return true;
  }
}
