import { NgOptimizedImage } from '@angular/common';
import { Component, ElementRef, afterRenderEffect, computed, inject, input, output } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { moveInfo } from '@core/dex/moves';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattlePokemonCard, PokemonCardMode } from '@features/battle/components/battle-pokemon-card/battle-pokemon-card';
import { RequestPokemon } from '@features/battle/models/battle';
import { BattleChoices, SWITCH_ATTRIBUTE, TargetOption } from '@features/battle/state/battle-choices';
import { BattleStore, parseCondition } from '@features/battle/state/battle-store';
import { typeColor } from '@shared/data/type-colors';

const WIDTH = 961;
const GAP = 12;
/** Big buttons (targets, rematch/leave): two per row. */
const BIG_WIDTH = Math.floor((WIDTH - GAP) / 2);
/** The two rows of targets. */
const ROW_TOPS = [36, 96];
/** The Pokémon card on the right; the moves (or the plans) take the rest. */
const CARD_WIDTH = 340;
const LEFT_WIDTH = WIDTH - GAP - CARD_WIDTH;
/** The four moves, two by two. */
const MOVE_WIDTH = Math.floor((LEFT_WIDTH - GAP) / 2);
const MOVE_HEIGHT = 53;
const MOVE_TOPS = [36, 36 + MOVE_HEIGHT + 6];

/**
 * The command panel, 961x148. Choosing: the four moves two by two (Showdown style, each on its type's
 * colour, with Showdown's category icon, its power, accuracy and PP) and, on the right, the card of the Pokémon
 * choosing (item, ability, Tera type, stats). Switching is done on the team tiles in the right column
 * (BattleTeamPreview): the card follows the tile pointed at, to see what comes in. Then the target
 * picker when a move needs one (foes on top, as on the field), the forced switch after a faint (on the
 * tiles too), and the rematch/leave buttons at the end. While a turn plays (or the opponent chooses)
 * it shows what each Pokémon was told to do beside the card, so the panel never goes blank. Each view
 * is a normal-flow block with absolutely placed parts (Brewser layout rules), swapped with @if. Text
 * rows have fixed heights: on the console a row that starts empty (a slot's name before its Pokémon
 * is out) overlapped the next once filled.
 */
@Component({
  selector: 'app-battle-controls',
  imports: [BattlePokemonCard, NgOptimizedImage],
  host: { class: 'block h-[148px] w-[961px] text-white' },
  template: `
    @if (store.result(); as result) {
      <div class="relative h-[148px] w-[961px]">
        <p class="absolute top-0 left-0 block h-7 w-[961px] text-lg leading-7 font-bold">{{ resultText() }}</p>
        @if (canRematch()) {
          <button type="button" data-pick class="absolute top-[40px] left-0 h-[60px] w-[474px] rounded-md border border-blue-300 bg-blue-700 text-xl font-bold hover:bg-blue-800" (click)="rematch.emit()">
            Rematch
          </button>
        }
        <button type="button" data-pick class="absolute top-[40px] h-[60px] rounded-md border border-gray-400 bg-gray-600 text-xl font-bold hover:bg-gray-500"
          [style.left.px]="canRematch() ? 486 : 0" [style.width.px]="canRematch() ? 474 : 961" (click)="leave.emit()">
          Back to Home
        </button>
      </div>
    } @else if (choices.slot() !== null) {
      @if (choices.pendingMove()) {
        <div class="relative h-[148px] w-[961px]">
          <p class="absolute top-0 left-0 block h-7 w-[520px] text-base leading-7 text-gray-200">Choose a target</p>
          @for (option of targets(); track option.target) {
            <button
              type="button"
              data-pick
              class="absolute h-[52px] w-[474px] rounded-md border p-[4px_12px] text-left disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400"
              [class]="option.foe ? 'border-red-300 bg-red-900 enabled:hover:bg-red-800' : 'border-blue-300 bg-blue-900 enabled:hover:bg-blue-800'"
              [style.left.px]="option.left"
              [style.top.px]="option.top"
              [disabled]="!option.allowed"
              (click)="choices.chooseTarget(option.target)"
            >
              <span class="block text-lg leading-6 font-bold">{{ option.name }}</span>
              <span class="block text-sm leading-5">{{ option.detail }}</span>
            </button>
          }
          <button type="button" class="absolute top-0 left-[821px] h-7 w-[140px] rounded-md border border-gray-400 bg-gray-600 text-sm font-bold hover:bg-gray-500" (click)="choices.back()">
            Back
          </button>
        </div>
      } @else if (choices.forceSwitch()) {
        <!-- The Pokémon is picked on the team tiles on the right, which take focus (BattleTeamPreview). -->
        <div class="relative h-[148px] w-[961px]">
          <p class="absolute top-0 left-0 block h-7 w-[609px] text-base leading-7 text-gray-200">
            <strong class="text-white">Choose a Pokémon to send out</strong> on your team, on the right →
          </p>
          <p class="absolute top-[36px] left-0 block h-6 w-[609px] text-sm leading-6 text-gray-300">
            {{ choices.pokemonName() ? choices.pokemonName() + ' has fainted.' : '' }}
          </p>
          @if (choices.canGoBack()) {
            <button type="button" class="absolute top-0 left-[821px] h-7 w-[140px] rounded-md border border-gray-400 bg-gray-600 text-sm font-bold hover:bg-gray-500" (click)="choices.back()">
              Back
            </button>
          }
          <app-battle-pokemon-card class="absolute top-[36px] left-[621px]" [pokemon]="inspected().pokemon" [mode]="inspected().mode" />
        </div>
      } @else {
        <div class="relative h-[148px] w-[961px]">
          <p class="absolute top-0 left-0 block h-7 w-[627px] overflow-hidden text-base leading-7 whitespace-nowrap text-gray-200">
            <strong class="text-white">{{ choices.pokemonName() }}</strong>{{ canSwitch() ? ' — choose a move, or switch on the right →' : ' — choose a move' }}
          </p>
          @if (choices.canMega()) {
            <!-- L does this on the controller, so the d-pad skips it (data-kb-skip); it's for clicks. -->
            <button
              type="button"
              data-kb-skip
              class="absolute top-0 left-[641px] h-7 w-[168px] rounded-md border text-sm font-bold"
              [class]="choices.mega() ? 'border-fuchsia-300 bg-[#6b2a73]' : 'border-gray-400 bg-gray-700 hover:bg-gray-600'"
              [attr.aria-pressed]="choices.mega()"
              (click)="choices.toggleMega()"
            >
              <span class="block h-[26px] text-center leading-[26px]"
                ><span class="rounded-sm bg-header p-[2px_6px] font-bold text-white">L</span>{{ choices.mega() ? ' Mega Evolving' : ' Mega Evolve' }}</span
              >
            </button>
          } @else if (choices.teraType(); as teraType) {
            <!-- Terastallize, as Mega Evolve: L on the controller. Grey naming its type; on the type's colour
              once chosen. The colour is always bound: Brewser kept the last one when the binding went null. -->
            <button
              type="button"
              data-kb-skip
              class="absolute top-0 left-[641px] h-7 w-[168px] rounded-md border text-sm font-bold"
              [class]="choices.tera() ? 'border-white' : 'border-gray-500 text-gray-200'"
              [style.background-color]="choices.tera() ? teraColor() : '#374151'"
              [attr.aria-pressed]="choices.tera()"
              [attr.aria-label]="'Terastallize into ' + teraType"
              (click)="choices.toggleTera()"
            >
              <span class="block h-[26px] text-center leading-[26px]"
                ><span class="rounded-sm bg-header p-[2px_6px] font-bold text-white">L</span>{{ choices.tera() ? ' Terastallizing' : ' Tera: ' + teraType }}</span
              >
            </button>
          }
          @if (choices.canGoBack()) {
            <button type="button" class="absolute top-0 left-[821px] h-7 w-[140px] rounded-md border border-gray-400 bg-gray-600 text-sm font-bold hover:bg-gray-500" (click)="choices.back()">
              Back
            </button>
          }
          @for (move of moves(); track $index) {
            <button
              type="button"
              data-pick
              class="absolute h-[53px] w-[298px] rounded-md border border-gray-300 p-0 text-left disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400"
              [style.left.px]="move.left"
              [style.top.px]="move.top"
              [style.background-color]="move.disabled ? '#374151' : move.color"
              [disabled]="move.disabled"
              [attr.aria-label]="move.label"
              (click)="choices.chooseMove($index)"
            >
              <!-- Every part placed (a button centres whatever stays in flow). Showdown's category icon and the
                rest of the line apart: an inline image next to text wraps on Brewser. -->
              <span class="absolute top-[4px] left-[10px] block h-6 w-[210px] overflow-hidden text-lg leading-6 font-bold whitespace-nowrap">{{ move.move }}</span>
              @if (move.categoryIcon; as icon) {
                <img [ngSrc]="icon" width="32" height="14" alt="" class="absolute top-[31px] left-[10px] block" />
              }
              <span
                class="absolute top-[28px] block h-5 overflow-hidden text-sm leading-5 whitespace-nowrap"
                [style.left.px]="move.categoryIcon ? 48 : 10"
                [style.width.px]="move.categoryIcon ? 238 : 276"
                >{{ move.detail }}</span
              >
              <span class="absolute top-[4px] left-[214px] block h-6 w-[72px] text-right text-sm leading-6">{{ move.ppText }}</span>
            </button>
          }
          <app-battle-pokemon-card class="absolute top-[36px] left-[621px]" [pokemon]="inspected().pokemon" [mode]="inspected().mode" />
        </div>
      }
    } @else {
      <div class="relative h-[148px] w-[961px]">
        <p class="absolute top-0 left-0 block h-7 w-[609px] text-base leading-7 text-gray-200">{{ watchingTitle() }}</p>
        @if (store.canUndo()) {
          <!-- Showdown's Cancel: while the opponent is still choosing, the choices can be made again (B too). -->
          <button
            type="button"
            data-pick
            class="absolute top-0 left-[821px] h-7 w-[140px] rounded-md border border-gray-400 bg-gray-600 text-sm font-bold hover:bg-gray-500"
            aria-label="Cancel: choose again"
            (click)="store.undo()"
          >
            <span class="block h-[26px] text-center leading-[26px]"><span class="rounded-sm bg-header p-[2px_6px]">B</span> Cancel</span>
          </button>
        }
        @for (plan of plans(); track plan.slot) {
          <div
            class="absolute block h-[53px] w-[609px] rounded-md border border-gray-500 p-[4px_12px]"
            [style.top.px]="plan.top"
            [style.background-color]="plan.color"
          >
            <span class="block h-5 overflow-hidden text-sm leading-5 whitespace-nowrap text-gray-200">{{ plan.name }}{{ plan.detail ? ' · ' + plan.detail : '' }}</span>
            <span class="block h-6 overflow-hidden text-xl leading-6 font-bold whitespace-nowrap">{{ plan.action }}</span>
          </div>
        }
        <app-battle-pokemon-card class="absolute top-[36px] left-[621px]" [pokemon]="inspected().pokemon" [mode]="inspected().mode" />
      </div>
    }
  `,
})
export class BattleControls {
  private readonly dex = inject(ChampionsDex);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly navigation = inject(KeyboardNavigation);
  protected readonly store = inject(BattleStore);
  protected readonly choices = inject(BattleChoices);

  /** Another battle against the mock at the end; a real battle only has Back to Home. */
  readonly canRematch = input(true);
  readonly rematch = output<void>();
  readonly leave = output<void>();

  protected readonly resultText = computed(() => {
    switch (this.store.result()) {
      case 'win':
        return 'You won!';
      case 'loss':
        return 'You lost.';
      default:
        return 'The battle ended in a tie.';
    }
  });

  protected readonly moves = computed(() =>
    this.choices.moves().map((move, i) => {
      const dexMove = this.dex.move(move.id);
      const info = dexMove ?? moveInfo(move.id);
      const type = info?.type ?? '';
      const power = info && info.basePower > 0 ? `${info.basePower} BP` : '';
      const accuracy = info && info.category !== 'Status' ? (info.accuracy > 0 ? `${info.accuracy}%` : 'Never misses') : '';
      const category = info?.category ?? '';
      const detail = [type, power, accuracy].filter(Boolean).join(' · ');
      return {
        ...move,
        disabled: !!move.disabled || move.pp <= 0,
        color: typeColor(type) || '#4b5563',
        detail,
        categoryIcon: category ? `categories/${category.toLowerCase()}.png` : '',
        ppText: `${move.pp}/${move.maxpp}`,
        label: `${move.move}: ${[type, category, power, accuracy].filter(Boolean).join(' · ')}, ${move.pp} of ${move.maxpp} PP`,
        left: (i % 2) * (MOVE_WIDTH + GAP),
        top: MOVE_TOPS[Math.floor(i / 2)] ?? 0,
      };
    }),
  );

  protected readonly teraColor = computed(() => typeColor(this.choices.teraType()) || '#374151');

  /** Some team member can come in (not while trapped). */
  protected readonly canSwitch = computed(() => this.choices.switchOptions().some((option) => option.allowed));

  protected readonly watchingTitle = computed(() => {
    if (this.store.playing()) return this.store.turn() > 0 ? `Turn ${this.store.turn()} in progress…` : 'The battle is starting…';
    return 'Waiting for the opponent…';
  });

  /** The switch the pointed-at team tile would make (the mouse over it, or the d-pad on it); null for none. */
  private readonly pointedSwitch = computed(() => {
    const hovered = this.choices.hoveredSwitch();
    if (hovered !== null) return hovered;
    const focused = this.navigation.lastFocusedControl() as HTMLButtonElement | null;
    const index = focused?.getAttribute(SWITCH_ATTRIBUTE);
    return index && focused?.isConnected && !focused.disabled ? Number(index) : null;
  });

  /**
   * The Pokémon the card shows: the team member pointed at on the right while choosing, with its
   * moves (what it would bring in); else the one choosing, else (while the turn plays) the first one
   * out there, with its stats.
   */
  protected readonly inspected = computed<{ pokemon: RequestPokemon | null; mode: PokemonCardMode }>(() => {
    const team = this.store.team();
    const pointed = this.choices.slot() !== null ? this.pointedSwitch() : null;
    if (pointed !== null && team[pointed - 1]) return { pokemon: team[pointed - 1], mode: 'moves' };
    if (this.choices.forceSwitch()) return { pokemon: null, mode: 'moves' };
    const pokemon = this.choices.pokemon() ?? team.find((member) => member.active && !parseCondition(member.condition, 100).fainted) ?? null;
    return { pokemon, mode: 'stats' };
  });

  /** Each active slot's order this turn, on its move type's colour; before any order, who's out there. */
  protected readonly plans = computed(() => {
    const submitted = this.choices.submitted();
    const { active } = this.store.sides().p1;
    // Singles has one slot: the second (always empty) would show as a blank box.
    const slots = this.store.gameType() === 'singles' ? active.slice(0, 1) : active;
    return slots.map((pokemon, slot) => {
      const plan = submitted.find((p) => p.slot === slot);
      const top = MOVE_TOPS[slot] ?? 0;
      if (plan) return { ...plan, top, color: typeColor(plan.type) || '#374151' };
      const action = !pokemon ? '' : pokemon.fainted ? 'Fainted' : 'Getting ready';
      return { slot, top, name: pokemon?.name ?? '', action, detail: '', color: '#374151' };
    });
  });

  protected readonly targets = computed(() =>
    this.choices.targetOptions().map((option, i) => ({
      ...option,
      name: option.pokemon?.name ?? 'Empty',
      detail: targetDetail(option),
      left: (i % 2) * (BIG_WIDTH + GAP),
      top: ROW_TOPS[Math.floor(i / 2)] ?? 0,
    })),
  );

  /** Changes whenever a new set of buttons appears, so focus can move to it. */
  private readonly view = computed(() => {
    const request = this.store.request();
    return [this.store.result(), request?.rqid, this.choices.slot(), !!this.choices.pendingMove(), this.store.canUndo()].join('|');
  });

  constructor() {
    // Focus the first usable button of each new view, so the controller can pick straight away. A
    // forced switch has none here: the team tiles take focus (BattleTeamPreview).
    afterRenderEffect(() => {
      this.view();
      const first = this.host.nativeElement.querySelector<HTMLButtonElement>('button[data-pick]:not([disabled])');
      first?.focus();
    });
  }
}

/** "Foe · 73% HP", "Ally · Fainted". */
function targetDetail({ pokemon, foe }: TargetOption): string {
  if (!pokemon) return '';
  return `${foe ? 'Foe' : 'Ally'} · ${pokemon.fainted ? 'Fainted' : `${hpPercent(pokemon.hp, pokemon.maxHp)}% HP`}`;
}

function hpPercent(hp: number, maxHp: number): number {
  return maxHp > 0 ? Math.max(hp > 0 ? 1 : 0, Math.round((hp / maxHp) * 100)) : 0;
}
