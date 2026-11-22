import { computed, inject } from '@angular/core';
import { ROLE_KEYS } from '@core/input/console-keys';
import { BattleStore, timerSecondsLeft } from '@features/battle/state/battle-store';
import { rgba } from '@core/gl/gl-renderer';
import { HOLD_FILL } from '@core/gl/ui/hold-action';
import { INK, ScreenContext, hint, write } from './screen-context';

/** The timer turns red with this little left of the turn (the last minute). */
const LOW_SECONDS = 60;
/** With this little left, the seconds show big in the middle of the screen. */
const URGENT_SECONDS = 15;
/** The bar's height: the field starts under it. */
export const BAR_H = 44;

/** Forfeit is held down until it fills up, then the server ends the battle (forfeiting). */
export type ForfeitState = 'idle' | 'forfeiting';

/** What the header's buttons do and show. */
export interface HeaderActions {
  infoOpen: boolean;
  toggleInfo: () => void;
  forfeitState: ForfeitState;
  /** How full Forfeit is while R is held, 0 to 1. */
  forfeitProgress: number;
  forfeit: () => void;
  toggleTimer: () => void;
}

/**
 * The top bar, 1280x44: the format (with a replay's rating, or a best-of set's game and score) on the
 * left, "p1 VS p2" in the sides' colours, our battle timer (or the button that turns it on) and the
 * turn, then a LIVE or REPLAY badge (or Forfeit, R held, in our own battles) and Battle info's ZR
 * hint. The buttons are clickable; the controller has its own buttons for them.
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
    renderer.rect(0, 0, 1280, BAR_H - 2, { fill: INK.headerBar });
    renderer.rect(0, BAR_H - 2, 1280, 2, { fill: INK.stage });

    const format = this.formatLine();
    write(ctx, format.top, 16, 12, { size: 11, bold: true }, INK.gray400, 'left', 300);
    write(ctx, format.name, 16, 29, { size: 18, bold: true }, INK.white, 'left', 300);

    const { p1, p2 } = this.store.sides();
    if (p1.name && p2.name) {
      write(ctx, p1.name, 540, 21, { size: 20, bold: true }, INK.sky300, 'right', 216);
      renderer.rect(548, 10, 40, 24, { fill: INK.stage, radius: 2 });
      write(ctx, 'VS', 568, 22, { size: 13, bold: true }, INK.yellow200, 'center');
      write(ctx, p2.name, 596, 21, { size: 20, bold: true }, INK.red300, 'left', 196);
    }

    this.drawTimer(ctx, actions.toggleTimer);

    const turn = this.store.turn() > 0 ? `TURN ${this.store.turn()}` : this.store.teamPreview() ? 'PREVIEW' : 'STARTING…';
    renderer.rect(912, 7, 100, 30, { fill: INK.tab, radius: 15 });
    write(ctx, turn, 962, 22, { size: 15, bold: true }, INK.white, 'center', 94);

    if (this.store.watching()) {
      const live = this.store.spectating();
      renderer.rect(1020, 9, 122, 26, { fill: live ? INK.red800 : INK.tab, radius: 2 });
      write(ctx, live ? 'LIVE' : 'REPLAY', 1081, 22, { size: 15, bold: true }, INK.white, 'center');
    } else if (!this.store.result()) {
      if (actions.forfeitState === 'forfeiting') {
        renderer.rect(1020, 6, 122, 32, { fill: rgba('#7f1d1d'), stroke: INK.red300, radius: 6, border: 1 });
        write(ctx, 'Forfeiting…', 1081, 22, { size: 14, bold: true }, INK.white, 'center');
      } else {
        hint(ctx, 'header-forfeit', { x: 1020, y: 6, w: 122, h: 32 }, 'R', 'Forfeit', false, actions.forfeit, undefined, { progress: actions.forfeitProgress, color: HOLD_FILL });
      }
    }

    hint(ctx, 'header-info', { x: 1150, y: 6, w: 122, h: 32 }, 'ZR', 'Info', actions.infoOpen, actions.toggleInfo);
  }

  /**
   * The last seconds of our turn on the timer, big in the middle of the screen over everything (so
   * time doesn't run out unnoticed): a red disc with the seconds, beating once a second.
   */
  drawCountdown(ctx: ScreenContext): void {
    const timer = this.store.battleTimer();
    if (!timer || timer.since === null || this.store.result() || this.store.watching()) return;
    const now = Date.now();
    const seconds = timerSecondsLeft(timer, now);
    if (seconds === null || seconds > URGENT_SECONDS) return;
    // A beat at each new second: big, then settling.
    const beat = 1 - ((now - timer.since) % 1000) / 1000;
    const radius = 84 + 14 * beat * beat;
    const { renderer } = ctx;
    renderer.rect(640 - radius, 360 - radius, radius * 2, radius * 2, { fill: [0.6, 0.06, 0.06, 0.82], stroke: INK.red300, radius, border: 4 });
    write(ctx, String(seconds), 640, 352, { size: 88, bold: true }, INK.white, 'center');
    write(ctx, seconds === 1 ? 'second' : 'seconds', 640, 414, { size: 20, bold: true }, INK.red300, 'center');
  }

  /**
   * Our time left this turn while the battle timer is on ("2:30"): green while it runs, red when it's
   * running low, grey and still while we wait for the opponent. Off, a button that turns it on (ROLE_KEYS.timer: R3, X on the native .nro),
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
      const box = { x: 798, y: 7, w: 106, h: 30 };
      if (canToggle) ctx.focus.control({ id: 'header-timer', ...box, accept: toggle, skip: true });
      renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke: border, radius: 14, border: 1 });
      if (canToggle) {
        // Its key: R3 (the right stick pressed) a round chip with an R, X (native) a square one.
        const stick = ROLE_KEYS.timer.label === 'R3';
        renderer.rect(box.x + 8, box.y + 4, 22, 22, { fill: INK.header, stroke: INK.gray400, radius: stick ? 11 : 4, border: 1.5 });
        write(ctx, stick ? 'R' : ROLE_KEYS.timer.label, box.x + 19, box.y + 15, { size: 13, bold: true }, INK.white, 'center');
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
      hint(ctx, 'header-timer', { x: 798, y: 6, w: 106, h: 32 }, ROLE_KEYS.timer.label, cooldown ? `Wait ${cooldown}s` : 'Timer', false, toggle);
    }
  }
}
