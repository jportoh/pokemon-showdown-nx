import { Component, ElementRef, afterNextRender, computed, inject, output } from '@angular/core';
import { BattlePokemon, BattleSide } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';

const WIDTH = 829;
const GAP = 12;
const BUTTON_WIDTH = Math.floor((WIDTH - GAP * 3) / 4);
/** Each team row: the player's name, then up to six Pokémon. */
const NAME_WIDTH = 140;
const TILE_GAP = 8;
const TILE_WIDTH = Math.floor((WIDTH - NAME_WIDTH - GAP - TILE_GAP * 5) / 6);
const SPEEDS = [1, 2, 4];

interface TeamTile {
  key: string;
  name: string;
  detail: string;
  left: number;
  fainted: boolean;
  active: boolean;
}

/**
 * The command panel while watching a replay, 829x216: play/pause (or watch again once it's over),
 * next turn, speed and back to the replay list, then both teams as shown at team preview with the HP
 * seen so far. Absolutely laid out (Brewser layout rules).
 */
@Component({
  selector: 'app-replay-controls',
  host: { class: 'block h-[216px] w-[829px] text-white' },
  template: `
    <div class="relative h-[216px] w-[829px]">
      <p
        class="absolute top-0 left-0 block h-7 w-[829px] overflow-hidden text-base leading-7 whitespace-nowrap text-gray-200"
      >
        {{ title() }}
      </p>
      <button
        type="button"
        class="absolute top-[36px] h-[44px] rounded-md border border-blue-300 bg-blue-700 text-base font-bold hover:bg-blue-800"
        [style.left.px]="0"
        [style.width.px]="buttonWidth"
        (click)="finished() ? again.emit() : store.togglePause()"
      >
        {{ finished() ? 'Watch again' : store.paused() ? 'Play' : 'Pause' }}
      </button>
      <button
        type="button"
        class="absolute top-[36px] h-[44px] rounded-md border border-gray-400 bg-gray-600 text-base font-bold enabled:hover:bg-gray-500 disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400"
        [style.left.px]="buttonWidth + gap"
        [style.width.px]="buttonWidth"
        [disabled]="finished()"
        (click)="store.nextTurn()"
      >
        Next turn
      </button>
      <button
        type="button"
        class="absolute top-[36px] h-[44px] rounded-md border border-gray-400 bg-gray-600 text-base font-bold hover:bg-gray-500"
        [style.left.px]="(buttonWidth + gap) * 2"
        [style.width.px]="buttonWidth"
        [attr.aria-label]="'Playback speed ' + store.speed() + 'x'"
        (click)="nextSpeed()"
      >
        {{ 'Speed ' + store.speed() + 'x' }}
      </button>
      <button
        type="button"
        class="absolute top-[36px] h-[44px] rounded-md border border-gray-400 bg-gray-600 text-base font-bold hover:bg-gray-500"
        [style.left.px]="(buttonWidth + gap) * 3"
        [style.width.px]="buttonWidth"
        (click)="leave.emit()"
      >
        Other replays
      </button>

      @for (row of teams(); track row.key) {
        <div class="absolute block h-[54px] w-[829px]" [style.top.px]="row.top">
          <span
            class="absolute top-0 left-0 block h-[54px] overflow-hidden text-sm leading-[54px] font-bold whitespace-nowrap"
            [style.width.px]="nameWidth"
            >{{ row.player }}</span
          >
          @for (tile of row.tiles; track tile.key) {
            <div
              class="absolute top-0 block h-[54px] rounded-md border p-[5px_8px]"
              [class]="
                tile.fainted
                  ? 'border-gray-700 bg-gray-800 text-gray-400'
                  : tile.active
                    ? 'border-blue-300 bg-blue-900'
                    : 'border-gray-600 bg-gray-700'
              "
              [style.left.px]="tile.left"
              [style.width.px]="tileWidth"
            >
              <span
                class="block h-5 overflow-hidden text-sm leading-5 font-bold whitespace-nowrap"
                >{{ tile.name }}</span
              >
              <span class="block h-5 text-xs leading-5 text-gray-300">{{ tile.detail }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ReplayControls {
  protected readonly store = inject(BattleStore);

  readonly again = output<void>();
  readonly leave = output<void>();

  protected readonly buttonWidth = BUTTON_WIDTH;
  protected readonly gap = GAP;
  protected readonly nameWidth = NAME_WIDTH;
  protected readonly tileWidth = TILE_WIDTH;

  protected readonly finished = computed(() => !!this.store.result() && !this.store.playing());

  protected readonly title = computed(() => {
    const replay = this.store.replay();
    if (!replay) return '';
    const status = this.finished()
      ? this.store.winner()
        ? `${this.store.winner()} won`
        : 'Tie'
      : this.store.paused()
        ? 'Paused'
        : this.store.turn() > 0
          ? `Turn ${this.store.turn()}`
          : 'Team preview';
    return `Replay · ${replay.players[0]} vs ${replay.players[1]}${replay.rating ? ` · Rating ${replay.rating}` : ''} · ${status}`;
  });

  protected readonly teams = computed(() => {
    const { p1, p2 } = this.store.sides();
    return [
      { key: 'p1', top: 92, player: p1.name, tiles: tiles(p1) },
      { key: 'p2', top: 158, player: p2.name, tiles: tiles(p2) },
    ];
  });

  constructor() {
    // The first control, so the controller can pause straight away.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => host.querySelector<HTMLButtonElement>('button')?.focus());
  }

  protected nextSpeed(): void {
    const next = SPEEDS[(SPEEDS.indexOf(this.store.speed()) + 1) % SPEEDS.length];
    this.store.setSpeed(next);
  }
}

/**
 * The side's Pokémon as shown at team preview, each with what's been seen of it: HP, fainted, in
 * battle, or "Not sent out". Without a team preview, the Pokémon seen so far.
 */
function tiles(side: BattleSide): TeamTile[] {
  const species = side.preview.length > 0 ? side.preview : side.pokemon.map((p) => p.species);
  return species.slice(0, 6).map((name, i) => {
    const seen = side.pokemon.find((p) => p.species === name || p.species.startsWith(`${name}-`));
    const active = !!seen && side.active.some((p) => p?.ident === seen.ident);
    return {
      key: `${i}-${name}`,
      name: seen?.name ?? name,
      detail: tileDetail(seen, active),
      left: NAME_WIDTH + GAP + i * (TILE_WIDTH + TILE_GAP),
      fainted: !!seen?.fainted,
      active,
    };
  });
}

function tileDetail(pokemon: BattlePokemon | undefined, active: boolean): string {
  if (!pokemon) return 'Not sent out';
  if (pokemon.fainted) return 'Fainted';
  const percent =
    pokemon.maxHp > 0 ? Math.max(1, Math.round((pokemon.hp / pokemon.maxHp) * 100)) : 0;
  return `${percent}%${active ? ' · in battle' : ''}`;
}
