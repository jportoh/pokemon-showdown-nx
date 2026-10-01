import { computed, inject } from '@angular/core';
import { ListView, UiContext, button, focusRing, label } from '@core/gl/ui/retro-kit';
import { Team } from '@features/teambuilder/models/team';
import { TeamValidation } from '@features/teambuilder/state/team-validation';
import { formatName } from '@shared/data/formats';
import { PANEL_X, TOP, WrapCache } from './tb-draw';

const BOX = { x: PANEL_X + 24, y: TOP + 140, w: 872, h: 428 };
const ROW_H = 58;
const ROWS = 7;
export const VALIDATION_BACK_ID = 'validation-back';

/**
 * What the Showdown server said of a team (TeamValidationPanel on the canvas): checking, valid, or
 * rejected with its reasons, a page of them at a time (the d-pad walks them and moves the list past
 * the first or last one shown). Back, focused on opening, returns to the team.
 */
export class ValidationView {
  private readonly validation = inject(TeamValidation);
  private readonly list = new ListView('problem', ROW_H, ROWS, 0, true);
  private readonly wraps = new WrapCache();

  private readonly status = computed(() => this.validation.result()?.status ?? 'checking');
  private readonly message = computed(() => {
    const result = this.validation.result();
    return !result || result.status === 'checking' ? 'Checking with the Showdown server…' : result.message;
  });
  private readonly problems = computed(() => this.validation.result()?.problems ?? []);

  /** Starts checking a team; the list starts at its top. */
  validate(team: Team): void {
    this.list.start = 0;
    this.validation.validate(team);
  }

  draw(ctx: UiContext, team: Team, back: () => void): void {
    const p = ctx.palette;
    const x = PANEL_X + 24;
    label(ctx, `Validate: ${team.name}`, x, TOP + 44, { size: 20, bold: true }, p.ink, { maxWidth: 872 });
    label(ctx, formatName(team.format), x, TOP + 80, { size: 16 }, p.muted, { maxWidth: 872 });
    const status = this.status();
    const color = status === 'checking' ? p.muted : status === 'valid' ? p.teal : p.danger;
    label(ctx, this.message(), x, TOP + 116, { size: 18, bold: true }, color, { maxWidth: 872 });

    const problems = this.problems();
    if (problems.length > 0) {
      ctx.renderer.rect(BOX.x, BOX.y, BOX.w, BOX.h, { fill: p.panel, stroke: p.rim, radius: 6, border: 2 });
      this.list.draw(
        ctx,
        BOX.x + 2,
        BOX.y + 8,
        BOX.w - 4,
        problems.length,
        (row) => {
          const { box } = row;
          if (row.index < problems.length - 1) ctx.renderer.rect(box.x, box.y + box.h - 1, box.w, 1, { fill: p.rim });
          this.wraps.draw(ctx, problems[row.index], box.x + 12, box.y + 6, box.w - 24, 22, { size: 16 }, p.ink, 2);
          if (row.focused) focusRing(ctx, box, 4);
        },
        () => undefined,
      );
    }
    button(ctx, VALIDATION_BACK_ID, { x, y: TOP + 584, w: 120, h: 40 }, 'Back', { size: 16, accept: back });
  }
}
