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
  host: { class: 'flex flex-col bg-[#0f141c]' },
  // Fixed heights matching the lobby chat panel (28px title + 616px list = 644px): Brewser
  // mis-sizes percentage and flex-grown boxes whose content is inserted after load. See styles.css.
  template: `
    <h2 id="chat-user-count" class="h-7 py-1 text-center text-gray-200">{{ count() }} users</h2>
    <ul
      appScrollRegion
      aria-labelledby="chat-user-count"
      tabindex="0"
      class="h-[616px] overflow-y-auto px-1.5 pb-2 text-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    >
      @for (user of visibleUsers(); track user.id) {
        <li class="flex items-center leading-relaxed">
          <span class="w-4 shrink-0 text-center text-gray-300">{{ user.rank }}</span>
          <span
            class="truncate"
            [class]="user.name | usernameColor"
            [class.font-bold]="isStaff(user)"
            [class.italic]="user.away"
          >{{ user.name }}</span>
          @if (user.away) {
            <!--
              A flex sibling rather than inline in the name: Brewser wraps an inline svg onto a new
              line despite nowrap. Labelled icon rather than sr-only text, which Brewser doesn't fully hide.
            -->
            <svg role="img" aria-label="(away)" viewBox="0 0 16 16" class="ml-1 size-3.5 shrink-0 fill-gray-300">
              <path d="M10.5 1.5a6.5 6.5 0 1 0 4 11.6A5.5 5.5 0 0 1 10.5 1.5z" />
            </svg>
          }
        </li>
      }
      @if (hiddenCount() > 0) {
        <li class="py-1 text-base text-gray-400">…and {{ hiddenCount() }} more</li>
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
