import { Component, ElementRef, afterRenderEffect, computed, inject, output } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { BattleChoices, TargetOption } from '@features/battle/state/battle-choices';
import { BattleStore, parseCondition } from '@features/battle/state/battle-store';
import { typeColor } from '@shared/data/type-colors';

const WIDTH = 961;
const GAP = 12;
/** Big buttons (targets, the plans while a turn plays, rematch/leave): two per row. */
const BIG_WIDTH = Math.floor((WIDTH - GAP) / 2);
/** The four moves, in one row. */
const MOVE_WIDTH = Math.floor((WIDTH - GAP * 3) / 4);
/** Forced switches: three per row, so a full team fits in two. */
const SWITCH_WIDTH = Math.floor((WIDTH - GAP * 2) / 3);
/** The two rows of targets or forced switches. */
const ROW_TOPS = [36, 96];

/**
 * The command panel, 961x148: the four moves in a row (Showdown style, each on its type's colour) and
 * a row to switch to any benched Pokémon; then the target picker when a move needs one (foes on top,
 * as on the field), the forced switch after a faint, and the rematch/leave buttons at the end. While a turn
 * plays (or the opponent chooses) it shows what each Pokémon was told to do and the team's HP, with
 * nothing to press, so the panel never goes blank. Each view is a normal-flow block with absolutely
 * placed parts (Brewser layout rules), swapped with @if. Text rows have fixed heights: on the console
 * a row that starts empty (a slot's name before its Pokémon is out) overlapped the next once filled.
 */
@Component({
  selector: 'app-battle-controls',
  host: { class: 'block h-[148px] w-[961px] text-white' },
  template: `
    @if (store.result(); as result) {
      <div class="relative h-[148px] w-[961px]">
        <p class="absolute top-0 left-0 block h-7 w-[961px] text-lg leading-7 font-bold">{{ resultText() }}</p>
        <button type="button" data-pick class="absolute top-[40px] left-0 h-[60px] w-[474px] rounded-md border border-blue-300 bg-blue-700 text-xl font-bold hover:bg-blue-800" (click)="rematch.emit()">
          Rematch
        </button>
        <button type="button" data-pick class="absolute top-[40px] left-[486px] h-[60px] w-[474px] rounded-md border border-gray-400 bg-gray-600 text-xl font-bold hover:bg-gray-500" (click)="leave.emit()">
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
        <div class="relative h-[148px] w-[961px]">
          <p class="absolute top-0 left-0 block h-7 w-[520px] text-base leading-7 text-gray-200">Choose a Pokémon to send out</p>
          @for (option of bigSwitches(); track option.index) {
            <button
              type="button"
              data-pick
              class="absolute h-[52px] w-[312px] rounded-md border border-gray-400 bg-gray-600 p-[4px_12px] text-left enabled:hover:bg-gray-500 disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400"
              [style.left.px]="option.left"
              [style.top.px]="option.top"
              [disabled]="!option.allowed"
              (click)="choices.chooseSwitch(option.index)"
            >
              <span class="block text-lg leading-6 font-bold">{{ option.name }}</span>
              <span class="block text-sm leading-5">{{ option.detail }}</span>
            </button>
          }
          @if (choices.canGoBack()) {
            <button type="button" class="absolute top-0 left-[821px] h-7 w-[140px] rounded-md border border-gray-400 bg-gray-600 text-sm font-bold hover:bg-gray-500" (click)="choices.back()">
              Back
            </button>
          }
        </div>
      } @else {
        <div class="relative h-[148px] w-[961px]">
          <p class="absolute top-0 left-0 block h-7 w-[627px] overflow-hidden text-base leading-7 whitespace-nowrap text-gray-200">
            <strong class="text-white">{{ choices.pokemonName() }}</strong>{{ ' — choose a move or switch' }}
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
              class="absolute top-[36px] h-[60px] w-[231px] rounded-md border border-gray-300 p-[6px_12px] text-left disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400"
              [style.left.px]="move.left"
              [style.background-color]="move.disabled ? null : move.color"
              [disabled]="move.disabled"
              (click)="choices.chooseMove($index)"
            >
              <span class="block h-6 overflow-hidden text-lg leading-6 font-bold whitespace-nowrap">{{ move.move }}</span>
              <span class="block h-5 overflow-hidden text-sm leading-5 whitespace-nowrap">{{ move.detail }}</span>
            </button>
          }
          @for (option of smallSwitches(); track option.index) {
            <button
              type="button"
              data-pick
              class="absolute top-[104px] h-[44px] rounded-md border border-gray-400 bg-gray-600 p-[3px_8px] text-left enabled:hover:bg-gray-500 disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400"
              [style.left.px]="option.left"
              [style.width.px]="option.width"
              [disabled]="!option.allowed"
              [attr.aria-label]="option.label"
              (click)="choices.chooseSwitch(option.index)"
            >
              <span class="block h-5 overflow-hidden text-sm leading-5 font-bold whitespace-nowrap">{{ option.name }}</span>
              <span class="block h-4 text-xs leading-4">{{ option.detail }}</span>
            </button>
          }
        </div>
      }
    } @else {
      <div class="relative h-[148px] w-[961px]">
        <p class="absolute top-0 left-0 block h-7 w-[961px] text-base leading-7 text-gray-200">{{ watchingTitle() }}</p>
        @for (plan of plans(); track plan.slot) {
          <div
            class="absolute top-[36px] block h-[60px] w-[474px] rounded-md border border-gray-500 p-[5px_12px]"
            [style.left.px]="plan.left"
            [style.background-color]="plan.color"
          >
            <span class="block h-5 overflow-hidden text-sm leading-5 whitespace-nowrap text-gray-200">{{ plan.name }}{{ plan.detail ? ' · ' + plan.detail : '' }}</span>
            <span class="block h-7 overflow-hidden text-xl leading-7 font-bold whitespace-nowrap">{{ plan.action }}</span>
          </div>
        }
        @for (member of teamStatus(); track member.name) {
          <div
            class="absolute top-[104px] block h-[44px] rounded-md border border-gray-600 bg-gray-700 p-[3px_8px]"
            [style.left.px]="member.left"
            [style.width.px]="member.width"
          >
            <span class="block h-5 overflow-hidden text-sm leading-5 font-bold whitespace-nowrap">{{ member.name }}</span>
            <span class="block h-4 text-xs leading-4 text-gray-300">{{ member.detail }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class BattleControls {
  private readonly dex = inject(ChampionsDex);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly store = inject(BattleStore);
  protected readonly choices = inject(BattleChoices);

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
      const type = this.dex.move(move.id)?.type ?? '';
      return {
        ...move,
        disabled: !!move.disabled || move.pp <= 0,
        color: typeColor(type) || '#4b5563',
        detail: `${type} · PP ${move.pp}/${move.maxpp}`,
        left: i * (MOVE_WIDTH + GAP),
      };
    }),
  );

  protected readonly watchingTitle = computed(() => {
    if (this.store.playing()) return this.store.turn() > 0 ? `Turn ${this.store.turn()} in progress…` : 'The battle is starting…';
    return 'Waiting for the opponent…';
  });

  /** Each active slot's order this turn, on its move type's colour; before any order, who's out there. */
  protected readonly plans = computed(() => {
    const submitted = this.choices.submitted();
    return this.store.sides().p1.active.map((pokemon, slot) => {
      const plan = submitted.find((p) => p.slot === slot);
      const left = slot * (BIG_WIDTH + GAP);
      if (plan) return { ...plan, left, color: typeColor(plan.type) || '#374151' };
      const action = !pokemon ? '' : pokemon.fainted ? 'Fainted' : 'Getting ready';
      return { slot, left, name: pokemon?.name ?? '', action, detail: '', color: '#374151' };
    });
  });

  /**
   * The whole team's HP (read-only), from the log as it plays. The team comes from the last request;
   * before the first one (the intro), the Pokémon sent out so far.
   */
  protected readonly teamStatus = computed(() => {
    const seen = this.store.sides().p1;
    const team = this.store.team();
    const members = team.length > 0 ? team : seen.pokemon.map((p) => ({ ident: p.ident, condition: `${p.hp}/${p.maxHp}` }));
    const width = Math.floor((WIDTH - GAP * (members.length - 1)) / Math.max(1, members.length));
    return members.map((member, i) => {
      const pokemon = seen.pokemon.find((p) => p.ident === member.ident);
      const { hp, maxHp, fainted } = pokemon ?? parseCondition(member.condition, 100);
      const active = seen.active.some((p) => p?.ident === member.ident);
      const status = fainted ? 'Fainted' : `${hpPercent(hp, maxHp)}%${active ? ' · in battle' : ''}`;
      return { name: member.ident.slice(member.ident.indexOf(': ') + 2), detail: status, width, left: i * (width + GAP) };
    });
  });

  /** One row across the bottom, as wide as the team allows. */
  protected readonly smallSwitches = computed(() => {
    const options = this.choices.switchOptions();
    const width = Math.floor((WIDTH - GAP * (options.length - 1)) / Math.max(1, options.length));
    return options.map((option, i) => ({
      ...option,
      width,
      left: i * (width + GAP),
      detail: option.fainted ? 'Fainted' : `${option.hpPercent}%${option.allowed ? '' : ' · in battle'}`,
      label: `Switch to ${option.name}, ${option.fainted ? 'fainted' : `${option.hpPercent}% HP`}`,
    }));
  });

  protected readonly bigSwitches = computed(() =>
    this.choices.switchOptions().map((option, i) => ({
      ...option,
      left: (i % 3) * (SWITCH_WIDTH + GAP),
      top: ROW_TOPS[Math.floor(i / 3)] ?? 0,
      detail: option.fainted ? 'Fainted' : `${option.hpPercent}% HP${option.allowed ? '' : ' · in battle'}`,
    })),
  );

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
    return [this.store.result(), request?.rqid, this.choices.slot(), !!this.choices.pendingMove()].join('|');
  });

  constructor() {
    // Focus the first usable button of each new view, so the controller can pick straight away.
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
