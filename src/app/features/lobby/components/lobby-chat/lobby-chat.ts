import { Component, output, signal } from '@angular/core';
import { ChatMessageList } from '@features/lobby/components/chat-message-list/chat-message-list';
import { ChatUserList } from '@features/lobby/components/chat-user-list/chat-user-list';
import { MOCK_CHAT_MESSAGES, MOCK_CHAT_USERS } from '@features/lobby/data/mock-chat';

@Component({
  imports: [ChatUserList, ChatMessageList],
  selector: 'app-lobby-chat',
  host: { class: 'flex' },
  // Fixed 640x644 panel (see styles.css): 224px user list + 415px messages + 1px border;
  // 600px message log + 44px "Join chat" bar.
  template: `
    <section aria-label="Lobby chat" class="flex h-[644px] w-[640px] border-l border-gray-600">
      <app-chat-user-list [users]="users()" class="h-[644px] w-56 shrink-0 border-r border-gray-600" />
      <div class="flex h-[644px] w-[415px] flex-col bg-[#0b0e14]">
        <app-chat-message-list [messages]="messages()" />
        <div class="flex h-11 items-center border-t border-gray-600 px-1.5">
          <button
            type="button"
            (click)="joinChat.emit()"
            class="cursor-pointer rounded-md border border-gray-400 bg-linear-to-b from-gray-600 to-gray-800 px-3 py-1 text-lg text-white hover:from-gray-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Join chat
          </button>
        </div>
      </div>
    </section>
  `,
})
export class LobbyChat {
  readonly joinChat = output<void>();

  protected readonly users = signal(MOCK_CHAT_USERS);
  protected readonly messages = signal(MOCK_CHAT_MESSAGES);
}
