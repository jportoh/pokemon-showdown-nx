import { ChatRoom } from '@features/lobby/models/chat';

/**
 * Rooms offered in the lobby's chat panel. IDs verified against the server's room list and by
 * joining each one ("Español" is `espanol`).
 */
export const CHAT_ROOMS: readonly ChatRoom[] = [
  { id: 'lobby', title: 'Lobby' },
  { id: 'vgc', title: 'VGC' },
  { id: 'champions', title: 'Champions' },
  { id: 'espanol', title: 'Español' },
];
