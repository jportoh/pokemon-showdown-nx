import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Rgba, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { Chip, drawChip, drawGround, drawKeyButton, drawSprite } from '@core/gl/ui/menu-kit';
import { PageBar } from '@core/gl/ui/page-bar';
import { Box, UiContext, keysLegend, label, paragraph, pill } from '@core/gl/ui/retro-kit';
import { ROLE_KEYS } from '@core/input/console-keys';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ServerStats, roomKey } from '@features/connection/server-stats';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { LoginOverlay } from '@features/home/gl/login-overlay';
import { HOME_MENU_ITEMS } from '@features/home/state/home-menu';
import { CHAT_ROOMS } from '@features/lobby/data/chat-rooms';
import { ChatLogView, ChatUsersView } from '@features/lobby/gl/chat-log-view';
import { ChatRoom } from '@features/lobby/models/chat';
import { ChatRoomStore } from '@features/lobby/state/chat-room-store';

/** Showdown's limit for a chat message. */
const MAX_MESSAGE_LENGTH = 300;
/** The rooms' cards on the left, as many as fit (the window scrolls with the focus). */
const ROOM = { x: 40, y: 100, w: 380, h: 64, step: 72 };
const ROOMS_SHOWN = 7;
/** The room's panel on the right, and inside it the log (or the users) and the message field. */
const PANEL: Box = { x: 448, y: 96, w: 784, h: 548 };
const VIEW_BOX: Box = { x: 464, y: 188, w: 752, h: 356 };
const FIELD: Box = { x: 468, y: 562, w: 744, h: 60 };
const FOOTER_Y = 668;
/** The cards slide in one after another on arrival; the page fades out on leaving. */
const INTRO_MS = 380;
const LEAVE_MS = 180;

/**
 * Chats, drawn on the stage in the menu's style: the rooms as cards on the left (each its Pokémon and
 * how many are in it, from `/cmd rooms`) and the room joined on the right (one at a time), in a panel
 * with Chats' colour: its log, or its users on demand (ZL), and a field to write in with the canvas
 * keyboard (+). Before a room is joined, the panel shows the focused one. L leaves
 * the room, as does picking another one or leaving the page (a room joined off this page would only
 * cost the console the work of its traffic). The d-pad scrolls the log or the users while they have
 * the focus, and goes on past their ends. Our own lines stand out, and the ones that say our name.
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
  private readonly stats = inject(ServerStats);
  private readonly login = inject(ShowdownLogin);

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
  /** Our name, to mark our lines and the ones that say it (none until we have one). */
  private readonly me = computed(() => {
    const login = this.login.state();
    return login.status === 'named' ? login.name : '';
  });
  private readonly usersShown = signal(false);
  /** Why there's no room in the panel, when it's something to say (offline, joining, refused). */
  private readonly status = computed((): { text: string; error: boolean } | null => {
    if (this.offline()) return { text: `Offline: press ZR to log in (or connect as a guest) and chat.`, error: false };
    if (this.joining()) return { text: `Joining ${this.roomTitle()}…`, error: false };
    const error = this.store.joinError();
    return error ? { text: error, error: true } : null;
  });

  /** The message being written (kept when the keyboard is cancelled, emptied once sent). */
  private draft = '';
  private lastJoinState = this.store.joinState();
  /** The room whose card gets the focus back if the join ends without a room (refused, or left). */
  private roomOnIdle: string | null = null;
  /** The room the panel showed last (it stays while the focus is off the cards). */
  private previewed: ChatRoom = this.store.room() ?? CHAT_ROOMS[0];
  /** The first room shown in the menu. */
  private roomStart = 0;
  private logOnJoin = false;
  private leaving: { at: number } | null = null;
  private readonly start = performance.now();
  /** Each control's eased focus, by ID. */
  private readonly focusAnim = new Map<string, number>();

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => !this.leaving && this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    // How many are in each room, while the page is open.
    const unwatch = this.stats.watch();
    // Focus starts on the room joined, or the first one.
    this.focus.focus(`room-${this.store.room()?.id ?? CHAT_ROOMS[0].id}`);
    // The console buttons, while in a room: ROLE_KEYS.chatWrite writes (+;
    // offline, ZR opens the login box), ZL shows or hides the users, L leaves.
    const write = () => {
      if (this.joined()) this.write();
      return true;
    };
    const release = [
      this.navigation.registerButton('buttonZR', () => this.loginBox.pressZR() || true),
      this.navigation.registerButton(ROLE_KEYS.chatWrite.button, write),
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
      unwatch();
      release.forEach((fn) => fn());
      this.keyboard.close(null);
      this.store.leave();
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
    // Offline, a room asks to log in first (as ZR does).
    if (this.offline()) {
      this.loginBox.pressZR();
      return;
    }
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

  /** The join went on (joined: the log gets the focus) or ended without a room (its card does). */
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
    const { renderer, now, dt } = frame;
    this.followJoin();
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    const ease = 1 - Math.exp(-dt * 14);
    const age = now - this.start;
    const intro = (delay: number): number => 1 - Math.pow(1 - clamp01((age - delay) / INTRO_MS), 3);

    drawGround(ctx, 1);
    this.bar.drawHeader(ctx, { title: 'CHATS', icon: 'chats', back: () => this.onAction('back') });
    const plate = this.plate(p.appearance);
    this.drawRooms(ctx, plate, ease, intro);
    this.drawPanel(ctx, plate, intro(120));
    this.drawFooter(ctx);
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

  /** Chats' colour on the home menu, which the cards and the panel fade into. */
  private plate(appearance: 'light' | 'dark'): Rgba {
    const item = HOME_MENU_ITEMS.find((it) => it.id === 'chats');
    return item ? rgba(item.plate[appearance]) : this.theme.palette().rim;
  }

  /** A control's eased focus. */
  private eased(id: string, ease: number): number {
    const previous = this.focusAnim.get(id) ?? 0;
    const value = previous + ((this.focus.focused === id ? 1 : 0) - previous) * ease;
    this.focusAnim.set(id, value);
    return value;
  }

  /** How many are in a room: the room joined counts live, the others come from `/cmd rooms`. */
  private usersIn(room: ChatRoom): number | null {
    if (this.joined() && this.store.room()?.id === room.id) return this.store.userCount();
    return this.stats.rooms().get(roomKey(room.title))?.users ?? null;
  }

  /** What a room is about: the server's description, or ours until it arrives. */
  private descOf(room: ChatRoom): string {
    return this.stats.rooms().get(roomKey(room.title))?.desc || room.desc;
  }

  /** The rooms as cards: the focused one lit and nudged right, the joined one tinted with a chip. */
  private drawRooms(ctx: UiContext, plate: Rgba, ease: number, intro: (delay: number) => number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const offline = this.offline();
    const current = this.store.room()?.id ?? null;
    // A window of the rooms that follows the focus; arrows say there's more.
    const focusedIndex = CHAT_ROOMS.findIndex((room) => `room-${room.id}` === this.focus.focused);
    if (focusedIndex !== -1) this.revealRoom(focusedIndex);
    const end = Math.min(CHAT_ROOMS.length, this.roomStart + ROOMS_SHOWN);
    for (let i = this.roomStart; i < end; i++) {
      const room = CHAT_ROOMS[i];
      const id = `room-${room.id}`;
      const k = i - this.roomStart;
      const box = { x: ROOM.x, y: ROOM.y + k * ROOM.step, w: ROOM.w, h: ROOM.h };
      this.focus.control({
        id,
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
      const f = this.eased(id, ease);
      const alpha = intro(k * 40);
      const a = (color: Rgba, extra = 1): Rgba => withAlpha(color, alpha * extra);
      const here = room.id === current && this.joined();
      const x = box.x + 8 * f - (1 - alpha) * 60;
      if (f > 0.01) renderer.rect(x, box.y + 10, box.w, box.h, { fill: [0, 0, 0, 0.2 * f * alpha], radius: 14, softness: 18 });
      const body = mixRgba(p.panel, p.select, f);
      renderer.rect(x, box.y, box.w, box.h, {
        fill: a(body),
        fillEnd: a(here || f > 0.01 ? mixRgba(body, plate, Math.max(f, here ? 1 : 0)) : body),
        stroke: a(mixRgba(p.rim, p.accentText, f)),
        border: 1 + 2 * f,
        radius: 14,
      });
      // The room's Pokémon in a small plate of Chats' colour.
      const art = { x: x + 6, y: box.y + 5, w: 54, h: 54 };
      renderer.rect(art.x, art.y, art.w, art.h, { fill: a(plate), radius: 12 });
      renderer.clip(art);
      drawSprite(ctx, room.art, art.x - 5, art.y - 8, 64, alpha * (offline ? 0.5 : 1));
      renderer.clip(null);

      const chip: Chip | null = here ? { text: 'Joined', tone: 'muted' } : room.lang ? { text: room.lang, tone: 'faded' } : null;
      const chipW = chip ? ctx.text.measure(chip.text, { size: 15, bold: true }) + 24 : 0;
      const textW = box.w - 74 - (chip ? chipW + 24 : 16);
      label(ctx, room.title, x + 74, box.y + 22, { size: 21, bold: true }, a(offline ? p.muted : p.ink), { maxWidth: textW });
      label(ctx, this.roomDetail(room), x + 74, box.y + 46, { size: 14 }, a(p.muted), { maxWidth: textW, fast: true });
      if (chip) drawChip(ctx, chip, x + box.w - 16 - chipW, box.y + box.h / 2, alpha, 26);
    }
    if (this.roomStart > 0) label(ctx, '▲', ROOM.x + ROOM.w - 12, ROOM.y - 12, { size: 16, bold: true }, p.accentText, { align: 'center' });
    if (end < CHAT_ROOMS.length) {
      label(ctx, `▼ ${CHAT_ROOMS.length - end} more`, ROOM.x + ROOM.w / 2, ROOM.y + ROOMS_SHOWN * ROOM.step + 6, { size: 16, bold: true }, p.accentText, { align: 'center' });
    }
  }

  /** Moves the rooms' window so room `index` shows. */
  private revealRoom(index: number): void {
    if (index < this.roomStart) this.roomStart = index;
    if (index >= this.roomStart + ROOMS_SHOWN) this.roomStart = index - ROOMS_SHOWN + 1;
    this.roomStart = Math.max(0, Math.min(this.roomStart, CHAT_ROOMS.length - ROOMS_SHOWN));
  }

  /** The line under a room's name: how many are in it, and whether we are. */
  private roomDetail(room: ChatRoom): string {
    if (this.offline()) return 'Needs connection';
    const users = this.usersIn(room);
    const count = users === null ? '' : `${users} users`;
    if (this.store.room()?.id !== room.id) return count || 'Join';
    if (this.joining()) return 'Joining…';
    if (this.store.connectionState().status !== 'connected') return 'Reconnecting…';
    return count ? `You are here · ${count}` : 'You are here';
  }

  /** The panel: the room joined, or (before joining) the room focused, shown big. */
  private drawPanel(ctx: UiContext, plate: Rgba, alpha: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const { x, y, w, h } = PANEL;
    renderer.rect(x, y + 12, w, h, { fill: [0, 0, 0, 0.2 * alpha], radius: 22, softness: 30 });
    renderer.rect(x, y, w, h, {
      fill: withAlpha(mixRgba(plate, p.panel, 0.25), alpha),
      fillEnd: withAlpha(p.panel, alpha),
      stroke: withAlpha(p.rim, alpha),
      border: 1,
      radius: 22,
    });
    if (this.joined()) this.drawRoom(ctx);
    else this.drawPreview(ctx, alpha);
  }

  private drawRoom(ctx: UiContext): void {
    const p = ctx.palette;
    const room = this.store.room();
    const titleW = label(ctx, this.roomTitle(), PANEL.x + 28, PANEL.y + 32, { size: 30, bold: true }, p.ink, { maxWidth: 300 });
    drawChip(ctx, { text: `${this.store.userCount()} users`, tone: 'muted' }, PANEL.x + 42 + titleW, PANEL.y + 33, 1, 28, 120);
    if (room) label(ctx, this.descOf(room), PANEL.x + 30, PANEL.y + 66, { size: 15 }, p.muted, { maxWidth: 400 });

    const usersShown = this.usersShown();
    // ZL presses Users, and so can the d-pad (the only way to the list by touch too); L is Leave's.
    const leave = { x: PANEL.x + PANEL.w - 20 - 120, y: PANEL.y + 16, w: 120, h: 46 };
    const usersW = usersShown ? 176 : 128;
    drawKeyButton(ctx, 'users-button', { x: leave.x - 12 - usersW, y: leave.y, w: usersW, h: 46 }, 'ZL', usersShown ? 'Back to chat' : 'Users', () => this.toggleUsers(false), false);
    drawKeyButton(ctx, 'leave', leave, 'L', 'Leave', () => this.leaveRoom());

    if (usersShown) this.usersView.draw(ctx, VIEW_BOX, this.store.users(), this.store.userCount());
    else this.log.draw(ctx, VIEW_BOX, this.store.messages(), this.me());
    this.drawMessageField(ctx);
  }

  /** The message field: our draft or what to write, the button that opens the keyboard at its right. */
  private drawMessageField(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const focused = ctx.focus.control({ id: 'message', ...FIELD, accept: () => this.write() });
    renderer.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h, { fill: p.input, stroke: focused ? p.accentText : p.rim, border: focused ? 4 : 2, radius: 14 });
    const cy = FIELD.y + FIELD.h / 2;
    const key = ROLE_KEYS.chatWrite.label;
    const writeW = ctx.text.measure('Write', { size: 17, bold: true });
    label(ctx, 'Write', FIELD.x + FIELD.w - 16 - writeW, cy, { size: 17, bold: true }, p.ink);
    const keyW = Math.max(28, ctx.text.measure(key, { size: 15, bold: true }) + 16);
    const keyX = FIELD.x + FIELD.w - 16 - writeW - 10 - keyW;
    pill(ctx, key, keyX, cy, 28);
    const room = keyX - FIELD.x - 40;
    if (this.draft) label(ctx, this.draft, FIELD.x + 20, cy, { size: 20 }, p.ink, { maxWidth: room, fast: true });
    else label(ctx, `Say something in ${this.roomTitle()}`, FIELD.x + 20, cy, { size: 20 }, p.muted, { maxWidth: room });
  }

  /** Before joining: the focused room big (its Pokémon, name, people and what it's about), and why there's no room yet. */
  private drawPreview(ctx: UiContext, alpha: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const focused = CHAT_ROOMS.find((room) => `room-${room.id}` === this.focus.focused);
    if (focused) this.previewed = focused;
    const room = this.previewed;
    const a = (color: Rgba, extra = 1): Rgba => withAlpha(color, alpha * extra);
    renderer.clip({ x: PANEL.x + 2, y: PANEL.y + 2, w: PANEL.w - 4, h: PANEL.h - 4 });
    drawSprite(ctx, room.art, PANEL.x + PANEL.w - 320, PANEL.y + PANEL.h - 310, 340, alpha * (p.appearance === 'light' ? 0.6 : 0.45));
    renderer.clip(null);
    const left = PANEL.x + 36;
    label(ctx, 'ROOM', left, PANEL.y + 44, { size: 14, bold: true }, a(p.muted));
    label(ctx, room.title, left, PANEL.y + 94, { size: 52, bold: true }, a(p.ink), { maxWidth: 560 });
    let cx = left;
    const users = this.offline() ? null : this.usersIn(room);
    if (users !== null) cx += drawChip(ctx, { text: `${users} users`, tone: 'muted' }, cx, PANEL.y + 152, alpha, 30) + 8;
    if (room.lang) drawChip(ctx, { text: room.lang, tone: 'faded' }, cx, PANEL.y + 152, alpha, 30);
    // Under the chips, or in their place when there are none (offline, counts not in yet).
    const chips = users !== null || room.lang !== undefined;
    paragraph(ctx, this.descOf(room), left + 2, PANEL.y + (chips ? 200 : 146), 420, 30, { size: 21 }, a(p.ink), 5);
    const status = this.status();
    if (status) paragraph(ctx, status.text, left + 2, PANEL.y + PANEL.h - 86, 460, 28, { size: 19, bold: true }, a(status.error ? p.danger : p.ink), 2);
  }

  /** What the focused control is for, and the buttons that work there. */
  private drawFooter(ctx: UiContext): void {
    const p = ctx.palette;
    const focused = this.focus.focused ?? '';
    const room = CHAT_ROOMS.find((r) => `room-${r.id}` === focused);
    const write = ROLE_KEYS.chatWrite.label;
    let hint = '';
    let keys: [string, string][];
    if (room) {
      hint = this.offline()
        ? 'Rooms need a connection.'
        : this.store.room()?.id === room.id
          ? `You are in ${room.title}.`
          : 'One room at a time: joining one leaves the other.';
      keys = this.offline() ? [['ZR', 'Log in'], ['B', 'Menu']] : [['A', this.store.room()?.id === room.id ? 'Go to the chat' : 'Join'], ['B', 'Menu']];
    } else if (focused === 'log') {
      hint = this.me() ? 'The latest 30 messages. Lines that say your name are marked.' : 'The latest 30 messages.';
      keys = [['▲▼', 'Scroll'], [write, 'Write'], ['ZL', 'Users'], ['L', 'Leave']];
    } else if (focused === 'users') {
      hint = 'Everyone in the room, the staff first.';
      keys = [['▲▼', 'Scroll'], ['ZL', 'Chat'], ['B', 'Chat']];
    } else if (focused === 'message') {
      hint = 'The on-screen keyboard opens to write your message.';
      keys = [['A', 'Write'], ['B', 'Menu']];
    } else {
      keys = [['A', 'Select'], ['B', 'Menu']];
    }
    const x = keysLegend(ctx, keys, 1232, FOOTER_Y);
    label(ctx, hint, 48, FOOTER_Y, { size: 16 }, p.muted, { maxWidth: x - 72 });
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
