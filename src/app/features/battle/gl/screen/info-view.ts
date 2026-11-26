import { computed, inject, signal } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { Rgba, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { ROLE_KEYS } from '@core/input/console-keys';
import { pillTarget } from '@core/gl/canvas-ui';
import { FieldCondition, SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { conditionColor, conditionTurns } from '@features/battle/state/field-conditions';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { PokemonSheet, SheetContext, ownSheet, seenSheet, stageText } from '@features/battle/state/pokemon-sheet';
import { spriteSetOf } from '@shared/utils/sprite-id';
import { foeInk } from './header-view';
import { LogView } from './overlay-views';
import { PokemonSheetView } from './pokemon-sheet-view';
import { ScreenContext, keyChip, write, drawKeys } from './screen-context';
import { CARD_H, CARD_W, TeamCard, drawTeamCard, ownCard, seenCard } from './team-card';

const TOP = 44;
const TAB_Y = TOP + 10;
const TAB_W = 230;
const TAB_H = 40;
const CONTENT_Y = 104;
const GRID_X = 16;
const GAP_X = 16;
const GAP_Y = 8;
const COLUMN_W = 405;
const WHITE: Rgba = [1, 1, 1, 1];
const ROW_H = 76;
/** The field view (Y): the opponent's side's conditions, their cards, the whole field's, ours, our side's (rows' middles; cards' tops). */
const FIELD_ROWS = { foe: 110, foeCards: 130, field: 346, ownCards: 366, own: 584 };

/** The team cards' focus ids: "info-card-p2-0". */
export const CARD_PREFIX = 'info-card-';

export type InfoTab = 'p2' | 'p1' | 'field' | 'log';
export const INFO_TABS: readonly InfoTab[] = ['p2', 'p1', 'field', 'log'];

interface ConditionRow {
  name: string;
  color: Rgba;
  /** "3 turns left of 5", "2 layers", "Until it's gone". */
  detail: string;
  /** The same on a chip: "3" turns left, "×2" layers, nothing. */
  short: string;
  pips: { on: boolean }[];
}


/**
 * Battle info (ZR), over the whole stage under the top bar, in the menu's style: tabs for each side's
 * team (every member as a team card with all that's known of it: ours exact, theirs as far as the
 * battle or their open team sheet has shown), the field's conditions (weather, terrain and rooms, then
 * each side's, with their turns left) and the battle log with the chat. ZL/ZR or left/right change
 * tabs, up/down page the log, A writes a chat message there (live battles), B closes. On a team's tab
 * the d-pad moves between its cards (left/right past the edge changes tab) and A opens that member's
 * sheet (PokemonSheetView): its stats and stages, Speed, volatile conditions and moves; left/right go
 * through the team, B back. It also draws the field at a glance (Y): drawActive.
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
    return target ? this.sheetOf(target.side, target.index) : null;
  });

  /** In singles, the sheet of each side's Pokémon on the field: the field view's glance beside its card. */
  private readonly glances = computed<Record<SideId, PokemonSheet | null>>(() => {
    const actives = this.actives();
    const singles = this.store.gameType() === 'singles';
    const of = (side: SideId): PokemonSheet | null => (singles && actives[side].length === 1 ? this.sheetOf(side, actives[side][0]) : null);
    return { p2: of('p2'), p1: of('p1') };
  });

  /** A team member's whole sheet: ours exact (in our own battles), theirs as far as it's been seen. */
  private sheetOf(side: SideId, index: number): PokemonSheet | null {
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
  }

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

  /** Each side's members on the field, by their index in the team. */
  private readonly actives = computed(() => {
    const teams = this.inspection.teams();
    const onField = (side: SideId): number[] => {
      if (side === 'p1' && this.ownTeam()) return this.store.team().flatMap((pokemon, i) => (pokemon.active ? [i] : []));
      return teams[side].flatMap((inspected, i) => (inspected.member.active ? [i] : []));
    };
    return { p2: onField('p2').slice(0, 2), p1: onField('p1').slice(0, 2) };
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
      const short = turns ? String(turns.left) : condition.layers > 1 ? `×${condition.layers}` : '';
      return { name: condition.name, color: rgba(conditionColor(condition)), detail, short, pips };
    };
    const { p1, p2 } = this.store.sides();
    return [
      { title: 'Field', side: null, rows: [field.weather, field.terrain, ...field.rooms].filter((c): c is FieldCondition => !!c).map(toRow) },
      { title: `${p2.name || 'Opponent'}'s side`, side: 'p2' as SideId, rows: field.sides.p2.map(toRow) },
      { title: `${p1.name || 'Your'}${p1.name ? "'s" : ''} side`, side: 'p1' as SideId, rows: field.sides.p1.map(toRow) },
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

  /** The first card of the field view, where the focus starts. */
  firstActiveId(): string | null {
    const { p1, p2 } = this.actives();
    return p2.length ? `${CARD_PREFIX}p2-${p2[0]}` : p1.length ? `${CARD_PREFIX}p1-${p1[0]}` : null;
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

  /** The page's ground under the top bar: the theme's, with the lit side. */
  private drawGround(ctx: ScreenContext): void {
    const p = ctx.palette;
    ctx.renderer.rect(0, TOP, 1280, 720 - TOP, { fill: p.bg });
    ctx.renderer.rect(0, TOP, 640, 720 - TOP, { fill: withAlpha(p.hero, 0.8), fillEnd: withAlpha(p.hero, 0) });
  }

  /** The open sheet, if any (its own page); true when drawn. */
  private drawSheet(ctx: ScreenContext): boolean {
    const shownSheet = this.sheet();
    const target = this.sheetTarget();
    if (!shownSheet || !target) return false;
    this.drawGround(ctx);
    this.sheetView.draw(ctx, shownSheet, this.tabLabel(target.side), spriteSetOf(this.store.gen()));
    return true;
  }

  /**
   * `sheetHint`: what ZL does on the opponent's tab (accepting open team sheets), when anything;
   * `select`: a tab tapped (the touch screen, a click).
   */
  draw(ctx: ScreenContext, tab: InfoTab, sheetHint: string, select: (tab: InfoTab) => void): void {
    if (this.drawSheet(ctx)) return;
    const p = ctx.palette;
    const { renderer } = ctx;
    this.drawGround(ctx);
    INFO_TABS.forEach((t, i) => {
      const x = GRID_X + i * (TAB_W + 8);
      const on = t === tab;
      // Tapped, it opens (the d-pad changes tabs with ZL/ZR and ◀▶, so it never lands here).
      ctx.focus.control({ id: `info-tab-${t}`, x, y: TAB_Y, w: TAB_W, h: TAB_H, skip: true, accept: () => select(t) });
      renderer.rect(x, TAB_Y, TAB_W, TAB_H, { fill: on ? p.accent : p.panel, stroke: on ? p.accent : p.rim, radius: TAB_H / 2, border: 1 });
      const color = on ? ([1, 1, 1, 1] as Rgba) : t === 'p2' ? foeInk(p) : t === 'p1' ? p.accentText : p.ink;
      write(ctx, this.tabLabel(t), x + TAB_W / 2, TAB_Y + TAB_H / 2, { size: 17, bold: true }, color, 'center', TAB_W - 24);
    });
    const sheet = tab === 'p2' && sheetHint;
    if (sheet) write(ctx, sheet, 1264, TAB_Y + TAB_H / 2, { size: 16, bold: true }, p.teal, 'right', 300);
    else {
      const keys: [string, string][] =
        tab === 'p1' || tab === 'p2' ? [['A', 'Details'], ['ZL ZR', 'Tabs'], ['B', 'Close']] : tab !== 'log' ? [['◀▶', 'Tabs'], ['B', 'Close']] : this.store.canChat() ? [['A', 'Chat'], ['▲▼', 'Scroll'], ['B', 'Close']] : [['▲▼', 'Scroll'], ['B', 'Close']];
      drawKeys(ctx, keys, 1264, TAB_Y + TAB_H / 2);
    }

    if (tab === 'log') this.log.draw(ctx);
    else if (tab === 'field') this.drawField(ctx);
    else this.drawTeam(ctx, tab);
  }

  /**
   * The field at a glance (Y): the opponent's Pokémon on top, ours under, each as its
   * team card with all that's known of it, and the field's conditions as chips with their turns left:
   * each side's by its Pokémon (screens, hazards, Tailwind), the whole field's between them (weather,
   * terrain, rooms). A opens a Pokémon's whole sheet (stats and stages, Speed, conditions), as on
   * Battle info's tabs; Battle info's Field tab has the conditions in full.
   */
  drawActive(ctx: ScreenContext): void {
    if (this.drawSheet(ctx)) return;
    const p = ctx.palette;
    this.drawGround(ctx);
    const keyW = keyChip(ctx, ROLE_KEYS.fieldView.label, GRID_X, TOP + 32, 30);
    pillTarget(ctx, 'field-key', { x: GRID_X - 4, y: TOP + 17, w: keyW + 8, h: 30 }, ROLE_KEYS.fieldView.label);
    const titleW = write(ctx, 'FIELD', GRID_X + keyW + 12, TOP + 32, { size: 24, bold: true }, p.ink);
    write(ctx, `Turn ${this.store.turn()}`, GRID_X + keyW + titleW + 28, TOP + 33, { size: 16 }, p.muted);
    drawKeys(ctx, [['A', 'Whole sheet'], ['B', 'Close']], 1264, TOP + 32);
    const [field, foeSide, ownSide] = this.conditions();
    this.drawConditionChips(ctx, foeSide, FIELD_ROWS.foe);
    this.drawConditionChips(ctx, field, FIELD_ROWS.field);
    this.drawConditionChips(ctx, ownSide, FIELD_ROWS.own);
    const teams = this.teams();
    const actives = this.actives();
    (['p2', 'p1'] as const).forEach((side, row) => {
      actives[side].forEach((index, column) => {
        const card = teams[side][index];
        if (!card) return;
        const cx = GRID_X + column * (CARD_W + GAP_X);
        const cy = row === 0 ? FIELD_ROWS.foeCards : FIELD_ROWS.ownCards;
        const focused = ctx.focus.control({ id: `${CARD_PREFIX}${side}-${index}`, x: cx, y: cy, w: CARD_W, h: CARD_H, accept: () => this.openSheet(side, index) });
        drawTeamCard(ctx, cx, cy, card, { side, dim: card.fainted, focused });
      });
      const glance = this.glances()[side];
      if (glance && !glance.fainted) this.drawGlance(ctx, glance, GRID_X + CARD_W + GAP_X, row === 0 ? FIELD_ROWS.foeCards : FIELD_ROWS.ownCards);
    });
    write(ctx, "The opponent's show only what the battle has revealed.", GRID_X, 698, { size: 15 }, p.muted, 'left', 800);
  }

  /**
   * Singles' room beside a card in the field view: what the whole sheet tells that matters turn by turn,
   * its stat stages, its Speed (ours against the foe, theirs as the range it can have) and its volatile
   * conditions (confusion, Leech Seed, Substitute…).
   */
  private drawGlance(ctx: ScreenContext, sheet: PokemonSheet, x: number, y: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const w = 1264 - x;
    renderer.rect(x, y, w, CARD_H, { fill: withAlpha(p.panel, 0.7), stroke: p.rim, radius: 12, border: 1 });
    const labelX = x + 16;
    const valueX = x + 132;
    const valueW = w - 148;
    const label = (text: string, cy: number): void => void write(ctx, text, labelX, cy, { size: 13, bold: true }, p.muted);
    const chips = (items: { text: string; color: Rgba }[], cy: number, none: string): void => {
      if (items.length === 0) {
        write(ctx, none, valueX, cy, { size: 16 }, p.muted);
        return;
      }
      let cx = valueX;
      for (const item of items) {
        const tw = ctx.text.measure(item.text, { size: 15, bold: true }) + 20;
        if (cx + tw > x + w - 12) break;
        renderer.rect(cx, cy - 13, tw, 26, { fill: item.color, radius: 13 });
        write(ctx, item.text, cx + tw / 2, cy, { size: 15, bold: true }, WHITE, 'center');
        cx += tw + 6;
      }
    };

    const stagesY = y + 36;
    label('STAGES', stagesY);
    const stages = sheet.stats.filter((stat) => stat.label !== 'HP' && stat.stage !== 0);
    chips(stages.map((stat) => ({ text: `${stat.label} ${stageText(stat.stage)}`, color: rgba(stat.stage > 0 ? '#15803d' : '#b91c1c') })), stagesY, 'No stat changes');

    const speedY = y + 92;
    label('SPEED', speedY);
    const speed = sheet.speed;
    if (!speed) write(ctx, 'Unknown', valueX, speedY, { size: 16 }, p.muted);
    else if (speed.kind === 'range') {
      const nowW = write(ctx, speed.now, valueX, speedY, { size: 19, bold: true }, speed.change > 0 ? rgba('#15803d') : speed.change < 0 ? rgba('#b91c1c') : p.ink);
      write(ctx, speed.reasons || 'Possible range at its level', valueX + nowW + 14, speedY, { size: 15 }, p.muted, 'left', valueW - nowW - 14);
    } else {
      const ownW = write(ctx, `${speed.own}`, valueX, speedY, { size: 19, bold: true }, p.ink);
      const verdicts = speed.rivals.map((rival) => `${rival.verdict === 'slower' ? 'Faster than' : rival.verdict === 'faster' ? 'Slower than' : 'Maybe faster than'} ${rival.name} (${rival.range})`);
      write(ctx, verdicts.join(' · ') || speed.note, valueX + ownW + 14, speedY, { size: 15 }, p.ink, 'left', valueW - ownW - 14);
    }

    const conditionsY = y + 148;
    label('CONDITIONS', conditionsY);
    chips(sheet.conditions.map((look) => ({ text: look.name, color: rgba(look.color) })), conditionsY, 'None');
  }

  /** A row of the field view: the group's name, then each condition as a chip (its colour, name, turns left), as many as fit. */
  private drawConditionChips(ctx: ScreenContext, group: { title: string; side: SideId | null; rows: ConditionRow[] }, cy: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const color = group.side === 'p2' ? foeInk(p) : group.side === 'p1' ? p.accentText : p.ink;
    let x = GRID_X + 4 + write(ctx, group.title.toUpperCase(), GRID_X + 4, cy, { size: 14, bold: true }, color, 'left', 300) + 14;
    if (group.rows.length === 0) {
      write(ctx, 'Nothing', x, cy, { size: 16 }, p.muted);
      return;
    }
    const nameStyle = { size: 16, bold: true };
    for (const row of group.rows) {
      const nameW = ctx.text.measure(row.name, nameStyle);
      const shortW = row.short ? ctx.text.measure(row.short, nameStyle) + 16 : 0;
      const w = 12 + 10 + 8 + nameW + (shortW ? 8 + shortW : 0) + 12;
      if (x + w > 1264) break;
      renderer.rect(x, cy - 15, w, 30, { fill: p.panel, stroke: p.rim, radius: 15, border: 1 });
      renderer.rect(x + 12, cy - 5, 10, 10, { fill: row.color, radius: 5 });
      write(ctx, row.name, x + 30, cy, nameStyle, p.ink);
      if (shortW) {
        const sx = x + 30 + nameW + 8;
        renderer.rect(sx, cy - 11, shortW, 22, { fill: p.rim, radius: 11 });
        write(ctx, row.short, sx + shortW / 2, cy, nameStyle, p.ink, 'center');
      }
      x += w + 8;
    }
  }

  private drawTeam(ctx: ScreenContext, side: SideId): void {
    const cards = this.teams()[side];
    if (cards.length === 0) {
      write(ctx, 'Nothing seen of this team yet.', 640, 400, { size: 22 }, ctx.palette.muted, 'center');
    }
    cards.slice(0, 6).forEach((card, i) => {
      const x = GRID_X + (i % 2) * (CARD_W + GAP_X);
      const y = CONTENT_Y + Math.floor(i / 2) * (CARD_H + GAP_Y);
      const focused = ctx.focus.control({ id: `${CARD_PREFIX}${side}-${i}`, x, y, w: CARD_W, h: CARD_H, accept: () => this.openSheet(side, i) });
      drawTeamCard(ctx, x, y, card, { side, dim: card.fainted, focused });
    });
  }

  private drawField(ctx: ScreenContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    this.conditions().forEach((group, column) => {
      const x = GRID_X + column * (COLUMN_W + 16);
      renderer.rect(x, CONTENT_Y + 10, COLUMN_W, 594, { fill: [0, 0, 0, 0.16], radius: 20, softness: 20 });
      renderer.rect(x, CONTENT_Y, COLUMN_W, 594, { fill: p.panel, stroke: p.rim, radius: 20, border: 1 });
      const color = group.side === 'p2' ? foeInk(p) : group.side === 'p1' ? p.accentText : p.ink;
      write(ctx, group.title, x + 20, CONTENT_Y + 30, { size: 22, bold: true }, color, 'left', COLUMN_W - 40);
      if (group.rows.length === 0) write(ctx, 'Nothing', x + 20, CONTENT_Y + 74, { size: 20 }, p.muted);
      group.rows.slice(0, 7).forEach((row, i) => {
        const y = CONTENT_Y + 54 + i * (ROW_H + 4);
        renderer.rect(x + 12, y, COLUMN_W - 24, ROW_H, { fill: mixRgba(p.panel, p.rim, 0.6), radius: 12 });
        renderer.rect(x + 12, y + 8, 6, ROW_H - 16, { fill: row.color, radius: 3 });
        write(ctx, row.name, x + 32, y + 24, { size: 21, bold: true }, p.ink, 'left', COLUMN_W - 64);
        write(ctx, row.detail, x + 32, y + 54, { size: 16 }, p.muted, 'left', 220);
        const pipW = row.pips.length > 0 ? Math.min(16, Math.floor((120 - 4 * (row.pips.length - 1)) / row.pips.length)) : 0;
        row.pips.forEach((pip, n) => {
          const px = x + COLUMN_W - 24 - (row.pips.length - n) * (pipW + 4);
          renderer.rect(px, y + 48, pipW, 12, { fill: pip.on ? row.color : p.rim, radius: 3 });
        });
      });
    });
  }
}
