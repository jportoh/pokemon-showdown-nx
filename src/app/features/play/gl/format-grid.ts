import { Texture, mixRgba, withAlpha } from '@core/gl/gl-renderer';
import { STAGE_W } from '@core/gl/gl-stage';
import { SLANT } from '@core/gl/ui/menu-kit';
import { Box, UiContext, label, paragraph, pill } from '@core/gl/ui/retro-kit';
import { battlePlate } from '@features/play/gl/format-carousel';
import { PlayableFormat } from '@shared/data/formats';

/** The grid: five tiles a row, the page's width. */
const LEFT = 32;
const COLUMNS = 5;
const TILE_W = 232;
const TILE_H = 92;
const GAP_X = 14;
const GAP_Y = 10;
const HEADING_H = 28;
const GROUP_GAP = 12;
/** What's shown of it: between the bar and the actions along the foot; the rest scrolls. */
const VIEW = { y: 80, h: 496 };
/** Room above the first heading and round a tile brought into view (its lift and focus border). */
const PAD = 6;
/** How fast the scroll eases to where it's going (per second). */
const SCROLL_EASE = 14;

/** The page's sections, in order: this generation's, the past ones', then the other randomized metas. */
const SECTIONS = ['CURRENT GEN', 'OTHER GENS', 'RANDOMIZED METAS'] as const;

/** A random format's section: Random Battle by its generation (Gen 9 and Champions are current), else the metas. */
function sectionOf(format: PlayableFormat): string {
  if (format.category !== 'Random') return format.category.toUpperCase();
  return pastGen(format) ? 'OTHER GENS' : 'CURRENT GEN';
}

/** A past generation's number (gen1… gen8), or null for the current one. */
function pastGen(format: PlayableFormat): number | null {
  const gen = /^gen([1-8])(?!\d)/.exec(format.id);
  return gen ? Number(gen[1]) : null;
}

export interface FormatGridModel {
  formats: readonly PlayableFormat[];
  /** Formats coming later: shown in their place, greyed with SOON, never picked. */
  upcoming: readonly PlayableFormat[];
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

interface GridTile {
  format: PlayableFormat;
  id: string;
  x: number;
  /** From the top of the grid's content. */
  y: number;
  /** Its row, counted through all the sections, and its place in it. */
  row: number;
  col: number;
  /** In its section's first row (its heading comes into view with it). */
  firstRow: boolean;
  /** Coming later: greyed, SOON, the focus passes it by. */
  soon: boolean;
}

interface GridLayout {
  headings: { title: string; y: number }[];
  tiles: GridTile[];
  /** Each row's tiles, through all the sections. */
  rows: GridTile[][];
  height: number;
}

/** Where everything goes, from the top of the content: each section's heading, then its rows of tiles. */
function layoutGrid(playable: readonly PlayableFormat[], upcoming: readonly PlayableFormat[]): GridLayout {
  const formats = [...playable, ...upcoming];
  const headings: GridLayout['headings'] = [];
  const tiles: GridTile[] = [];
  const rows: GridTile[][] = [];
  const titles = [...new Set(formats.map(sectionOf))].sort((a, b) => order(a) - order(b));
  let y = PAD;
  for (const title of titles) {
    // Past generations newest first, as Showdown lists them.
    const members = formats.filter((format) => sectionOf(format) === title).sort((a, b) => (pastGen(b) ?? 0) - (pastGen(a) ?? 0));
    headings.push({ title, y });
    y += HEADING_H;
    members.forEach((format, i) => {
      const col = i % COLUMNS;
      if (col === 0) rows.push([]);
      const tile: GridTile = {
        format,
        id: formatTileId(format.id),
        x: LEFT + col * (TILE_W + GAP_X),
        y: y + Math.floor(i / COLUMNS) * (TILE_H + GAP_Y),
        row: rows.length - 1,
        col,
        firstRow: i < COLUMNS,
        soon: upcoming.includes(format),
      };
      rows[rows.length - 1].push(tile);
      tiles.push(tile);
    });
    y += Math.ceil(members.length / COLUMNS) * (TILE_H + GAP_Y) - GAP_Y + GROUP_GAP;
  }
  return { headings, tiles, rows, height: y - GROUP_GAP + PAD };
}

function order(section: string): number {
  const index = (SECTIONS as readonly string[]).indexOf(section);
  return index < 0 ? SECTIONS.length : index;
}

/**
 * The Random Battle page's formats: tiles in rows of five under their section's heading (this
 * generation's, the past ones', the other randomized metas), each with its short name and its sets,
 * scrolling once there are more than fit; formats still to come show in their place, greyed with SOON. The d-pad walks the grid row by row (the view follows the
 * focus; down from the last row reaches the actions) and A picks a tile (the focus goes on to
 * BATTLE!); the one picked is filled in Battle's colour, and while searching it shows the search,
 * the others dimmed.
 */
export class FormatGridView {
  private layout: GridLayout | null = null;
  private formats: readonly PlayableFormat[] | null = null;
  private scroll = 0;
  private target = 0;
  private placed = false;
  private lastNow = 0;

  draw(ctx: UiContext, model: FormatGridModel): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    if (this.formats !== model.formats || !this.layout) {
      this.formats = model.formats;
      this.layout = layoutGrid(model.formats, model.upcoming);
    }
    const dt = this.lastNow ? Math.min(0.1, (ctx.now - this.lastNow) / 1000) : 0;
    this.lastNow = ctx.now;
    const layout = this.layout;
    const maxScroll = Math.max(0, layout.height - VIEW.h);
    // The focused tile in full view, with its heading when it's in a section's first row; on the first
    // frame, straight to it (the page opens on the format picked).
    const focused = layout.tiles.find((tile) => tile.id === ctx.focus.focused) ?? (this.placed ? null : layout.tiles.find((tile) => tile.format.id === model.picked));
    if (focused) {
      const top = focused.y - (focused.firstRow ? HEADING_H : 0) - PAD;
      const bottom = focused.y + TILE_H + PAD * 2;
      if (top < this.target) this.target = top;
      if (bottom > this.target + VIEW.h) this.target = bottom - VIEW.h;
    }
    this.target = Math.min(maxScroll, Math.max(0, this.target));
    if (!this.placed) this.scroll = this.target;
    this.placed = true;
    this.scroll += (this.target - this.scroll) * (1 - Math.exp(-SCROLL_EASE * dt));
    if (Math.abs(this.target - this.scroll) < 0.5) this.scroll = this.target;
    const top = VIEW.y - this.scroll;

    renderer.clip({ x: 0, y: VIEW.y, w: STAGE_W, h: VIEW.h });
    for (const heading of layout.headings) {
      label(ctx, heading.title, LEFT + 4, top + heading.y + HEADING_H / 2, { size: 15, bold: true }, p.accentText);
    }
    if (!model.locked && layout.headings.length > 0) {
      // ZL/ZR step through them from anywhere on the page, as the Battle page's carousel.
      const x = LEFT + COLUMNS * (TILE_W + GAP_X) - GAP_X;
      const cy = top + layout.headings[0].y + HEADING_H / 2;
      pill(ctx, 'ZR', x - 36, cy, 24);
      pill(ctx, 'ZL', x - 80, cy, 24);
    }
    for (const tile of layout.tiles) this.drawTile(ctx, model, tile, top + tile.y);
    renderer.clip(null);

    if (maxScroll > 0) {
      // Where the view is: a thin bar at the right edge.
      const track = { x: STAGE_W - 14, y: VIEW.y + 8, w: 4, h: VIEW.h - 16 };
      const thumbH = Math.max(32, (track.h * VIEW.h) / layout.height);
      renderer.rect(track.x, track.y, track.w, track.h, { fill: withAlpha(p.rim, 0.5), radius: 2 });
      renderer.rect(track.x, track.y + ((track.h - thumbH) * this.scroll) / maxScroll, track.w, thumbH, { fill: p.accentText, radius: 2 });
    }
  }

  /**
   * The pickable tile beside it, or in the nearest row above or below that has one (the nearest column
   * there); false past the grid's foot. Tiles coming SOON are passed by.
   */
  private move(ctx: UiContext, tile: GridTile, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const rows = this.layout?.rows ?? [];
    if (direction === 'left' || direction === 'right') {
      const step = direction === 'left' ? -1 : 1;
      const row = rows[tile.row];
      for (let col = tile.col + step; col >= 0 && col < row.length; col += step) {
        if (row[col].soon) continue;
        ctx.focus.focus(row[col].id);
        break;
      }
      return true;
    }
    const step = direction === 'up' ? -1 : 1;
    for (let index = tile.row + step; index >= 0 && index < rows.length; index += step) {
      const open = rows[index].filter((other) => !other.soon);
      if (open.length === 0) continue;
      const nearest = open.reduce((best, other) => (Math.abs(other.col - tile.col) < Math.abs(best.col - tile.col) ? other : best));
      ctx.focus.focus(nearest.id);
      return true;
    }
    // Down from the last row: the actions along the foot (the focus's own way).
    return direction === 'up';
  }

  private drawTile(ctx: UiContext, model: FormatGridModel, tile: GridTile, screenY: number): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const format = tile.format;
    const picked = format.id === model.picked;
    const usable = !tile.soon && (!model.locked || picked);
    // Its control only where it shows: a tile scrolled out of view can't be clicked, and the d-pad only
    // reaches it through the grid (it then scrolls into view).
    const shownTop = Math.max(screenY, VIEW.y);
    const shownBottom = Math.min(screenY + TILE_H, VIEW.y + VIEW.h);
    const shown = shownBottom > shownTop;
    const edge = screenY < VIEW.y ? VIEW.y : VIEW.y + VIEW.h;
    const focused = ctx.focus.control({
      id: tile.id,
      x: tile.x,
      y: shown ? shownTop : edge,
      w: TILE_W,
      h: shown ? shownBottom - shownTop : 0,
      skip: !usable || !shown,
      accept: () => usable && model.pick(format.id),
      // While searching, only the picked one can have the focus: the focus's own way, over the others.
      move: (direction) => !model.locked && this.move(ctx, tile, direction),
    });
    if (!shown) return;
    const box: Box = { x: tile.x, y: screenY, w: TILE_W, h: TILE_H };
    const alpha = usable ? 1 : tile.soon ? 0.55 : 0.45;
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
      const size = ctx.text.measure(name, { size: 21, bold: true }) > width ? 17 : 21;
      label(ctx, name, x, y + 26, { size, bold: true }, ink, { maxWidth: width });
      paragraph(ctx, format.rules, x, y + 46, tile.soon ? width - 64 : picked ? width - 26 : width, 18, { size: 14 }, withAlpha(p.muted, alpha), 2);
    }
    // Coming later: SOON on a chip at the bottom right.
    if (tile.soon) {
      const chipStyle = { size: 12, bold: true };
      const chipW = ctx.text.measure('SOON', chipStyle) + 18;
      const chipX = box.x + box.w - 22 - chipW;
      renderer.rect(chipX, y + box.h - 30, chipW, 20, { fill: p.accent, radius: 10 });
      label(ctx, 'SOON', chipX + chipW / 2, y + box.h - 20, chipStyle, [1, 1, 1, 1], { align: 'center' });
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
