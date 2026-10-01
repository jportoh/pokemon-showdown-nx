import { computed, inject } from '@angular/core';
import { GlTheme, Palette } from '@core/gl/ui/gl-theme';
import { ChampionsDex } from '@core/dex/champions-dex';
import { moveType } from '@core/dex/moves';
import { sheetRows } from '@features/battle/gl/screen/sheet-rows';
import { BattleLogEntry } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { unpackTeamSheet } from '@features/battle/state/team-sheet';
import { Rgba, rgba } from '@core/gl/gl-renderer';
import { TextStyle } from '@core/gl/gl-textures';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { INK, ScreenContext, write } from './screen-context';

const LOG_X = 582;
const LOG_Y = 48;
const LOG_W = 415;
const LOG_H = 500;
const LOG_TEXT_W = LOG_W - 24;
/** The rows' block inside its padding (8px over, 12px under). */
const LOG_ROOM = LOG_H - 20;
const PAGE_STEP_ENTRIES = 3;

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
  turn: { style: { size: 18, bold: true }, color: INK.white, lineHeight: 28, before: 14, after: 6, width: LOG_TEXT_W - 16 },
  minor: { style: { size: 14 }, color: INK.gray300, lineHeight: 20, before: 0, after: 0, width: LOG_TEXT_W },
  result: { style: { size: 18, bold: true }, color: INK.yellow200, lineHeight: 28, before: 8, after: 0, width: LOG_TEXT_W },
  message: { style: { size: 16 }, color: INK.gray100, lineHeight: 24, before: 0, after: 0, width: LOG_TEXT_W },
};

/**
 * The battle log over the field's right part (415x500): a turn header per turn, each
 * message, minor details in smaller grey text, the result in yellow; the newest entries that fit,
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
    renderer.rect(LOG_X, LOG_Y, LOG_W, LOG_H, { fill: INK.card });
    const log = this.store.log();
    const { start, end } = this.window(ctx);
    let y = LOG_Y + 8;
    for (let i = start; i < end; i++) {
      const entry = log[i];
      const look = LOG_STYLES[entry.kind];
      const lines = this.lines(ctx, entry);
      y += look.before;
      if (entry.kind === 'turn') renderer.rect(LOG_X + 12, y - 2, LOG_TEXT_W, lines.length * look.lineHeight + 4, { fill: INK.stage, radius: 2 });
      const x = LOG_X + 12 + (entry.kind === 'turn' ? 8 : 0);
      lines.forEach((line, n) => write(ctx, line, x, y + look.lineHeight * n + look.lineHeight / 2, look.style, look.color));
      y += lines.length * look.lineHeight + look.after;
    }
    if (start > 0) write(ctx, '▲', LOG_X + LOG_W - 14, LOG_Y + 10, { size: 12 }, INK.gray400, 'center');
    if (this.end !== null) write(ctx, '▼', LOG_X + LOG_W - 14, LOG_Y + LOG_H - 10, { size: 12 }, INK.gray400, 'center');
  }

  private lines(ctx: ScreenContext, entry: BattleLogEntry): string[] {
    let lines = this.wrapped.get(entry.id);
    if (!lines) {
      const look = LOG_STYLES[entry.kind];
      lines = ctx.text.wrap(entry.text, look.style, look.width);
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
 * A spectator's team preview, as BattleTeamsOverview: while the players pick theirs, both teams side
 * by side over the field and the column (1280x500), each Pokémon with its item, ability and moves
 * from an open team sheet, else its types.
 */
export class TeamsOverviewView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly palette = retroPalette();

  readonly shown = computed(() => this.store.spectating() && this.store.teamPreview());

  private readonly sides = computed(() => {
    const { p1, p2 } = this.store.sides();
    const sheets = this.store.teamSheets();
    return [
      { left: 12, border: INK.sky300, rows: sheetRows(p1.preview, sheets.p1, this.dex, 3, 18) },
      { left: 684, border: INK.red300, rows: sheetRows(p2.preview, sheets.p2, this.dex, 3, 18) },
    ];
  });

  draw(ctx: ScreenContext): void {
    const { renderer } = ctx;
    const p = this.palette;
    renderer.rect(0, 48, 1280, 500, { fill: p.bg });
    for (const side of this.sides()) {
      side.rows.slice(0, 6).forEach((row, i) => {
        const x = side.left;
        const y = 48 + 8 + i * 82;
        renderer.rect(x, y, 584, 78, { fill: p.panel, stroke: side.border, radius: 12, border: 2 });
        const sprite = ctx.images.sprite(row.sprite, false, ImagePriority.Screen);
        if (sprite) renderer.rect(x + 6, y + 1, 72, 72, { fill: INK.white, texture: sprite });
        write(ctx, row.name, x + 84, y + 16, { size: 20, bold: true }, p.ink, 'left', 320);
        if (row.sheet) {
          ctx.images.drawItem(row.sheet.itemId, x + 82, y + 30, 24);
          write(ctx, row.sheet.item, x + 110, y + 42, { size: 16 }, p.muted, 'left', 296);
          write(ctx, row.sheet.ability, x + 84, y + 64, { size: 14 }, p.muted, 'left', 320);
          for (const move of row.sheet.moves) {
            renderer.rect(x + 420, y + move.top, 150, 16, { fill: rgba(move.color || '#4b5563'), radius: 2 });
            write(ctx, move.name, x + 495, y + move.top + 8, { size: 12, bold: true }, INK.white, 'center', 146);
          }
        } else {
          write(ctx, row.types, x + 84, y + 42, { size: 16 }, p.muted, 'left', 320);
        }
      });
    }
    write(ctx, 'VS', 640, 48 + 250, { size: 48, bold: true }, p.accentText, 'center');
  }
}

/**
 * The opponent's open team sheet over the field, as BattleTeamSheet: their six Pokémon, each with its
 * item, ability, nature and moves. Shown with ZL; B or ZL closes it.
 */
export class TeamSheetView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);

  private readonly sheet = computed(() => {
    const packed = this.store.teamSheets().p2;
    return packed ? unpackTeamSheet(packed, this.dex) : [];
  });

  draw(ctx: ScreenContext): void {
    const { renderer } = ctx;
    const x0 = 12;
    const y0 = 48;
    renderer.rect(x0, y0, 985, 500, { fill: INK.card });
    const name = this.store.sides().p2.name;
    write(ctx, name ? `${name}'s team` : "Your opponent's team", x0 + 16, y0 + 24, { size: 20, bold: true }, INK.red300, 'left', 700);
    write(ctx, 'Open team sheet · ZL or B to close', x0 + 970, y0 + 24, { size: 14 }, INK.gray300, 'right');
    const sheet = this.sheet();
    if (sheet.length === 0) {
      write(ctx, 'No team sheet for this battle.', x0 + 492, y0 + 254, { size: 18 }, INK.gray300, 'center');
      return;
    }
    sheet.slice(0, 6).forEach((pokemon, index) => {
      const x = x0 + 12 + (index % 2) * (472 + 17);
      const y = y0 + 48 + Math.floor(index / 2) * (146 + 6);
      renderer.rect(x, y, 472, 146, { fill: INK.stage, radius: 6 });
      const sprite = ctx.images.sprite(spriteId(pokemon.species), false, ImagePriority.Screen);
      if (sprite) renderer.rect(x + 6, y + 25, 96, 96, { fill: INK.white, texture: sprite });
      write(ctx, pokemon.species, x + 112, y + 20, { size: 18, bold: true }, INK.white, 'left', 350);
      write(ctx, pokemon.item ? `@ ${pokemon.item}` : 'No item', x + 112, y + 46, { size: 16 }, INK.yellow100, 'left', 350);
      const details = [pokemon.ability, pokemon.nature && `${pokemon.nature} Nature`].filter(Boolean).join(' · ');
      write(ctx, details, x + 112, y + 70, { size: 16 }, INK.gray300, 'left', 350);
      pokemon.moves.slice(0, 4).forEach((move, i) => {
        const mx = x + 112 + (i % 2) * 178;
        const my = y + 88 + Math.floor(i / 2) * 28;
        renderer.rect(mx, my, 170, 22, { fill: rgba(typeColor(moveType(move)) || '#4b5563'), radius: 2 });
        write(ctx, move, mx + 85, my + 11, { size: 14, bold: true }, INK.white, 'center', 164);
      });
    });
  }
}
