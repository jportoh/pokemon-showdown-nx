import { Service, signal } from '@angular/core';
import { CalcField, CalcSide } from './damage-calc';
import { RivalSet } from './rival-sets';

/** Who hits whom: your Pokémon the rival, or the rival yours. */
export type CalcMode = 'attack' | 'defend';

export function freshSide(): CalcSide {
  return { reflect: false, lightScreen: false, auroraVeil: false, friendGuard: false, helpingHand: false, tailwind: false, boosts: { atk: 0, spa: 0, def: 0, spd: 0 }, hp: 100 };
}

/** Doubles for VGC, Singles for Battle Stadium Singles. */
export function freshField(format: string): CalcField {
  return { doubles: format.includes('vgc'), weather: 'auto', terrain: 'auto', crit: false, trickRoom: false, yours: freshSide(), rival: freshSide() };
}

/**
 * The Calcs tab's choices, kept while the teambuilder is open: the rival and its set, who attacks,
 * and the field. They stay when you switch tabs or Pokémon, so the same rival can be checked against
 * the whole team.
 */
@Service()
export class CalcState {
  readonly rival = signal<RivalSet | null>(null);
  readonly mode = signal<CalcMode>('attack');
  /** Null until the tab first opens on a team (its format says Doubles or Singles). */
  readonly field = signal<CalcField | null>(null);

  /** The field for a team of `format`, made the first time. */
  fieldFor(format: string): CalcField {
    let field = this.field();
    if (!field) {
      field = freshField(format);
      this.field.set(field);
    }
    return field;
  }

  update(change: (field: CalcField) => CalcField): void {
    const field = this.field();
    if (field) this.field.set(change(field));
  }
}
