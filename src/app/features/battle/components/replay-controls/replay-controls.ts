import { Component, ElementRef, afterNextRender, computed, inject, output } from '@angular/core';
import { BattleStore } from '@features/battle/state/battle-store';

const WIDTH = 961;
const GAP = 12;
const BUTTON_WIDTH = Math.floor((WIDTH - GAP * 3) / 4);
const SPEEDS = [1, 2, 4];

/**
 * The command panel while watching a replay, 961x148: play/pause (or watch again once it's over),
 * next turn, speed and back to the replay list (both teams are in the right column). Absolutely laid
 * out (Brewser layout rules).
 */
@Component({
  selector: 'app-replay-controls',
  host: { class: 'block h-[148px] w-[961px] text-white' },
  template: `
    <div class="relative h-[148px] w-[961px]">
      <p
        class="absolute top-0 left-0 block h-7 w-[961px] overflow-hidden text-base leading-7 whitespace-nowrap text-gray-200"
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
    // The players, rating and turn are in the match header.
    if (this.finished()) return this.store.winner() ? `${this.store.winner()} won` : 'Tie';
    if (this.store.paused()) return 'Paused';
    return this.store.turn() > 0 ? 'Playing' : 'Team preview';
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
