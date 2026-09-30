import { Component, DestroyRef, ElementRef, Injector, afterNextRender, afterRenderEffect, computed, inject, signal, viewChild, viewChildren } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ChatMessageList } from '@features/lobby/components/chat-message-list/chat-message-list';
import { ChatUserList } from '@features/lobby/components/chat-user-list/chat-user-list';
import { CHAT_ROOMS } from '@features/lobby/data/chat-rooms';
import { ChatRoom } from '@features/lobby/models/chat';
import { ChatRoomStore } from '@features/lobby/state/chat-room-store';
import { KeyboardField } from '@shared/components/keyboard-field';
import { OnScreenKeyboard } from '@shared/components/on-screen-keyboard/on-screen-keyboard.service';
import { PixelIcon } from '@shared/components/pixel-icon';
import { RetroBox } from '@shared/components/retro-box';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

type ChatView = 'chat' | 'users';

/** Showdown's limit for a chat message. */
const MAX_MESSAGE_LENGTH = 300;
/** A console button's pill on its own (not inside a button), as in the page's legend. */
const PILL = 'absolute block h-7 w-9 rounded-sm bg-retro-select text-center text-sm leading-7 font-bold text-retro-ink';

/**
 * The Chats page: a Gen 3 menu of rooms on the left and the room joined on the right (one at a time),
 * with its log, or its users on demand (ZL), and a field to write in with the app's keyboard (ZR).
 * L leaves the room, as does picking another one or leaving the page (a room joined off this page
 * would only cost the console the work of its traffic). The d-pad scrolls the log or the user list.
 *
 * Brewser rules this follows (seen on device, see styles.css): fixed positions and sizes throughout;
 * the scroll regions (log, users) are mounted from the start and only shown or hidden, as are the
 * views, through normal-flow wrappers (moved or re-created absolute boxes leave stale paint).
 */
@Component({
  imports: [BackAction, ChatMessageList, ChatUserList, KeyboardField, PixelIcon, RetroBox],
  selector: 'app-chats-page',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px] text-retro-ink' },
  template: `
    <app-retro-box class="absolute top-[24px] left-[32px]" [width]="300" [height]="596">
      <h2 id="chat-rooms-title" class="absolute top-[14px] left-[20px] block h-10 w-[248px] text-3xl leading-10 font-bold">Rooms</h2>
      <ul aria-labelledby="chat-rooms-title" class="block">
        @for (room of rooms; track room.id; let i = $index) {
          <li class="block">
            <!-- The one pointed at gets the accent border and lighter panel from styles.css ([data-kb-focus][data-menu-item]). -->
            <button
              #roomButton
              type="button"
              class="absolute left-[8px] h-[46px] w-[272px] cursor-pointer rounded-lg border-2 border-retro-panel bg-retro-panel text-left text-retro-ink hover:bg-retro-select"
              [style.top.px]="60 + i * 48"
              [attr.data-menu-item]="room.id"
              [attr.data-autofocus]="room.id === autofocusRoom() ? '' : null"
              [attr.aria-current]="room.id === joinedRoom() ? 'true' : null"
              [attr.aria-disabled]="offline() ? 'true' : null"
              [attr.aria-label]="room.title + ', ' + roomDetail(room.id)"
              (click)="pickRoom(room)"
            >
              <span class="block" [class.hidden]="focusedRoom() !== room.id">
                <svg aria-hidden="true" viewBox="0 0 4 7" class="absolute top-[10px] left-[10px] h-[21px] w-[12px] fill-retro-accent-text"><path d="M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" /></svg>
              </span>
              <span aria-hidden="true" class="absolute top-0 left-[32px] block h-6 w-[196px] text-xl leading-6 font-bold whitespace-nowrap" [class]="offline() ? 'text-retro-muted' : 'text-retro-ink'">{{ room.title }}</span>
              <span aria-hidden="true" class="absolute top-[22px] left-[32px] block h-5 w-[228px] overflow-hidden text-sm leading-5 whitespace-nowrap text-retro-muted">{{ roomDetail(room.id) }}</span>
              <span class="block" [class.hidden]="room.id !== joinedRoom()">
                <span aria-hidden="true" class="absolute top-[6px] left-[240px] block size-3 rounded-full bg-retro-accent-text"></span>
              </span>
            </button>
          </li>
        }
      </ul>
    </app-retro-box>

    <app-retro-box class="absolute top-[24px] left-[348px]" [width]="904" [height]="596">
      <section aria-label="Chat room" class="block">
        <!-- Until a room is joined: why not (offline, joining, refused) or how to join one. -->
        <div class="block" [class.hidden]="joined()">
          <app-pixel-icon class="absolute top-[140px] left-[386px]" [name]="'chats'" [size]="120" [muted]="true" />
          <p role="status" class="absolute top-[292px] left-[46px] block h-8 w-[800px] text-center text-2xl leading-8" [class]="store.joinError() && !joining() ? 'text-retro-danger' : 'text-retro-ink'">{{ idleMessage() }}</p>
        </div>

        <div class="block" [class.hidden]="!joined()">
          <h2 class="absolute top-[12px] left-[16px] block h-11 w-[448px] overflow-hidden text-3xl leading-[44px] font-bold whitespace-nowrap">{{ roomTitle() }}</h2>
          <!-- ZL presses this, so the d-pad can still reach it (the only way to the list by touch too). -->
          <button
            #usersButton
            type="button"
            [class]="secondaryClass"
            class="absolute top-[10px] left-[480px] h-12 w-[224px] p-0 text-xl"
            aria-controls="room-users"
            [attr.aria-pressed]="usersShown()"
            (click)="toggleUsers(false)"
          >
            <span aria-hidden="true" class="absolute top-[10px] left-[10px] block h-6 w-9 rounded-sm bg-retro-select text-center text-sm leading-6 font-bold">ZL</span>
            <span class="absolute top-0 left-[52px] block h-11 w-[160px] text-center leading-[44px]">{{ usersShown() ? 'Back to chat' : 'Users (' + store.userCount() + ')' }}</span>
          </button>
          <!-- L presses this, so the d-pad skips it (data-kb-skip); the button shows it in a pill. -->
          <button
            type="button"
            data-kb-skip
            [class]="secondaryClass"
            class="absolute top-[10px] left-[716px] h-12 w-[160px] p-0 text-xl"
            [attr.aria-label]="'Leave ' + roomTitle()"
            (click)="leaveRoom()"
          >
            <span aria-hidden="true" class="absolute top-[10px] left-[10px] block h-6 w-9 rounded-sm bg-retro-select text-center text-sm leading-6 font-bold">L</span>
            <span class="absolute top-0 left-[52px] block h-11 w-[96px] text-center leading-[44px]">Leave</span>
          </button>

          <!-- Shown and hidden through normal-flow wrappers, the toggle that holds on Brewser. -->
          <div class="block" [class.hidden]="!logShown()">
            <app-chat-message-list class="absolute top-[72px] left-[12px]" [messages]="store.messages()" [visible]="logShown() && !typing()" />
          </div>
          <div class="block" [class.hidden]="!usersShown()">
            <app-chat-user-list
              id="room-users"
              class="absolute top-[72px] left-[12px] h-[420px] w-[868px]"
              [users]="store.users()"
              [count]="store.userCount()"
              [visible]="usersShown() && !typing()"
              (appBack)="backToChat()"
            />
          </div>

          <span aria-hidden="true" [class]="pill" class="top-[520px] left-[12px]">ZR</span>
          <app-keyboard-field
            class="absolute top-[508px] left-[56px]"
            label="Message"
            [placeholder]="'Say something in ' + roomTitle()"
            textSize="text-lg"
            [width]="824"
            [height]="52"
            [maxLength]="maxMessageLength"
            [clearOnAccept]="true"
            (accepted)="say($event)"
          />
        </div>
      </section>
    </app-retro-box>
  `,
})
export class ChatsPage {
  protected readonly store = inject(ChatRoomStore);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly keyboard = inject(OnScreenKeyboard);
  private readonly injector = inject(Injector);
  protected readonly rooms = CHAT_ROOMS;
  private readonly roomButtons = viewChildren<ElementRef<HTMLButtonElement>>('roomButton');
  private readonly usersButton = viewChild.required<ElementRef<HTMLButtonElement>>('usersButton');
  private readonly messageList = viewChild.required(ChatMessageList);
  private readonly userList = viewChild.required(ChatUserList);
  private readonly field = viewChild.required(KeyboardField);

  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;
  protected readonly pill = PILL;
  protected readonly maxMessageLength = MAX_MESSAGE_LENGTH;

  protected readonly joined = computed(() => this.store.joinState() === 'joined');
  protected readonly joining = computed(() => this.store.joinState() === 'joining');
  protected readonly roomTitle = computed(() => this.store.room()?.title ?? '');
  /** The room joined, for its ● in the menu. */
  protected readonly joinedRoom = computed(() => (this.joined() ? (this.store.room()?.id ?? null) : null));
  /** Not connected: the player connects from the home screen (as a guest or logging in). */
  protected readonly offline = computed(() => this.store.connectionState().status === 'offline');

  /** The room the controller points at, for its ▶. */
  protected readonly focusedRoom = computed(() => this.navigation.lastFocusedControl()?.getAttribute('data-menu-item') ?? null);
  /** Focus starts on the room joined, or the first one. */
  protected readonly autofocusRoom = computed(() => this.store.room()?.id ?? this.rooms[0].id);

  /**
   * Once joined, the user list stays mounted and is shown in place of the log on demand (display:
   * none otherwise), which avoids the two-step removal a scroll region otherwise needs on Brewser.
   */
  protected readonly view = signal<ChatView>('chat');
  protected readonly usersShown = computed(() => this.joined() && this.view() === 'users');
  protected readonly logShown = computed(() => this.joined() && this.view() === 'chat');
  /**
   * The keyboard is open over the page, and the log hidden behind it (see ScrollRegion): once it
   * closes, the log catches up with the messages that came meanwhile.
   */
  protected readonly typing = computed(() => this.keyboard.entry() !== null);

  protected readonly idleMessage = computed(() => {
    if (this.offline()) return 'Offline: connect from the menu to chat.';
    if (this.joining()) return `Joining ${this.roomTitle()}…`;
    return this.store.joinError() ?? 'Pick a room and press A to join it.';
  });

  // The button the user pressed may be hidden, so focus moves to what replaces it instead of being
  // lost: the log once joined, or that room's button when back to no room (after leaving, or when
  // the server refuses the join).
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

    // The console buttons, while in a room: ZR writes, ZL shows or hides the users, L leaves.
    const unregister = [
      this.navigation.registerButton('buttonZR', () => {
        if (this.joined()) this.field().edit();
        return true;
      }),
      this.navigation.registerButton('buttonZL', () => {
        if (this.joined()) this.toggleUsers(true);
        return true;
      }),
      this.navigation.registerButton('buttonL', () => {
        if (this.store.room()) this.leaveRoom();
        return true;
      }),
    ];
    // Leaving the page leaves the room: its traffic would keep the console busy for nothing.
    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      this.store.leave();
    });
  }

  /** The line under a room's name in the menu. */
  protected roomDetail(id: string): string {
    if (this.offline()) return 'Needs connection';
    if (this.store.room()?.id !== id) return 'Join';
    if (this.joining()) return 'Joining…';
    return this.store.connectionState().status === 'connected' ? `Joined · ${this.store.userCount()} users` : 'Reconnecting…';
  }

  /** Joins the room (leaving the one joined, if another), or goes to its log if already in it. */
  protected pickRoom(room: ChatRoom): void {
    if (this.offline()) return;
    const current = this.store.room();
    if (current?.id === room.id) {
      if (this.joined()) this.focusShownView();
      return;
    }
    if (current) this.store.leave();
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

  /**
   * Shows the users in place of the log, or back. From ZL, focus follows to the view shown (it may
   * have been on the one now hidden); from the button, it stays on the button.
   */
  protected toggleUsers(moveFocus: boolean): void {
    this.view.set(this.view() === 'users' ? 'chat' : 'users');
    if (moveFocus) afterNextRender(() => this.focusShownView(), { injector: this.injector });
  }

  /** B in the user list: back to the log, with focus on the button that toggles them. */
  protected backToChat(): void {
    this.view.set('chat');
    this.usersButton().nativeElement.focus();
  }

  protected say(text: string): void {
    // The field empties itself (clearOnAccept), ready for the next message.
    this.store.send(text);
  }

  private focusShownView(): void {
    if (this.usersShown()) this.userList().focus();
    else this.messageList().focus();
  }
}
