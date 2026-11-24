import { Texture, mixRgba, withAlpha } from '@core/gl/gl-renderer';
import { SLANT } from '@core/gl/ui/menu-kit';
import { Box, UiContext, label, paragraph, pill } from '@core/gl/ui/retro-kit';
import { battlePlate } from '@features/play/gl/format-carousel';
import { PlayableFormat } from '@shared/data/formats';

/** The grid: five tiles a row, the page's width, between the bar and the actions along the foot. */
const LEFT = 32;
const TOP = 84;
const COLUMNS = 5;
const TILE_W = 232;
const TILE_H = 92;
const GAP_X = 14;
const GAP_Y = 10;
const HEADING_H = 30;
const GROUP_GAP = 14;
/** How the page's categories are headed. */
const HEADINGS: Record<string, string> = { Random: 'STANDARD', 'Randomized Metas': 'RANDOMIZED METAS' };

export interface FormatGridModel {
  formats: readonly PlayableFormat[];
  /** The format picked. */
  picked: string;
  /** A search is under way (or its battle opening): the format can't change. */
  locked: boolean;
  ball: Texture | null;
  /** The search under way, on the picked tile: its two lines. */
  search: { title: string; line: string } | null;
  pick: (id: string) => void;
}

/** The focus id of a format's tile. */
export function formatTileId(id: string): string {
  return `format-${id}`;
}

/**
 * The Random Battle page's formats, every one in sight: tiles in rows of five under their category's
 * heading (the standard ones, then the Randomized Metas), each with its short name and its
 * sets. The d-pad walks the grid and A picks a tile (the focus goes on to BATTLE!); the
 * one picked is filled in Battle's colour, and while searching it shows the search, the others dimmed.
 */
export class FormatGridView {
  draw(ctx: UiContext, model: FormatGridModel): void {
    let y = TOP;
    const groups = [...new Set(model.formats.map((format) => format.category))];
    for (const category of groups) {
      label(ctx, HEADINGS[category] ?? category.toUpperCase(), LEFT + 4, y + HEADING_H / 2, { size: 15, bold: true }, ctx.palette.accentText);
      y += HEADING_H;
      const formats = model.formats.filter((format) => format.category === category);
      formats.forEach((format, i) => {
        const box = { x: LEFT + (i % COLUMNS) * (TILE_W + GAP_X), y: y + Math.floor(i / COLUMNS) * (TILE_H + GAP_Y), w: TILE_W, h: TILE_H };
        this.drawTile(ctx, model, format, box);
      });
      y += Math.ceil(formats.length / COLUMNS) * (TILE_H + GAP_Y) - GAP_Y + GROUP_GAP;
    }
    if (!model.locked) {
      // ZL/ZR step through them from anywhere on the page, as the Battle page's carousel.
      const x = LEFT + COLUMNS * (TILE_W + GAP_X) - GAP_X;
      const cy = TOP + HEADING_H / 2;
      pill(ctx, 'ZR', x - 36, cy, 24);
      pill(ctx, 'ZL', x - 80, cy, 24);
    }
  }

  private drawTile(ctx: UiContext, model: FormatGridModel, format: PlayableFormat, box: Box): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const picked = format.id === model.picked;
    const usable = !model.locked || picked;
    const focused = ctx.focus.control({ id: formatTileId(format.id), ...box, skip: !usable, accept: () => usable && model.pick(format.id) });
    const alpha = usable ? 1 : 0.45;
    const lift = focused ? 3 : 0;
    const y = box.y - lift;
    renderer.rect(box.x, box.y + 8, box.w, box.h, { fill: [0, 0, 0, (picked ? 0.2 : 0.1) * alpha], radius: 12, softness: 16, skew: SLANT });
    const plate = battlePlate(p.appearance);
    renderer.rect(box.x, y, box.w, box.h, {
      fill: withAlpha(picked ? mixRgba(p.panel, plate, 0.55) : focused ? p.select : p.panel, alpha),
      fillEnd: withAlpha(picked ? plate : mixRgba(p.panel, plate, 0.25), alpha),
      stroke: withAlpha(picked ? p.accentText : p.rim, alpha),
      border: picked ? 2 : 1,
      radius: 12,
      skew: SLANT,
    });
    const x = box.x + 18;
    const width = box.w - 36;
    const ink = withAlpha(p.ink, alpha);
    const search = picked ? model.search : null;
    if (search) {
      if (model.ball) renderer.rect(x - 2, y + 14, 24, 24, { fill: [1, 1, 1, 1], texture: model.ball, angle: now / 260 });
      label(ctx, format.short ?? format.label, x + 30, y + 26, { size: 19, bold: true }, ink, { maxWidth: width - 30 });
      label(ctx, search.title, x, y + 54, { size: 15, bold: true }, ink, { maxWidth: width, fast: true });
      label(ctx, search.line, x, y + 74, { size: 13 }, withAlpha(p.muted, alpha), { maxWidth: width });
    } else {
      // The name (it says Doubles or 2v2 when it's not singles), the sets under it.
      const name = format.short ?? format.label;
      const nameW = width;
      const size = ctx.text.measure(name, { size: 21, bold: true }) > nameW ? 17 : 21;
      label(ctx, name, x, y + 26, { size, bold: true }, ink, { maxWidth: nameW });
      paragraph(ctx, format.rules, x, y + 46, picked ? width - 26 : width, 18, { size: 14 }, withAlpha(p.muted, alpha), 2);
    }
    // The one picked: a lit dot in its corner (the console's font has no check mark).
    if (picked) {
      const cx = box.x + box.w - 30;
      renderer.rect(cx - 9, y + box.h - 29, 18, 18, { fill: p.panel, stroke: p.accentText, border: 2, radius: 9 });
      renderer.rect(cx - 4, y + box.h - 24, 8, 8, { fill: p.accentText, radius: 4 });
    }
    if (focused) renderer.rect(box.x, y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: p.accentText, border: 4, radius: 12, skew: SLANT });
  }
}
