import { menuModal } from '@core/gl/ui/menu-kit';
import { ScreenContext, button, write, writeLines } from './screen-context';

const BOX = { x: 390, y: 230, w: 500, h: 236 };
const BUTTON_W = 218;
const BUTTON_H = 52;
const GAP = 16;

/** The dialog's buttons; Stay takes the focus first, so B then A doesn't leave by mistake. */
export const LEAVE_CONFIRM_IDS = { stay: 'leave-confirm-stay', leave: 'leave-confirm-leave' } as const;

/** What the dialog asks about: a replay (ours just finished, or one from the list) or a live battle. */
export type LeaveKind = 'replay' | 'instant' | 'live';

const TEXTS: Record<LeaveKind, { title: string; note: string; stay: string; leave: string }> = {
  replay: { title: 'Leave this replay?', note: 'You go back to the list of replays.', stay: 'Keep watching', leave: 'Leave' },
  instant: { title: 'Stop the replay?', note: 'You go back to the end of your battle.', stay: 'Keep watching', leave: 'Back to results' },
  live: { title: 'Stop watching?', note: 'You leave the battle and go back to the live battles.', stay: 'Keep watching', leave: 'Leave' },
};

/** B while watching: a box over the battle asking whether to leave it, with Stay and Leave (B is Stay). */
export function drawLeaveConfirm(ctx: ScreenContext, kind: LeaveKind, actions: { stay: () => void; leave: () => void }): void {
  const p = ctx.palette;
  const text = TEXTS[kind];
  menuModal(ctx, BOX, undefined, 0.55);
  write(ctx, text.title, BOX.x + 32, BOX.y + 48, { size: 26, bold: true }, p.ink, 'left', BOX.w - 64);
  writeLines(ctx, text.note, BOX.x + 32, BOX.y + 80, BOX.w - 64, 22, { size: 17 }, p.muted, 2);
  const y = BOX.y + BOX.h - BUTTON_H - 28;
  const left = BOX.x + (BOX.w - 2 * BUTTON_W - GAP) / 2;
  button(ctx, LEAVE_CONFIRM_IDS.stay, { x: left, y, w: BUTTON_W, h: BUTTON_H }, text.stay, 'plain', actions.stay);
  button(ctx, LEAVE_CONFIRM_IDS.leave, { x: left + BUTTON_W + GAP, y, w: BUTTON_W, h: BUTTON_H }, text.leave, 'primary', actions.leave);
}
