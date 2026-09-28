import { Service, signal } from '@angular/core';
import { PixelIconName } from '@shared/components/pixel-icon';

export interface HomeMenuItem {
  id: PixelIconName;
  label: string;
  /** The page it opens; none for Random Battle, which searches for an opponent right there. */
  path: string | null;
}

/**
 * The home menu's items, two per row: each page next to its quick counterpart (Battle and Random
 * Battle, Replays and Watch Live).
 */
export const HOME_MENU_ITEMS: readonly HomeMenuItem[] = [
  { id: 'battle', label: 'Battle', path: '/play' },
  { id: 'random', label: 'Random Battle', path: null },
  { id: 'teambuilder', label: 'Teambuilder', path: '/teambuilder' },
  { id: 'chats', label: 'Chats', path: '/chats' },
  { id: 'replays', label: 'Replays', path: '/replays' },
  { id: 'live', label: 'Watch Live', path: '/live' },
];

/** The item the home menu last opened, so coming back puts the cursor on it again. */
@Service()
export class HomeMenu {
  readonly lastItem = signal<PixelIconName>('battle');
}
