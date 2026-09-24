export type UserRank = '~' | '#' | '@' | '%' | '*' | '+' | ' ';

export interface ChatUser {
  name: string;
  rank: UserRank;
  away?: boolean;
}

export interface ChatMessage {
  id: number;
  author: string;
  text: string;
}
