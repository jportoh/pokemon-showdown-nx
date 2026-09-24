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
}
