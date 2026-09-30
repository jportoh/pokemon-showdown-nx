import { Component, ElementRef, afterRenderEffect, computed, input, viewChild } from '@angular/core';
import { ChatUser, UserRank } from '@features/lobby/models/chat';
import { ScrollRegion } from '@shared/directives/scroll-region';
import { UsernameColorPipe } from '@shared/utils/username-color-pipe';

const STAFF_RANKS: UserRank[] = ['~', '&', '#', '@'];
/**
 * Rows actually rendered. The lobby has ~600 users, too many DOM nodes for slow devices (the Brewser
 * console); the list is sorted by rank, so staff always stay visible.
 */
const MAX_VISIBLE_USERS = 50;

@Component({
  imports: [ScrollRegion, UsernameColorPipe],
  selector: 'app-chat-user-list',
  host: { class: 'block' },
  // Brewser layout rules this follows (seen on device): fixed heights (28px title + 392px list =
  // the Chats page's 420px room view); the same structure as the chat log, which shows on the console:
  // a scroll box holding an inner block with the padding and the rows (with the rows straight in the
  // scroll box, the list came out blank when shown); plain block rows with no truncation (flex rows
  // inserted dynamically break); padding as the shorthand (p-* utilities), since longhands lose to the
  // preflight's `padding: 0` shorthand on Brewser; no inline svg in a row (it wrapped), so away users
  // are italic, as in the official client, and labelled for screen readers.
  template: `
    <h2 id="chat-user-count" class="h-7 p-[2px_0] text-center text-retro-muted">{{ count() }} users</h2>
    <div
      #list
      appScrollRegion
      role="region"
      aria-labelledby="chat-user-count"
      tabindex="0"
      class="h-[392px] w-[868px] overflow-y-auto rounded-md bg-retro-input text-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    >
      <ul class="block p-[8px_12px]">
        @for (user of visibleUsers(); track user.id) {
          <li class="block leading-relaxed" [attr.aria-label]="user.away ? user.name + ' (away)' : null">
            <span class="text-retro-muted">{{ user.rank === ' ' ? ' ' : user.rank }}</span
            ><span
              [class]="user.name | usernameColor"
              [class.font-bold]="isStaff(user)"
              [class.italic]="user.away"
              >{{ user.name }}</span
            >
          </li>
        }
        @if (hiddenCount() > 0) {
          <li class="block p-[4px_0] text-base text-retro-muted">…and {{ hiddenCount() }} more</li>
        }
      </ul>
    </div>
  `,
})
export class ChatUserList {
  readonly users = input.required<ChatUser[]>();
  /** Total from the server, which can exceed the listed users. */
  readonly count = input.required<number>();
  /** False while the list is hidden (behind the log or the keyboard); it repaints once shown again. */
  readonly visible = input(true);

  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private repainted = false;

  protected readonly visibleUsers = computed(() => this.users().slice(0, MAX_VISIBLE_USERS));
  protected readonly hiddenCount = computed(() => Math.max(0, this.count() - this.visibleUsers().length));

  constructor() {
    // A scroll box shown after its rows were rendered can stay blank on Brewser: each time the list
    // is shown, hiding and showing it once forces a fresh paint (as the chat log does with its history).
    afterRenderEffect(() => {
      if (!this.visible()) {
        this.repainted = false;
        return;
      }
      if (this.repainted) return;
      this.repainted = true;
      const el = this.list().nativeElement;
      el.style.display = 'none';
      void el.offsetHeight;
      el.style.display = '';
    });
  }

  /** Moves keyboard focus to the list (it's focusable so it can be scrolled with the keyboard). */
  focus(): void {
    this.list().nativeElement.focus();
  }

  protected isStaff(user: ChatUser): boolean {
    return STAFF_RANKS.includes(user.rank);
  }
}
