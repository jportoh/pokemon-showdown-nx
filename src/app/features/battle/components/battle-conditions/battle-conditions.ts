import { Component, computed, inject, input } from '@angular/core';
import { FieldCondition, SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { conditionColor, conditionTurns } from '@features/battle/state/field-conditions';

/** Chips per group; past that, the last one becomes "+N". */
const MAX_CHIPS = 3;
const CHIP_WIDTH = 81;
const CHIP_GAP = 6;
const CHIP_LEFT = 8;
/** The pips' row inside a chip. */
const PIPS_WIDTH = 69;
const PIP_GAP = 2;
const MAX_PIP_WIDTH = 10;
/** Longer names get their short form ("Psychic" for Psychic Terrain) to fit a chip. */
const MAX_NAME_CHARS = 11;

export interface Pip {
  left: number;
  width: number;
  /** A turn still to come (or a layer). */
  on: boolean;
}

export interface Chip {
  name: string;
  color: string;
  left: number;
  /** Turns left out of its length, or its layers (Spikes); none for the ones that simply stay. */
  pips: Pip[];
}

/**
 * What's in play in one group: the field's own (weather, terrain, rooms) or a side's (Tailwind,
 * screens, hazards). Each condition is a chip in its colour with a pip per turn: lit for the turns
 * left, dim for the ones gone (Spikes show their layers). A card fixed at 271x64, stacked with the
 * others in the battle's right column; chips at fixed positions (Brewser layout rules).
 */
@Component({
  selector: 'app-battle-conditions',
  host: { class: 'block h-[64px] w-[271px]' },
  template: `
    @let info = group();
    <div class="relative block h-[64px] w-[271px] rounded-md bg-card" role="group" [attr.aria-label]="info.ariaLabel">
      <span
        aria-hidden="true"
        class="absolute top-[4px] left-[10px] block h-4 w-[251px] overflow-hidden text-xs leading-4 font-bold whitespace-nowrap text-gray-300 uppercase"
        >{{ info.label }}</span
      >
      <!-- By position, not by condition: a chip that moved over would leave its text and pips
           behind on Brewser (absolute children don't follow a container that moves). -->
      @for (chip of info.chips; track chip.left) {
        <span
          aria-hidden="true"
          class="absolute top-[24px] block h-[34px] rounded-sm text-white"
          [style.left.px]="chip.left"
          [style.width.px]="chipWidth"
          [style.background-color]="chip.color"
        >
          <span
            class="absolute left-[2px] block h-4 w-[77px] overflow-hidden text-center text-xs leading-4 font-bold whitespace-nowrap"
            [style.top.px]="chip.pips.length > 0 ? 4 : 9"
            >{{ chip.name }}</span
          >
          @for (pip of chip.pips; track $index) {
            <span
              class="absolute top-[23px] block h-[6px] rounded-[1px]"
              [style.left.px]="pip.left"
              [style.width.px]="pip.width"
              [style.background-color]="pip.on ? '#ffffff' : 'rgba(0, 0, 0, 0.35)'"
            ></span>
          }
        </span>
      } @empty {
        <span aria-hidden="true" class="absolute top-[30px] left-[10px] block h-5 text-sm leading-5 text-gray-400">None</span>
      }
    </div>
  `,
})
export class BattleConditions {
  private readonly store = inject(BattleStore);

  /** The field's conditions, or a side's (next to that side's team, so labelled "Side"). */
  readonly of = input.required<'field' | SideId>();

  protected readonly chipWidth = CHIP_WIDTH;

  protected readonly group = computed(() => {
    const field = this.store.field();
    const turn = this.store.turn();
    const of = this.of();
    const conditions =
      of === 'field' ? [field.weather, field.terrain, ...field.rooms].filter((c): c is FieldCondition => !!c) : field.sides[of];
    const owner = of === 'field' ? '' : this.store.sides()[of].name || (of === 'p2' ? 'Opponent' : 'Player');
    const described = conditions.map((c) => describe(c, turn)).join(', ');
    return {
      label: of === 'field' ? 'Field' : 'Side',
      chips: toChips(conditions, turn),
      ariaLabel: `${of === 'field' ? 'Field' : `${owner}'s side`}: ${described || 'none'}`,
    };
  });
}

/** Up to three chips; with more conditions, two and a "+N" chip for the rest. */
export function toChips(conditions: readonly FieldCondition[], turn: number): Chip[] {
  const fits = conditions.length <= MAX_CHIPS;
  const shown = fits ? conditions : conditions.slice(0, MAX_CHIPS - 1);
  const chips = shown.map((condition, i) => toChip(condition, turn, i));
  if (fits) return chips;
  const more = conditions.length - shown.length;
  return [
    ...chips,
    { name: `+${more}`, color: '#374151', left: chipLeft(shown.length), pips: [] },
  ];
}

function toChip(condition: FieldCondition, turn: number, index: number): Chip {
  const turns = conditionTurns(condition, turn);
  const pips = turns
    ? toPips(turns.total, turns.left)
    : condition.layers > 1
      ? toPips(condition.layers, condition.layers)
      : [];
  return {
    name: condition.name.length > MAX_NAME_CHARS ? shortName(condition.name) : condition.name,
    color: conditionColor(condition),
    left: chipLeft(index),
    pips,
  };
}

function chipLeft(index: number): number {
  return CHIP_LEFT + index * (CHIP_WIDTH + CHIP_GAP);
}

/** `count` pips centred in the chip, the first `on` of them lit. */
function toPips(count: number, on: number): Pip[] {
  const width = Math.min(MAX_PIP_WIDTH, Math.floor((PIPS_WIDTH - PIP_GAP * (count - 1)) / count));
  const rowWidth = width * count + PIP_GAP * (count - 1);
  const start = 6 + Math.floor((PIPS_WIDTH - rowWidth) / 2);
  return Array.from({ length: count }, (_, i) => ({ left: start + i * (width + PIP_GAP), width, on: i < on }));
}

/** "Tailwind, 3 turns left", "Spikes, 2 layers", "Stealth Rock": what screen readers hear. */
function describe(condition: FieldCondition, turn: number): string {
  const turns = conditionTurns(condition, turn);
  if (turns) return `${condition.name}, ${turns.left} ${turns.left === 1 ? 'turn' : 'turns'} left`;
  return condition.layers > 1 ? `${condition.name}, ${condition.layers} layers` : condition.name;
}

function shortName(name: string): string {
  return name
    .replace(/ Terrain$/, '')
    .replace('Light Screen', 'Screen')
    .replace('Aurora Veil', 'Veil')
    .replace('Stealth Rock', 'Rocks')
    .replace('Toxic Spikes', 'T. Spikes')
    .replace('Strong winds', 'Winds');
}
