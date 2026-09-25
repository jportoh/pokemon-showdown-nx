import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { Team } from '@features/teambuilder/models/team';
import { TeamValidation } from '@features/teambuilder/state/team-validation';
import { formatName } from '@shared/data/formats';
import { ScrollRegion } from '@shared/directives/scroll-region';

@Component({
  imports: [ScrollRegion],
  selector: 'app-team-validation-panel',
  host: { class: 'block' },
  // Fixed 920x644 panel with plain block content (Brewser layout rules, see styles.css). The problem
  // list stays mounted and is only hidden, and its rows are blocks with the padding inside the region.
  template: `
    <div class="h-[644px] w-[920px] p-6">
      <h2 class="h-10 text-xl font-bold text-white">Validate: {{ team()?.name }}</h2>
      <p class="h-8 text-base text-gray-200">{{ format() }}</p>
      <p
        role="status"
        class="h-10 text-lg font-bold"
        [class.text-gray-200]="status() === 'checking'"
        [class.text-green-300]="status() === 'valid'"
        [class.text-red-300]="status() === 'invalid' || status() === 'error'"
      >
        {{ message() }}
      </p>
      <div class="h-[444px]">
        <ul
          #problemList
          appScrollRegion
          tabindex="0"
          aria-label="Problems"
          [class.hidden]="problems().length === 0"
          class="block h-[428px] w-[872px] overflow-y-auto rounded-md border border-gray-400 bg-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          @for (problem of problems(); track $index) {
            <li class="block border-b border-gray-700 p-[8px_12px] text-base text-white">{{ problem }}</li>
          }
        </ul>
      </div>
      <button
        #backButton
        type="button"
        (click)="back.emit()"
        class="block h-10 w-[120px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Back
      </button>
    </div>
  `,
})
export class TeamValidationPanel {
  private readonly validation = inject(TeamValidation);
  private readonly backButton = viewChild.required<ElementRef<HTMLButtonElement>>('backButton');

  readonly team = input<Team | undefined>(undefined);
  readonly back = output<void>();

  protected readonly format = computed(() => formatName(this.team()?.format ?? ''));
  protected readonly status = computed(() => this.validation.result()?.status ?? 'checking');
  protected readonly message = computed(() => {
    const result = this.validation.result();
    return !result || result.status === 'checking' ? 'Checking with the Showdown server…' : result.message;
  });
  protected readonly problems = computed(() => this.validation.result()?.problems ?? []);

  /** Starts checking the team shown. */
  validate(): void {
    const team = this.team();
    if (team) this.validation.validate(team);
  }

  /** Back is focused when the panel opens; the problem list is just above it. */
  focusBack(): void {
    this.backButton().nativeElement.focus();
  }
}
