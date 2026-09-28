import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { BattleStore, timerSecondsLeft } from '@features/battle/state/battle-store';

/** The timer turns red with this little left of the turn (the last minute). */
const LOW_SECONDS = 60;

export type ForfeitState = 'idle' | 'confirming' | 'forfeiting';

/** Names are cut by hand: text-overflow is untested on Brewser. */
const MAX_NAME_CHARS = 20;

/**
 * The match header across the top of the battle, 1280x48, laid out like a scoreboard over the stage
 * below it: the format on the left; "p1 VS p2" centred over the field, each name in its side's colour
 * (blue the near side, red the far one, as the team cards and the target buttons); our battle timer (while
 * it's on; in a real battle a "Timer" button while it's off, both turning it on or off with ZL) and the
 * turn at the field's right edge; and over the right column, Forfeit (R) and the battle log (ZR) as button hints.
 * A replay shows a "Replay" badge where Forfeit goes. The hints are for clicks: the controller has
 * its own buttons for them, so the d-pad skips them (data-kb-skip). Absolutely laid out (Brewser
 * layout rules).
 */
@Component({
  selector: 'app-battle-header',
  host: { class: 'block h-[48px] w-[1280px] border-b-2 border-stage bg-[#172238] text-white' },
  template: `
    <div class="relative h-[46px] w-[1280px]">
      <span class="absolute top-[6px] left-[16px] block h-[14px] w-[250px] overflow-hidden text-[11px] leading-[14px] font-bold whitespace-nowrap text-gray-400 uppercase">
        {{ formatLine().top }}
      </span>
      <span class="absolute top-[21px] left-[16px] block h-5 w-[250px] overflow-hidden text-base leading-5 font-bold whitespace-nowrap">
        {{ formatLine().name }}
      </span>

      @if (players(); as p) {
        <span class="absolute top-0 left-[272px] block h-[46px] w-[204px] overflow-hidden text-right text-lg leading-[46px] font-bold whitespace-nowrap text-sky-300">
          {{ p.p1 }}
        </span>
        <span class="absolute top-[11px] left-[484px] block h-6 w-10 rounded-sm bg-stage text-center text-xs leading-6 font-bold text-yellow-200">VS</span>
        <span class="absolute top-0 left-[532px] block h-[46px] w-[204px] overflow-hidden text-lg leading-[46px] font-bold whitespace-nowrap text-red-300">
          {{ p.p2 }}
        </span>
      }

      @if (timerView(); as t) {
        <!-- Icon and time placed apart: an inline svg next to text wraps on Brewser. Running: a clock on
          green (red when low) with its hand ticking; stopped: two pause bars on grey, the time dimmed.
          A button (ZL) that asks for the timer off. -->
        <button
          type="button"
          data-kb-skip
          class="absolute top-[9px] left-[759px] block h-7 w-[110px] rounded-full border"
          [class]="t.running ? (t.low ? 'border-red-300 bg-red-800 text-white' : 'border-emerald-300 bg-emerald-800 text-white') : 'border-gray-500 bg-gray-700 text-gray-300'"
          [disabled]="!store.canToggleTimer()"
          [attr.aria-label]="t.label + (store.canToggleTimer() ? '. Press to turn the timer off' : '')"
          (click)="toggleTimer.emit()"
        >
          @if (store.canToggleTimer()) {
            <span aria-hidden="true" class="absolute top-[4px] left-[6px] block h-[18px] w-[24px] rounded-sm bg-header text-center text-xs leading-[18px] font-bold text-white">ZL</span>
          }
          @if (t.running) {
            <svg aria-hidden="true" viewBox="0 0 16 16" class="absolute top-[5px] left-[36px] size-4">
              <circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path [attr.d]="t.tick ? 'M8 9V5.5M6 1.5h4' : 'M8 9l3-1.5M6 1.5h4'" fill="none" stroke="currentColor" stroke-width="1.8" />
            </svg>
          } @else {
            <svg aria-hidden="true" viewBox="0 0 16 16" class="absolute top-[5px] left-[36px] size-4">
              <path d="M5 3v10M11 3v10" fill="none" stroke="currentColor" stroke-width="2.4" />
            </svg>
          }
          <span aria-hidden="true" class="absolute top-0 left-[56px] block h-[26px] w-[48px] text-left text-sm leading-[26px] font-bold">{{ t.text }}</span>
        </button>
      } @else if (store.canToggleTimer() && !store.result()) {
        <button
          type="button"
          data-kb-skip
          class="absolute top-[7px] left-[759px] h-8 w-[110px] rounded-md border border-gray-500 bg-tab text-sm font-bold hover:bg-tab-hover"
          [attr.aria-label]="cooldownSeconds() ? 'Turn the battle timer on: allowed again in ' + cooldownSeconds() + ' seconds' : 'Turn the battle timer on'"
          (click)="toggleTimer.emit()"
        >
          <span class="block h-[30px] text-center leading-[30px]"><span class="rounded-sm bg-header p-[2px_6px]">ZL</span> {{ cooldownSeconds() ? 'Wait ' + cooldownSeconds() + 's' : 'Timer' }}</span>
        </button>
      }

      <span class="absolute top-[9px] left-[877px] block h-7 w-[110px] rounded-full bg-tab text-center text-sm leading-7 font-bold uppercase">
        {{ store.turn() > 0 ? 'Turn ' + store.turn() : 'Starting…' }}
      </span>

      @if (store.replay()) {
        <span class="absolute top-[11px] left-[1003px] block h-6 w-[130px] rounded-sm bg-tab text-center text-sm leading-6 font-bold uppercase">Replay</span>
      } @else if (!store.result()) {
        @if (forfeitState() === 'forfeiting') {
          <span role="status" class="absolute top-[7px] left-[1003px] block h-8 w-[130px] rounded-md border border-red-300 bg-red-900 text-center text-sm leading-[30px] font-bold">
            Forfeiting…
          </span>
        } @else {
          <button
            type="button"
            data-kb-skip
            class="absolute top-[7px] left-[1003px] h-8 w-[130px] rounded-md border text-sm font-bold"
            [class]="forfeitState() === 'confirming' ? 'border-red-300 bg-red-800 hover:bg-red-700' : 'border-gray-500 bg-tab hover:bg-tab-hover'"
            [attr.aria-label]="forfeitState() === 'confirming' ? 'Press again to forfeit' : 'Forfeit'"
            (click)="forfeit.emit()"
          >
            <span class="block h-[30px] text-center leading-[30px]"
              ><span class="rounded-sm bg-header p-[2px_6px]">R</span>{{ forfeitState() === 'confirming' ? ' Confirm' : ' Forfeit' }}</span
            >
          </button>
        }
      }

      <button
        type="button"
        data-kb-skip
        class="absolute top-[7px] left-[1141px] h-8 w-[133px] rounded-md border text-sm font-bold"
        [class]="logOpen() ? 'border-sky-300 bg-[#2c4a78] hover:bg-[#35598f]' : 'border-gray-500 bg-tab hover:bg-tab-hover'"
        [attr.aria-expanded]="logOpen()"
        (click)="toggleLog.emit()"
      >
        <span class="block h-[30px] text-center leading-[30px]"><span class="rounded-sm bg-header p-[2px_6px]">ZR</span> Battle log</span>
      </button>
    </div>
  `,
})
export class BattleHeader {
  protected readonly store = inject(BattleStore);

  /** Forfeit's first press waits for the second (confirming), then the server ends the battle (forfeiting). */
  readonly forfeitState = input<ForfeitState>('idle');
  readonly logOpen = input(false);

  readonly forfeit = output<void>();
  readonly toggleLog = output<void>();
  readonly toggleTimer = output<void>();

  /** The clock's "now", moved on every second while the timer runs. */
  private readonly now = signal(Date.now());

  /**
   * Our time left this turn while the battle timer is on ("2:30"), green while it runs, red when it's
   * running low. It stands still, grey with a pause sign, while we wait for the opponent (the server
   * doesn't count that time).
   */
  /** Seconds until the server lets us turn the timer back on (after we turned it off); 0 when it does. */
  protected readonly cooldownSeconds = computed(() => {
    const until = this.store.timerCooldownUntil();
    return until ? Math.max(0, Math.ceil((until - this.now()) / 1000)) : 0;
  });

  protected readonly timerView = computed(() => {
    const timer = this.store.battleTimer();
    if (!timer || this.store.result()) return null;
    const seconds = timerSecondsLeft(timer, this.now());
    const total = timer.totalSeconds === null ? '' : `, ${timer.totalSeconds} in total`;
    const running = timer.since !== null;
    const state = running ? 'running' : 'stopped until your next choice';
    // Turned on while we wait: our time comes with our next request.
    if (seconds === null) {
      return { text: 'On', running, low: false, tick: false, label: 'Battle timer on, stopped until your next choice' };
    }
    return {
      text: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
      running,
      low: seconds <= LOW_SECONDS,
      /** The clock hand moves every second while it runs. */
      tick: seconds % 2 === 0,
      label: `Battle timer ${state}: ${seconds} seconds left this turn${total}`,
    };
  });

  constructor() {
    const render = inject(RenderScheduler);
    const clock = setInterval(() => {
      const cooldown = this.store.timerCooldownUntil();
      if (this.store.battleTimer()?.since == null && !(cooldown && cooldown > this.now())) return;
      this.now.set(Date.now());
      render.request();
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(clock));
  }

  /** Both names once the server has sent them. */
  protected readonly players = computed(() => {
    const { p1, p2 } = this.store.sides();
    return p1.name && p2.name ? { p1: cut(p1.name), p2: cut(p2.name) } : null;
  });

  /**
   * "[Gen 9 Champions] VGC 2026 Reg M-C" as a small "Gen 9 Champions" line (with the replay's rating)
   * over the format's own name.
   */
  protected readonly formatLine = computed(() => {
    const match = /^\[(.+?)\]\s*(.*)$/.exec(this.store.format());
    const rating = this.store.replay()?.rating;
    const top = [match?.[1] ?? '', rating ? `Rating ${rating}` : ''].filter(Boolean).join(' · ');
    return { top, name: match?.[2] ?? this.store.format() };
  });
}

function cut(name: string): string {
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
}
