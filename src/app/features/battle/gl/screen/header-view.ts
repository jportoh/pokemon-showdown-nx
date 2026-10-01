import { computed, inject } from '@angular/core';
import { BattleStore } from '@features/battle/state/battle-store';
import { INK, ScreenContext, hint, write } from './screen-context';

/**
 * The match header across the top, 1280x48, as BattleHeader: the format (with a replay's rating, or
 * a best-of set's game and score) on the left, "p1 VS p2" centred over the field in the sides'
 * colours, the turn at the field's right edge, and over the right column a LIVE or REPLAY badge and
 * the battle log's ZR hint (clickable; the controller has ZR).
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

  draw(ctx: ScreenContext, logOpen: boolean, toggleLog: () => void): void {
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

    const turn = this.store.turn() > 0 ? `TURN ${this.store.turn()}` : this.store.teamPreview() ? 'PREVIEW' : 'STARTING…';
    renderer.rect(877, 9, 110, 28, { fill: INK.tab, radius: 14 });
    write(ctx, turn, 932, 23, { size: 14, bold: true }, INK.white, 'center', 104);

    const live = this.store.spectating();
    renderer.rect(1003, 11, 130, 24, { fill: live ? INK.red800 : INK.tab, radius: 2 });
    write(ctx, live ? 'LIVE' : 'REPLAY', 1068, 23, { size: 14, bold: true }, INK.white, 'center');

    hint(ctx, 'header-log', { x: 1141, y: 7, w: 133, h: 32 }, 'ZR', 'Battle log', logOpen, toggleLog);
  }
}
