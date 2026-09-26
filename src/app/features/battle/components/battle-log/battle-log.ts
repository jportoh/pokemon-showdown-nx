import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, inject, viewChild } from '@angular/core';
import { BattleStore } from '@features/battle/state/battle-store';
import { ScrollRegion } from '@shared/directives/scroll-region';

/** How close to the bottom (px) still counts as "reading the newest entries". */
const STICK_THRESHOLD_PX = 40;
/** Delay before repeating the scroll to the bottom, once the engine has laid out new rows. */
const DEFERRED_SCROLL_MS = 100;
/** Scroll events this soon after the app's own scrolling are treated as layout, not as the reader. */
const IGNORE_SCROLL_AFTER_AUTO_MS = 500;

/**
 * The whole battle log, Showdown style: a turn header per turn, each message, and minor details
 * (HP lost) in smaller grey text. Fixed 427x500 (the right third of the stage, under the battle bar
 * and the field conditions). It follows new entries while the reader is at the bottom, with the chat log's Brewser workarounds:
 * block rows, padding on an inner block and a repeated scroll to the bottom. Unlike the chat log, it
 * repaints itself on every new entry (see repaint()). The d-pad never focuses it (data-kb-skip):
 * it follows the battle by itself, and a focused log kept the ring after the turn. It stays reachable
 * with the Tab key and scrollable with a mouse.
 */
@Component({
  imports: [ScrollRegion],
  selector: 'app-battle-log',
  host: { class: 'block h-[500px] w-[427px] bg-card' },
  template: `
    <div
      #log
      appScrollRegion
      role="log"
      aria-label="Battle log"
      tabindex="0"
      data-kb-skip
      class="h-[500px] w-[427px] overflow-y-auto text-base text-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    >
      <div class="p-[8px_12px_12px]">
        @for (entry of store.log(); track entry.id) {
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
  protected readonly store = inject(BattleStore);

  private readonly logElement = viewChild.required<ElementRef<HTMLElement>>('log');
  private stickToBottom = true;
  private lastAutoScroll = 0;
  private deferredScroll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    afterRenderEffect(() => {
      const log = this.store.log();
      // A new battle (rematch) empties the log: it follows the newest entries again.
      if (log.length === 0) {
        this.stickToBottom = true;
        return;
      }
      const el = this.logElement().nativeElement;
      this.repaint(el);
      if (!this.stickToBottom) return;
      this.scrollToBottom(el);
      if (this.deferredScroll !== null) clearTimeout(this.deferredScroll);
      this.deferredScroll = setTimeout(() => {
        this.deferredScroll = null;
        if (this.stickToBottom) this.scrollToBottom(el);
      }, DEFERRED_SCROLL_MS);
    });

    // Native listener: a template (scroll) binding would run change detection on every scroll event.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.logElement().nativeElement;
      const onScroll = () => {
        if (Date.now() - this.lastAutoScroll < IGNORE_SCROLL_AFTER_AUTO_MS) return;
        this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      destroyRef.onDestroy(() => {
        el.removeEventListener('scroll', onScroll);
        if (this.deferredScroll !== null) clearTimeout(this.deferredScroll);
      });
    });
  }

  /**
   * Seen on the console: rows appended during a turn only appeared once the turn ended (when the
   * command panel changed), while the HP bars moved on time. Brewser seems to paint a scroll box on
   * its own layer and not repaint it for rows added inside it; the chat log got away with it because
   * it always overflows, and each new message scrolling it repaints it, but a battle log that doesn't
   * fill the box yet never scrolls. Hiding and showing the box repaints it (the technique that fixed
   * blank scroll boxes on device); its scroll position is kept, as hiding may reset it.
   */
  private repaint(el: HTMLElement): void {
    const scrollTop = el.scrollTop;
    this.lastAutoScroll = Date.now();
    el.style.display = 'none';
    void el.offsetHeight;
    el.style.display = '';
    el.scrollTop = scrollTop;
  }

  // Clamped explicitly: an engine that doesn't clamp scrollTop would scroll past the content.
  private scrollToBottom(el: HTMLElement): void {
    this.lastAutoScroll = Date.now();
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  }
}
