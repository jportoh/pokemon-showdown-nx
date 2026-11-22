import { Rgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { TextStyle } from '@core/gl/gl-textures';
import { menuFocus } from '@core/gl/ui/menu-kit';
import { Box, UiContext, label } from '@core/gl/ui/retro-kit';
import { ChatMessage, ChatUser } from '@features/lobby/models/chat';
import { toId } from '@shared/utils/to-id';
import { usernameColor } from '@shared/utils/username-color';

const LINE_H = 28;
const PAD_X = 12;
const PAD_Y = 8;
const TEXT: TextStyle = { size: 18 };
const BOLD: TextStyle = { size: 18, bold: true };
const HEADING: TextStyle = { size: 13, bold: true };
const STAFF_RANKS = ['~', '&', '#', '@'];
/**
 * Users listed: the lobby has ~600, sorted by rank, so staff always show. Drawn a page at a time, but
 * a list this long is enough to find anyone worth finding on a console.
 */
const MAX_LISTED_USERS = 50;

/** Each user's colour, converted once per appearance (the lines are cached, so they keep only the name). */
const userColors = new Map<string, Rgba>();
function userColor(name: string, light: boolean): Rgba {
  const key = `${light ? 'l' : 'd'}:${name}`;
  let color = userColors.get(key);
  if (!color) {
    color = rgba(usernameColor(name, light));
    userColors.set(key, color);
  }
  return color;
}

/** A piece of a line: its text, colour (a user's own, or the theme's) and weight. */
interface Part {
  text: string;
  color: { user: string } | 'ink' | 'muted' | 'danger';
  bold?: boolean;
  /** Where it starts, from the line's left (a column); right after the part before it otherwise. */
  at?: number;
  /** Cut to this width (a column's). */
  maxWidth?: number;
  /** Small bold text: a section's heading. */
  heading?: boolean;
}

/**
 * One line as drawn, its parts one after another; dim (an away user) at 60%. `mine` (our own
 * message) is drawn on the selection colour, `named` (a message that says our name) on amber with a
 * bar at its left.
 */
interface Line {
  key: string;
  parts: Part[];
  dim?: boolean;
  tone?: 'mine' | 'named';
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
    const colors = { ink: p.ink, muted: p.muted, danger: p.danger };
    const light = p.appearance === 'light';
    lines.slice(this.start, this.start + visible).forEach((line, i) => {
      const top = box.y + PAD_Y + i * LINE_H;
      const cy = top + LINE_H / 2;
      if (line.tone === 'mine') ctx.renderer.rect(box.x + 4, top, box.w - 32, LINE_H, { fill: p.select, radius: 8 });
      if (line.tone === 'named') {
        ctx.renderer.rect(box.x + 4, top, box.w - 32, LINE_H, { fill: withAlpha(p.teal, light ? 0.16 : 0.2), radius: 8 });
        ctx.renderer.rect(box.x + 4, top + 4, 4, LINE_H - 8, { fill: p.teal, radius: 2 });
      }
      let x = box.x + PAD_X;
      for (const part of line.parts) {
        const color = typeof part.color === 'string' ? colors[part.color] : userColor(part.color.user, light);
        if (part.at !== undefined) x = box.x + PAD_X + part.at;
        const style = part.heading ? HEADING : part.bold ? BOLD : TEXT;
        x += label(ctx, part.text, x, cy, style, withAlpha(color, line.dim ? 0.6 : 1), part.maxWidth ? { fast: true, maxWidth: part.maxWidth } : { fast: true });
      }
    });
    if (this.start > 0) label(ctx, '▲', box.x + box.w - 14, box.y + 14, { size: 14 }, p.accentText, { align: 'center' });
    if (this.start < max) label(ctx, '▼', box.x + box.w - 14, box.y + box.h - 14, { size: 14 }, p.accentText, { align: 'center' });
    if (focused) menuFocus(ctx, { x: box.x - 6, y: box.y - 6, w: box.w + 12, h: box.h + 12 });
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
  private me = '';
  private mention: RegExp | null = null;

  reset(): void {
    this.list.reset();
    this.layouts.clear();
  }

  /** `me`: our own name, to mark our messages and the ones that say it (empty as a guest). */
  draw(ctx: UiContext, box: Box, messages: readonly ChatMessage[], me: string): void {
    const width = box.w - PAD_X * 2 - 24;
    if (width !== this.width || me !== this.me) {
      this.width = width;
      this.me = me;
      this.mention = mentionPattern(me);
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
    const author: Part = { text: `${message.author}${message.action ? ' ' : ': '}`, color: { user: message.author }, bold: true };
    const color = message.action ? 'muted' : 'ink';
    const mine = this.me !== '' && toId(message.author) === toId(this.me);
    const tone = mine ? 'mine' : this.mention?.test(message.text) ? 'named' : undefined;
    return wrap(ctx, message.text, width - measure(ctx, author.text, BOLD), width).map((text, i) => ({
      key: `${message.id}:${i}`,
      parts: i === 0 ? [author, { text, color }] : [{ text, color }],
      tone,
    }));
  }
}

/** The room's users: rank, then the name in its colour (bold for staff, dim while away). */
export class ChatUsersView {
  private readonly list = new LineList('users', false);

  reset(): void {
    this.list.reset();
  }

  /**
   * The staff first, then everyone else (voices too), each under its heading and in `columns`
   * columns, a line per row of them. An away user's name is muted and followed by "zZ".
   */
  draw(ctx: UiContext, box: Box, users: readonly ChatUser[], count: number, columns = 3): void {
    const listed = users.slice(0, MAX_LISTED_USERS);
    const staff = listed.filter((user) => user.rank !== ' ' && user.rank !== '+');
    const others = listed.filter((user) => user.rank === ' ' || user.rank === '+');
    const columnW = Math.floor((box.w - PAD_X * 2 - 24) / columns);
    const lines: Line[] = [];
    const section = (key: string, heading: string, group: readonly ChatUser[]): void => {
      if (group.length === 0) return;
      lines.push({ key: `h-${key}`, parts: [{ text: heading, color: 'muted', heading: true }] });
      for (let i = 0; i < group.length; i += columns) {
        const row = group.slice(i, i + columns);
        lines.push({
          key: `${key}-${row[0].id}`,
          parts: row.flatMap((user, c): Part[] => [
            { text: user.rank === ' ' ? '' : user.rank, color: 'muted', bold: true, at: c * columnW },
            {
              text: user.away ? `${user.name} zZ` : user.name,
              color: user.away ? 'muted' : { user: user.name },
              bold: STAFF_RANKS.includes(user.rank),
              at: c * columnW + 24,
              maxWidth: columnW - 34,
            },
          ]),
        });
      }
    };
    section('staff', `STAFF · ${staff.length}`, staff);
    section('users', `EVERYONE ELSE · ${Math.max(others.length, count - staff.length)}`, others);
    const hidden = Math.max(0, count - listed.length);
    if (hidden > 0) lines.push({ key: 'more', parts: [{ text: `…and ${hidden} more`, color: 'muted' }] });
    this.list.draw(ctx, box, lines);
  }
}

/** Our name as a whole word, in any case (how Showdown highlights a message); none without a name. */
function mentionPattern(name: string): RegExp | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
}
