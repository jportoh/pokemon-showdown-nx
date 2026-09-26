import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input, untracked, viewChild } from '@angular/core';
import { stepAnimation } from '@features/battle/animation/step-animation';
import { BattlePokemon } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { STATUS } from '@features/battle/state/status-conditions';
import { typeColor } from '@shared/data/type-colors';

/** How a box stands out while a move plays: its user, or one of its targets. */
export type HpBoxEmphasis = 'attacker' | 'target';

const BAR_WIDTH = 268;
/** How long the bar takes to reach its new width at normal speed (an HP step lasts 600 ms). */
const BAR_MS = 500;
const BORDER_COLORS: Record<HpBoxEmphasis | 'none', string> = { attacker: '#eab308', target: '#dc2626', none: '#404040' };
const CHIP_LEFT = 12;
const CHIP_WIDTH = 48;
const CHIP_GAP = 4;
/** Chips that fit on the bottom row: next to the HP shown there, or the whole row when it isn't. */
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
 * opponent's box shows no level at level 50 (every Pokémon in VGC); at any other (Random Battle) it
 * shows it, with the percentage moving under the bar as on the player's. A Mega Evolved Pokémon is
 * marked MEGA; a Terastallized one TERA, next to its Tera type (named, on its colour). Fixed 336x84,
 * absolutely laid out (Brewser layout rules). While a move plays, the border turns yellow on its user
 * and red on its targets. The HP bar slides to its new width in steps (Brewser doesn't animate CSS transitions).
 */
@Component({
  selector: 'app-battle-hp-box',
  host: { class: 'block' },
  template: `
    @if (pokemon(); as p) {
      <div
        role="group"
        [attr.aria-label]="label()"
        class="relative h-[84px] w-[336px] rounded-[10px] border-[3px] bg-[#f8f8d8] text-[#303030]"
        [style.border-color]="borderColor()"
      >
        <span class="absolute top-[4px] left-[12px] block h-6 overflow-hidden text-lg leading-6 font-bold whitespace-nowrap" [style.width.px]="nameWidth()">{{ p.name }}</span>
        @if (isMega()) {
          <span class="absolute top-[7px] left-[222px] block h-[18px] w-[44px] rounded-sm bg-[#6b2a73] text-center text-xs leading-[18px] font-bold text-white">MEGA</span>
        } @else if (p.tera) {
          <!-- A generic TERA mark (the games show it as a rainbow), and the type itself by name: its colour alone could be mistaken. -->
          <span class="absolute top-[7px] left-[150px] block h-[18px] w-[44px] rounded-sm bg-[#1e293b] text-center text-xs leading-[18px] font-bold text-[#a5f3fc]">TERA</span>
          <span
            class="absolute top-[7px] left-[198px] block h-[18px] w-[64px] overflow-hidden rounded-full text-center text-xs leading-[18px] font-bold whitespace-nowrap text-white"
            [style.background-color]="teraColor()"
            >{{ p.tera }}</span
          >
        }
        <span class="absolute top-[4px] left-[266px] block h-6 w-[58px] text-right text-base leading-6 font-bold">{{ showLevel() ? 'Lv' + p.level : percentLabel() }}</span>
        <span aria-hidden="true" class="absolute top-[33px] left-[12px] block h-4 w-[30px] rounded-sm bg-[#e8a020] text-center text-[11px] leading-4 font-bold">HP</span>
        <span aria-hidden="true" class="absolute top-[35px] left-[48px] block h-3 w-[272px] rounded-sm bg-[#506858] p-[2px]">
          <span #bar class="block h-2 rounded-sm"></span>
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
        @if (hpText(); as hp) {
          <span class="absolute top-[52px] left-[230px] block h-6 w-[90px] text-right text-lg leading-6 font-bold">{{ hp }}</span>
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
  readonly emphasis = input<HpBoxEmphasis | null>(null);

  private readonly store = inject(BattleStore);
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  /** The width the bar shows now (-1 before it's first drawn) and whose HP it is. */
  private shownWidth = -1;
  private shownIdent = '';
  private stopBar: (() => void) | null = null;

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
  protected readonly borderColor = computed(() => BORDER_COLORS[this.emphasis() ?? 'none']);

  /** The player's own always; the opponent's unless it's level 50 (all of them in VGC). */
  protected readonly showLevel = computed(() => this.own() || (this.pokemon()?.level ?? 50) !== 50);

  /** The HP under the bar: numbers on the player's own, else the percentage when the level took its place. */
  protected readonly hpText = computed(() => {
    const p = this.pokemon();
    if (!p) return null;
    if (this.own()) return this.exact() ? `${p.hp}/${p.maxHp}` : this.percentLabel();
    return this.showLevel() ? this.percentLabel() : null;
  });

  /** Shorter when the TERA mark and its type sit after the name. */
  protected readonly nameWidth = computed(() => (this.pokemon()?.tera && !this.isMega() ? 136 : 210));

  protected readonly teraColor = computed(() => typeColor(this.pokemon()?.tera ?? '') || '#374151');

  constructor() {
    afterRenderEffect(() => {
      const el = this.bar()?.nativeElement;
      const width = this.barWidth();
      const ident = this.pokemon()?.ident ?? '';
      untracked(() => this.moveBar(el, width, ident));
    });
    inject(DestroyRef).onDestroy(() => this.stopBar?.());
  }

  /** Slides the bar from what it shows to the new width; a new Pokémon's bar is drawn at once. */
  private moveBar(el: HTMLElement | undefined, width: number, ident: string): void {
    if (!el) return;
    this.stopBar?.();
    this.stopBar = null;
    const from = this.shownWidth;
    const paint = (w: number) => {
      el.style.width = `${w}px`;
      el.style.backgroundColor = barColor(w / BAR_WIDTH);
      this.shownWidth = w;
    };
    if (from < 0 || ident !== this.shownIdent || from === width) {
      this.shownIdent = ident;
      paint(width);
      return;
    }
    this.stopBar = stepAnimation(BAR_MS / this.store.speed(), (progress) => paint(Math.round(from + (width - from) * progress)));
  }

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
    const max = this.hpText() !== null ? OWN_CHIPS : FOE_CHIPS;
    const shown = all.length > max ? [...all.slice(0, max - 1), { key: 'more', text: `+${all.length - max + 1}`, color: '#4b5563' }] : all;
    return shown.map((chip, i) => ({ ...chip, left: CHIP_LEFT + i * (CHIP_WIDTH + CHIP_GAP) }));
  });

  protected readonly label = computed(() => {
    const p = this.pokemon();
    if (!p) return '';
    const level = this.showLevel() ? `level ${p.level}, ` : '';
    const hp = this.own() && this.exact() ? `${level}${p.hp} of ${p.maxHp} HP` : `${level}${this.percentLabel()} HP`;
    const status = STATUS[p.status]?.name;
    const tera = p.tera ? [`Terastallized, ${p.tera} type`] : [];
    const stages = STATS.filter(([stat]) => p.boosts[stat]).map(([stat, short]) => `${short} ${p.boosts[stat] > 0 ? '+' : ''}${p.boosts[stat]}`);
    return [p.name, hp, ...tera, ...(status ? [status] : []), ...stages].join(', ');
  });
}

/** Green, then yellow under half, red under a fifth, as in the games. */
export function barColor(fraction: number): string {
  return fraction > 0.5 ? '#38c060' : fraction > 0.2 ? '#e0b020' : '#e04030';
}
