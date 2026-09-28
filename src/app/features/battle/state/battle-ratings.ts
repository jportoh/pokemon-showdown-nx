import { RatingChange } from '@features/battle/models/battle';

/**
 * A player's new ladder rating, from the line Showdown adds after a rated battle ends:
 * `|raw|Micael Lopes's rating: 1822 &rarr; <strong>1839</strong><br />(+17 for winning)`.
 * Null for any other `|raw|` HTML.
 */
export function parseRatingChange(html: string): RatingChange | null {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&rarr;/g, '→')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const match = /^(.+)'s rating: (\d+) → (\d+)\s*\(/.exec(text.trim());
  if (!match) return null;
  const before = Number(match[2]);
  const after = Number(match[3]);
  return { name: match[1], before, after, change: after - before };
}
