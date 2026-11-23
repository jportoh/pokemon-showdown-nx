import { spriteId } from './sprite-id';

/**
 * What a battle's log tells at a glance, for the replays' and live battles' details: the players and
 * their ratings as it started, each side's team (sprite IDs) and where it stands (the last turn
 * reached, the winner once it's over).
 */
export interface BattleSummary {
  /** p1's and p2's names ('' until their `|player|` lines). */
  players: [string, string];
  /** Their ratings as the battle started (null when unrated). */
  ratings: [number | null, number | null];
  /**
   * Each side's Pokémon as sprite IDs: the team preview's six (`|poke|`), or, with no preview (random
   * formats), the ones seen so far as they switch in.
   */
  teams: [string[], string[]];
  /** The last turn started; 0 before the first (the team preview). */
  turn: number;
  /** The winner's name, 'tie', or null while it goes on. */
  end: { winner: string } | 'tie' | null;
}

const SIDES = ['p1', 'p2'] as const;

/** Reads the log's lines (a replay's whole log, or a room's history as a spectator joins). */
export function summarizeBattle(lines: readonly string[]): BattleSummary {
  const summary: BattleSummary = { players: ['', ''], ratings: [null, null], teams: [[], []], turn: 0, end: null };
  const previewed = [false, false];
  for (const line of lines) {
    if (line.startsWith('|player|')) {
      // |player|p1|NAME|AVATAR|RATING (emptied as the battle ends: the name stays as it was).
      const [, , side, name, , rating] = line.split('|');
      const index = SIDES.indexOf(side as 'p1' | 'p2');
      if (index < 0) continue;
      if (name) summary.players[index] = name;
      const value = Number(rating);
      if (rating && Number.isFinite(value) && value > 0) summary.ratings[index] = value;
    } else if (line.startsWith('|poke|')) {
      // |poke|p1|Incineroar, L50, M|item
      const [, , side, details] = line.split('|');
      const index = SIDES.indexOf(side as 'p1' | 'p2');
      if (index < 0 || !details) continue;
      previewed[index] = true;
      summary.teams[index].push(spriteId(details.split(',')[0]));
    } else if (line.startsWith('|switch|') || line.startsWith('|drag|')) {
      // |switch|p1a: Nickname|Garchomp, L50, F|100/100: what a side without a preview has shown so far.
      const [, , who, details] = line.split('|');
      const team = who?.startsWith('p1') ? summary.teams[0] : who?.startsWith('p2') ? summary.teams[1] : null;
      if (!team || previewed[team === summary.teams[0] ? 0 : 1] || !details) continue;
      const sprite = spriteId(details.split(',')[0]);
      if (!team.includes(sprite)) team.push(sprite);
    } else if (line.startsWith('|turn|')) {
      summary.turn = Number(line.slice('|turn|'.length)) || summary.turn;
    } else if (line.startsWith('|win|')) {
      summary.end = { winner: line.slice('|win|'.length) };
    } else if (line === '|tie') {
      summary.end = 'tie';
    }
  }
  return summary;
}
