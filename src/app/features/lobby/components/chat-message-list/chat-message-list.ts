import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, inject, input, viewChild } from '@angular/core';
import { ChatMessage } from '@features/lobby/models/chat';
import { ScrollRegion } from '@shared/directives/scroll-region';
import { UsernameColorPipe } from '@shared/utils/username-color-pipe';

/** How close to the bottom (px) still counts as "reading the newest messages". */
const STICK_THRESHOLD_PX = 40;
/** Delay before repeating the scroll to the bottom, once the engine has laid out new rows. */
const DEFERRED_SCROLL_MS = 100;
/** Scroll events this soon after the app's own scrolling are treated as layout, not as the reader. */
const IGNORE_SCROLL_AFTER_AUTO_MS = 500;

@Component({
  imports: [ScrollRegion, UsernameColorPipe],
  selector: 'app-chat-message-list',
  host: { class: 'block' },
  // Fixed height matching the lobby chat panel: Brewser mis-sizes percentage and flex-grown
  // boxes whose content (these messages) is inserted after load. See styles.css.
  template: `
    <div
      #log
      appScrollRegion
      role="log"
      aria-label="Chat messages"
      tabindex="0"
      class="h-[564px] overflow-y-auto text-lg text-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    >
      <!--
        Brewser layout rules this follows (seen on device): the padding lives on this inner block and
        uses the padding shorthand (Tailwind p-* utilities): longhands (px-*, py-*, pl-*…) lose to the
        preflight's 'padding: 0' shorthand on Brewser whatever their specificity; plain block rows, since flex rows holding
        wrapped text overlap as rows are added; the text directly after </strong> with no whitespace,
        since a whitespace-led text node was pushed below the name; the gap after the name is a space
        in the interpolated value, since margins on inline elements are ignored.
      -->
      <div class="p-[8px_12px]">
        @for (message of messages(); track message.id) {
          <p class="leading-relaxed wrap-anywhere" [class.italic]="message.action">
            <strong [class]="message.author | usernameColor"
              >{{ message.author }}{{ message.action ? ' ' : ': ' }}</strong
            >{{ message.text }}
          </p>
        }
      </div>
    </div>
  `,
})
export class ChatMessageList {
  readonly messages = input.required<ChatMessage[]>();
  /** False while the log is hidden behind another view; it scrolls to the newest message once shown again. */
  readonly visible = input(true);

  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');
  // Starts true, and stays true if the engine never fires scroll events (the log then always follows).
  private stickToBottom = true;
  private repaintedFirstContent = false;
  // When the app itself last scrolled the log; see the scroll listener.
  private lastAutoScroll = 0;
  private deferredScroll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    afterRenderEffect(() => {
      const messages = this.messages();
      // An emptied log (the room was left) behaves like a fresh one when content comes back.
      if (messages.length === 0) {
        this.repaintedFirstContent = false;
        this.stickToBottom = true;
      }
      if (!this.visible()) return;
      const el = this.log().nativeElement;

      // On Brewser the log sometimes stayed blank when the history (~50 rows at once) first filled
      // it. Hiding and showing it once forces a fresh paint (the technique that repainted scroll boxes
      // in on-device tests).
      if (!this.repaintedFirstContent && messages.length > 0) {
        this.repaintedFirstContent = true;
        el.style.display = 'none';
        void el.offsetHeight;
        el.style.display = '';
      }

      // Follow new messages only while the reader is at the bottom, so scrolling up to read isn't
      // interrupted. Brewser may not have laid out the new rows yet (the history only reached the
      // bottom once the next message arrived), so the scroll is repeated shortly after.
      if (!this.stickToBottom) return;
      this.scrollToBottom(el);
      if (this.deferredScroll !== null) clearTimeout(this.deferredScroll);
      this.deferredScroll = setTimeout(() => {
        this.deferredScroll = null;
        if (this.stickToBottom && this.visible()) this.scrollToBottom(el);
      }, DEFERRED_SCROLL_MS);
    });

    // A native listener rather than a (scroll) template binding: template listeners schedule change
    // detection on every scroll event, which is costly on slow devices, and this only updates a flag.
    // Scroll events right after the app's own scrolling are ignored: a late layout can fire one that
    // would otherwise read as the reader scrolling up and stop the log from following.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.log().nativeElement;
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

  /** Moves keyboard focus to the log (it's focusable so it can be scrolled with the keyboard). */
  focus(): void {
    this.log().nativeElement.focus();
  }

  // The offset is clamped explicitly: browsers clamp `scrollTop = scrollHeight` to the maximum, but an
  // engine that doesn't would scroll past the content and show an empty box.
  private scrollToBottom(el: HTMLElement): void {
    this.lastAutoScroll = Date.now();
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  }
}
