import { Component, ElementRef, afterRenderEffect, input, viewChild } from '@angular/core';
import { ChatMessage } from '@features/lobby/models/chat';
import { ScrollRegion } from '@shared/directives/scroll-region';
import { UsernameColorPipe } from '@shared/utils/username-color-pipe';

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
      @for (message of messages(); track message.id) {
        <p class="leading-relaxed wrap-break-word">
          <strong class="mr-1.5" [class]="message.author | usernameColor">{{ message.author }}:</strong>
          {{ message.text }}
        </p>
      }
    </div>
  `,
})
export class ChatMessageList {
  readonly messages = input.required<ChatMessage[]>();

  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');

  constructor() {
    // Keep the newest message in view whenever the list changes.
    afterRenderEffect(() => {
      this.messages();
      const el = this.log().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }
}
