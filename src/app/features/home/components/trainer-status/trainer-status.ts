import { Component, computed, inject } from '@angular/core';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';

type StatusKey = 'offline' | 'connecting' | 'reconnecting' | 'loggingIn' | 'online' | 'noName';

/**
 * Each state's words, dot colour and the width its words take (in the console's font, a bit wider
 * than the web's), so the line can end right at the area's edge with no gap after short words.
 */
const STATES: readonly { key: StatusKey; text: string; width: number; dot: string }[] = [
  { key: 'offline', text: 'Offline', width: 76, dot: 'bg-gray-400' },
  { key: 'connecting', text: 'Connecting…', width: 124, dot: 'bg-amber-300' },
  { key: 'reconnecting', text: 'Reconnecting…', width: 146, dot: 'bg-amber-300' },
  { key: 'loggingIn', text: 'Logging in…', width: 116, dot: 'bg-amber-300' },
  { key: 'online', text: 'Online', width: 72, dot: 'bg-emerald-400' },
  { key: 'noName', text: 'Online', width: 72, dot: 'bg-red-400' },
];

/**
 * The trainer's line for the dark bars: our name (once we have one), a coloured dot and the connection
 * ("ffenrix ● Online"), ending at the area's right edge, next to whatever follows it. A fixed 360x28
 * area. On Brewser (device, 2026-09-28) one line mixing inline elements wrapped despite `nowrap`,
 * `text-align: right` was ignored and a "●" glyph was cut, so the parts are separate boxes anchored
 * by their right edge (`right`): the words in a box as wide as they are, the dot (a rounded box)
 * before them, and the name, shrinking to fit, before the dot. Every state has its own line, all
 * mounted with fixed positions, and only the current one shown: nothing moves at runtime (Brewser
 * leaves moved boxes painted where they were). Boxes have the text's natural line height: a taller
 * line in an overflow-hidden box drew its text at the top on Brewser.
 */
@Component({
  selector: 'app-trainer-status',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-7 w-[360px]', role: 'status' },
  template: `
    @for (state of states; track state.key) {
      <div class="block" [class.hidden]="state.key !== key()">
        @if (state.key === 'online' || state.key === 'noName') {
          <span
            class="absolute top-0 block h-7 text-xl font-bold whitespace-nowrap text-retro-ink"
            [style.right.px]="state.width + 22"
          >{{ state.key === 'online' ? login.state().name : 'No name' }}</span>
        }
        <span aria-hidden="true" class="absolute top-[8px] block size-3 rounded-full" [class]="state.dot" [style.right.px]="state.width + 4"></span>
        <span class="absolute top-0 right-0 block h-7 overflow-hidden text-xl whitespace-nowrap text-retro-ink" [style.width.px]="state.width">{{ state.text }}</span>
      </div>
    }
  `,
})
export class TrainerStatus {
  protected readonly login = inject(ShowdownLogin);
  private readonly connection = inject(ShowdownConnection);

  protected readonly states = STATES;

  protected readonly key = computed<StatusKey>(() => {
    const login = this.login.state();
    const status = this.connection.state().status;
    // Connected to log in, without a name yet: still offline as far as the player is concerned.
    if (!login.mode || status === 'offline' || (login.status === 'ready' && !login.loggingIn)) return 'offline';
    if (status !== 'connected') return status === 'connecting' ? 'connecting' : 'reconnecting';
    if (login.status === 'named') return 'online';
    if (login.status === 'unavailable') return 'noName';
    if (login.loggingIn) return 'loggingIn';
    return 'connecting';
  });
}
