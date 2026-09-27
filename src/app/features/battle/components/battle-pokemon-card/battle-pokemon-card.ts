import { Component, computed, input } from '@angular/core';
import { moveInfo } from '@core/dex/moves';
import { abilityName, itemName } from '@core/dex/names';
import { RequestPokemon } from '@features/battle/models/battle';
import { parseCondition } from '@features/battle/state/battle-store';
import { ItemIcon } from '@shared/components/item-icon';
import { typeColor } from '@shared/data/type-colors';

const STATS = [
  { id: 'atk', label: 'Atk' },
  { id: 'def', label: 'Def' },
  { id: 'spa', label: 'SpA' },
  { id: 'spd', label: 'SpD' },
  { id: 'spe', label: 'Spe' },
] as const;
/** The stats strip's columns, 322px across the card's inner width. */
const STAT_WIDTH = 64;
/** The moves, two by two. */
const MOVE_WIDTH = 157;
const MOVE_LEFTS = [8, 8 + MOVE_WIDTH + 8];
const MOVE_TOPS = [54, 81];

/**
 * What the card shows under the Pokémon's name and item: its stats (the one choosing, or out there),
 * or its moves (a team member pointed at to switch in, on a blue card so it's clearly another view).
 */
export type PokemonCardMode = 'stats' | 'moves';

/**
 * One of our Pokémon as the request describes it, beside the moves: its name and Tera type, its held
 * item (with its icon) and ability, then its stats in a strip or its four moves on their type colours.
 * A fixed 340x112 card with absolutely placed rows (Brewser layout rules); every row is always
 * there, so none appears late or overlaps. Colours are always bound, never null (Brewser kept the
 * old one when a binding went null).
 */
@Component({
  selector: 'app-battle-pokemon-card',
  imports: [ItemIcon],
  host: { class: 'block h-[112px] w-[340px] text-white' },
  template: `
    <section
      class="relative block h-[112px] w-[340px] rounded-md border"
      [class]="mode() === 'moves' ? 'border-sky-300' : 'border-gray-500'"
      [style.background-color]="mode() === 'moves' ? '#1b3354' : '#1f2937'"
      [attr.aria-label]="view().label"
    >
      <app-item-icon class="absolute top-[8px] left-[9px]" [item]="view().itemId" [size]="32" />
      <span class="absolute top-[5px] left-[50px] block h-6 w-[184px] overflow-hidden text-base leading-6 font-bold whitespace-nowrap">{{ view().name }}</span>
      @if (view().tera; as tera) {
        <span
          class="absolute top-[7px] left-[240px] block h-5 w-[90px] rounded-full border text-center text-xs leading-[18px] font-bold"
          [class]="tera.done ? 'border-white' : 'border-transparent'"
          [style.background-color]="tera.color"
          >{{ tera.text }}</span
        >
      }
      <span class="absolute top-[28px] left-[50px] block h-5 w-[280px] overflow-hidden text-sm leading-5 whitespace-nowrap">
        <span class="font-bold">{{ view().item }}</span><span class="text-gray-300">{{ view().ability ? ' · ' + view().ability : '' }}</span>
      </span>

      @if (mode() === 'moves') {
        @for (move of view().moves; track $index) {
          <span
            class="absolute block h-[23px] w-[157px] overflow-hidden rounded-sm text-center text-sm leading-[23px] font-bold whitespace-nowrap"
            [style.left.px]="move.left"
            [style.top.px]="move.top"
            [style.background-color]="move.color"
            >{{ move.name }}</span
          >
        }
      } @else {
        <span class="absolute top-[54px] left-[8px] block h-[50px] w-[322px] rounded-md bg-[#111827]"></span>
        @for (stat of view().stats; track stat.label) {
          <span class="absolute top-[59px] block h-4 w-[64px] text-center text-[11px] leading-4 font-bold text-gray-400 uppercase" [style.left.px]="stat.left">{{
            stat.label
          }}</span>
          <span class="absolute top-[76px] block h-6 w-[64px] text-center text-lg leading-6 font-bold" [style.left.px]="stat.left">{{ stat.value }}</span>
        }
      }
    </section>
  `,
})
export class BattlePokemonCard {
  readonly pokemon = input<RequestPokemon | null>(null);
  readonly mode = input<PokemonCardMode>('stats');

  protected readonly view = computed(() => {
    const pokemon = this.pokemon();
    if (!pokemon) return { label: 'Pokémon details', itemId: '', name: '', tera: null, item: '', ability: '', stats: [], moves: [] };
    const name = pokemon.ident.slice(pokemon.ident.indexOf(': ') + 2);
    const { hp, maxHp, fainted } = parseCondition(pokemon.condition, 100);
    const item = itemName(pokemon.item) || 'No item';
    const ability = abilityName(pokemon.ability ?? '');
    const teraType = pokemon.terastallized || pokemon.teraType || '';
    const tera = teraType
      ? { text: `Tera ${teraType}`, color: typeColor(teraType) || '#374151', done: !!pokemon.terastallized }
      : null;
    const stats = pokemon.stats
      ? STATS.map((stat, i) => ({ label: stat.label, value: pokemon.stats?.[stat.id] ?? 0, left: 9 + i * STAT_WIDTH }))
      : [];
    const moves = pokemon.moves.slice(0, 4).map((id, i) => {
      const info = moveInfo(id);
      return {
        name: info?.name ?? id,
        color: typeColor(info?.type ?? '') || '#4b5563',
        left: MOVE_LEFTS[i % 2],
        top: MOVE_TOPS[Math.floor(i / 2)],
      };
    });
    const details = this.mode() === 'moves' ? moves.map((move) => move.name).join(', ') : stats.map((stat) => `${stat.label} ${stat.value}`).join(', ');
    const teraText = tera ? (tera.done ? `Terastallized into ${teraType}` : `Tera ${teraType}`) : '';
    return {
      label: [`${name}, ${fainted ? 'fainted' : `${hp}/${maxHp} HP`}`, item, ability, teraText, details].filter(Boolean).join('; '),
      itemId: fainted ? '' : pokemon.item,
      name,
      tera,
      item,
      ability,
      stats,
      moves,
    };
  });
}
