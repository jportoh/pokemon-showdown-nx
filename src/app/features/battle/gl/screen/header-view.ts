import { computed, inject } from '@angular/core';
import { BattleStore, timerSecondsLeft } from '@features/battle/state/battle-store';
import { rgba } from '@core/gl/gl-renderer';
import { HOLD_FILL } from '@core/gl/ui/hold-action';
import { INK, ScreenContext, hint, write } from './screen-context';

/** The timer turns red with this little left of the turn (the last minute). */
const LOW_SECONDS = 60;

/** Forfeit is held down until it fills up, then the server ends the battle (forfeiting). */
export type ForfeitState = 'idle' | 'forfeiting';

/** What the header's buttons do and show. */
export interface HeaderActions {
  logOpen: boolean;
  toggleLog: () => void;
  forfeitState: ForfeitState;
  /** How full Forfeit is while R is held, 0 to 1. */
  forfeitProgress: number;
  forfeit: () => void;
  toggleTimer: () => void;
}

/**
 * The match header across the top, 1280x48, as BattleHeader: the format (with a replay's rating, or
 * a best-of set's game and score) on the left, "p1 VS p2" centred over the field in the sides'
 * colours, our battle timer (or the button that turns it on) and the turn at the field's right edge,
 * and over the right column a LIVE or REPLAY badge (or Forfeit, R, in our own battles) and the battle
 * log's ZR hint. The buttons are clickable; the controller has its own buttons for them.
 */
export class HeaderView {
  private readonly store = inject(BattleStore);

  private readonly formatLine = computed(() => {
    const match = /^\[(.+?)\]\s*(.*)$/.exec(this.store.format());
    const rating = this.store.replay()?.rating;
    const series = this.store.series();
    const game = series ? `Game ${series.game}/${series.bestOf} · ${series.wins.p1}–${series.wins.p2}` : '';
    const top = [game, match?.[1] ?? '', rating ? `Rating ${rating}` : ''].filter(Boolean).join(' · ');
    return { top: top.toUpperCase(), name: match?.[2] ?? this.store.format() };
  });

  draw(ctx: ScreenContext, actions: HeaderActions): void {
    const { renderer } = ctx;
    renderer.rect(0, 0, 1280, 46, { fill: INK.headerBar });
    renderer.rect(0, 46, 1280, 2, { fill: INK.stage });

    const format = this.formatLine();
    write(ctx, format.top, 16, 13, { size: 11, bold: true }, INK.gray400, 'left', 250);
    write(ctx, format.name, 16, 31, { size: 16, bold: true }, INK.white, 'left', 250);

    const { p1, p2 } = this.store.sides();
    if (p1.name && p2.name) {
      write(ctx, p1.name, 476, 23, { size: 18, bold: true }, INK.sky300, 'right', 204);
      renderer.rect(484, 11, 40, 24, { fill: INK.stage, radius: 2 });
      write(ctx, 'VS', 504, 23, { size: 12, bold: true }, INK.yellow200, 'center');
      write(ctx, p2.name, 532, 23, { size: 18, bold: true }, INK.red300, 'left', 204);
    }

    this.drawTimer(ctx, actions.toggleTimer);

    const turn = this.store.turn() > 0 ? `TURN ${this.store.turn()}` : this.store.teamPreview() ? 'PREVIEW' : 'STARTING…';
    renderer.rect(877, 9, 110, 28, { fill: INK.tab, radius: 14 });
    write(ctx, turn, 932, 23, { size: 14, bold: true }, INK.white, 'center', 104);

    if (this.store.watching()) {
      const live = this.store.spectating();
      renderer.rect(1003, 11, 130, 24, { fill: live ? INK.red800 : INK.tab, radius: 2 });
      write(ctx, live ? 'LIVE' : 'REPLAY', 1068, 23, { size: 14, bold: true }, INK.white, 'center');
    } else if (!this.store.result()) {
      if (actions.forfeitState === 'forfeiting') {
        renderer.rect(1003, 7, 130, 32, { fill: rgba('#7f1d1d'), stroke: INK.red300, radius: 6, border: 1 });
        write(ctx, 'Forfeiting…', 1068, 23, { size: 14, bold: true }, INK.white, 'center');
      } else {
        hint(ctx, 'header-forfeit', { x: 1003, y: 7, w: 130, h: 32 }, 'R', 'Forfeit', false, actions.forfeit, undefined, { progress: actions.forfeitProgress, color: HOLD_FILL });
      }
    }

    hint(ctx, 'header-log', { x: 1141, y: 7, w: 133, h: 32 }, 'ZR', 'Battle log', actions.logOpen, actions.toggleLog);
  }

  /**
   * Our time left this turn while the battle timer is on ("2:30"): green while it runs, red when it's
   * running low, grey and still while we wait for the opponent. Off, a button that turns it on (R3),
   * or how long until the server allows it again.
   */
  private drawTimer(ctx: ScreenContext, toggle: () => void): void {
    const { renderer } = ctx;
    const timer = this.store.battleTimer();
    const canToggle = this.store.canToggleTimer();
    const now = Date.now();
    if (timer && !this.store.result()) {
      const seconds = timerSecondsLeft(timer, now);
      const running = timer.since !== null;
      const low = seconds !== null && seconds <= LOW_SECONDS;
      const fill = running ? (low ? rgba('#991b1b') : rgba('#065f46')) : INK.gray700;
      const border = running ? (low ? INK.red300 : rgba('#6ee7b7')) : INK.gray500;
      const box = { x: 759, y: 9, w: 110, h: 28 };
      if (canToggle) ctx.focus.control({ id: 'header-timer', ...box, accept: toggle, skip: true });
      renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke: border, radius: 14, border: 1 });
      if (canToggle) {
        renderer.rect(box.x + 6, box.y + 5, 24, 18, { fill: INK.header, radius: 2 });
        write(ctx, 'R3', box.x + 18, box.y + 14, { size: 12, bold: true }, INK.white, 'center');
      }
      // A clock whose hand ticks every second while it runs; two pause bars while it's stopped.
      const cx = box.x + 44;
      const cy = box.y + 15;
      const ink = running ? INK.white : INK.gray300;
      if (running) {
        renderer.rect(cx - 6, cy - 6, 12, 12, { fill: [0, 0, 0, 0], stroke: ink, radius: 6, border: 1.8 });
        const angle = ((seconds ?? 0) % 2 === 0 ? -Math.PI / 2 : -Math.PI / 6);
        renderer.rect(cx - 0.9, cy - 4, 1.8, 4, { fill: ink, angle: angle + Math.PI / 2 });
      } else {
        renderer.rect(cx - 4, cy - 5, 2.4, 10, { fill: ink });
        renderer.rect(cx + 2, cy - 5, 2.4, 10, { fill: ink });
      }
      const text = seconds === null ? 'On' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      write(ctx, text, box.x + 56, box.y + 14, { size: 14, bold: true }, ink);
      return;
    }
    if (canToggle && !this.store.result()) {
      const until = this.store.timerCooldownUntil();
      const cooldown = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
      hint(ctx, 'header-timer', { x: 759, y: 7, w: 110, h: 32 }, 'R3', cooldown ? `Wait ${cooldown}s` : 'Timer', false, toggle);
    }
  }
}
