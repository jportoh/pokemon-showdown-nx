import { Component, computed, inject } from '@angular/core';
import { FieldCondition } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { conditionColor, conditionLabel } from '@features/battle/state/field-conditions';

const ROW_HEIGHT = 30;
const CHIP_LEFT = 84;
const ROW_END = 419;
const CHIP_GAP = 6;
/** Chip width from its text: about this much per character (bold 12px) plus the padding. */
const CHAR_PX = 6.8;
const CHIP_PADDING = 14;
const MORE_WIDTH = 64;
/** Characters of a player's name that fit the label column. */
const MAX_LABEL_CHARS = 8;

interface Chip {
  key: string;
  text: string;
  color: string;
  left: number;
  width: number;
}

/**
 * What's in play on the field, at a glance, with the turns left: weather, terrain and rooms (Trick
 * Room…) on the first row, then each side's conditions (Tailwind, screens, hazards), the opponent's
 * first as on the field. Fixed 427x96 under the battle bar; chips at fixed positions (Brewser
 * layout rules).
 */
@Component({
  selector: 'app-battle-conditions',
  host: { class: 'block h-[96px] w-[427px] bg-[#283040]' },
  template: `
    <div class="relative h-[96px] w-[427px]" role="group" aria-label="Field conditions">
      @for (row of rows(); track row.key) {
        <div class="absolute left-0 block h-[26px] w-[427px]" [style.top.px]="row.top" [attr.aria-label]="row.ariaLabel" role="group">
          <span class="absolute top-0 left-[12px] block h-[26px] w-[66px] overflow-hidden text-sm leading-[26px] font-bold whitespace-nowrap text-gray-200">{{ row.label }}</span>
          @for (chip of row.chips; track chip.key) {
            <span
              class="absolute top-[1px] block h-6 overflow-hidden rounded-sm text-center text-xs leading-6 font-bold whitespace-nowrap text-white"
              [style.left.px]="chip.left"
              [style.width.px]="chip.width"
              [style.background-color]="chip.color"
              >{{ chip.text }}</span
            >
          } @empty {
            <span class="absolute top-0 left-[84px] block h-[26px] text-sm leading-[26px] text-gray-400">None</span>
          }
        </div>
      }
    </div>
  `,
})
export class BattleConditions {
  private readonly store = inject(BattleStore);

  protected readonly rows = computed(() => {
    const field = this.store.field();
    const sides = this.store.sides();
    const turn = this.store.turn();
    const global = [field.weather, field.terrain, ...field.rooms].filter((c): c is FieldCondition => !!c);
    return [
      { key: 'field', label: 'Field', conditions: global },
      { key: 'p2', label: shortLabel(sides.p2.name || 'Opponent'), conditions: field.sides.p2 },
      { key: 'p1', label: shortLabel(sides.p1.name || 'You'), conditions: field.sides.p1 },
    ].map((row, i) => {
      const chips = toChips(row.conditions, turn);
      const ariaLabel = `${row.label}: ${chips.length > 0 ? chips.map((c) => c.text).join(', ') : 'none'}`;
      return { key: row.key, label: row.label, top: 6 + i * ROW_HEIGHT, chips, ariaLabel };
    });
  });
}

/**
 * Chips as wide as their text, one after the other. When they don't fit, shorter names ("Psychic ·
 * 3" for Psychic Terrain), and past that a "+N" chip for the rest.
 */
function toChips(conditions: readonly FieldCondition[], turn: number): Chip[] {
  const full = layout(conditions, (c) => conditionLabel(c, turn));
  if (full.length === conditions.length) return full;
  const short = layout(conditions, (c) => conditionLabel({ ...c, name: shortName(c.name) }, turn));
  if (short.length === conditions.length) return short;
  const shown = layout(conditions, (c) => conditionLabel({ ...c, name: shortName(c.name) }, turn), MORE_WIDTH + CHIP_GAP);
  const left = shown.length > 0 ? shown[shown.length - 1].left + shown[shown.length - 1].width + CHIP_GAP : CHIP_LEFT;
  return [...shown, { key: 'more', text: `+${conditions.length - shown.length}`, color: '#374151', left, width: MORE_WIDTH }];
}

/** As many chips as fit before the row's end (less the space kept for a "+N" chip). */
function layout(conditions: readonly FieldCondition[], text: (c: FieldCondition) => string, reserve = 0): Chip[] {
  const chips: Chip[] = [];
  let left = CHIP_LEFT;
  for (const condition of conditions) {
    const label = text(condition);
    const width = Math.round(label.length * CHAR_PX + CHIP_PADDING);
    if (left + width > ROW_END - reserve) break;
    chips.push({ key: condition.id, text: label, color: conditionColor(condition), left, width });
    left += width + CHIP_GAP;
  }
  return chips;
}

/** A player's name cut to fit the 66px label column, by hand: text-overflow is untested on Brewser. */
function shortLabel(name: string): string {
  return name.length > MAX_LABEL_CHARS ? `${name.slice(0, MAX_LABEL_CHARS - 1)}…` : name;
}

function shortName(name: string): string {
  return name.replace(/ Terrain$/, '').replace('Light Screen', 'Screen').replace('Aurora Veil', 'Veil').replace('Stealth Rock', 'Rocks');
}
