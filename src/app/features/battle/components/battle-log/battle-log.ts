import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, inject, input, linkedSignal, viewChild } from '@angular/core';
import { KeyboardNavigation, PageStep } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { fitEnd, fitStart } from '@features/battle/components/battle-log/log-window';
import { BattleStore } from '@features/battle/state/battle-store';

/** Entries the d-pad moves the window by. */
const PAGE_STEP_ENTRIES = 3;

/**
 * The battle log, Showdown style: a turn header per turn, each message, and minor details (HP lost)
 * in smaller grey text. Fixed 415x500, shown over the field only on request (`open`), and hidden with
 * display:none rather than removed.
 *
 * It is NOT a scroll box: on the console, a scroll box shown for the first time stayed blank until a
 * new row arrived, whatever was done when opening it (test L1: repaints, opacity, resizing, scroll
 * nudges, repainting the field or the page), while a plain block painted fine. So it shows a window of
 * entries that fits its height, the newest ones unless the reader has paged back: the d-pad moves the
 * window (the log registers as a pager, see KeyboardNavigation), and so does the mouse wheel. What
 * fits is estimated from the entries' text (see log-window), never measured: on the console the
 * rendered height read short, and a window corrected from it kept spilling out of the box.
 * It takes focus when it opens; the d-pad never moves onto it from elsewhere (data-kb-skip).
 */
@Component({
  selector: 'app-battle-log',
  host: {
    class: 'h-[500px] w-[415px] bg-card',
    '[style.display]': "open() ? 'block' : 'none'",
  },
  template: `
    <div
      #log
      role="log"
      aria-label="Battle log"
      tabindex="0"
      data-kb-skip
      class="block h-[500px] w-[415px] text-base text-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    >
      <div class="block p-[8px_12px_12px]">
        @for (entry of entries(); track entry.id) {
          @switch (entry.kind) {
            @case ('turn') {
              <h2 class="mt-3 mb-1 block rounded-sm bg-stage p-[2px_8px] text-lg leading-7 font-bold text-white">{{ entry.text }}</h2>
            }
            @case ('minor') {
              <p class="block text-sm leading-5 text-gray-300 wrap-anywhere">{{ entry.text }}</p>
            }
            @case ('result') {
              <p class="mt-2 block text-lg leading-7 font-bold text-yellow-200 wrap-anywhere">{{ entry.text }}</p>
            }
            @default {
              <p class="block leading-6 wrap-anywhere">{{ entry.text }}</p>
            }
          }
        }
      </div>
    </div>
  `,
})
export class BattleLog {
  private readonly store = inject(BattleStore);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly renderScheduler = inject(RenderScheduler);

  /** Shown over the field; hidden (not removed) otherwise. */
  readonly open = input(false);

  /** Where the window ends, or null to follow the newest entries. Opening goes back to the newest. */
  private readonly end = linkedSignal<boolean, number | null>({ source: this.open, computation: () => null });

  /** The entries shown, [start, end). */
  private readonly window = computed(() => {
    const log = this.store.log();
    const end = this.end();
    const last = end === null ? log.length : Math.min(end, log.length);
    return { start: fitStart(log, last), end: last };
  });

  protected readonly entries = computed(() => {
    const { start, end } = this.window();
    return this.store.log().slice(start, end);
  });

  private readonly logElement = viewChild.required<ElementRef<HTMLElement>>('log');
  private wasOpen = false;

  constructor() {
    afterRenderEffect(() => {
      const open = this.open();
      const opening = open && !this.wasOpen;
      this.wasOpen = open;
      if (opening) this.logElement().nativeElement.focus();
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.logElement().nativeElement;
      const unregister = this.navigation.registerPager(el, (step) => this.page(step));
      // Browsers: the wheel pages the log as it would scroll it.
      const onWheel = (event: WheelEvent) => {
        if (event.deltaY === 0) return;
        event.preventDefault();
        if (this.page(event.deltaY > 0 ? 'down' : 'up')) this.renderScheduler.request();
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      destroyRef.onDestroy(() => {
        unregister();
        el.removeEventListener('wheel', onWheel);
      });
    });
  }

  /** The d-pad (or the wheel): moves the window a few entries; false when it's already at that end. */
  private page(step: PageStep): boolean {
    const log = this.store.log();
    const { start, end } = this.window();
    const firstPageEnd = fitEnd(log, 0);
    switch (step) {
      case 'up': {
        if (start === 0) return false;
        // At least one entry back, even where the first page's estimate disagrees with the rendered window.
        this.end.set(Math.min(end - 1, Math.max(end - PAGE_STEP_ENTRIES, firstPageEnd)));
        return true;
      }
      case 'down': {
        if (this.end() === null) return false;
        const next = end + PAGE_STEP_ENTRIES;
        this.end.set(next >= log.length ? null : next);
        return true;
      }
      case 'first':
        this.end.set(Math.min(firstPageEnd, log.length));
        return true;
      case 'last':
        this.end.set(null);
        return true;
    }
  }
}
