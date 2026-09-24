import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LOBBY_ROOM_ID, splitLine } from '@features/connection/showdown-protocol';
import { ChatMessage, ChatUser } from '@features/lobby/models/chat';
import { filter } from 'rxjs';
import { compareUsers, parseUserEntry } from './chat-users';

// Rendering budget for slow devices (the Brewser console): the busy lobby sends many small frames,
// so server lines are buffered and applied in batches, and the user list is republished less often.
/** Buffered lines are applied at most this often. */
const FLUSH_INTERVAL_MS = 150;
/** Joins/leaves are frequent and low priority: the sorted user list is republished at most this often. */
const USERS_PUBLISH_INTERVAL_MS = 1000;
/** Visible history; older messages are dropped. The log shows ~20 at a time. */
const MAX_MESSAGES = 50;

/**
 * Read-only state of the Showdown lobby room: who is in it and the recent chat. Joins the lobby
 * whenever the server connection (re)opens and applies the room's protocol messages in batches.
 */
@Service()
export class LobbyChatStore {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);

  // Mutated in place while applying lines; published to signals on a slower cadence.
  private readonly usersById = new Map<string, ChatUser>();
  private userTotal = 0;
  private usersDirty = false;

  // Bumped when the (mutable) user map should be republished; see `users`.
  private readonly usersVersion = signal(0);
  private readonly userCountSignal = signal(0);
  private readonly messagesSignal = signal<ChatMessage[]>([]);
  private nextMessageId = 1;

  private pendingLines: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private usersTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Everyone in the lobby, sorted by rank then name. A computed is lazy, so the sort only runs while
   * something displays the list: off the lobby page, joins/leaves cost no sorting at all.
   */
  readonly users = computed(() => {
    this.usersVersion();
    return [...this.usersById.values()].sort(compareUsers);
  });
  /** The server's total, which also counts users not in the list. */
  readonly userCount = this.userCountSignal.asReadonly();
  readonly messages = this.messagesSignal.asReadonly();
  readonly connectionState = this.connection.state;

  constructor() {
    this.connection.frames
      .pipe(
        filter((frame) => frame.roomId === LOBBY_ROOM_ID),
        takeUntilDestroyed(),
      )
      .subscribe((frame) => this.queue(frame.lines));

    const joinLobby = () => this.connection.send('', `/join ${LOBBY_ROOM_ID}`);
    this.connection.opened.pipe(takeUntilDestroyed()).subscribe(joinLobby);
    // Covers a connection some other feature already opened before this store existed.
    if (this.connection.state().status === 'connected') joinLobby();

    inject(DestroyRef).onDestroy(() => {
      if (this.flushTimer !== null) clearTimeout(this.flushTimer);
      if (this.usersTimer !== null) clearTimeout(this.usersTimer);
    });

    this.connection.connect();
  }

  private queue(lines: string[]): void {
    for (const line of lines) this.pendingLines.push(line);
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    const lines = this.pendingLines;
    this.pendingLines = [];
    this.applyLines(lines);
    this.render.request();
  }

  /** Applies a batch of lines: messages are published right away, users on their own cadence. */
  private applyLines(lines: string[]): void {
    let reset = false;
    let fullUserList = false;
    const added: ChatMessage[] = [];

    for (const line of lines) {
      const [type] = splitLine(line);
      switch (type) {
        case 'init':
          reset = true;
          added.length = 0;
          this.usersById.clear();
          this.userTotal = 0;
          this.usersDirty = true;
          break;
        case 'users': {
          const [total, ...entries] = (splitLine(line, 1)[1] ?? '').split(',');
          this.usersById.clear();
          for (const user of entries.map(parseUserEntry)) if (user.id) this.usersById.set(user.id, user);
          this.userTotal = Number(total) || this.usersById.size;
          this.usersDirty = true;
          fullUserList = true;
          break;
        }
        case 'J':
        case 'j': {
          const user = parseUserEntry(splitLine(line, 1)[1] ?? '');
          if (!user.id) break;
          if (!this.usersById.has(user.id)) this.userTotal++;
          this.usersById.set(user.id, user);
          this.usersDirty = true;
          break;
        }
        case 'L':
        case 'l': {
          const user = parseUserEntry(splitLine(line, 1)[1] ?? '');
          if (this.usersById.delete(user.id)) {
            this.userTotal = Math.max(0, this.userTotal - 1);
            this.usersDirty = true;
          }
          break;
        }
        case 'N':
        case 'n': {
          const [, entry = '', oldId = ''] = splitLine(line, 2);
          const user = parseUserEntry(entry);
          this.usersById.delete(oldId);
          if (user.id) this.usersById.set(user.id, user);
          this.usersDirty = true;
          break;
        }
        case 'c': {
          const [, author = '', text = ''] = splitLine(line, 2);
          this.pushMessage(added, author, text);
          break;
        }
        case 'c:': {
          const [, , author = '', text = ''] = splitLine(line, 3);
          this.pushMessage(added, author, text);
          break;
        }
      }
    }

    if (reset || added.length > 0) {
      const base = reset ? [] : this.messagesSignal();
      this.messagesSignal.set([...base, ...added].slice(-MAX_MESSAGES));
    }

    // The first full list shows up immediately; later joins/leaves wait for the next publish slot.
    if (fullUserList) this.publishUsers();
    else if (this.usersDirty) this.usersTimer ??= setTimeout(() => this.publishUsers(), USERS_PUBLISH_INTERVAL_MS);
  }

  private publishUsers(): void {
    if (this.usersTimer !== null) clearTimeout(this.usersTimer);
    this.usersTimer = null;
    this.usersDirty = false;
    this.usersVersion.update((version) => version + 1);
    this.userCountSignal.set(this.userTotal);
    this.render.request();
  }

  /**
   * Adds a chat line as plain text. Commands other than `/me` (e.g. `/raw` or `/uhtml`, which carry
   * server HTML) are skipped: the app never renders HTML from the server.
   */
  private pushMessage(into: ChatMessage[], authorEntry: string, text: string): void {
    let action = false;
    if (text.startsWith('/me ')) {
      action = true;
      text = text.slice(4);
    } else if (text.startsWith('//')) {
      text = text.slice(1);
    } else if (text.startsWith('/')) {
      return;
    }
    const author = parseUserEntry(authorEntry).name;
    into.push({ id: this.nextMessageId++, author, text, action });
  }
}
