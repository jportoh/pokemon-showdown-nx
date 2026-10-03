import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Texture, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { iconTexture } from '@core/gl/gl-textures';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { maskOf } from '@core/gl/ui/masks';
import { PageBar } from '@core/gl/ui/page-bar';
import { Box, UiContext, button, label, pill, retroBox, textField } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { LoginOverlay } from '@features/home/gl/login-overlay';
import { CHAT_ROOMS } from '@features/lobby/data/chat-rooms';
import { ChatLogView, ChatUsersView } from '@features/lobby/gl/chat-log-view';
import { ChatRoom } from '@features/lobby/models/chat';
import { ChatRoomStore } from '@features/lobby/state/chat-room-store';

/** Showdown's limit for a chat message. */
const MAX_MESSAGE_LENGTH = 300;
const ROOMS_BOX: Box = { x: 32, y: 100, w: 300, h: 596 };
const ROOM_BOX: Box = { x: 348, y: 100, w: 904, h: 596 };
/** The rooms' menu: rows big enough to read, as many as fit over the "more" arrow (it scrolls). */
const ROOMS_TOP = ROOMS_BOX.y + 60;
const ROOM_STEP = 68;
const ROOMS_SHOWN = 7;
/** The log or the users, under the room's title. */
const VIEW_BOX: Box = { x: ROOM_BOX.x + 12, y: ROOM_BOX.y + 72, w: 868, h: 420 };
const LEAVE_MS = 180;
const CURSOR = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];

/**
 * Chats, drawn on the stage: a Gen 3 menu of rooms on the left and the room joined on the right (one
 * at a time), with its log, or its users on demand (ZL), and a field to write in with the canvas
 * keyboard (ZR). L leaves the room, as does picking another one or leaving the page (a room joined
 * off this page would only cost the console the work of its traffic). The d-pad scrolls the log or
 * the users while they have the focus, and goes on past their ends.
 */
@Component({
  selector: 'app-chats-scene',
  template: '',
})
export class ChatsScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bar = inject(PageBar);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly store = inject(ChatRoomStore);

  private readonly focus = new CanvasFocus();
  /** Offline, ZR opens the menu's login box over the page. */
  private readonly loginBox = new LoginOverlay(this.focus);
  private readonly log = new ChatLogView();
  private readonly usersView = new ChatUsersView();

  private readonly joined = computed(() => this.store.joinState() === 'joined');
  private readonly joining = computed(() => this.store.joinState() === 'joining');
  private readonly roomTitle = computed(() => this.store.room()?.title ?? '');
  /** Not connected: the player connects from the home screen (as a guest or logging in). */
  private readonly offline = computed(() => this.store.connectionState().status === 'offline');
  private readonly usersShown = signal(false);
  private readonly idleMessage = computed(() => {
    if (this.offline()) return 'Offline: press ZR to log in (or connect as a guest) and chat.';
    if (this.joining()) return `Joining ${this.roomTitle()}…`;
    return this.store.joinError() ?? 'Pick a room and press A to join it.';
  });

  /** The message being written (kept when the keyboard is cancelled, emptied once sent). */
  private draft = '';
  private chatsIcon: Texture | null = null;
  private lastJoinState = this.store.joinState();
  /** The room whose button gets the focus back if the join ends without a room (refused, or left). */
  private roomOnIdle: string | null = null;
  /** The first room shown in the menu. */
  private roomStart = 0;
  private logOnJoin = false;
  private leaving: { at: number } | null = null;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => !this.leaving && this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.stage.whenReady(({ renderer }) => (this.chatsIcon = iconTexture(renderer, 'chats', true)));
    // Focus starts on the room joined, or the first one.
    this.focus.focus(`room-${this.store.room()?.id ?? CHAT_ROOMS[0].id}`);
    // The console buttons, while in a room: ZR writes (offline, it opens the login box), ZL shows or hides the users, L leaves.
    const release = [
      this.navigation.registerButton('buttonZR', () => {
        if (this.loginBox.pressZR()) return true;
        if (this.joined()) this.write();
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
      hide();
      release.forEach((fn) => fn());
      this.keyboard.close(null);
      this.store.leave();
      this.stage.whenReady(({ renderer }) => this.chatsIcon && renderer.deleteTexture(this.chatsIcon));
    });
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    if (action === 'back') {
      if (this.loginBox.back()) return true;
      // From the users: back to the log, on the button that shows them.
      if (this.usersShown() && this.joined()) {
        this.usersShown.set(false);
        this.focus.focus('users-button');
      } else {
        this.leaving = { at: performance.now() };
      }
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  /** Joins the room (leaving the one joined, if another), or goes to its log if already in it. */
  private pickRoom(room: ChatRoom): void {
    if (this.offline()) return;
    const current = this.store.room();
    if (current?.id === room.id) {
      if (this.joined()) this.focus.focus(this.usersShown() ? 'users' : 'log');
      return;
    }
    if (current) this.store.leave();
    this.logOnJoin = true;
    this.roomOnIdle = room.id;
    this.usersShown.set(false);
    this.log.reset();
    this.usersView.reset();
    this.store.join(room);
  }

  private leaveRoom(): void {
    this.logOnJoin = false;
    this.roomOnIdle = this.store.room()?.id ?? null;
    this.store.leave();
  }

  /** The users in place of the log, or back; from ZL the focus follows to the one shown. */
  private toggleUsers(moveFocus: boolean): void {
    this.usersShown.update((shown) => !shown);
    if (this.usersShown()) this.usersView.reset();
    if (moveFocus) this.focus.focus(this.usersShown() ? 'users' : 'log');
  }

  /** The keyboard over the page, for a message: OK sends it. */
  private write(): void {
    this.keyboard.open({
      label: `Message to ${this.roomTitle()}`,
      value: this.draft,
      maxLength: MAX_MESSAGE_LENGTH,
      done: (value) => {
        if (value === null) return;
        const text = value.trim();
        this.draft = '';
        if (text) this.store.send(text);
      },
    });
  }

  /** The join went on (joined: the log gets the focus) or ended without a room (its button does). */
  private followJoin(): void {
    const state = this.store.joinState();
    if (state === this.lastJoinState) return;
    this.lastJoinState = state;
    if (state === 'joined' && this.logOnJoin) {
      this.logOnJoin = false;
      this.roomOnIdle = null;
      this.focus.focus('log');
    } else if (state === 'idle' && this.roomOnIdle !== null) {
      this.focus.focus(`room-${this.roomOnIdle}`);
      this.logOnJoin = false;
      this.roomOnIdle = null;
    }
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    this.followJoin();
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    this.bar.draw(ctx, { title: 'Chats', icon: 'chats', back: () => this.onAction('back') });
    this.drawRooms(ctx);
    this.drawRoom(ctx);
    this.loginBox.draw(ctx);
    if (this.leaving) {
      const t = Math.min(1, (now - this.leaving.at) / LEAVE_MS);
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: withAlpha(p.bg, t) });
      if (t >= 1) {
        this.leaving = null;
        void this.router.navigateByUrl('/');
      }
    }
    this.focus.end();
    renderer.end();
  }

  /** The Gen 3 menu of rooms: the one pointed at with a ▶ and a lit border, the joined one with a dot. */
  private drawRooms(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    retroBox(ctx, ROOMS_BOX);
    label(ctx, 'Rooms', ROOMS_BOX.x + 20, ROOMS_BOX.y + 34, { size: 30, bold: true }, p.ink);
    const offline = this.offline();
    const current = this.store.room()?.id ?? null;
    // A window of the rooms, big enough to read, that follows the focus; arrows say there's more.
    const focusedIndex = CHAT_ROOMS.findIndex((room) => `room-${room.id}` === this.focus.focused);
    if (focusedIndex !== -1) this.revealRoom(focusedIndex);
    const end = Math.min(CHAT_ROOMS.length, this.roomStart + ROOMS_SHOWN);
    for (let i = this.roomStart; i < end; i++) {
      const room = CHAT_ROOMS[i];
      const box = { x: ROOMS_BOX.x + 8, y: ROOMS_TOP + (i - this.roomStart) * ROOM_STEP, w: 272, h: ROOM_STEP - 4 };
      const focused = this.focus.control({
        id: `room-${room.id}`,
        ...box,
        accept: () => this.pickRoom(room),
        // Past the rows shown: on to the next room (the window follows).
        move: (direction) => {
          const next = direction === 'down' && i === end - 1 ? i + 1 : direction === 'up' && i === this.roomStart ? i - 1 : -1;
          if (next < 0 || next >= CHAT_ROOMS.length) return false;
          this.focus.focus(`room-${CHAT_ROOMS[next].id}`);
          this.revealRoom(next);
          return true;
        },
      });
      renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.accentText : p.panel, radius: 8, border: 2 });
      if (focused) renderer.image(maskOf(renderer, CURSOR), box.x + 10, box.y + 16, 3, p.accentText);
      label(ctx, room.title, box.x + 32, box.y + 20, { size: 24, bold: true }, offline ? p.muted : p.ink, { maxWidth: 200 });
      label(ctx, this.roomDetail(room.id), box.x + 32, box.y + 46, { size: 17 }, p.muted, { maxWidth: 228, fast: true });
      if (room.id === current && this.joined()) renderer.rect(box.x + 246, box.y + 8, 14, 14, { fill: p.accentText, radius: 7 });
    }
    const arrowX = ROOMS_BOX.x + ROOMS_BOX.w - 30;
    if (this.roomStart > 0) label(ctx, '▲', arrowX, ROOMS_BOX.y + 34, { size: 22, bold: true }, p.accentText, { align: 'center' });
    if (end < CHAT_ROOMS.length) label(ctx, `▼ ${CHAT_ROOMS.length - end} more`, ROOMS_BOX.x + ROOMS_BOX.w / 2, ROOMS_BOX.y + ROOMS_BOX.h - 20, { size: 18, bold: true }, p.accentText, { align: 'center' });
  }

  /** Moves the rooms' window so room `index` shows. */
  private revealRoom(index: number): void {
    if (index < this.roomStart) this.roomStart = index;
    if (index >= this.roomStart + ROOMS_SHOWN) this.roomStart = index - ROOMS_SHOWN + 1;
    this.roomStart = Math.max(0, Math.min(this.roomStart, CHAT_ROOMS.length - ROOMS_SHOWN));
  }

  /** The line under a room's name in the menu. */
  private roomDetail(id: string): string {
    if (this.offline()) return 'Needs connection';
    if (this.store.room()?.id !== id) return 'Join';
    if (this.joining()) return 'Joining…';
    return this.store.connectionState().status === 'connected' ? `Joined · ${this.store.userCount()} users` : 'Reconnecting…';
  }

  private drawRoom(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    retroBox(ctx, ROOM_BOX);
    if (!this.joined()) {
      if (this.chatsIcon) renderer.image(this.chatsIcon, ROOM_BOX.x + 392, ROOM_BOX.y + 140, 5);
      const error = this.store.joinError() !== null && !this.joining();
      label(ctx, this.idleMessage(), ROOM_BOX.x + ROOM_BOX.w / 2, ROOM_BOX.y + 308, { size: 24 }, error ? p.danger : p.ink, { align: 'center', maxWidth: 800 });
      return;
    }
    label(ctx, this.roomTitle(), ROOM_BOX.x + 16, ROOM_BOX.y + 34, { size: 30, bold: true }, p.ink, { maxWidth: 448 });
    const usersShown = this.usersShown();
    // ZL presses this, and so can the d-pad (the only way to the list by touch too).
    button(ctx, 'users-button', { x: ROOM_BOX.x + 480, y: ROOM_BOX.y + 10, w: 224, h: 48 }, usersShown ? 'Back to chat' : `Users (${this.store.userCount()})`, {
      shortcut: 'ZL',
      size: 20,
      accept: () => this.toggleUsers(false),
    });
    button(ctx, 'leave', { x: ROOM_BOX.x + 716, y: ROOM_BOX.y + 10, w: 160, h: 48 }, 'Leave', { shortcut: 'L', skip: true, size: 20, accept: () => this.leaveRoom() });

    if (usersShown) {
      label(ctx, `${this.store.userCount()} users`, VIEW_BOX.x + VIEW_BOX.w / 2, VIEW_BOX.y + 14, { size: 16 }, p.muted, { align: 'center', fast: true });
      this.usersView.draw(ctx, { ...VIEW_BOX, y: VIEW_BOX.y + 28, h: VIEW_BOX.h - 28 }, this.store.users(), this.store.userCount());
    } else {
      this.log.draw(ctx, VIEW_BOX, this.store.messages());
    }

    pill(ctx, 'ZR', ROOM_BOX.x + 12, ROOM_BOX.y + 534, 28);
    textField(ctx, 'message', { x: ROOM_BOX.x + 56, y: ROOM_BOX.y + 508, w: 824, h: 52 }, this.draft, {
      placeholder: `Say something in ${this.roomTitle()}`,
      edit: () => this.write(),
    });
  }
}
