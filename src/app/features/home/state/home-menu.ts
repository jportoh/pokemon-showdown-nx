import { Service, signal } from '@angular/core';
import { PixelIconName } from '@shared/components/pixel-icon';

export interface HomeMenuItem {
  id: PixelIconName;
  label: string;
  /** The page it opens; none for Random Battle, which searches for an opponent right there. */
  path: string | null;
  /** Only useful connected: faded on the menu while offline. */
  needsConnection: boolean;
  /**
   * The tint of the plate behind its icon, so each button is also known by its colour: a dark shade
   * of the icon's own colour, fixed (the themes are all dark), a literal as Brewser needs.
   */
  plate: string;
}

/**
 * The home menu's items: Battle and Random Battle first (the two big buttons), then the other pages
 * in one row of four.
 */
export const HOME_MENU_ITEMS: readonly HomeMenuItem[] = [
  { id: 'battle', label: 'Battle', path: '/play', needsConnection: false, plate: '#4a1f2b' },
  { id: 'random', label: 'Random Battle', path: null, needsConnection: true, plate: '#43361a' },
  { id: 'teambuilder', label: 'Teambuilder', path: '/teambuilder', needsConnection: false, plate: '#15375a' },
  { id: 'chats', label: 'Chats', path: '/chats', needsConnection: true, plate: '#173f33' },
  { id: 'live', label: 'Watch Live', path: '/live', needsConnection: true, plate: '#3a2049' },
  { id: 'settings', label: 'Settings', path: '/settings', needsConnection: false, plate: '#26313d' },
];

/** The item the home menu last opened, so coming back puts the cursor on it again. */
@Service()
export class HomeMenu {
  readonly lastItem = signal<PixelIconName>('battle');
  /**
   * EXPERIMENT (feat/webgl-probe): the menu is the WebGL one (/gl) until R switches to the DOM one,
   * and back from a page lands on whichever was last shown.
   */
  readonly glHome = signal(true);
}
