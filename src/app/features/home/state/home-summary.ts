import { Service, computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { AppSettings, THEMES } from '@core/settings/app-settings';
import { ServerStats } from '@features/connection/server-stats';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { CHAT_ROOMS } from '@features/lobby/data/chat-rooms';
import { ChatRoomStore } from '@features/lobby/state/chat-room-store';
import { PlaySelection } from '@features/play/state/play-selection';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { groupDigits } from '@shared/utils/group-digits';
import { spriteId } from '@shared/utils/sprite-id';

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What the home menu's buttons show under their names: live facts rather than explanations (the
 * Battle page's format and default team, a challenge, how many teams, the chat room, the battles on
 * now, the theme). Whether a page needs a connection is the home screen's to say.
 */
@Service()
export class HomeSummary {
  private readonly dex = inject(ChampionsDex);
  private readonly selection = inject(PlaySelection);
  private readonly teamStore = inject(TeamStore);
  private readonly challenges = inject(ShowdownChallenges);
  private readonly chat = inject(ChatRoomStore);
  private readonly stats = inject(ServerStats);
  private readonly settings = inject(AppSettings);

  /** Who challenges us ("Kaiser_Red", "Kaiser_Red +1"), or null. */
  readonly challenger = computed(() => {
    const incoming = this.challenges.incoming();
    if (incoming.length === 0) return null;
    return incoming.length > 1 ? `${incoming[0].from} +${incoming.length - 1}` : incoming[0].from;
  });

  /** Battle's line: the challenge, or the Battle page's format and how many teams fit it. */
  readonly battle = computed(() => {
    const challenger = this.challenger();
    if (challenger) return `${challenger} wants to battle!`;
    const format = this.selection.playFormat();
    if (format.randomTeams) return `${format.label} · random teams`;
    const teams = this.selection.teams().length;
    return `${format.label} · ${teams ? plural(teams, 'team') : 'no teams yet'}`;
  });

  /** The Battle page's team: its name and its Pokémon's sprites (Megas as they'll fight). */
  readonly team = computed(() => {
    const team = this.selection.team();
    if (!team) return null;
    return { name: team.name, sprites: team.sets.map((set) => this.dex.mega(set.species, set.item)?.sprite ?? spriteId(set.species)) };
  });

  readonly teambuilder = computed(() => {
    const teams = this.teamStore.teams().length;
    return teams ? plural(teams, 'team') : 'No teams yet';
  });

  readonly chats = computed(() => {
    const room = this.chat.room();
    return room ? `In ${room.title}` : plural(CHAT_ROOMS.length, 'room');
  });

  readonly live = computed(() => {
    const counts = this.stats.counts();
    return counts ? `${groupDigits(counts.battles)} battles on now` : 'Battles on now';
  });

  readonly settingsLine = computed(() => `Theme: ${THEMES.find((theme) => theme.id === this.settings.settings().theme)?.name ?? ''}`);
}
