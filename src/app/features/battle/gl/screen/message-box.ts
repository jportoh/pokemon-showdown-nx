import { BAR_H, BAR_TOP } from '@features/battle/gl/field-layout';
import { BattleLogEntry } from '@features/battle/models/battle';
import { ScreenContext, write } from './screen-context';

const STYLE = { size: 24, bold: true };
const LINE_GAP = 32;

/** The command bar's ground: along the stage's foot, always there, the theme's panel with a soft shadow over the field. */
export function drawCommandBar(ctx: ScreenContext): void {
  const p = ctx.palette;
  ctx.renderer.rect(0, BAR_TOP - 10, 1280, 14, { fill: [0, 0, 0, 0.18], softness: 10 });
  ctx.renderer.rect(0, BAR_TOP, 1280, BAR_H, { fill: p.panel });
  ctx.renderer.rect(0, BAR_TOP, 1280, 1, { fill: p.rim });
}

/**
 * What's happening now, in the command bar while the turn plays: the battle log's latest message (its
 * smaller detail lines are left to the field's labels), up to two lines, in the given area of the bar
 * (all of it by default). Nothing before the first one.
 */
export function drawMessage(ctx: ScreenContext, log: readonly BattleLogEntry[], area = { x: 28, w: 1224 }): void {
  const entry = latest(log);
  if (!entry) return;
  const p = ctx.palette;
  const lines = ctx.text.wrap(entry.text, STYLE, area.w).slice(0, 2);
  const color = entry.kind === 'result' ? p.teal : p.ink;
  const middle = BAR_TOP + BAR_H / 2 + 1;
  lines.forEach((line, i) => write(ctx, line, area.x, middle + (i - (lines.length - 1) / 2) * LINE_GAP, STYLE, color, 'left', area.w));
}

function latest(log: readonly BattleLogEntry[]): BattleLogEntry | null {
  // The chat pops up over the field instead.
  for (let i = log.length - 1; i >= 0; i--) if (log[i].kind !== 'minor' && log[i].kind !== 'chat') return log[i];
  return null;
}
