import { Component, ElementRef, computed, input, output, viewChild } from '@angular/core';
import { exportTeamPaste } from '@features/teambuilder/data/showdown-paste';
import { Team } from '@features/teambuilder/models/team';
import { ScrollRegion } from '@shared/directives/scroll-region';

@Component({
  imports: [ScrollRegion],
  selector: 'app-team-export',
  host: { class: 'block' },
  // Fixed 920x644 panel with plain block content (Brewser layout rules, see styles.css).
  template: `
    <div class="h-[644px] w-[920px] p-6">
      <h2 class="h-10 text-xl font-bold text-white">Export: {{ team()?.name }}</h2>
      <label for="export-paste" class="block h-7 text-base text-gray-200">
        Select all and copy, then paste it into Showdown's Teambuilder (Import/Export).
      </label>
      <div class="h-[488px]">
        <textarea
          #paste
          id="export-paste"
          appScrollRegion
          readonly
          spellcheck="false"
          [value]="text()"
          class="block h-[472px] w-[872px] rounded-md border border-gray-400 bg-gray-800 p-[8px_12px] font-mono text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        ></textarea>
      </div>
      <button
        type="button"
        (click)="back.emit()"
        class="block h-10 w-[120px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Back
      </button>
    </div>
  `,
})
export class TeamExport {
  private readonly paste = viewChild.required<ElementRef<HTMLTextAreaElement>>('paste');

  readonly team = input<Team | undefined>(undefined);
  readonly back = output<void>();

  protected readonly text = computed(() => {
    const team = this.team();
    return team ? exportTeamPaste(team.sets) : '';
  });

  /** Focuses the text with everything selected, ready to copy. */
  focusText(): void {
    const textarea = this.paste().nativeElement;
    textarea.focus();
    textarea.select();
  }
}
