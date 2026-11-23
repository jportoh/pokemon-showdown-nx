import { ChatRoom } from '@features/lobby/models/chat';

/**
 * Rooms offered on the Chats page, the most used ones by the server's room list (2026-09-30). IDs
 * verified by joining each one: accented letters are dropped ("Español" is `espanol`, "Français"
 * `franais`, "Português" `portugus`). Each has a Pokémon drawn on its card, and a description of its
 * own for when the server's (from `/cmd rooms`) hasn't arrived.
 */
export const CHAT_ROOMS: readonly ChatRoom[] = [
  { id: 'lobby', title: 'Lobby', art: 'whimsicott', desc: 'The main room: say hi and find someone to battle.' },
  { id: 'vgc', title: 'VGC', art: 'incineroar', desc: 'Official doubles: the current regulation, teams and tips.' },
  { id: 'champions', title: 'Champions', art: 'charizard', desc: 'Pokémon Champions: news, formats and teams.' },
  { id: 'tournaments', title: 'Tournaments', art: 'lucario', desc: 'Join a tournament or follow the brackets.' },
  { id: 'overused', title: 'OverUsed', art: 'garchomp', desc: 'Gen 9 OU singles.' },
  { id: 'randombattles', title: 'Random Battles', art: 'pikachu', desc: 'Random teams, every generation.' },
  { id: 'monotype', title: 'Monotype', art: 'gengar', desc: 'Teams of a single type.' },
  { id: 'help', title: 'Help', art: 'rotom', desc: 'Questions about the game or the site.' },
  { id: 'espanol', title: 'Español', art: 'meowscarada', desc: 'La sala en español.', lang: 'ES' },
  { id: 'franais', title: 'Français', art: 'chandelure', desc: 'Le salon en français.', lang: 'FR' },
  { id: 'portugus', title: 'Português', art: 'sylveon', desc: 'A sala em português.', lang: 'PT' },
];
