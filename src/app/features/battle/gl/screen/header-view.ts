import { computed, inject } from '@angular/core';
import { Rgba, withAlpha } from '@core/gl/gl-renderer';
import { Palette } from '@core/gl/ui/gl-theme';
import { BATTLE_SHORTCUTS, ROLE_KEYS } from '@core/input/console-keys';
import { BattleStore, timerSecondsLeft } from '@features/battle/state/battle-store';
import { INK, ScreenContext, hint, keyChip, write } from './screen-context';

/** The timer turns red with this little left of the turn (the last minute). */
const LOW_SECONDS = 60;
/** With this little left, the seconds show big in the middle of the screen. */
const URGENT_SECONDS = 15;
/** The bar's height: the field starts under it. */
export const BAR_H = 44;
/** The turn's chip, and the timer's (or a LIVE / REPLAY badge, or Forfeiting…) after it. */
const TURN = { x: 640, w: 92 };
const BADGE = { x: 740, w: 98 };

/** Forfeit is held down until it fills up, then the server ends the battle (forfeiting). */
export type ForfeitState = 'idle' | 'forfeiting';

/** What the header's buttons do and show (each has its controller button; these are for clicks). */
export interface HeaderActions {
  infoOpen: boolean;
  toggleInfo: () => void;
  menuOpen: boolean;
  toggleMenu: () => void;
  fieldOpen: boolean;
  /** The field view; null while there's none to show (team preview), and no button for it. */
  toggleField: (() => void) | null;
  /** The last turn's log (L held): whether it's held now; null where there's none to show. */
  logHeld: boolean | null;
  forfeitState: ForfeitState;
  toggleTimer: () => void;
}

/** The opponent's colour for text on the bars and panels (the field keeps its own). */
export function foeInk(p: Palette): Rgba {
  return p.appearance === 'light' ? [0.7, 0.12, 0.09, 1] : INK.red300;
}

/**
 * The top bar, 1280x44, in the menu's style: the format (with a replay's rating, or a best-of set's
 * game and score) on the left, "p1 VS p2" in the sides' colours, the turn and our battle timer (or a
 * LIVE / REPLAY badge), then round buttons for what works everywhere in battle: the last turn's log
 * (L held), the field view (Y; not in team preview), Battle info (ZR) and the
 * menu (+). The controller has its own buttons for them; these are for clicks.
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
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(0, 0, 1280, BAR_H, { fill: p.bar });
    renderer.rect(0, BAR_H - 1, 1280, 1, { fill: p.rim });

    const format = this.formatLine();
    write(ctx, format.top, 16, 12, { size: 11, bold: true }, p.muted, 'left', 300);
    write(ctx, format.name, 16, 29, { size: 18, bold: true }, p.ink, 'left', 300);

    const { p1, p2 } = this.store.sides();
    if (p1.name && p2.name) {
      write(ctx, p1.name, 456, 22, { size: 19, bold: true }, p.accentText, 'right', 140);
      renderer.rect(464, 10, 40, 24, { fill: p.accent, radius: 6, skew: 0.14 });
      write(ctx, 'VS', 484, 22, { size: 13, bold: true }, [1, 1, 1, 1], 'center');
      write(ctx, p2.name, 512, 22, { size: 19, bold: true }, foeInk(p), 'left', 120);
    }

    const turn = this.store.turn() > 0 ? `TURN ${this.store.turn()}` : this.store.teamPreview() ? 'PREVIEW' : 'STARTING…';
    renderer.rect(TURN.x, 7, TURN.w, 30, { fill: p.rim, radius: 15 });
    write(ctx, turn, TURN.x + TURN.w / 2, 22, { size: 14, bold: true }, p.ink, 'center', TURN.w - 8);

    if (this.store.watching()) {
      const live = this.store.spectating();
      renderer.rect(BADGE.x, 7, BADGE.w, 30, { fill: live ? p.danger : p.rim, radius: 15 });
      write(ctx, live ? 'LIVE' : 'REPLAY', BADGE.x + BADGE.w / 2, 22, { size: 14, bold: true }, live ? p.contrast : p.ink, 'center');
    } else if (actions.forfeitState === 'forfeiting' && !this.store.result()) {
      renderer.rect(BADGE.x, 7, BADGE.w + 6, 30, { fill: p.danger, radius: 15 });
      write(ctx, 'Forfeiting…', BADGE.x + (BADGE.w + 6) / 2, 22, { size: 14, bold: true }, p.contrast, 'center');
    } else {
      this.drawTimer(ctx, actions.toggleTimer);
    }

    // The round buttons, from the right: Menu, Info, Field, Last turn (held: a click does nothing).
    const buttons: { id: string; key: string; label: string; active: boolean; press: () => void }[] = [
      ...(actions.logHeld !== null ? [{ id: 'header-log', key: BATTLE_SHORTCUTS.log.label, label: 'Last turn', active: actions.logHeld, press: () => undefined }] : []),
      ...(actions.toggleField ? [{ id: 'header-field', key: ROLE_KEYS.fieldView.label, label: 'Field', active: actions.fieldOpen, press: actions.toggleField }] : []),
      { id: 'header-info', key: 'ZR', label: 'Info', active: actions.infoOpen, press: actions.toggleInfo },
      { id: 'header-menu', key: ROLE_KEYS.battleMenu.label, label: 'Menu', active: actions.menuOpen, press: actions.toggleMenu },
    ];
    let right = 1264;
    for (const b of [...buttons].reverse()) {
      const w = ctx.text.measure(b.label, { size: 14, bold: true }) + Math.max(24, ctx.text.measure(b.key, { size: 13, bold: true }) + 12) + 30;
      right -= w;
      hint(ctx, b.id, { x: right, y: 6, w, h: 32 }, b.key, b.label, b.active, b.press);
      right -= 6;
    }
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
   * Our time left this turn while the battle timer is on ("2:30"): a clock that ticks while it runs
   * (red when it's running low), paused while we wait for the opponent; clicking it turns it off. Off,
   * a round button with − (the menu has it too).
   */
  private drawTimer(ctx: ScreenContext, toggle: () => void): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const timer = this.store.battleTimer();
    const canToggle = this.store.canToggleTimer();
    const now = Date.now();
    if (timer && !this.store.result()) {
      const seconds = timerSecondsLeft(timer, now);
      const running = timer.since !== null;
      const low = running && seconds !== null && seconds <= LOW_SECONDS;
      const box = { x: BADGE.x, y: 7, w: BADGE.w, h: 30 };
      if (canToggle) ctx.focus.control({ id: 'header-timer', ...box, accept: toggle, skip: true });
      renderer.rect(box.x, box.y, box.w, box.h, { fill: low ? p.danger : p.rim, radius: 15 });
      const ink = low ? p.contrast : running ? p.ink : p.muted;
      // A clock whose hand ticks every second while it runs; two pause bars while it's stopped.
      const cx = box.x + 20;
      const cy = box.y + 15;
      if (running) {
        renderer.rect(cx - 7, cy - 7, 14, 14, { fill: [0, 0, 0, 0], stroke: ink, radius: 7, border: 2 });
        const angle = (seconds ?? 0) % 2 === 0 ? -Math.PI / 2 : -Math.PI / 6;
        renderer.rect(cx - 1, cy - 5, 2, 5, { fill: ink, angle: angle + Math.PI / 2 });
      } else {
        renderer.rect(cx - 4, cy - 5, 2.6, 10, { fill: ink });
        renderer.rect(cx + 2, cy - 5, 2.6, 10, { fill: ink });
      }
      const text = seconds === null ? 'On' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      write(ctx, text, box.x + 36, cy, { size: 15, bold: true }, ink);
      return;
    }
    if (canToggle && !this.store.result()) {
      const until = this.store.timerCooldownUntil();
      const cooldown = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
      // Refused (asked again too soon after turning it off): the wait, greyed, so it isn't taken for the timer.
      const look = cooldown ? { fill: p.disabledFill, border: p.disabledBorder, ink: p.disabledInk } : undefined;
      hint(ctx, 'header-timer', { x: BADGE.x, y: 6, w: BADGE.w, h: 32 }, BATTLE_SHORTCUTS.timer.label, cooldown ? `Wait ${cooldown}s` : 'Timer', false, toggle, look);
    }
  }
}

/** A key chip and its action, for legends drawn by the battle's panels; returns the width used. */
export function legendItem(ctx: ScreenContext, key: string, text: string, x: number, cy: number, color?: Rgba): number {
  const width = keyChip(ctx, key, x, cy, 26);
  return width + 8 + write(ctx, text, x + width + 8, cy, { size: 16 }, color ?? withAlpha(ctx.palette.ink, 1));
}
