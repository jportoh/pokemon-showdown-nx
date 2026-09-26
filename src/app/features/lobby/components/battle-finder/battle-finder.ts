import { Component, ElementRef, computed, output, signal, viewChild } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { PLAYABLE_FORMATS } from '@shared/data/formats';

export interface BattleRequest {
  /** The format's ID (`gen9randombattle`…). */
  format: string;
}


@Component({
  imports: [FormField],
  selector: 'app-battle-finder',
  templateUrl: './battle-finder.html',
})
export class BattleFinder {
  private readonly formatSelect = viewChild.required<ElementRef<HTMLSelectElement>>('formatSelect');

  readonly findBattle = output<BattleRequest>();
  readonly chooseTeam = output<void>();

  /** VGC (doubles, with the player's team) or Random Battle (singles, random teams). */
  protected readonly formats = PLAYABLE_FORMATS;
  protected readonly teamSlots = Array.from({ length: 6 });

  private readonly request = signal<BattleRequest>({ format: PLAYABLE_FORMATS[0].id });

  protected readonly battleForm = form(this.request);

  protected readonly isRandomFormat = computed(
    () => PLAYABLE_FORMATS.find((format) => format.id === this.request().format)?.randomTeams ?? false,
  );

  /**
   * Not a form submit: on the console a submit button did nothing (plain click buttons work), so
   * this reads the select itself in case the events that update the form model were missed.
   */
  protected battle(): void {
    this.syncFormat();
    this.findBattle.emit(this.request());
  }

  /** Reads the picked format from the select, in case the events that update the form model were missed. */
  protected syncFormat(): void {
    this.request.set({ format: this.formatSelect().nativeElement.value });
  }
}
