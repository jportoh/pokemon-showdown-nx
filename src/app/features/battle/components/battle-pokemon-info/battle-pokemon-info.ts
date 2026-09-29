import { Component, computed, input } from '@angular/core';
import { moveInfo } from '@core/dex/moves';
import { speciesInfo } from '@core/dex/species';
import { barColor } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { STATUS } from '@features/battle/state/status-conditions';
import { InspectedMember } from '@features/battle/state/pokemon-inspection';
import { ItemIcon } from '@shared/components/item-icon';
import { typeColor } from '@shared/data/type-colors';
import { toId } from '@shared/utils/to-id';

const BASE_STATS = [
  { id: 'hp', label: 'HP' },
  { id: 'atk', label: 'Atk' },
  { id: 'def', label: 'Def' },
  { id: 'spa', label: 'SpA' },
  { id: 'spd', label: 'SpD' },
  { id: 'spe', label: 'Spe' },
] as const;
/** Stat stages with no row of their own, shown under the HP. */
const OTHER_BOOSTS = [
  { id: 'accuracy', label: 'Acc' },
  { id: 'evasion', label: 'Eva' },
] as const;
const STAT_TOP = 10;
const STAT_ROW = 21;
/** The widest bar, for a base stat of MAX_STAT or more. */
const STAT_BAR = 96;
const MAX_STAT = 200;
const HP_BAR = 120;
const TYPE_WIDTH = 64;
const MOVE_TOP = 60;
const MOVE_ROW = 21;
const MOVE_SLOTS = 4;

/** A base stat's bar colour, from red (low) to teal (very high), as Showdown's. */
function statColor(value: number): string {
  if (value < 50) return '#dc2626';
  if (value < 70) return '#ea580c';
  if (value < 90) return '#ca8a04';
  if (value < 110) return '#65a30d';
  if (value < 130) return '#16a34a';
  return '#0d9488';
}

/** "+2", "−1" (a real minus sign). */
function stageText(stage: number): string {
  return stage > 0 ? `+${stage}` : `−${-stage}`;
}

/**
 * Everything a spectator knows of one team member, in the command panel while watching a live battle:
 * its trainer, name, level, types (or its Tera type once Terastallized), HP and status on the left;
 * its base stats as bars, with its stat stages while it's on the field, in the middle; on the right,
 * its item and ability once the battle has revealed them (until then the abilities it may have), and
 * the moves it has used so far. With an open team sheet (Open Team Sheets formats) all of those, and
 * its nature, are known from the start. A fixed 645x148 card with absolutely placed rows (Brewser layout
 * rules); colours are always bound, never null.
 */
@Component({
  selector: 'app-battle-pokemon-info',
  imports: [ItemIcon],
  host: { class: 'block h-[148px] w-[645px] text-white' },
  template: `
    <section class="relative block h-[148px] w-[645px] rounded-md border border-gray-500 bg-[#1f2937]" aria-live="polite" [attr.aria-label]="view().label">
      @if (view().shown) {
        <span
          class="absolute top-[6px] left-[12px] block h-4 w-[206px] overflow-hidden text-xs leading-4 font-bold whitespace-nowrap uppercase"
          [class]="view().side === 'p1' ? 'text-sky-300' : 'text-red-300'"
          >{{ view().owner }}</span
        >
        <span class="absolute top-[22px] left-[12px] block h-7 w-[206px] overflow-hidden text-lg leading-7 font-bold whitespace-nowrap">{{ view().name }}</span>
        <span class="absolute top-[50px] left-[12px] block h-5 w-[206px] overflow-hidden text-sm leading-5 whitespace-nowrap text-gray-300">{{ view().subtitle }}</span>
        @for (chip of view().types; track $index) {
          <span
            class="absolute top-[74px] block h-5 overflow-hidden rounded-sm border text-center text-xs leading-[18px] font-bold whitespace-nowrap"
            [class]="chip.tera ? 'border-white' : 'border-transparent'"
            [style.left.px]="chip.left"
            [style.width.px]="chip.width"
            [style.background-color]="chip.color"
            >{{ chip.text }}</span
          >
        }
        @if (view().hp; as hp) {
          <span aria-hidden="true" class="absolute top-[104px] left-[12px] block h-2 w-[120px] rounded-sm bg-gray-700">
            <span class="block h-2 rounded-sm" [style.width.px]="hp.width" [style.background-color]="hp.color"></span>
          </span>
          <span class="absolute top-[98px] left-[140px] block h-5 w-[40px] text-sm leading-5 font-bold">{{ hp.text }}</span>
        }
        @if (view().status; as status) {
          <span
            class="absolute top-[98px] left-[182px] block h-5 w-[36px] rounded-sm text-center text-xs leading-5 font-bold"
            [style.background-color]="status.color"
            >{{ status.text }}</span
          >
        }
        <span class="absolute top-[124px] left-[12px] block h-4 w-[206px] overflow-hidden text-xs leading-4 whitespace-nowrap text-gray-300">{{ view().note }}</span>

        <span aria-hidden="true" class="absolute top-[8px] left-[228px] block h-[130px] w-px bg-gray-600"></span>
        @for (stat of view().stats; track stat.label) {
          <span class="absolute left-[238px] block h-4 w-[30px] text-[11px] leading-4 font-bold text-gray-400 uppercase" [style.top.px]="stat.top">{{ stat.label }}</span>
          <span class="absolute left-[268px] block h-4 w-[30px] text-right text-sm leading-4 font-bold" [style.top.px]="stat.top">{{ stat.value }}</span>
          <span aria-hidden="true" class="absolute left-[304px] block h-2 w-[96px] rounded-sm bg-gray-700" [style.top.px]="stat.top + 4">
            <span class="block h-2 rounded-sm" [style.width.px]="stat.width" [style.background-color]="stat.color"></span>
          </span>
          <span
            class="absolute left-[402px] block h-4 w-[28px] text-right text-xs leading-4 font-bold"
            [class]="stat.stage > 0 ? 'text-green-400' : 'text-red-300'"
            [style.top.px]="stat.top"
            >{{ stat.stageText }}</span
          >
        }
        <span aria-hidden="true" class="absolute top-[8px] left-[438px] block h-[130px] w-px bg-gray-600"></span>

        <app-item-icon class="absolute top-[6px] left-[446px]" [item]="view().itemId" [size]="24" />
        <!-- Beside its icon once known; unknown or gone, where the icon would be. -->
        <span
          class="absolute top-[8px] block h-5 overflow-hidden text-sm leading-5 whitespace-nowrap"
          [class]="view().itemKnown ? 'left-[474px] w-[160px] font-bold' : 'left-[448px] w-[186px] text-gray-400'"
          >{{ view().item }}</span
        >
        <!-- The abilities it may have take two small lines. -->
        <span
          class="absolute left-[448px] block w-[186px] overflow-hidden"
          [class]="view().abilityKnown ? 'top-[34px] h-5 text-sm leading-5 font-bold whitespace-nowrap' : 'top-[32px] h-[26px] text-xs leading-[13px] text-gray-400'"
          >{{ view().ability }}</span
        >
        @for (move of view().moves; track $index) {
          <span
            class="absolute left-[448px] block h-[19px] w-[186px] overflow-hidden rounded-sm px-2 text-sm leading-[19px] whitespace-nowrap"
            [class]="move.known ? 'font-bold' : 'text-gray-400'"
            [style.top.px]="move.top"
            [style.background-color]="move.color"
            >{{ move.name }}</span
          >
        }
      } @else {
        <p class="absolute top-[56px] left-[24px] block h-12 w-[597px] text-center text-base leading-6 text-gray-300">
          Point at a Pokémon on the right to see everything known about it here.
        </p>
      }
    </section>
  `,
})
export class BattlePokemonInfo {
  /** The team member to show, with its trainer's name; null shows how to pick one. */
  readonly inspected = input<InspectedMember | null>(null);
  readonly owner = input('');

  protected readonly view = computed(() => {
    const inspected = this.inspected();
    if (!inspected) return { ...EMPTY_VIEW, label: 'Pokémon details: point at a Pokémon on the right' };
    const { side, member, sheet } = inspected;
    const seen = member.seen;
    const species = seen?.species ?? member.species;
    const info = speciesInfo(species);
    const name = seen?.name ?? member.species;
    const owner = this.owner();

    const gender = seen?.gender || sheet?.gender;
    const nature = sheet?.nature ?? '';
    const subtitle = [seen ? `Lv ${seen.level}` : '', gender === 'M' ? '♂' : gender === 'F' ? '♀' : '', name !== species ? species : '', nature]
      .filter(Boolean)
      .join(' · ');

    // Terastallized, it's of its Tera type only.
    const typeNames = seen?.tera ? [seen.tera] : (info?.types ?? []);
    const types = typeNames.map((type, i) => ({
      text: seen?.tera ? `Tera ${type}` : type,
      tera: !!seen?.tera,
      left: 12 + i * (TYPE_WIDTH + 6),
      width: seen?.tera ? 96 : TYPE_WIDTH,
      color: typeColor(type) || '#374151',
    }));

    const fraction = seen && !seen.fainted && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
    const percent = seen?.fainted ? 0 : Math.max(1, Math.round(fraction * 100));
    const hp = seen ? { width: Math.round(fraction * HP_BAR), color: barColor(fraction), text: `${percent}%` } : null;
    const status = seen?.status && STATUS[seen.status] ? STATUS[seen.status] : null;

    const boosts = member.active ? (seen?.boosts ?? {}) : {};
    const otherBoosts = OTHER_BOOSTS.filter((b) => boosts[b.id]).map((b) => `${b.label} ${stageText(boosts[b.id])}`);
    const where = seen?.fainted ? 'Fainted' : member.active ? 'On the field' : seen ? 'In the back' : 'Not sent out yet';
    const note = [where, ...otherBoosts].join(' · ');

    const stats = info
      ? BASE_STATS.map((stat, i) => {
          const value = info.baseStats[stat.id];
          const stage = stat.id === 'hp' ? 0 : (boosts[stat.id] ?? 0);
          return {
            label: stat.label,
            value,
            top: STAT_TOP + i * STAT_ROW,
            width: Math.max(2, Math.round((Math.min(value, MAX_STAT) / MAX_STAT) * STAT_BAR)),
            color: statColor(value),
            stage,
            stageText: stage ? stageText(stage) : '',
          };
        })
      : [];

    const lost = seen?.lostItem ?? '';
    // The sheet's item until the battle shows it used up or knocked off.
    const itemName = seen?.item || (lost ? '' : (sheet?.item ?? ''));
    const item = itemName || (lost ? `No item (${lost} gone)` : sheet ? 'No item' : 'Item not revealed');

    const possible = info?.abilities ?? [];
    const known = seen?.ability || sheet?.ability;
    const abilityKnown = !!known || possible.length === 1;
    const ability = known || (possible.length === 1 ? possible[0] : possible.length ? `Maybe ${possible.join(' / ')}` : 'Ability not revealed');

    const moves = Array.from({ length: MOVE_SLOTS }, (_, i) => {
      // The sheet's moves in its order; without one, those used so far.
      const move = sheet ? sheet.moves[i] : seen?.moves[i];
      const top = MOVE_TOP + i * MOVE_ROW;
      if (!move) return { name: sheet ? '—' : 'Move not revealed', known: false, top, color: '#111827' };
      const data = moveInfo(move);
      return { name: data?.name ?? move, known: true, top, color: typeColor(data?.type ?? '') || '#4b5563' };
    });

    const knownMoves = moves.filter((m) => m.known).map((m) => m.name);
    const label = [
      `${owner ? `${owner}'s ` : ''}${name}${name !== species ? ` (${species})` : ''}`,
      seen ? `level ${seen.level}` : '',
      nature ? `${nature} nature` : '',
      types.map((t) => t.text).join(' and ') + (types.length ? ' type' : ''),
      hp ? `${hp.text} HP` : '',
      status ? status.name : '',
      note,
      stats.map((s) => `base ${s.label} ${s.value}${s.stage ? ` (${s.stageText})` : ''}`).join(', '),
      item,
      abilityKnown ? `ability ${ability}` : ability,
      knownMoves.length ? `${sheet ? 'moves' : 'moves used'}: ${knownMoves.join(', ')}` : 'no moves used yet',
    ]
      .filter(Boolean)
      .join('; ');

    return {
      shown: true,
      label,
      side,
      owner,
      name,
      subtitle,
      types,
      hp,
      status,
      note,
      stats,
      itemId: itemName ? toId(itemName) : '',
      itemKnown: !!itemName,
      item,
      abilityKnown,
      ability,
      moves,
    };
  });
}

const EMPTY_VIEW = {
  shown: false,
  label: '',
  side: 'p2',
  owner: '',
  name: '',
  subtitle: '',
  types: [],
  hp: null,
  status: null,
  note: '',
  stats: [],
  itemId: '',
  itemKnown: false,
  item: '',
  abilityKnown: false,
  ability: '',
  moves: [],
};
