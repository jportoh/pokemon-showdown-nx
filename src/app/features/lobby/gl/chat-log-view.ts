import { Rgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { TextStyle } from '@core/gl/gl-textures';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { ChatMessage, ChatUser } from '@features/lobby/models/chat';
import { usernameColor } from '@shared/utils/username-color';

const LINE_H = 28;
const PAD_X = 12;
const PAD_Y = 8;
const TEXT: TextStyle = { size: 18 };
const BOLD: TextStyle = { size: 18, bold: true };
const STAFF_RANKS = ['~', '&', '#', '@'];
/**
 * Users listed: the lobby has ~600, sorted by rank, so staff always show. Drawn a page at a time, but
 * a list this long is enough to find anyone worth finding on a console.
 */
const MAX_LISTED_USERS = 50;

/** A piece of a line: its text, colour (its own, or the theme's) and weight. */
interface Part {
  text: string;
  color: Rgba | 'ink' | 'muted' | 'danger';
  bold?: boolean;
}

/** One line as drawn, its parts one after another; dim (an away user) at 60%. */
interface Line {
  key: string;
  parts: Part[];
  dim?: boolean;
}

/**
 * A scrolling list of lines in a box (the chat's log, or its users), drawn on the canvas: the lines
 * that fit, glyph by glyph from the atlas (they change all the time). Focused, the d-pad scrolls it a
 * line at a time, and lets go past either end (to the controls around it). With `follow`, it keeps to
 * the newest line until scrolled up, and then stays on the lines being read while new ones arrive.
 */
class LineList {
  /** The first line shown while scrolled; null while following the end. */
  private anchor: string | null = null;
  private start = 0;

  constructor(
    readonly id: string,
    private readonly follow: boolean,
  ) {}

  /** Back to the end (or the top, without `follow`): a new room, a list shown again. */
  reset(): void {
    this.anchor = null;
    this.start = 0;
  }

  draw(ctx: UiContext, box: Box, lines: readonly Line[]): void {
    const p = ctx.palette;
    const visible = Math.floor((box.h - PAD_Y * 2) / LINE_H);
    const max = Math.max(0, lines.length - visible);
    if (this.follow) {
      const index = this.anchor === null ? -1 : lines.findIndex((line) => line.key === this.anchor);
      this.start = this.anchor === null ? max : index === -1 ? 0 : Math.min(index, max);
    } else {
      this.start = Math.min(this.start, max);
    }
    const focused = ctx.focus.control({
      id: this.id,
      ...box,
      move: (direction) => {
        if (direction !== 'up' && direction !== 'down') return false;
        const next = this.start + (direction === 'down' ? 1 : -1);
        if (next < 0 || next > max) return false;
        this.start = next;
        this.anchor = this.follow && next === max ? null : (lines[next]?.key ?? null);
        return true;
      },
    });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.input, radius: 6 });
    const colors = { ink: p.ink, muted: p.muted, danger: p.danger };
    lines.slice(this.start, this.start + visible).forEach((line, i) => {
      const cy = box.y + PAD_Y + i * LINE_H + LINE_H / 2;
      let x = box.x + PAD_X;
      for (const part of line.parts) {
        const color = typeof part.color === 'string' ? colors[part.color] : part.color;
        x += label(ctx, part.text, x, cy, part.bold ? BOLD : TEXT, withAlpha(color, line.dim ? 0.6 : 1), { fast: true });
      }
    });
    if (this.start > 0) label(ctx, '▲', box.x + box.w - 18, box.y + 14, { size: 14 }, p.muted, { align: 'center' });
    if (this.start < max) label(ctx, '▼', box.x + box.w - 18, box.y + box.h - 14, { size: 14 }, p.muted, { align: 'center' });
    if (focused) focusRing(ctx, box);
  }
}

/** Width of text as the atlas draws it (when it covers the text), else as a texture would. */
function measure(ctx: UiContext, text: string, style: TextStyle): number {
  const glyphs = ctx.text.glyphs;
  return glyphs?.covers(text) ? glyphs.measure(text, style) : ctx.text.measure(text, style);
}

/** `text` in lines: the first `firstWidth` wide (after a lead), the rest `width`; long words are cut. */
function wrap(ctx: UiContext, text: string, firstWidth: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  let room = firstWidth;
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(ctx, candidate, TEXT) <= room) {
      line = candidate;
      continue;
    }
    if (line || room < width) {
      lines.push(line);
      room = width;
    }
    line = word;
    while (measure(ctx, line, TEXT) > room && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(ctx, line.slice(0, cut), TEXT) > room) cut--;
      lines.push(line.slice(0, cut));
      room = width;
      line = line.slice(cut);
    }
  }
  lines.push(line);
  return lines;
}

/** The room's log: each message wrapped to the box, its author in their colour. */
export class ChatLogView {
  private readonly list = new LineList('log', true);
  /** Each message's lines, by its ID (they never change once received). */
  private readonly layouts = new Map<number, Line[]>();
  private width = 0;

  reset(): void {
    this.list.reset();
    this.layouts.clear();
  }

  draw(ctx: UiContext, box: Box, messages: readonly ChatMessage[]): void {
    const width = box.w - PAD_X * 2 - 24;
    if (width !== this.width) {
      this.width = width;
      this.layouts.clear();
    }
    const lines: Line[] = [];
    const kept = new Set<number>();
    for (const message of messages) {
      kept.add(message.id);
      let layout = this.layouts.get(message.id);
      if (!layout) {
        layout = this.layout(ctx, message, width);
        this.layouts.set(message.id, layout);
      }
      lines.push(...layout);
    }
    for (const id of this.layouts.keys()) if (!kept.has(id)) this.layouts.delete(id);
    this.list.draw(ctx, box, lines);
  }

  private layout(ctx: UiContext, message: ChatMessage, width: number): Line[] {
    if (message.system) {
      return wrap(ctx, message.text, width, width).map((text, i) => ({ key: `${message.id}:${i}`, parts: [{ text, color: 'danger' }] }));
    }
    // A /me reads "author does something", without the colon.
    const author: Part = { text: `${message.author}${message.action ? ' ' : ': '}`, color: rgba(usernameColor(message.author)), bold: true };
    const color = message.action ? 'muted' : 'ink';
    return wrap(ctx, message.text, width - measure(ctx, author.text, BOLD), width).map((text, i) => ({
      key: `${message.id}:${i}`,
      parts: i === 0 ? [author, { text, color }] : [{ text, color }],
    }));
  }
}

/** The room's users: rank, then the name in its colour (bold for staff, dim while away). */
export class ChatUsersView {
  private readonly list = new LineList('users', false);

  reset(): void {
    this.list.reset();
  }

  draw(ctx: UiContext, box: Box, users: readonly ChatUser[], count: number): void {
    const listed = users.slice(0, MAX_LISTED_USERS);
    const lines: Line[] = listed.map((user) => ({
      key: user.id,
      parts: [
        { text: user.rank === ' ' ? '  ' : user.rank, color: 'muted' },
        { text: user.name, color: rgba(usernameColor(user.name)), bold: STAFF_RANKS.includes(user.rank) },
      ],
      dim: user.away,
    }));
    const hidden = Math.max(0, count - listed.length);
    if (hidden > 0) lines.push({ key: 'more', parts: [{ text: `…and ${hidden} more`, color: 'muted' }] });
    this.list.draw(ctx, box, lines);
  }
}
