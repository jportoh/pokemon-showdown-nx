import { computed, inject } from '@angular/core';
import { GlTheme, Palette } from '@core/gl/ui/gl-theme';
import { ChampionsDex } from '@core/dex/champions-dex';
import { sheetRows } from '@features/battle/gl/screen/sheet-rows';
import { BattleLogEntry } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { Rgba } from '@core/gl/gl-renderer';
import { TextStyle } from '@core/gl/gl-textures';
import { CARD, FaceSide, SLOTS, TOP, drawHalves, drawHero, drawIcon, heroFromRow, iconBox } from './face-off';
import { INK, ScreenContext, write } from './screen-context';

/** Battle info's Log tab, under its tabs. */
const LOG_X = 16;
const LOG_Y = 104;
const LOG_W = 1248;
const LOG_H = 604;
const LOG_TEXT_W = LOG_W - 40;
/** The rows' block inside its padding (12px over, 12px under). */
const LOG_ROOM = LOG_H - 24;
const PAGE_STEP_ENTRIES = 3;
/** Chat messages' lines start after their mark. */
const CHAT_INDENT = 14;

interface LogStyle {
  style: TextStyle;
  color: Rgba;
  lineHeight: number;
  /** Space above and below the entry's lines. */
  before: number;
  after: number;
  width: number;
}

const LOG_STYLES: Record<BattleLogEntry['kind'], LogStyle> = {
  turn: { style: { size: 22, bold: true }, color: INK.white, lineHeight: 34, before: 16, after: 8, width: LOG_TEXT_W - 16 },
  minor: { style: { size: 18 }, color: INK.gray300, lineHeight: 26, before: 0, after: 0, width: LOG_TEXT_W },
  result: { style: { size: 22, bold: true }, color: INK.yellow200, lineHeight: 34, before: 10, after: 0, width: LOG_TEXT_W },
  message: { style: { size: 20 }, color: INK.gray100, lineHeight: 30, before: 0, after: 0, width: LOG_TEXT_W },
  chat: { style: { size: 20 }, color: INK.white, lineHeight: 30, before: 4, after: 4, width: LOG_TEXT_W - CHAT_INDENT },
};

/** A chat message's text, after its author's name: "Jorge: gg". */
export function chatText(entry: BattleLogEntry): string {
  return entry.author ? `${entry.author}: ${entry.text}` : entry.text;
}

/**
 * The battle log, Battle info's Log tab (1248x604): a turn header per turn, each
 * message, minor details in smaller grey text, the result in yellow, chat messages marked in sky blue
 * by the side (the author's name too; the server's notices grey); the newest entries that fit,
 * unless the reader has paged back with the d-pad. On the canvas each entry's lines are measured
 * exactly.
 */
export class LogView {
  private readonly store = inject(BattleStore);
  /** Where the window ends, or null to follow the newest entries. */
  private end: number | null = null;
  private readonly wrapped = new Map<number, string[]>();

  /** Opening shows the newest entries. */
  reset(): void {
    this.end = null;
  }

  /** The d-pad while it's open: moves the window a few entries; false at that end already. */
  page(step: 'up' | 'down' | 'first' | 'last', ctx: ScreenContext | null): boolean {
    if (!ctx) return false;
    const log = this.store.log();
    const { start, end } = this.window(ctx);
    const firstPageEnd = this.fitEnd(ctx, log, 0);
    switch (step) {
      case 'up':
        if (start === 0) return false;
        this.end = Math.min(end - 1, Math.max(end - PAGE_STEP_ENTRIES, firstPageEnd));
        return true;
      case 'down': {
        if (this.end === null) return false;
        const next = end + PAGE_STEP_ENTRIES;
        this.end = next >= log.length ? null : next;
        return true;
      }
      case 'first':
        this.end = Math.min(firstPageEnd, log.length);
        return true;
      case 'last':
        this.end = null;
        return true;
    }
  }

  draw(ctx: ScreenContext): void {
    const { renderer } = ctx;
    renderer.rect(LOG_X, LOG_Y, LOG_W, LOG_H, { fill: INK.card, radius: 10 });
    const log = this.store.log();
    const { start, end } = this.window(ctx);
    let y = LOG_Y + 12;
    for (let i = start; i < end; i++) {
      const entry = log[i];
      const look = LOG_STYLES[entry.kind];
      const lines = this.lines(ctx, entry);
      y += look.before;
      if (entry.kind === 'turn') renderer.rect(LOG_X + 20, y - 2, LOG_TEXT_W, lines.length * look.lineHeight + 4, { fill: INK.stage, radius: 4 });
      if (entry.kind === 'chat') this.drawChat(ctx, entry, lines, y);
      else {
        const x = LOG_X + 20 + (entry.kind === 'turn' ? 10 : 0);
        lines.forEach((line, n) => write(ctx, line, x, y + look.lineHeight * n + look.lineHeight / 2, look.style, look.color));
      }
      y += lines.length * look.lineHeight + look.after;
    }
    if (start > 0) write(ctx, '▲', LOG_X + LOG_W - 16, LOG_Y + 14, { size: 16 }, INK.gray400, 'center');
    if (this.end !== null) write(ctx, '▼', LOG_X + LOG_W - 16, LOG_Y + LOG_H - 14, { size: 16 }, INK.gray400, 'center');
  }

  /** A chat message: a sky-blue mark by its lines, its author's name in sky blue; the server's notices grey. */
  private drawChat(ctx: ScreenContext, entry: BattleLogEntry, lines: string[], top: number): void {
    const look = LOG_STYLES.chat;
    const x = LOG_X + 20 + CHAT_INDENT;
    ctx.renderer.rect(LOG_X + 20, top, 4, lines.length * look.lineHeight, { fill: entry.author ? INK.sky300 : INK.gray500, radius: 2 });
    const color = entry.author ? look.color : INK.gray300;
    const prefix = entry.author ? `${entry.author}:` : '';
    lines.forEach((line, n) => {
      const cy = top + look.lineHeight * n + look.lineHeight / 2;
      if (n === 0 && prefix && line.startsWith(prefix)) {
        const width = write(ctx, prefix, x, cy, look.style, INK.sky300);
        write(ctx, line.slice(prefix.length), x + width, cy, look.style, color);
      } else {
        write(ctx, line, x, cy, look.style, color);
      }
    });
  }

  private lines(ctx: ScreenContext, entry: BattleLogEntry): string[] {
    let lines = this.wrapped.get(entry.id);
    if (!lines) {
      const look = LOG_STYLES[entry.kind];
      lines = ctx.text.wrap(entry.kind === 'chat' ? chatText(entry) : entry.text, look.style, look.width);
      if (this.wrapped.size > 600) this.wrapped.clear();
      this.wrapped.set(entry.id, lines);
    }
    return lines;
  }

  private height(ctx: ScreenContext, entry: BattleLogEntry): number {
    const look = LOG_STYLES[entry.kind];
    return look.before + this.lines(ctx, entry).length * look.lineHeight + look.after;
  }

  private window(ctx: ScreenContext): { start: number; end: number } {
    const log = this.store.log();
    const end = this.end === null ? log.length : Math.min(this.end, log.length);
    let used = 0;
    let start = end;
    while (start > 0) {
      used += this.height(ctx, log[start - 1]);
      if (used > LOG_ROOM && start < end) break;
      start--;
    }
    return { start, end };
  }

  private fitEnd(ctx: ScreenContext, log: readonly BattleLogEntry[], start: number): number {
    let used = 0;
    let end = start;
    while (end < log.length) {
      used += this.height(ctx, log[end]);
      if (used > LOG_ROOM && end > start) break;
      end++;
    }
    return end;
  }
}

/** The retro palette of the theme chosen in Settings (GlTheme); call it in an injection context. */
export function retroPalette(): Palette {
  return inject(GlTheme).palette();
}

/**
 * A spectator's team preview, face to face like our own team select (face-off.ts) but without
 * picks: while the players choose theirs, p1 on the left and p2 on the right, each side's six down
 * its edge and the one in focus big over a card with its set (from an open team sheet, else its
 * abilities and speed). ▲▼ go down a column, ◀▶ cross over; B leaves as anywhere else when watching.
 */
export class TeamsOverviewView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly palette = retroPalette();

  readonly shown = computed(() => this.store.spectating() && this.store.teamPreview());

  /** Where the focus starts. */
  readonly firstId = 'watch-left-0';

  private readonly teams = computed(() => {
    const { p1, p2 } = this.store.sides();
    const sheets = this.store.teamSheets();
    return {
      left: sheetRows(p1.preview, sheets.p1, this.dex, 0, 0).slice(0, SLOTS).map(heroFromRow),
      right: sheetRows(p2.preview, sheets.p2, this.dex, 0, 0).slice(0, SLOTS).map(heroFromRow),
    };
  });

  /** Each side's Pokémon shown big (the last one the focus was on), and since when, for its slide in. */
  private readonly showing = { left: { index: 0, since: -1e4 }, right: { index: 0, since: -1e4 } };
  private active: FaceSide = 'left';

  /** Whether one of its icons has the focus (else the screen takes it, at its first). */
  owns(id: string | null): boolean {
    return !!id && id.startsWith('watch-');
  }

  draw(ctx: ScreenContext): void {
    const p = this.palette;
    this.followFocus(ctx);
    drawHalves(ctx, p, true);
    const { p1, p2 } = this.store.sides();
    write(ctx, 'Team preview', 640, TOP + 24, { size: 20, bold: true }, p.ink, 'center', 400);
    write(ctx, p1.name, CARD.left, TOP + 24, { size: 20, bold: true }, p.accentText, 'left', 300);
    write(ctx, p2.name, CARD.right + CARD.w, TOP + 24, { size: 20, bold: true }, INK.red300, 'right', 300);

    const teams = this.teams();
    for (const side of ['left', 'right'] as const) {
      const team = teams[side];
      team.forEach((set, i) => {
        const box = iconBox(side, i);
        const focused = ctx.focus.control({ id: `watch-${side}-${i}`, ...box, move: (direction) => this.move(ctx, side, i, direction) });
        drawIcon(ctx, p, box, set, side, i === this.showing[side].index, focused, null, false);
      });
      const hero = team[this.showing[side].index];
      if (hero) drawHero(ctx, p, hero, side, this.showing[side].since, this.active === side);
    }

    const dots = '.'.repeat(1 + (Math.floor(ctx.now / 500) % 3));
    write(ctx, `The players are picking their Pokémon${dots}`, 640, 640, { size: 20, bold: true }, p.teal, 'center', 760);
    write(ctx, '▲▼ team · ◀▶ sides · ZR battle info · B leave', 640, 680, { size: 15 }, p.muted, 'center', 760);
  }

  /** The side and Pokémon shown follow the focus: a new one slides in. */
  private followFocus(ctx: ScreenContext): void {
    const match = /^watch-(left|right)-(\d+)$/.exec(ctx.focus.focused ?? '');
    if (!match) return;
    const side = match[1] as FaceSide;
    const index = Number(match[2]);
    if (this.showing[side].index !== index) this.showing[side] = { index, since: ctx.now };
    this.active = side;
  }

  /** ▲▼ along a column, ◀▶ across to the other column's Pokémon in view. */
  private move(ctx: ScreenContext, side: FaceSide, index: number, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const count = this.teams()[side].length;
    if (direction === 'up' && index > 0) ctx.focus.focus(`watch-${side}-${index - 1}`);
    else if (direction === 'down' && index < count - 1) ctx.focus.focus(`watch-${side}-${index + 1}`);
    else if ((direction === 'right' && side === 'left') || (direction === 'left' && side === 'right')) {
      const other: FaceSide = side === 'left' ? 'right' : 'left';
      if (this.teams()[other].length > 0) ctx.focus.focus(`watch-${other}-${this.showing[other].index}`);
    }
    return true;
  }
}
