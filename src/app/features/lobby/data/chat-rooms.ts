import { ChatRoom } from '@features/lobby/models/chat';

/**
 * Rooms offered on the Chats page, the most used ones by the server's room list (2026-09-30). IDs
 * verified by joining each one: accented letters are dropped ("Español" is `espanol`, "Français"
 * `franais`, "Português" `portugus`).
 */
export const CHAT_ROOMS: readonly ChatRoom[] = [
  { id: 'lobby', title: 'Lobby' },
  { id: 'vgc', title: 'VGC' },
  { id: 'champions', title: 'Champions' },
  { id: 'tournaments', title: 'Tournaments' },
  { id: 'overused', title: 'OverUsed' },
  { id: 'randombattles', title: 'Random Battles' },
  { id: 'monotype', title: 'Monotype' },
  { id: 'help', title: 'Help' },
  { id: 'espanol', title: 'Español' },
  { id: 'franais', title: 'Français' },
  { id: 'portugus', title: 'Português' },
];
