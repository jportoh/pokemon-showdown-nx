import { computed, inject } from '@angular/core';
import { withAlpha } from '@core/gl/gl-renderer';
import { STAGE_H, STAGE_W } from '@core/gl/gl-stage';
import { ListView, UiContext, button, focusRing, label, retroBox } from '@core/gl/ui/retro-kit';
import { Team } from '@features/teambuilder/models/team';
import { TeamValidation } from '@features/teambuilder/state/team-validation';
import { WrapCache, entrance } from './tb-draw';
import { shortFormat } from './team-grid-view';

const BOX = { x: 200, y: 110, w: 880, h: 500 };
const LIST = { x: BOX.x + 28, y: BOX.y + 172, w: BOX.w - 56, h: 256 };
const ROW_H = 58;
const ROWS = 4;
export const VALIDATION_BACK_ID = 'validation-back';

/**
 * What the Showdown server said of a team (TeamValidationPanel on the canvas), as a modal over the
 * team: checking, valid, or rejected with its reasons, a page of them at a time (the d-pad walks them
 * and moves the list past the first or last one shown). It fades and rises in; Close (or B) returns.
 */
export class ValidationView {
  private readonly validation = inject(TeamValidation);
  private readonly list = new ListView('problem', ROW_H, ROWS, 8, true);
  private readonly wraps = new WrapCache();
  /** When it opened (on the next frame drawn after validate()). */
  private openedAt: number | null = null;

  private readonly status = computed(() => this.validation.result()?.status ?? 'checking');
  private readonly message = computed(() => {
    const result = this.validation.result();
    return !result || result.status === 'checking' ? 'Checking with the Showdown server…' : result.message;
  });
  private readonly problems = computed(() => this.validation.result()?.problems ?? []);

  /** Starts checking a team; the list starts at its top. */
  validate(team: Team): void {
    this.list.start = 0;
    this.openedAt = null;
    this.validation.validate(team);
  }

  draw(ctx: UiContext, team: Team, close: () => void): void {
    const p = ctx.palette;
    this.openedAt ??= ctx.now;
    const shown = entrance(ctx.now, this.openedAt, 0, 220);
    ctx.renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: withAlpha(p.bg, 0.72 * shown) });
    ctx.focus.trap();
    const box = { ...BOX, y: BOX.y + (1 - shown) * 16 };
    const dy = box.y - BOX.y;
    retroBox(ctx, box);

    const x = box.x + 28;
    label(ctx, 'Validate', x, box.y + 40, { size: 28, bold: true }, p.ink);
    label(ctx, `${team.name} · ${shortFormat(team.format)}`, x + 140, box.y + 42, { size: 20 }, p.muted, { maxWidth: box.w - 196 });
    const status = this.status();
    const color = status === 'checking' ? p.muted : status === 'valid' ? p.teal : p.danger;
    ctx.renderer.rect(x, box.y + 76, box.w - 56, 64, { fill: p.bg, radius: 10 });
    label(ctx, this.message(), x + 18, box.y + 108, { size: 22, bold: true }, color, { maxWidth: box.w - 92 });

    const problems = this.problems();
    if (problems.length > 0) {
      this.list.draw(
        ctx,
        LIST.x,
        LIST.y + dy,
        LIST.w,
        problems.length,
        (row) => {
          const { box: rowBox } = row;
          ctx.renderer.rect(rowBox.x, rowBox.y, rowBox.w, rowBox.h, { fill: row.focused ? p.select : [0, 0, 0, 0], stroke: p.rim, radius: 8, border: 2 });
          // One line or two, in the middle of the row.
          const lines = this.wraps.get(ctx, problems[row.index], { size: 18 }, rowBox.w - 32, 2).length;
          this.wraps.draw(ctx, problems[row.index], rowBox.x + 16, rowBox.y + (rowBox.h - lines * 24) / 2, rowBox.w - 32, 24, { size: 18 }, p.ink, 2);
          if (row.focused) focusRing(ctx, rowBox, 8);
        },
        () => undefined,
      );
    }
    button(ctx, VALIDATION_BACK_ID, { x, y: box.y + box.h - 64, w: 140, h: 44 }, 'Close', { size: 18, accept: close });
  }
}
