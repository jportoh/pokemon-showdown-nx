import { computed, inject } from '@angular/core';
import { BAR_TOP } from '@features/battle/gl/field-layout';
import { BattleStore } from '@features/battle/state/battle-store';
import { ButtonLook, ScreenContext, button, writeLines } from './screen-context';
import { drawCommandBar, drawMessage } from './message-box';

/** The message on the bar's left; the controls on its right, two by two. */
const MESSAGE = { x: 28, w: 740 };
const CONTROLS_X = 796;
const RIGHT = 1264;
const GAP = 12;
const BUTTON_H = 40;
const ROWS = [BAR_TOP + 12, BAR_TOP + 58];
const BUTTON_W = Math.floor((RIGHT - CONTROLS_X - GAP) / 2);
const SPEEDS = [1, 2, 4];

/** The ids of the panel's buttons, for the screen's first focus and B. */
export const PANEL_IDS = {
  play: 'replay-play',
  leaveLive: 'live-leave',
} as const;

/**
 * The command bar while watching: the message on the left and the controls on the right, a replay's (play/pause or watch again, next turn, speed, back to the list), or
 * a live battle's (the way back to the list and what's going on). Both teams are in Battle info (ZR).
 */
export class WatchPanelView {
  private readonly store = inject(BattleStore);

  private readonly finished = computed(() => !!this.store.result() && !this.store.playing());

  private readonly liveStatus = computed(() => {
    const error = this.store.spectateError();
    if (error) return error;
    const { p1, p2 } = this.store.sides();
    if (!p1.name || !p2.name) return 'Joining the battle…';
    if (this.store.result()) return 'The battle is over.';
    if (this.store.teamPreview()) return 'Team preview: the players are picking their Pokémon.';
    return 'Watching live. ZR: both teams, the field and the log.';
  });

  draw(ctx: ScreenContext, actions: { again: () => void; leaveReplay: () => void; leaveLive: () => void }): void {
    drawCommandBar(ctx);
    drawMessage(ctx, this.store.log(), MESSAGE);
    if (this.store.replay()) this.drawReplay(ctx, actions);
    else this.drawLive(ctx, actions.leaveLive);
  }

  private drawReplay(ctx: ScreenContext, actions: { again: () => void; leaveReplay: () => void }): void {
    const at = (i: number) => ({ x: CONTROLS_X + (i % 2) * (BUTTON_W + GAP), y: ROWS[Math.floor(i / 2)], w: BUTTON_W, h: BUTTON_H });
    const finished = this.finished();
    controlButton(ctx, PANEL_IDS.play, at(0), finished ? 'Watch again' : this.store.paused() ? 'Play' : 'Pause', 'primary', () => (finished ? actions.again() : this.store.togglePause()));
    controlButton(ctx, 'replay-next', at(1), 'Next turn', finished ? 'disabled' : 'plain', () => this.store.nextTurn());
    controlButton(ctx, 'replay-speed', at(2), `Speed ${this.store.speed()}x`, 'plain', () => {
      this.store.setSpeed(SPEEDS[(SPEEDS.indexOf(this.store.speed()) + 1) % SPEEDS.length]);
    });
    controlButton(ctx, 'replay-leave', at(3), 'Other replays', 'plain', actions.leaveReplay);
  }

  private drawLive(ctx: ScreenContext, leave: () => void): void {
    controlButton(ctx, PANEL_IDS.leaveLive, { x: CONTROLS_X, y: ROWS[0], w: RIGHT - CONTROLS_X, h: BUTTON_H }, 'Other live battles', 'plain', leave);
    writeLines(ctx, this.liveStatus(), CONTROLS_X, ROWS[1], RIGHT - CONTROLS_X, 21, { size: 15 }, ctx.palette.muted, 2);
  }
}

/** A control as the app's buttons, in the theme's colours (the accent for the main one). */
function controlButton(ctx: ScreenContext, id: string, box: { x: number; y: number; w: number; h: number }, label: string, look: ButtonLook, accept: () => void): void {
  button(ctx, id, box, label, look, accept);
}
