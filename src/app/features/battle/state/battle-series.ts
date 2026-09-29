// A best-of-3 set on Showdown is a room of its own ("game-bestof3-<format>-<n>") whose games are
// ordinary battle rooms. What a game's room tells about its set comes as server HTML, which is never
// rendered here: only these few known shapes are read from it.

/** Which game of which set a battle is. */
export interface SeriesInfo {
  /** The set's room, where the player confirms being ready for the next game. */
  roomId: string;
  game: number;
  bestOf: number;
}

/** The set's score as a game starts, by the players' names as the server writes them. */
export interface SeriesScore {
  names: readonly [string, string];
  wins: readonly [number, number];
}

/** Between games: nothing asked, "are you ready for the next game?", or ready and waiting for the opponent. */
export type ReadyState = 'none' | 'ask' | 'waiting';

/**
 * `|uhtml|bestof|<h2><strong>Game 2</strong> of <a href="/game-bestof3-gen9…-123">a best-of-3</a></h2>`
 * (also as `uhtmlchange`).
 */
export function parseSeriesTitle(html: string): SeriesInfo | null {
  const match = /Game (\d+)<\/strong> of <a href="\/(game-bestof(\d+)-[a-z0-9-]+)"/.exec(html);
  return match ? { game: Number(match[1]), roomId: match[2], bestOf: Number(match[3]) } : null;
}

/**
 * The table each game opens with: the two names, then a circle per game needed to win, filled for
 * each game won (`fa-circle`, `fa-circle-o` for the rest).
 */
export function parseSeriesScore(html: string): SeriesScore | null {
  const match =
    /<td align="left">(.*?)<\/td><td align="right">(.*?)<\/tr><tr><td align="left">(.*?)<\/td><td align="right">(.*?)<\/tr>/.exec(html);
  if (!match) return null;
  const wins = (cell: string) => (cell.match(/fa-circle"/g) ?? []).length;
  return { names: [unescapeHtml(match[1]), unescapeHtml(match[2])], wins: [wins(match[3]), wins(match[4])] };
}

/**
 * `|c|~|/uhtml controls,<div…>Are you ready for game 2, Name?…<button … value="/msgroom …,/confirmready">`
 * (a disabled button once we're ready), or empty when there's nothing to confirm.
 */
export function parseReadyPrompt(message: string): ReadyState | null {
  if (!message.startsWith('/uhtml controls,')) return null;
  const html = message.slice('/uhtml controls,'.length);
  if (!html.includes('Are you ready')) return 'none';
  return html.includes('disabled') ? 'waiting' : 'ask';
}

function unescapeHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&amp;/g, '&')
    .trim();
}
