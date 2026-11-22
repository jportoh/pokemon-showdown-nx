/** Rank symbol as sent by the server: '~', '&', '#', '@', '%', '*', '+', ' ' (regular user), … */
export type UserRank = string;

export interface ChatUser {
  /** Showdown user ID (see `toId`), unique per user. */
  id: string;
  name: string;
  rank: UserRank;
  away: boolean;
}

export interface ChatMessage {
  id: number;
  author: string;
  text: string;
  /** A `/me` message, shown as "author text". */
  action: boolean;
  /** A notice from the server (e.g. why a message wasn't sent), shown without an author. */
  system: boolean;
}

/** A Showdown chat room the user can join from the lobby. */
export interface ChatRoom {
  /** Room ID on the server (what `/join` takes). */
  id: string;
  title: string;
  /** The Pokémon drawn on its card (a bundled sprite's name). */
  art: string;
  /** What it's about, until the server's own description arrives. */
  desc: string;
  /** Its language, for the rooms not in English ("ES"). */
  lang?: string;
}
