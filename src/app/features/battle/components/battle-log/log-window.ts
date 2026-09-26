import { BattleLogEntry } from '@features/battle/models/battle';

/** The rows' block: 415px wide with 12px padding on each side, 500px tall with 8px + 12px padding. */
const TEXT_WIDTH_PX = 391;
const LOG_HEIGHT_PX = 500;
const ROWS_PADDING_PX = 20;
/**
 * Left free at the bottom, for a line wrapped earlier than estimated. The window can't be measured
 * instead: on the console the rendered height read short, so a measured window kept overflowing.
 */
const RESERVE_PX = 16;
/**
 * Average character width as a share of the font size, measured on console screenshots and rounded
 * up a little, so estimates run tall rather than short: 16px text 0.55-0.57 (a line holds ~42
 * characters), 14px minor text 0.525 (~51).
 */
const CHAR_WIDTH_EM = 0.58;
const MINOR_CHAR_WIDTH_EM = 0.54;
const BOLD_CHAR_WIDTH_EM = 0.62;

function lines(text: string, fontPx: number, charEm: number): number {
  return Math.max(1, Math.ceil((text.length * fontPx * charEm) / TEXT_WIDTH_PX));
}

/** An entry's height in px (margins included), estimated from its text: see the battle log's rows. */
function estimateHeight(entry: BattleLogEntry): number {
  switch (entry.kind) {
    case 'turn':
      return 12 + 4 + 4 + 28 * lines(entry.text, 18, BOLD_CHAR_WIDTH_EM);
    case 'minor':
      return 20 * lines(entry.text, 14, MINOR_CHAR_WIDTH_EM);
    case 'result':
      return 8 + 28 * lines(entry.text, 18, BOLD_CHAR_WIDTH_EM);
    default:
      return 24 * lines(entry.text, 16, CHAR_WIDTH_EM);
  }
}

const AVAILABLE_PX = LOG_HEIGHT_PX - ROWS_PADDING_PX - RESERVE_PX;

/** The first entry of the window that ends before `end`: as many as fit, at least one. */
export function fitStart(log: readonly BattleLogEntry[], end: number): number {
  let used = 0;
  let start = end;
  while (start > 0) {
    used += estimateHeight(log[start - 1]);
    if (used > AVAILABLE_PX && start < end) break;
    start--;
  }
  return start;
}

/** The end of the window that starts at `start`: as many as fit, at least one. */
export function fitEnd(log: readonly BattleLogEntry[], start: number): number {
  let used = 0;
  let end = start;
  while (end < log.length) {
    used += estimateHeight(log[end]);
    if (used > AVAILABLE_PX && end > start) break;
    end++;
  }
  return end;
}
