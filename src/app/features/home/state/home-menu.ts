import { Service, signal } from '@angular/core';
import { PixelIconName } from '@core/gl/ui/pixel-icons';
import { Appearance } from '@core/settings/app-settings';

export interface HomeMenuItem {
  id: PixelIconName;
  label: string;
  /** The page it opens. */
  path: string;
  /** Only useful connected: faded on the menu while offline. */
  needsConnection: boolean;
  /**
   * The tint its button fades into, so each is also known by its colour: a dark shade of the icon's
   * colour on the dark appearance, a pastel one on the light (literals).
   */
  plate: Readonly<Record<Appearance, string>>;
  /** What it's for, under the menu while it has the focus. */
  description: string;
  /** What A does on it, in the menu's controls legend. */
  action: string;
}

/**
 * The home menu's items: Battle first (the wide button), then Random Battle, Teambuilder, Watch Live
 * and Chats (two rows of two), and Settings (a small button at the top).
 */
export const HOME_MENU_ITEMS: readonly HomeMenuItem[] = [
  {
    id: 'battle',
    label: 'Battle',
    path: '/play',
    needsConnection: false,
    plate: { dark: '#4a1f2b', light: '#f8d9dc' },
    description: 'Challenge a player or play on the ladder.',
    action: 'Open',
  },
  {
    id: 'random',
    label: 'Random Battle',
    path: '/random',
    needsConnection: true,
    plate: { dark: '#43361a', light: '#f6e6bf' },
    description: 'Pick a random format: a team is handed out, no building needed.',
    action: 'Open',
  },
  {
    id: 'teambuilder',
    label: 'Teambuilder',
    path: '/teambuilder',
    needsConnection: false,
    plate: { dark: '#15375a', light: '#d2e5f8' },
    description: 'Build, import and tune your teams.',
    action: 'Open',
  },
  {
    id: 'live',
    label: 'Watch Live',
    path: '/live',
    needsConnection: true,
    plate: { dark: '#3a2049', light: '#e8d9f6' },
    description: 'Watch the best battles on the ladder right now.',
    action: 'Watch',
  },
  {
    id: 'chats',
    label: 'Chats',
    path: '/chats',
    needsConnection: true,
    plate: { dark: '#173f33', light: '#cdeee1' },
    description: 'Talk in the lobby and the format rooms.',
    action: 'Open',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    needsConnection: false,
    plate: { dark: '#26313d', light: '#dde4eb' },
    description: 'Themes, appearance, formats and your account.',
    action: 'Open',
  },
];

/** The item the home menu last opened, so coming back puts the cursor on it again. */
@Service()
export class HomeMenu {
  readonly lastItem = signal<PixelIconName>('battle');
  /** Coming back from a page the Trainer Card opened (the battle history): the menu opens the card again. */
  readonly openCard = signal(false);
  /**
   * The player chose to play offline on the entry screen: the menu opens without a connection (the
   * Teambuilder and Settings work offline). Otherwise the menu needs a connection asked for first.
   */
  readonly offlineChosen = signal(false);
  /** The menu opens from the entry screen (same trainer, same lit side): it doesn't bring them in again. */
  readonly fromEntry = signal(false);
}
