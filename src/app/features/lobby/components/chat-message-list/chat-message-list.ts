import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, inject, input, viewChild } from '@angular/core';
import { ChatMessage } from '@features/lobby/models/chat';
import { ScrollRegion } from '@shared/directives/scroll-region';
import { UsernameColorPipe } from '@shared/utils/username-color-pipe';

/** How close to the bottom (px) still counts as "reading the newest messages". */
const STICK_THRESHOLD_PX = 40;

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
      class="h-[600px] overflow-y-auto px-3 py-2 text-lg text-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    >
      <!--
        Plain block rows with the name inline, and the text directly after </strong> with no
        whitespace in between. On Brewser, flex rows holding wrapped text overlap as rows are added
        (verified), and a whitespace-led text node after the name was pushed below it. The gap after
        the name is a space inside the interpolated value: Brewser ignores margins on inline elements.
      -->
      @for (message of messages(); track message.id) {
        <p class="leading-relaxed wrap-anywhere" [class.italic]="message.action">
          <strong [class]="message.author | usernameColor"
            >{{ message.author }}{{ message.action ? ' ' : ': ' }}</strong
          >{{ message.text }}
        </p>
      }
    </div>
  `,
})
export class ChatMessageList {
  readonly messages = input.required<ChatMessage[]>();

  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');
  // Starts true, and stays true if the engine never fires scroll events (the log then always follows).
  private stickToBottom = true;

  constructor() {
    // Follow new messages only while the reader is at the bottom, so scrolling up to read isn't interrupted.
    afterRenderEffect(() => {
      this.messages();
      if (!this.stickToBottom) return;
      const el = this.log().nativeElement;
      el.scrollTop = el.scrollHeight;
    });

    // A native listener rather than a (scroll) template binding: template listeners schedule change
    // detection on every scroll event, which is costly on slow devices, and this only updates a flag.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.log().nativeElement;
      const onScroll = () => {
        this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      destroyRef.onDestroy(() => el.removeEventListener('scroll', onScroll));
    });
  }
}
