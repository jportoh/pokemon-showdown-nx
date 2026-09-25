import { Component, ElementRef, afterRenderEffect, computed, inject, output, signal, viewChild, viewChildren } from '@angular/core';
import { ChatMessageList } from '@features/lobby/components/chat-message-list/chat-message-list';
import { ChatUserList } from '@features/lobby/components/chat-user-list/chat-user-list';
import { CHAT_ROOMS } from '@features/lobby/data/chat-rooms';
import { ChatRoom } from '@features/lobby/models/chat';
import { ChatRoomStore } from '@features/lobby/state/chat-room-store';
import { BackAction } from '@shared/directives/back-action';

type ChatView = 'chat' | 'users';

@Component({
  imports: [ChatUserList, ChatMessageList, BackAction],
  selector: 'app-lobby-chat',
  host: { class: 'block' },
  // Fixed 427x644 panel, 1/3 of the stage (see styles.css): a 426px-wide (+1px border) 600px view area
  // over a 44px bar. The view area shows the room picker until the user joins a room; then a 36px room
  // header (name + Leave) over the 564px chat log or user list. Nothing moves or resizes at runtime, and
  // the scroll regions are mounted from the start, only shown or hidden: on Brewser, moving a container
  // leaves its absolutely positioned children behind, flex containers with changing content lose their
  // layout, and scroll lists inserted after load can stay blank (all seen on device). Room buttons sit
  // in fixed-height blocks rather than a flex gap or margins for the same reason.
  template: `
    <section aria-label="Chat" class="h-[644px] w-[427px] border-l border-gray-600 bg-[#0b0e14]">
      <div class="h-[600px] w-[426px]">
        <div role="region" aria-labelledby="chat-rooms-title" class="h-[600px] w-[426px] p-6" [class.hidden]="joined()">
          <h2 id="chat-rooms-title" class="h-9 text-lg font-bold text-gray-200">Chat rooms</h2>
          @for (room of rooms; track room.id) {
            <div class="h-[84px]">
              <button
                #roomButton
                type="button"
                (click)="joinRoom(room)"
                [disabled]="joining()"
                class="block h-[72px] w-[378px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 p-[10px_16px] text-left text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:bg-gray-800"
              >
                <span class="block text-xl font-bold">{{ room.title }}</span>
                <span class="block text-sm text-gray-300">{{ joining() && store.room()?.id === room.id ? 'Joining…' : 'Join as a guest' }}</span>
              </button>
            </div>
          }
        </div>
        <div class="relative h-9 w-[426px] border-b border-gray-600" [class.hidden]="!joined()">
          <h2 class="absolute top-[7px] left-3 text-base font-bold text-gray-100">{{ roomTitle() }}</h2>
          <button
            type="button"
            [attr.aria-label]="'Leave ' + roomTitle()"
            (click)="leaveRoom()"
            class="absolute top-1 left-[338px] h-7 w-[80px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-sm text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Leave
          </button>
        </div>
        <app-chat-message-list [messages]="store.messages()" [visible]="logShown()" [class.hidden]="!logShown()" />
        <app-chat-user-list
          id="room-users"
          [users]="store.users()"
          [count]="store.userCount()"
          class="h-[564px] w-[426px]"
          [class.hidden]="!usersShown()"
          (appBack)="backToChat()"
        />
      </div>
      <div class="relative h-11 w-[426px] border-t border-gray-600">
        <p role="status" class="absolute top-3 left-2 w-[410px] text-sm leading-5 text-gray-300" [class.hidden]="joined()">
          {{ joining() ? 'Joining ' + roomTitle() + '…' : (store.joinError() ?? 'Not in a room') }}
        </p>
        <button
          type="button"
          (click)="joinChat.emit()"
          class="absolute top-[5px] left-2 h-8 w-[100px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          [class.hidden]="!joined()"
        >
          Join chat
        </button>
        <button
          #usersButton
          type="button"
          aria-controls="room-users"
          [attr.aria-pressed]="usersShown()"
          (click)="toggleUsers()"
          class="absolute top-[5px] left-[116px] h-8 w-[136px] cursor-pointer rounded-md border border-gray-400 bg-gray-700 text-base text-white hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          [class.hidden]="!joined()"
        >
          {{ usersShown() ? 'Back to chat' : 'Users (' + store.userCount() + ')' }}
        </button>
        <p role="status" class="absolute top-3 left-[264px] w-[154px] text-sm leading-5 text-gray-300" [class.hidden]="!joined()">
          {{ statusText() }}
        </p>
      </div>
    </section>
  `,
})
export class LobbyChat {
  protected readonly store = inject(ChatRoomStore);
  protected readonly rooms = CHAT_ROOMS;
  private readonly messageList = viewChild.required(ChatMessageList);
  private readonly roomButtons = viewChildren<ElementRef<HTMLButtonElement>>('roomButton');
  private readonly usersButton = viewChild.required<ElementRef<HTMLButtonElement>>('usersButton');

  readonly joinChat = output<void>();

  protected readonly joined = computed(() => this.store.joinState() === 'joined');
  protected readonly joining = computed(() => this.store.joinState() === 'joining');
  protected readonly roomTitle = computed(() => this.store.room()?.title ?? '');

  /**
   * Once joined, the user list stays mounted and is shown in place of the chat log on demand
   * (display: none otherwise), which avoids the two-step removal a scroll region otherwise needs on
   * Brewser to not stay painted.
   */
  protected readonly view = signal<ChatView>('chat');
  protected readonly usersShown = computed(() => this.joined() && this.view() === 'users');
  protected readonly logShown = computed(() => this.joined() && this.view() === 'chat');

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

  // The button the user pressed gets disabled or hidden, so focus moves to what replaces it instead of
  // being lost: the log once joined, or that room's button when back on the picker (after leaving, or
  // when the server refuses the join).
  private focusLogOnJoin = false;
  private focusRoomOnIdle: string | null = null;

  constructor() {
    afterRenderEffect(() => {
      const state = this.store.joinState();
      if (state === 'joined' && this.focusLogOnJoin) {
        this.focusLogOnJoin = false;
        this.focusRoomOnIdle = null;
        this.messageList().focus();
      } else if (state === 'idle' && this.focusRoomOnIdle !== null) {
        const index = this.rooms.findIndex((room) => room.id === this.focusRoomOnIdle);
        this.focusLogOnJoin = false;
        this.focusRoomOnIdle = null;
        this.roomButtons()[index]?.nativeElement.focus();
      }
    });
  }

  protected joinRoom(room: ChatRoom): void {
    this.focusLogOnJoin = true;
    this.focusRoomOnIdle = room.id;
    this.view.set('chat');
    this.store.join(room);
  }

  protected leaveRoom(): void {
    this.focusLogOnJoin = false;
    this.focusRoomOnIdle = this.store.room()?.id ?? null;
    this.store.leave();
  }

  protected toggleUsers(): void {
    this.view.set(this.view() === 'users' ? 'chat' : 'users');
  }

  /** B in the user list: back to the chat log, with focus on the button that toggles them. */
  protected backToChat(): void {
    this.view.set('chat');
    this.usersButton().nativeElement.focus();
  }
}
