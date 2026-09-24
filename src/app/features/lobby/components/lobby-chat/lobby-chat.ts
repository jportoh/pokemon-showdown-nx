import { Component, computed, inject, output } from '@angular/core';
import { ChatMessageList } from '@features/lobby/components/chat-message-list/chat-message-list';
import { ChatUserList } from '@features/lobby/components/chat-user-list/chat-user-list';
import { LobbyChatStore } from '@features/lobby/state/lobby-chat-store';

@Component({
  imports: [ChatUserList, ChatMessageList],
  selector: 'app-lobby-chat',
  host: { class: 'flex' },
  // Fixed 640x644 panel (see styles.css): 224px user list + 415px messages + 1px border;
  // 600px message log + 44px bar with the "Join chat" button and the connection status.
  template: `
    <section aria-label="Lobby chat" class="flex h-[644px] w-[640px] border-l border-gray-600">
      <app-chat-user-list
        [users]="store.users()"
        [count]="store.userCount()"
        class="h-[644px] w-56 shrink-0 border-r border-gray-600"
      />
      <div class="flex h-[644px] w-[415px] flex-col bg-[#0b0e14]">
        <app-chat-message-list [messages]="store.messages()" />
        <div class="flex h-11 items-center gap-3 border-t border-gray-600 px-1.5">
          <button
            type="button"
            (click)="joinChat.emit()"
            class="cursor-pointer rounded-md border border-gray-400 bg-gray-700 px-3 py-1 text-lg text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Join chat
          </button>
          <p role="status" class="truncate text-sm text-gray-300">{{ statusText() }}</p>
        </div>
      </div>
    </section>
  `,
})
export class LobbyChat {
  protected readonly store = inject(LobbyChatStore);

  readonly joinChat = output<void>();

  protected readonly statusText = computed(() => {
    const { status, error } = this.store.connectionState();
    switch (status) {
      case 'connecting':
        return 'Connecting to Pokémon Showdown…';
      case 'connected':
        return 'Connected (read-only)';
      case 'disconnected':
        return `${error ? `${error} ` : 'Disconnected. '}Reconnecting…`;
      case 'error':
        return error ?? 'Connection failed.';
    }
  });
}
