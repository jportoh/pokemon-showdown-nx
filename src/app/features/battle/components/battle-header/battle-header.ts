import { Component, computed, inject, input, output } from '@angular/core';
import { BattleStore } from '@features/battle/state/battle-store';

/** Names are cut by hand: text-overflow is untested on Brewser. */
const MAX_NAME_CHARS = 20;

/**
 * The match header across the top of the battle, 1280x48, laid out like a scoreboard over the stage
 * below it: the format on the left; "p1 VS p2" centred over the field, each name in its side's colour
 * (blue the near side, red the far one, as the team cards and the target buttons); the turn at the
 * field's right edge; and over the right column, Forfeit (R) and the battle log (ZR) as button hints.
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

      <span class="absolute top-[9px] left-[877px] block h-7 w-[110px] rounded-full bg-tab text-center text-sm leading-7 font-bold uppercase">
        {{ store.turn() > 0 ? 'Turn ' + store.turn() : 'Starting…' }}
      </span>

      @if (store.replay()) {
        <span class="absolute top-[11px] left-[1003px] block h-6 w-[130px] rounded-sm bg-tab text-center text-sm leading-6 font-bold uppercase">Replay</span>
      } @else if (!store.result()) {
        <button
          type="button"
          data-kb-skip
          class="absolute top-[7px] left-[1003px] h-8 w-[130px] rounded-md border text-sm font-bold"
          [class]="confirmingForfeit() ? 'border-red-300 bg-red-800 hover:bg-red-700' : 'border-gray-500 bg-tab hover:bg-tab-hover'"
          [attr.aria-label]="confirmingForfeit() ? 'Press again to forfeit' : 'Forfeit'"
          (click)="forfeit.emit()"
        >
          <span class="block h-[30px] text-center leading-[30px]"
            ><span class="rounded-sm bg-header p-[2px_6px]">R</span>{{ confirmingForfeit() ? ' Confirm' : ' Forfeit' }}</span
          >
        </button>
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

  /** The first press of Forfeit is waiting for the second. */
  readonly confirmingForfeit = input(false);
  readonly logOpen = input(false);

  readonly forfeit = output<void>();
  readonly toggleLog = output<void>();

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
