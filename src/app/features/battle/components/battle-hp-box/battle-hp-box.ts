import { Component, computed, input } from '@angular/core';
import { BattlePokemon } from '@features/battle/models/battle';

const BAR_WIDTH = 268;
const CHIP_LEFT = 12;
const CHIP_WIDTH = 48;
const CHIP_GAP = 4;
/** Chips that fit on the bottom row: next to the HP numbers on the player's boxes, the whole row on the opponent's. */
const OWN_CHIPS = 4;
const FOE_CHIPS = 6;

/** Stat stages in the order the games list them, as the chips name them. */
const STATS: [string, string][] = [
  ['atk', 'Atk'],
  ['def', 'Def'],
  ['spa', 'SpA'],
  ['spd', 'SpD'],
  ['spe', 'Spe'],
  ['accuracy', 'Acc'],
  ['evasion', 'Eva'],
];

const STATUS: Record<string, { text: string; name: string; color: string }> = {
  brn: { text: 'BRN', name: 'burned', color: '#c2410c' },
  par: { text: 'PAR', name: 'paralyzed', color: '#a16207' },
  psn: { text: 'PSN', name: 'poisoned', color: '#7e22ce' },
  tox: { text: 'TOX', name: 'badly poisoned', color: '#7e22ce' },
  slp: { text: 'SLP', name: 'asleep', color: '#4b5563' },
  frz: { text: 'FRZ', name: 'frozen', color: '#0369a1' },
};

const RAISED_COLOR = '#15803d';
const LOWERED_COLOR = '#b91c1c';

interface Chip {
  key: string;
  text: string;
  color: string;
  left: number;
}

/**
 * A Pokémon's status box on the field, in the style of the third-generation games: name and HP bar,
 * with the HP left as a percentage for the opponent's Pokémon (all that's known of them) and as
 * numbers under the bar for the player's own (a percentage again in a replay, where that's all the log
 * gives). The bottom row shows its status (BRN, PAR…) and stat stages ("Atk -1", "Spe +2"). The
 * opponent's box shows no level: every Pokémon in the format is level 50. Fixed 336x84, absolutely
 * laid out (Brewser layout rules).
 */
@Component({
  selector: 'app-battle-hp-box',
  host: { class: 'block' },
  template: `
    @if (pokemon(); as p) {
      <div
        role="group"
        [attr.aria-label]="label()"
        class="relative h-[84px] w-[336px] rounded-[10px] border-[3px] border-[#404040] bg-[#f8f8d8] text-[#303030]"
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
        @for (chip of chips(); track chip.key) {
          <span
            aria-hidden="true"
            class="absolute top-[55px] block h-5 overflow-hidden rounded-sm text-center text-xs leading-5 font-bold whitespace-nowrap text-white"
            [style.left.px]="chip.left"
            [style.width.px]="chipWidth"
            [style.background-color]="chip.color"
            >{{ chip.text }}</span
          >
        }
        @if (own()) {
          <span class="absolute top-[52px] left-[230px] block h-6 w-[90px] text-right text-lg leading-6 font-bold">{{ exact() ? p.hp + '/' + p.maxHp : percentLabel() }}</span>
        }
      </div>
    }
  `,
})
export class BattleHpBox {
  readonly pokemon = input<BattlePokemon | null>(null);
  /** The player's own Pokémon: shows its HP numbers. */
  readonly own = input(false);
  /** Whether HP is known exactly (the player's own team); in a replay every HP is out of 100. */
  readonly exact = input(true);

  protected readonly chipWidth = CHIP_WIDTH;

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

  /** Status first, then each changed stat; the last chip says how many more when they don't fit. */
  protected readonly chips = computed<Chip[]>(() => {
    const p = this.pokemon();
    if (!p) return [];
    const status = STATUS[p.status];
    const all = [
      ...(status ? [{ key: 'status', text: status.text, color: status.color }] : []),
      ...STATS.filter(([stat]) => p.boosts[stat]).map(([stat, short]) => {
        const stage = p.boosts[stat];
        return { key: stat, text: `${short} ${stage > 0 ? '+' : ''}${stage}`, color: stage > 0 ? RAISED_COLOR : LOWERED_COLOR };
      }),
    ];
    const max = this.own() ? OWN_CHIPS : FOE_CHIPS;
    const shown = all.length > max ? [...all.slice(0, max - 1), { key: 'more', text: `+${all.length - max + 1}`, color: '#4b5563' }] : all;
    return shown.map((chip, i) => ({ ...chip, left: CHIP_LEFT + i * (CHIP_WIDTH + CHIP_GAP) }));
  });

  protected readonly label = computed(() => {
    const p = this.pokemon();
    if (!p) return '';
    const hp = this.own() && this.exact() ? `level ${p.level}, ${p.hp} of ${p.maxHp} HP` : `${this.percentLabel()} HP`;
    const status = STATUS[p.status]?.name;
    const stages = STATS.filter(([stat]) => p.boosts[stat]).map(([stat, short]) => `${short} ${p.boosts[stat] > 0 ? '+' : ''}${p.boosts[stat]}`);
    return [p.name, hp, ...(status ? [status] : []), ...stages].join(', ');
  });
}
