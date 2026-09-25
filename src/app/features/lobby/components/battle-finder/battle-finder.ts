import { Component, ElementRef, computed, output, signal, viewChild } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';

export interface BattleRequest {
  format: string;
  disallowSpectators: boolean;
}

const FORMATS = ['Random Battle', 'Gen 9 OU', 'Gen 9 UU', 'Gen 9 Ubers', 'Gen 9 Doubles OU'];

@Component({
  imports: [FormField],
  selector: 'app-battle-finder',
  templateUrl: './battle-finder.html',
})
export class BattleFinder {
  private readonly formatSelect = viewChild.required<ElementRef<HTMLSelectElement>>('formatSelect');
  private readonly spectatorsBox = viewChild.required<ElementRef<HTMLInputElement>>('spectatorsBox');

  readonly findBattle = output<BattleRequest>();
  readonly chooseTeam = output<void>();

  protected readonly formats = FORMATS;
  protected readonly teamSlots = Array.from({ length: 6 });

  private readonly request = signal<BattleRequest>({
    format: FORMATS[0],
    disallowSpectators: false,
  });

  protected readonly battleForm = form(this.request);

  protected readonly isRandomFormat = computed(() => this.request().format.startsWith('Random'));

  /**
   * Not a form submit: on the console a submit button did nothing (plain click buttons work), so
   * this reads the controls themselves in case the events that update the form model were missed.
   */
  protected battle(): void {
    this.request.set({
      format: this.formatSelect().nativeElement.value,
      disallowSpectators: this.spectatorsBox().nativeElement.checked,
    });
    this.findBattle.emit(this.request());
  }
}
