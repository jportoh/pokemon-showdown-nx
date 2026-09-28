import { Component, computed, inject } from '@angular/core';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';

/**
 * A notice in the dark bars while someone challenges us. Challenges are only answered on the Battle
 * page, so it says to go there. A fixed 380x36 pill; nothing while there's no challenge.
 */
@Component({
  selector: 'app-challenge-notice',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-9 w-[380px]' },
  template: `
    @if (notice(); as notice) {
      <p role="status" class="absolute top-0 left-0 block h-9 w-[380px] truncate rounded-md bg-retro-accent p-[0_12px] text-base leading-9 font-bold text-white">
        {{ notice }}
      </p>
    }
  `,
})
export class ChallengeNotice {
  private readonly challenges = inject(ShowdownChallenges);

  protected readonly notice = computed(() => {
    const incoming = this.challenges.incoming();
    if (incoming.length === 0) return null;
    const more = incoming.length > 1 ? ` (+${incoming.length - 1})` : '';
    return `${incoming[0].from} wants to battle!${more} Answer in Battle.`;
  });
}
