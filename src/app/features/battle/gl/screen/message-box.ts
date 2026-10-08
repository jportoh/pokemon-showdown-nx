import { Rgba, rgba } from '@core/gl/gl-renderer';
import { BAR_H, BAR_TOP } from '@features/battle/gl/field-layout';
import { BattleLogEntry } from '@features/battle/models/battle';
import { INK, ScreenContext, write } from './screen-context';

export const BAR_FILL: Rgba = rgba('#111a2c');
const STYLE = { size: 24, bold: true };
const LINE_GAP = 32;

/** The command bar's ground: along the stage's foot, always there, with a light edge on top. */
export function drawCommandBar(ctx: ScreenContext): void {
  ctx.renderer.rect(0, BAR_TOP, 1280, BAR_H, { fill: BAR_FILL });
  ctx.renderer.rect(0, BAR_TOP, 1280, 3, { fill: INK.sky300 });
}

/**
 * What's happening now, in the command bar while the turn plays: the battle log's latest message (its
 * smaller detail lines are left to the field's labels), up to two lines, in the given area of the bar
 * (all of it by default). Nothing before the first one.
 */
export function drawMessage(ctx: ScreenContext, log: readonly BattleLogEntry[], area = { x: 28, w: 1224 }): void {
  const entry = latest(log);
  if (!entry) return;
  const lines = ctx.text.wrap(entry.text, STYLE, area.w).slice(0, 2);
  const color = entry.kind === 'result' ? INK.yellow200 : INK.white;
  const middle = BAR_TOP + BAR_H / 2 + 1;
  lines.forEach((line, i) => write(ctx, line, area.x, middle + (i - (lines.length - 1) / 2) * LINE_GAP, STYLE, color, 'left', area.w));
}

function latest(log: readonly BattleLogEntry[]): BattleLogEntry | null {
  // The chat pops up over the field instead.
  for (let i = log.length - 1; i >= 0; i--) if (log[i].kind !== 'minor' && log[i].kind !== 'chat') return log[i];
  return null;
}
