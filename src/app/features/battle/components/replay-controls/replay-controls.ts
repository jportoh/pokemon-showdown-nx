import { Component, ElementRef, afterNextRender, computed, inject, output } from '@angular/core';
import { BattleTeamPreview } from '@features/battle/components/battle-team-preview/battle-team-preview';
import { BattleStore } from '@features/battle/state/battle-store';

const WIDTH = 829;
const GAP = 12;
const BUTTON_WIDTH = Math.floor((WIDTH - GAP * 3) / 4);
const SPEEDS = [1, 2, 4];

/**
 * The command panel while watching a replay, 829x216: play/pause (or watch again once it's over),
 * next turn, speed and back to the replay list, then p1's team (the opponent's is over the battle log)
 * as tiles. Absolutely laid out (Brewser layout rules).
 */
@Component({
  selector: 'app-replay-controls',
  imports: [BattleTeamPreview],
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

      <!-- p1's team; the opponent's is over the battle log. -->
      <span
        aria-hidden="true"
        class="absolute top-[116px] left-0 block h-[64px] w-[140px] overflow-hidden text-sm leading-[64px] font-bold whitespace-nowrap"
        >{{ store.sides().p1.name }}</span
      >
      <app-battle-team-preview class="absolute top-[110px] left-[140px]" side="p1" />
    </div>
  `,
})
export class ReplayControls {
  protected readonly store = inject(BattleStore);

  readonly again = output<void>();
  readonly leave = output<void>();

  protected readonly buttonWidth = BUTTON_WIDTH;
  protected readonly gap = GAP;

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
