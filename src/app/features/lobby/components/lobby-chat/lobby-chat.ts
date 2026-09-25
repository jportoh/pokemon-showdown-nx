import { Component, computed, inject, output, signal } from '@angular/core';
import { ChatMessageList } from '@features/lobby/components/chat-message-list/chat-message-list';
import { ChatUserList } from '@features/lobby/components/chat-user-list/chat-user-list';
import { LobbyChatStore } from '@features/lobby/state/lobby-chat-store';

type ChatView = 'chat' | 'users';

@Component({
  imports: [ChatUserList, ChatMessageList],
  selector: 'app-lobby-chat',
  host: { class: 'block' },
  // Fixed 427x644 panel, 1/3 of the stage (see styles.css): a 426px-wide (+1px border) 600px view area
  // showing either the chat log or the user list, over a 44px bar. Nothing moves or resizes at
  // runtime: on Brewser, moving or resizing a container leaves its absolutely positioned children
  // behind (verified on device), and flex containers with changing content lose their layout. So the
  // two views swap in place, and the bar's controls sit at fixed absolute positions.
  template: `
    <section aria-label="Lobby chat" class="h-[644px] w-[427px] border-l border-gray-600 bg-[#0b0e14]">
      <div class="h-[600px] w-[426px]">
        <app-chat-message-list [messages]="store.messages()" [visible]="!usersShown()" [class.hidden]="usersShown()" />
        <app-chat-user-list
          id="lobby-users"
          [users]="store.users()"
          [count]="store.userCount()"
          class="h-[600px] w-[426px]"
          [class.hidden]="!usersShown()"
        />
      </div>
      <div class="relative h-11 w-[426px] border-t border-gray-600">
        <button
          type="button"
          (click)="joinChat.emit()"
          class="absolute top-[5px] left-2 h-8 w-[100px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Join chat
        </button>
        <button
          type="button"
          aria-controls="lobby-users"
          [attr.aria-pressed]="usersShown()"
          (click)="toggleUsers()"
          class="absolute top-[5px] left-[116px] h-8 w-[136px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {{ usersShown() ? 'Back to chat' : 'Users (' + store.userCount() + ')' }}
        </button>
        <p role="status" class="absolute top-3 left-[264px] w-[154px] text-sm leading-5 text-gray-300">
          {{ statusText() }}
        </p>
      </div>
    </section>
  `,
})
export class LobbyChat {
  protected readonly store = inject(LobbyChatStore);

  readonly joinChat = output<void>();

  /**
   * The user list stays mounted and is shown in place of the chat log on demand (display: none
   * otherwise). Compared on device with rendering it only while shown, this ran fine, and it avoids
   * the two-step removal a scroll region otherwise needs on Brewser to not stay painted.
   */
  protected readonly view = signal<ChatView>('chat');
  protected readonly usersShown = computed(() => this.view() === 'users');

  protected readonly statusText = computed(() => {
    switch (this.store.connectionState().status) {
      case 'connecting':
        return 'Connecting…';
      case 'connected':
        return 'Connected';
      case 'disconnected':
        return 'Reconnecting…';
      case 'error':
        return 'Connection failed';
    }
  });

  protected toggleUsers(): void {
    this.view.set(this.usersShown() ? 'chat' : 'users');
  }
}
