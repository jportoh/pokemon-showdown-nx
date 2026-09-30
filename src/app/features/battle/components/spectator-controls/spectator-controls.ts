import { Component, ElementRef, afterNextRender, computed, inject, output, viewChild } from '@angular/core';
import { BattlePokemonInfo } from '@features/battle/components/battle-pokemon-info/battle-pokemon-info';
import { BattleStore } from '@features/battle/state/battle-store';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';

/**
 * The command panel while watching a live battle as a spectator, 961x148: on the left, who's playing
 * (or why the battle can't be watched, or how it ended) over the way back to the list of live battles
 * (B too); on the right, everything known of the team member pointed at in the right column (both
 * sides' tiles take the d-pad while watching). Absolutely laid out (Brewser layout rules).
 */
@Component({
  selector: 'app-spectator-controls',
  imports: [BattlePokemonInfo],
  host: { class: 'block h-[148px] w-[961px] text-white' },
  template: `
    <div class="relative h-[148px] w-[961px]">
      <p role="status" class="absolute top-0 left-0 block h-[72px] w-[300px] overflow-hidden text-base leading-6 text-gray-200">
        {{ status() }}
      </p>
      <button
        #leaveButton
        type="button"
        class="absolute top-[104px] left-0 h-[44px] w-[300px] rounded-md border border-gray-400 bg-gray-600 text-base font-bold hover:bg-gray-500"
        (click)="leave.emit()"
      >
        Other live battles
      </button>
      <app-battle-pokemon-info class="absolute top-0 left-[316px]" [inspected]="inspection.shown()" [owner]="owner()" />
    </div>
  `,
})
export class SpectatorControls {
  protected readonly store = inject(BattleStore);
  protected readonly inspection = inject(PokemonInspection);
  private readonly leaveButton = viewChild.required<ElementRef<HTMLButtonElement>>('leaveButton');

  readonly leave = output<void>();

  protected readonly status = computed(() => {
    const error = this.store.spectateError();
    if (error) return error;
    const { p1, p2 } = this.store.sides();
    if (!p1.name || !p2.name) return 'Joining the battle…';
    const result = this.store.result();
    if (result) return `${p1.name} vs ${p2.name}: the battle is over.`;
    if (this.store.teamPreview()) return 'Team preview: the players are picking their Pokémon.';
    return `Watching live: ${p1.name} vs ${p2.name}`;
  });

  /** The shown Pokémon's trainer. */
  protected readonly owner = computed(() => {
    const shown = this.inspection.shown();
    return shown ? this.store.sides()[shown.side].name : '';
  });

  constructor() {
    afterNextRender(() => this.focusLeave());
  }

  /** Focus back on the way out (B from the team tiles). */
  focusLeave(): void {
    this.leaveButton().nativeElement.focus();
  }
}
