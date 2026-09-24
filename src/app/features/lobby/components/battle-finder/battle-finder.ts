import { Component, computed, output, signal } from '@angular/core';
import { form, FormField, FormRoot } from '@angular/forms/signals';

export interface BattleRequest {
  format: string;
  disallowSpectators: boolean;
}

const FORMATS = ['Random Battle', 'Gen 9 OU', 'Gen 9 UU', 'Gen 9 Ubers', 'Gen 9 Doubles OU'];

@Component({
  imports: [FormField, FormRoot],
  selector: 'app-battle-finder',
  templateUrl: './battle-finder.html',
})
export class BattleFinder {
  readonly findBattle = output<BattleRequest>();
  readonly chooseTeam = output<void>();

  protected readonly formats = FORMATS;
  protected readonly teamSlots = Array.from({ length: 6 });

  private readonly request = signal<BattleRequest>({
    format: FORMATS[0],
    disallowSpectators: false,
  });

  protected readonly battleForm = form(this.request, {
    submission: {
      action: async (field) => {
        this.findBattle.emit(field().value());
        return undefined;
      },
    },
  });

  protected readonly isRandomFormat = computed(() => this.request().format.startsWith('Random'));
}
