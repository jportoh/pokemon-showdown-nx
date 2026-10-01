import { CanvasFocus } from '@core/gl/canvas-ui';
import { ListView, UiContext, button, focusRing, label } from '@core/gl/ui/retro-kit';
import { Team } from '@features/teambuilder/models/team';
import { formatName } from '@shared/data/formats';
import { TOP } from './tb-draw';

const WIDTH = 360;
const ROW_H = 64;
const ROWS = 8;
const LIST_Y = TOP + 65;
export const NEW_TEAM_ID = 'new-team';

/**
 * The teams, newest first, in the column on the left (TeamList on the canvas): New at the top, a
 * page of rows the d-pad walks (moving the list a row past the first or last one shown), and which
 * game data the teambuilder uses at the bottom. The team shown is lit.
 */
export class TeamListView {
  readonly list = new ListView('teams', ROW_H, ROWS, 0, false);

  constructor(private readonly focus: CanvasFocus) {}

  /** Focuses a team's row (showing it), or New when it isn't listed. */
  focusTeam(teams: readonly Team[], id: string | null): void {
    const index = newestFirst(teams).findIndex((team) => team.id === id);
    if (index < 0) {
      this.focus.focus(NEW_TEAM_ID);
      return;
    }
    this.list.reveal(index, teams.length);
    this.focus.focus(`teams-${index}`);
  }

  /** Whether the focus is on the list (New or a row). */
  hasFocus(): boolean {
    const id = this.focus.focused ?? '';
    return id === NEW_TEAM_ID || id.startsWith('teams-');
  }

  /** Home/End on the list: its first or last team. */
  jump(to: 'first' | 'last', count: number): void {
    this.list.jump(to, count, this.focus);
  }

  /** `interactive` false: drawn only (the editor and the validation keep the d-pad to themselves). */
  draw(
    ctx: UiContext,
    model: { teams: readonly Team[]; selectedId: string | null; dataSummary: string; interactive: boolean; create: () => void; select: (id: string) => void },
  ): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(0, TOP, WIDTH, 644, { fill: p.panel });
    renderer.rect(WIDTH - 1, TOP, 1, 644, { fill: p.outline });
    label(ctx, 'Teams', 16, TOP + 32, { size: 20, bold: true }, p.ink);
    const newBox = { x: 259, y: TOP + 14, w: 88, h: 36 };
    if (model.interactive) button(ctx, NEW_TEAM_ID, newBox, 'New', { primary: true, size: 16, accept: model.create });
    else renderer.rect(newBox.x, newBox.y, newBox.w, newBox.h, { fill: p.accent, stroke: p.bar, radius: 6, border: 2 });
    if (!model.interactive) label(ctx, 'New', newBox.x + newBox.w / 2, newBox.y + newBox.h / 2, { size: 16, bold: true }, [1, 1, 1, 1], { align: 'center' });
    renderer.rect(0, TOP + 64, WIDTH - 1, 1, { fill: p.rim });

    const teams = newestFirst(model.teams);
    if (teams.length === 0) {
      label(ctx, 'No teams yet. Use New to build one.', 16, LIST_Y + 28, { size: 16 }, p.muted, { maxWidth: 328 });
    } else if (model.interactive) {
      this.list.draw(ctx, 0, LIST_Y, WIDTH - 1, teams.length, (row) => this.drawRow(ctx, teams[row.index], row.box, row.focused, model.selectedId), (index) => model.select(teams[index].id));
    } else {
      // The same rows, drawn without being controls.
      const start = Math.max(0, Math.min(this.list.start, teams.length - ROWS));
      for (let index = start; index < Math.min(teams.length, start + ROWS); index++) {
        this.drawRow(ctx, teams[index], { x: 0, y: LIST_Y + (index - start) * ROW_H, w: WIDTH - 1, h: ROW_H }, false, model.selectedId);
      }
    }

    renderer.rect(0, TOP + 604, WIDTH - 1, 1, { fill: p.rim });
    label(ctx, model.dataSummary, 16, TOP + 624, { size: 14 }, p.muted, { maxWidth: 270 });
    const start = this.list.start;
    const arrows = `${start > 0 ? '▲' : ''}${start + ROWS < teams.length ? '▼' : ''}`;
    if (arrows) label(ctx, arrows, WIDTH - 16, TOP + 624, { size: 14 }, p.muted, { align: 'right' });
  }

  private drawRow(ctx: UiContext, team: Team, box: { x: number; y: number; w: number; h: number }, focused: boolean, selectedId: string | null): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    if (team.id === selectedId || focused) renderer.rect(box.x, box.y, box.w, box.h, { fill: p.select });
    renderer.rect(box.x, box.y + box.h - 1, box.w, 1, { fill: p.rim });
    label(ctx, team.name, box.x + 16, box.y + 22, { size: 16, bold: true }, p.ink, { maxWidth: box.w - 32 });
    label(ctx, summary(team), box.x + 16, box.y + 44, { size: 14 }, p.muted, { maxWidth: box.w - 32 });
    if (focused) focusRing(ctx, box, 4);
  }
}

/** Listed newest first: the team just built is at the top (they're stored in creation order). */
export function newestFirst(teams: readonly Team[]): Team[] {
  return [...teams].reverse();
}

/** "4 Pokémon · VGC 2026 Reg M-C": the format without its "[Gen 9 Champions]" prefix, so it fits one line. */
function summary(team: Team): string {
  const count = `${team.sets.length} Pokémon`;
  return team.format ? `${count} · ${formatName(team.format).replace(/^\[[^\]]*\]\s*/, '')}` : count;
}
