import { computed, inject, signal } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { Rgba, rgba } from '@core/gl/gl-renderer';
import { FieldCondition, SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { conditionColor, conditionTurns } from '@features/battle/state/field-conditions';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { PokemonSheet, SheetContext, ownSheet, seenSheet } from '@features/battle/state/pokemon-sheet';
import { spriteSetOf } from '@shared/utils/sprite-id';
import { LogView } from './overlay-views';
import { PokemonSheetView } from './pokemon-sheet-view';
import { INK, ScreenContext, write } from './screen-context';
import { CARD_H, CARD_W, TeamCard, drawTeamCard, ownCard, seenCard } from './team-card';

const TOP = 44;
const TAB_Y = TOP + 8;
const TAB_W = 230;
const TAB_H = 44;
const CONTENT_Y = 104;
const GRID_X = 16;
const GAP_X = 16;
const GAP_Y = 8;
const COLUMN_W = 405;
const ROW_H = 76;

/** The team cards' focus ids: "info-card-p2-0". */
export const CARD_PREFIX = 'info-card-';

export type InfoTab = 'p2' | 'p1' | 'field' | 'log';
export const INFO_TABS: readonly InfoTab[] = ['p2', 'p1', 'field', 'log'];

interface ConditionRow {
  name: string;
  color: Rgba;
  /** "3 turns left of 5", "2 layers", "Until it's gone". */
  detail: string;
  pips: { on: boolean }[];
}

/**
 * Battle info (ZR), over the whole stage under the top bar: tabs for each side's team (every member
 * as a team card with all that's known of it: ours exact, theirs as far as the battle or their open
 * team sheet has shown), the field's conditions (weather, terrain and rooms, then each side's, with
 * their turns left) and the battle log with the chat. ZL/ZR or left/right change tabs, up/down page the
 * log, A writes a chat message there (live battles), B closes. On a team's tab the d-pad moves between
 * its cards (left/right past the edge changes tab) and A opens that member's sheet (PokemonSheetView):
 * its stats and stages, Speed, volatile conditions and moves; left/right go through the team, B back.
 */
export class InfoView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly inspection = inject(PokemonInspection);
  readonly log = new LogView();
  private readonly sheetView = new PokemonSheetView();
  /** The team member whose sheet is open (A on its card); null while the tabs show. */
  private readonly sheetTarget = signal<{ side: SideId; index: number } | null>(null);
  readonly sheetOpen = computed(() => this.sheetTarget() !== null);

  /** Our team exactly (the request's), in our own battles. */
  private readonly ownTeam = computed(() => this.store.team().length > 0 && !this.store.watching());

  private readonly sheet = computed<PokemonSheet | null>(() => {
    const target = this.sheetTarget();
    if (!target) return null;
    const { side, index } = target;
    const sides = this.store.sides();
    const ctx: SheetContext = {
      gen: this.store.gen(),
      format: this.store.format(),
      turn: this.store.turn(),
      field: this.store.field(),
      active: { p1: sides.p1.active, p2: sides.p2.active },
      doubles: this.store.gameType() === 'doubles',
    };
    const sprite = this.teams()[side][index]?.sprite ?? '';
    if (side === 'p1' && this.ownTeam()) {
      const team = this.store.team();
      const request = team[index];
      if (!request) return null;
      // The request lists the ones on the field first, in slot order.
      const activeMoves = request.active ? this.store.activeMoves()[team.filter((p) => p.active).indexOf(request)]?.moves : undefined;
      const seen = sides.p1.pokemon.find((p) => p.ident === request.ident);
      return ownSheet({ request, activeMoves, seen }, sprite, ctx);
    }
    const member = this.inspection.teams()[side][index];
    return member ? seenSheet(member, sprite, ctx) : null;
  });

  private readonly teams = computed<Record<SideId, TeamCard[]>>(() => {
    const teams = this.inspection.teams();
    const own = this.store.team();
    const gen = this.store.gen();
    return {
      p2: teams.p2.map((member) => seenCard(member, this.dex, gen)),
      // Ours exactly, in our own battles.
      p1: this.ownTeam() ? own.map((pokemon) => ownCard(pokemon, this.dex, '', gen)) : teams.p1.map((member) => seenCard(member, this.dex, gen)),
    };
  });

  private readonly conditions = computed(() => {
    const field = this.store.field();
    const turn = this.store.turn();
    const toRow = (condition: FieldCondition): ConditionRow => {
      const turns = conditionTurns(condition, turn);
      const detail = turns
        ? `${turns.left} ${turns.left === 1 ? 'turn' : 'turns'} left of ${turns.total}`
        : condition.layers > 1
          ? `${condition.layers} layers`
          : 'Stays until removed';
      const pips = turns ? Array.from({ length: turns.total }, (_, i) => ({ on: i < turns.left })) : [];
      return { name: condition.name, color: rgba(conditionColor(condition)), detail, pips };
    };
    const { p1, p2 } = this.store.sides();
    return [
      { title: 'Field', color: INK.yellow200, rows: [field.weather, field.terrain, ...field.rooms].filter((c): c is FieldCondition => !!c).map(toRow) },
      { title: `${p2.name || 'Opponent'}'s side`, color: INK.red300, rows: field.sides.p2.map(toRow) },
      { title: `${p1.name || 'Your'}${p1.name ? "'s" : ''} side`, color: INK.sky300, rows: field.sides.p1.map(toRow) },
    ];
  });

  private tabLabel(tab: InfoTab): string {
    const { p1, p2 } = this.store.sides();
    switch (tab) {
      case 'p2':
        return p2.name ? `${p2.name}'s team` : 'Their team';
      case 'p1':
        return this.store.watching() ? (p1.name ? `${p1.name}'s team` : 'Their team') : 'Your team';
      case 'field':
        return 'Field';
      case 'log':
        return 'Battle log';
    }
  }

  /** A team member's sheet (A on its card). */
  openSheet(side: SideId, index: number): void {
    if (this.teams()[side][index]) this.sheetTarget.set({ side, index });
  }

  /** Closes the sheet; returns the focus id of its member's card, to land back on. */
  closeSheet(): string | null {
    const target = this.sheetTarget();
    this.sheetTarget.set(null);
    return target ? `${CARD_PREFIX}${target.side}-${target.index}` : null;
  }

  /** ◀ ▶ on a sheet: the team's previous or next member, round the team. */
  stepSheet(step: number): void {
    const target = this.sheetTarget();
    if (!target) return;
    const count = Math.min(6, this.teams()[target.side].length);
    if (count > 0) this.sheetTarget.set({ side: target.side, index: (target.index + step + count) % count });
  }

  /** `sheetHint`: what ZL does on the opponent's tab (accepting open team sheets), when anything. */
  draw(ctx: ScreenContext, tab: InfoTab, sheetHint: string): void {
    const { renderer } = ctx;
    const shownSheet = this.sheet();
    const target = this.sheetTarget();
    if (shownSheet && target) {
      this.sheetView.draw(ctx, shownSheet, this.tabLabel(target.side), spriteSetOf(this.store.gen()));
      return;
    }
    renderer.rect(0, TOP, 1280, 720 - TOP, { fill: [0.04, 0.06, 0.11, 1] });
    INFO_TABS.forEach((t, i) => {
      const x = GRID_X + i * (TAB_W + 8);
      const on = t === tab;
      renderer.rect(x, TAB_Y, TAB_W, TAB_H, { fill: on ? INK.blue700 : INK.card, stroke: on ? INK.blue300 : INK.tab, radius: 10, border: 2 });
      const color = t === 'p2' ? INK.red300 : t === 'p1' ? INK.sky300 : INK.white;
      write(ctx, this.tabLabel(t), x + TAB_W / 2, TAB_Y + TAB_H / 2, { size: 18, bold: true }, on ? INK.white : color, 'center', TAB_W - 16);
    });
    const keys = tab === 'p1' || tab === 'p2' ? 'A Details · ZL ZR Tabs · B Close' : tab !== 'log' ? '◀ ▶ Tabs · B Close' : this.store.canChat() ? 'A Chat · ▲ ▼ Scroll · B Close' : '◀ ▶ Tabs · ▲ ▼ Scroll · B Close';
    const sheet = tab === 'p2' && sheetHint;
    write(ctx, sheet || keys, 1264, TAB_Y + TAB_H / 2, { size: 16, bold: !!sheet }, sheet ? INK.yellow200 : INK.gray300, 'right', 300);

    if (tab === 'log') this.log.draw(ctx);
    else if (tab === 'field') this.drawField(ctx);
    else this.drawTeam(ctx, tab);
  }

  private drawTeam(ctx: ScreenContext, side: SideId): void {
    const cards = this.teams()[side];
    if (cards.length === 0) {
      write(ctx, 'Nothing seen of this team yet.', 640, 400, { size: 22 }, INK.gray300, 'center');
    }
    cards.slice(0, 6).forEach((card, i) => {
      const x = GRID_X + (i % 2) * (CARD_W + GAP_X);
      const y = CONTENT_Y + Math.floor(i / 2) * (CARD_H + GAP_Y);
      const focused = ctx.focus.control({ id: `${CARD_PREFIX}${side}-${i}`, x, y, w: CARD_W, h: CARD_H, accept: () => this.openSheet(side, i) });
      drawTeamCard(ctx, x, y, card, { border: side === 'p2' ? INK.red300 : INK.sky300, dim: card.fainted, focused });
    });
  }

  private drawField(ctx: ScreenContext): void {
    const { renderer } = ctx;
    this.conditions().forEach((group, column) => {
      const x = GRID_X + column * (COLUMN_W + 16);
      renderer.rect(x, CONTENT_Y, COLUMN_W, 604, { fill: INK.card, radius: 10 });
      write(ctx, group.title, x + 18, CONTENT_Y + 28, { size: 22, bold: true }, group.color, 'left', COLUMN_W - 36);
      if (group.rows.length === 0) write(ctx, 'Nothing', x + 18, CONTENT_Y + 72, { size: 20 }, INK.gray400);
      group.rows.slice(0, 7).forEach((row, i) => {
        const y = CONTENT_Y + 52 + i * (ROW_H + 4);
        renderer.rect(x + 12, y, COLUMN_W - 24, ROW_H, { fill: INK.header, radius: 8 });
        renderer.rect(x + 12, y, 8, ROW_H, { fill: row.color, radius: 4 });
        write(ctx, row.name, x + 32, y + 24, { size: 22, bold: true }, INK.white, 'left', COLUMN_W - 64);
        write(ctx, row.detail, x + 32, y + 54, { size: 18 }, INK.gray300, 'left', 220);
        const pipW = row.pips.length > 0 ? Math.min(16, Math.floor((120 - 4 * (row.pips.length - 1)) / row.pips.length)) : 0;
        row.pips.forEach((pip, n) => {
          const px = x + COLUMN_W - 24 - (row.pips.length - n) * (pipW + 4);
          renderer.rect(px, y + 48, pipW, 12, { fill: pip.on ? row.color : [1, 1, 1, 0.15], radius: 2 });
        });
      });
    });
  }
}
