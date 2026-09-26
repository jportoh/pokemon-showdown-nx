import { Component, computed, input } from '@angular/core';
import { BattlePokemon } from '@features/battle/models/battle';

const BAR_WIDTH = 268;

/**
 * A Pokémon's status box on the field, in the style of the third-generation games: name and HP bar,
 * with the HP left as a percentage for the opponent's Pokémon (all that's known of them) and as
 * numbers under the bar for the player's own. The opponent's box shows no level: every Pokémon in the
 * format is level 50. Fixed 336px wide, absolutely laid out (Brewser layout rules).
 */
@Component({
  selector: 'app-battle-hp-box',
  host: { class: 'block' },
  template: `
    @if (pokemon(); as p) {
      <div
        role="group"
        [attr.aria-label]="label()"
        class="relative w-[336px] rounded-[10px] border-[3px] border-[#404040] bg-[#f8f8d8] text-[#303030]"
        [style.height.px]="own() ? 84 : 62"
      >
        <span class="absolute top-[4px] left-[12px] block h-6 w-[210px] overflow-hidden text-lg leading-6 font-bold whitespace-nowrap">{{ p.name }}</span>
        @if (isMega()) {
          <span class="absolute top-[7px] left-[222px] block h-[18px] w-[44px] rounded-sm bg-[#6b2a73] text-center text-xs leading-[18px] font-bold text-white">MEGA</span>
        }
        <span class="absolute top-[4px] left-[266px] block h-6 w-[58px] text-right text-base leading-6 font-bold">{{ own() ? 'Lv' + p.level : percentLabel() }}</span>
        <span aria-hidden="true" class="absolute top-[33px] left-[12px] block h-4 w-[30px] rounded-sm bg-[#e8a020] text-center text-[11px] leading-4 font-bold">HP</span>
        <span aria-hidden="true" class="absolute top-[35px] left-[48px] block h-3 w-[272px] rounded-sm bg-[#506858] p-[2px]">
          <span class="block h-2 rounded-sm transition-[width] duration-500" [style.width.px]="barWidth()" [style.background-color]="barColor()"></span>
        </span>
        @if (own()) {
          <span class="absolute top-[52px] left-[160px] block h-6 w-[160px] text-right text-lg leading-6 font-bold">{{ p.hp }}/{{ p.maxHp }}</span>
        }
      </div>
    }
  `,
})
export class BattleHpBox {
  readonly pokemon = input<BattlePokemon | null>(null);
  /** The player's own Pokémon: shows its HP numbers. */
  readonly own = input(false);

  private readonly percent = computed(() => {
    const p = this.pokemon();
    return p && p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;
  });

  protected readonly barWidth = computed(() => Math.round(BAR_WIDTH * this.percent()));
  /** "73%": never 0% while it still has HP. */
  protected readonly percentLabel = computed(() => {
    const p = this.pokemon();
    const percent = Math.round(this.percent() * 100);
    return `${p && p.hp > 0 ? Math.max(1, percent) : 0}%`;
  });
  /** Green, then yellow under half, red under a fifth, as in the games. */
  protected readonly barColor = computed(() => {
    const percent = this.percent();
    return percent > 0.5 ? '#38c060' : percent > 0.2 ? '#e0b020' : '#e04030';
  });

  protected readonly isMega = computed(() => /-Mega/.test(this.pokemon()?.species ?? ''));

  protected readonly label = computed(() => {
    const p = this.pokemon();
    if (!p) return '';
    return this.own() ? `${p.name}, level ${p.level}, ${p.hp} of ${p.maxHp} HP` : `${p.name}, ${this.percentLabel()} HP`;
  });
}
