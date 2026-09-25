import { Component, computed, input } from '@angular/core';
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
  host: { class: 'block bg-[#0f141c]' },
  // Brewser layout rules this follows (seen on device): fixed heights (28px title + 536px list =
  // the 564px room view); plain block rows with no truncation (flex rows inserted dynamically break,
  // and overflow clipping on the rows is being ruled out); padding as the shorthand (p-* utilities) on the rows
  // (longhands lose to the preflight's `padding: 0` shorthand on Brewser); no inline svg in a row (it
  // wrapped), so away users are italic, as in the official client, and labelled for screen readers.
  template: `
    <h2 id="chat-user-count" class="h-7 p-[4px_0] text-center text-gray-200">{{ count() }} users</h2>
    <ul
      appScrollRegion
      aria-labelledby="chat-user-count"
      tabindex="0"
      class="h-[536px] overflow-y-auto text-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    >
      @for (user of visibleUsers(); track user.id) {
        <li class="p-[0_12px] leading-relaxed" [attr.aria-label]="user.away ? user.name + ' (away)' : null">
          <span class="text-gray-300">{{ user.rank === ' ' ? ' ' : user.rank }}</span
          ><span
            [class]="user.name | usernameColor"
            [class.font-bold]="isStaff(user)"
            [class.italic]="user.away"
            >{{ user.name }}</span
          >
        </li>
      }
      @if (hiddenCount() > 0) {
        <li class="p-[4px_12px] text-base text-gray-400">…and {{ hiddenCount() }} more</li>
      }
    </ul>
  `,
})
export class ChatUserList {
  readonly users = input.required<ChatUser[]>();
  /** Total from the server, which can exceed the listed users. */
  readonly count = input.required<number>();

  protected readonly visibleUsers = computed(() => this.users().slice(0, MAX_VISIBLE_USERS));
  protected readonly hiddenCount = computed(() => Math.max(0, this.count() - this.visibleUsers().length));

  protected isStaff(user: ChatUser): boolean {
    return STAFF_RANKS.includes(user.rank);
  }
}
