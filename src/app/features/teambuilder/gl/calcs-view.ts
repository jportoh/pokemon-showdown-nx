import { inject } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { Rgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { STAT_IDS, STAT_NAMES } from '@features/teambuilder/data/game-rules';
import { CalcMode, CalcState, freshField } from '@features/teambuilder/calc/calc-state';
import { CalcBoosts, CalcField, CalcOutcome, DamageCalc, MoveCalc, percent } from '@features/teambuilder/calc/damage-calc';
import { RivalSet, RivalSets } from '@features/teambuilder/calc/rival-sets';
import { PokemonSet } from '@features/teambuilder/models/team';
import { toId } from '@shared/utils/to-id';
import { ChooserOption, ChooserSpec, ChooserView } from './chooser-view';
import { FieldModal } from './field-modal';
import { BAR_FULL, BESIDE_COMPACT_X, EDIT_BODY_BOTTOM, EDIT_BODY_Y, EDIT_RIGHT, LEFT, RIGHT, WHITE, WrapCache, arrow, categoryBadge, typePills, typeRgba } from './tb-draw';
import { CATEGORY_ICON_W } from '@core/gl/ui/category-icons';

export const RIVAL_ID = 'calc-rival';
const MOVE_PREFIX = 'calc-move-';
/** The rival's card, the move rows under it, and the detail box at the bottom. */
const CARD_H = 140;
const ROW_H = 54;
const ROW_GAP = 6;
const ROWS_Y = EDIT_BODY_Y + CARD_H + 12;
const DETAIL_Y = ROWS_Y + 4 * ROW_H + 3 * ROW_GAP + 12;
/** A move row: the move's pill (its category inside), and the room the damage's numbers take after the bar. */
const NAME_W = 250;
const PERCENT_W = 156;
/** Your card's stage chips, in the order they're drawn (three over two). */
const STAGE_CHIPS: readonly (readonly [keyof CalcBoosts, string])[] = [
  ['atk', 'Atk'],
  ['spa', 'SpA'],
  ['spe', 'Spe'],
  ['def', 'Def'],
  ['spd', 'SpD'],
];
/** The species the tab starts on: the format's most used Pokémon. */
const FIRST_RIVAL = 'Incineroar';
const HP_GREEN: Rgba = rgba('#4cd07d');
const HP_YELLOW: Rgba = rgba('#e8c547');
const HP_RED: Rgba = rgba('#ef5350');

/** What the tab needs from the editor: the Pokémon being edited and its team's format. */
export interface CalcsModel {
  set: PokemonSet;
  format: string;
}

/**
 * The Calcs tab (beside the compact card): what your Pokémon's moves do to a rival, or with ZR what
 * the rival's moves do to yours, worked out by @smogon/calc. The rival's card is on top (A picks
 * another Pokémon from a list; left/right go through its sets: the format's common ones, your teams'
 * and generic spreads), a row per move under it (the damage as a bar of the target's HP, its range,
 * how many hits it takes), and the focused move's full calc at the bottom. ZL opens the field.
 */
export class CalcsView {
  private readonly dex = inject(ChampionsDex);
  private readonly state = inject(CalcState);
  private readonly calc = inject(DamageCalc);
  private readonly sets = inject(RivalSets);
  private readonly chooser: ChooserView;
  private readonly field: FieldModal;
  private readonly wraps = new WrapCache();

  private picking = false;
  /** The last outcome and what it was worked out from (frames are many, changes few). */
  private memo: { set: PokemonSet; rival: RivalSet; mode: CalcMode; field: CalcField; outcome: CalcOutcome } | null = null;

  /** The rival list: species with common sets, in your teams, or all of them. */
  private readonly options: readonly ChooserOption[] = this.dex.allSpecies
    .map((species) => ({ id: species.id, name: species.name, types: species.types, value: this.setCount(species.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  constructor(private readonly focus: CanvasFocus) {
    this.chooser = new ChooserView(focus);
    this.field = new FieldModal(focus);
  }

  /** The rival list or the field is open (they keep the d-pad, A and B). */
  get isOpen(): boolean {
    return this.picking || this.field.isOpen;
  }

  get isPicking(): boolean {
    return this.picking;
  }

  get fieldOpen(): boolean {
    return this.field.isOpen;
  }

  /** Whether the rival's card has the focus (A picks another, left/right its sets). */
  get onRival(): boolean {
    return this.focus.focused === RIVAL_ID;
  }

  /** The rival's card. */
  focusFirst(): void {
    this.focus.focus(RIVAL_ID);
  }

  /** B: closes the list or the field; false when neither is open. */
  back(): boolean {
    if (this.field.isOpen) {
      this.field.close();
      this.focus.focus(RIVAL_ID);
      return true;
    }
    if (this.picking) {
      this.picking = false;
      this.focus.focus(RIVAL_ID);
      return true;
    }
    return false;
  }

  /** ZR: the other way round (your moves on the rival, or the rival's on yours). */
  swap(): boolean {
    if (this.isOpen) return false;
    this.state.mode.update((mode) => (mode === 'attack' ? 'defend' : 'attack'));
    return true;
  }

  /** ZL: the field (or, while it's open, the field as it starts). */
  pressField(format: string): boolean {
    if (this.picking) return false;
    if (this.field.isOpen) {
      this.state.field.set(freshField(format));
      return true;
    }
    this.state.fieldFor(format);
    this.field.open();
    return true;
  }

  /** L/R while the rival list or the field is open: the list's filters, or the focused row's value. */
  pressLR(by: 1 | -1): boolean {
    if (this.field.isOpen) {
      this.field.step(by);
      return true;
    }
    return this.picking && this.chooser.stepFilter(this.spec(), by);
  }

  /** Home/End in the rival list. */
  jump(to: 'first' | 'last'): boolean {
    if (!this.picking || !this.chooser.hasFocus()) return false;
    this.chooser.jump(this.spec(), to);
    return true;
  }

  /** "Doubles · Rain (Drizzle) · Reflect": the field as the header sums it up. */
  fieldSummary(format: string): string {
    const field = this.state.fieldFor(format);
    const outcome = this.memo?.outcome;
    const target = this.state.mode() === 'attack' ? field.rival : field.yours;
    const parts = [field.doubles ? 'Doubles' : 'Singles'];
    const weather = outcome?.weather;
    const terrain = outcome?.terrain;
    if (weather) parts.push(weather.source ? `${weather.value} (${weather.source.split("'s ")[1]})` : weather.value);
    if (terrain) parts.push(terrain.source ? `${terrain.value} (${terrain.source.split("'s ")[1]})` : `${terrain.value} Terrain`);
    if (target.reflect) parts.push('Reflect');
    if (target.lightScreen) parts.push('Light Screen');
    if (target.auroraVeil) parts.push('Aurora Veil');
    if (field.crit) parts.push('Critical hit');
    if (parts.length === 1) parts.push('no weather');
    return parts.join(' · ');
  }

  draw(ctx: UiContext, model: CalcsModel): void {
    const field = this.state.fieldFor(model.format);
    const rival = this.rival();
    if (this.picking) {
      this.chooser.draw(ctx, this.spec(), (id) => this.pick(id));
      return;
    }
    const mode = this.state.mode();
    const outcome = rival ? this.outcome(model.set, rival, mode, field) : null;
    this.drawRival(ctx, rival, mode, field, outcome);
    this.drawMoves(ctx, rival, mode, outcome);
    this.drawDetail(ctx, rival, mode, outcome);
    if (this.field.isOpen) this.field.draw(ctx, { field, mode, yours: model.set, rival: rival?.set ?? null, outcome, change: (f) => this.state.update(f) });
  }

  /** The rival, the format's most used Pokémon to start with. */
  private rival(): RivalSet | null {
    let rival = this.state.rival();
    if (!rival) {
      rival = this.sets.firstSet(FIRST_RIVAL) ?? null;
      if (rival) this.state.rival.set(rival);
    }
    return rival;
  }

  private outcome(set: PokemonSet, rival: RivalSet, mode: CalcMode, field: CalcField): CalcOutcome {
    const memo = this.memo;
    if (memo && memo.set === set && memo.rival === rival && memo.mode === mode && memo.field === field) return memo.outcome;
    const outcome = mode === 'attack' ? this.calc.calculate(set, rival.set, 'yours', field) : this.calc.calculate(rival.set, set, 'rival', field);
    this.memo = { set, rival, mode, field, outcome };
    return outcome;
  }

  // ---------------------------------------------------------------- the rival's card

  private drawRival(ctx: UiContext, rival: RivalSet | null, mode: CalcMode, field: CalcField, outcome: CalcOutcome | null): void {
    const p = ctx.palette;
    const box = { x: BESIDE_COMPACT_X, y: EDIT_BODY_Y, w: EDIT_RIGHT - BESIDE_COMPACT_X, h: CARD_H };
    const focused = ctx.focus.control({
      id: RIVAL_ID,
      ...box,
      accept: () => this.openPicker(),
      move: (direction) => (direction === 'left' || direction === 'right' ? (this.stepSet(direction === 'left' ? -1 : 1), true) : false),
    });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: p.outline, radius: 10, border: 2 });
    if (!rival) {
      label(ctx, 'A: choose a rival', box.x + 24, box.y + box.h / 2, { size: 24, bold: true }, p.muted);
      if (focused) focusRing(ctx, box, 10);
      return;
    }
    const form = this.form(rival.set);
    const stageBox = { x: box.x + 10, y: box.y + 10, w: 120, h: 120 };
    ctx.renderer.rect(stageBox.x, stageBox.y, stageBox.w, stageBox.h, { fill: p.bg, radius: 8 });
    const sprite = form ? ctx.images.sprite(form.sprite, false, ImagePriority.Screen) : null;
    if (sprite) ctx.renderer.rect(stageBox.x + 12, stageBox.y + 12, 96, 96, { fill: WHITE, texture: sprite });

    // Its name and types, its set (left/right), and what the set is.
    const left = box.x + 148;
    const role = mode === 'attack' ? 'RIVAL' : 'ATTACKER';
    const roleW = label(ctx, role, left, box.y + 30, { size: 14, bold: true }, mode === 'attack' ? p.muted : p.danger);
    // Who moves first ends the line (on the right, before the HP); the name gives way to it.
    const stateX = box.x + box.w - 256;
    const verdictX = outcome ? this.drawVerdict(ctx, outcome, mode, stateX - 24, box.y + 30) : stateX - 24;
    const types = form?.types ?? [];
    const nameRoom = Math.min(260, verdictX - 16 - (types.length * 78 - 6) - 12 - (left + roleW + 12));
    const nameW = label(ctx, form?.name ?? rival.species, left + roleW + 12, box.y + 30, { size: 26, bold: true }, p.ink, { maxWidth: nameRoom });
    typePills(ctx, types, left + roleW + nameW + 24, box.y + 18, 72, 78, 24, 14);

    const sets = this.sets.setsFor(rival.species);
    const index = sets.findIndex((set) => set.id === rival.id);
    const setY = box.y + 68;
    arrow(ctx, LEFT, left, setY - 7, 2, p.accentText);
    const titleW = label(ctx, rival.title, left + 20, setY, { size: 20, bold: true }, p.ink, { maxWidth: 340 });
    arrow(ctx, RIGHT, left + 28 + titleW, setY - 7, 2, p.accentText);
    const where = rival.source === 'common' ? 'common set' : rival.source === 'team' ? 'your team' : 'generic spread';
    label(ctx, `${where} · ${index + 1} / ${sets.length}`, left + 50 + titleW, setY, { size: 15 }, p.muted);

    const set = rival.set;
    const ability = this.dex.mega(set.species, set.item)?.ability ?? set.ability;
    // "Careful · [icon] Sitrus Berry · Intimidate · HP 32 / Def 14 / SpD 20"
    const lineRight = box.x + box.w - 280;
    const natureW = set.nature ? label(ctx, `${set.nature} · `, left, box.y + 106, { size: 17 }, p.muted) : 0;
    const item = set.item ? this.dex.item(set.item) : undefined;
    if (item) ctx.images.drawItem(item.id, left + natureW, box.y + 96, 20);
    const restX = left + natureW + (item ? 24 : 0);
    const rest = [set.item || 'No item', ability, spreadText(set)].filter(Boolean).join(' · ');
    label(ctx, rest, restX, box.y + 106, { size: 17 }, p.muted, { maxWidth: lineRight - restX });

    // On the right, the rival as it battles here, like your card: HP, stages, its Speed.
    drawBattleState(ctx, stateX, box.y + 22, 236, battleState(field, outcome, mode, 'rival'));
    if (focused) focusRing(ctx, box, 10);
  }

  /**
   * "You first" as a pill ending at `right`: the faster one on this field (Choice Scarf, Swift
   * Swim in rain, Tailwind…), the slower one under Trick Room. Returns where the pill starts.
   */
  private drawVerdict(ctx: UiContext, outcome: CalcOutcome, mode: CalcMode, right: number, cy: number): number {
    const p = ctx.palette;
    const yours = mode === 'attack' ? outcome.speed.attacker : outcome.speed.target;
    const its = mode === 'attack' ? outcome.speed.target : outcome.speed.attacker;
    const room = outcome.speed.trickRoom;
    const youFirst = room ? yours < its : yours > its;
    const verdict = (yours === its ? 'Speed tie' : youFirst ? 'You first' : 'It first') + (room ? ' · TR' : '');
    const color = yours === its ? p.muted : youFirst ? p.accentText : p.danger;
    const style = { size: 15, bold: true };
    const w = ctx.text.measure(verdict, style) + 20;
    ctx.renderer.rect(right - w, cy - 13, w, 26, { fill: p.bg, stroke: color, radius: 13, border: 2 });
    label(ctx, verdict, right - w / 2, cy, style, color, { align: 'center' });
    return right - w;
  }

  /** Left/right on the rival's card: its previous or next set. */
  private stepSet(by: 1 | -1): void {
    const rival = this.state.rival();
    if (!rival) return;
    const sets = this.sets.setsFor(rival.species);
    const index = sets.findIndex((set) => set.id === rival.id);
    const next = sets[(index + by + sets.length) % sets.length];
    if (next) this.state.rival.set(next);
  }

  // ---------------------------------------------------------------- your Pokémon's card

  /**
   * Under the compact card's types, your Pokémon as it battles here (the moves are on the rows
   * already): its HP left, its stat stages (a Terrain Seed's included), what its side has up, and
   * its item. All of it but the item comes from the field (ZL).
   */
  drawYours(ctx: UiContext, box: Box, model: CalcsModel): void {
    const p = ctx.palette;
    const field = this.state.fieldFor(model.format);
    const yours = field.yours;
    const rival = this.picking ? null : this.rival();
    const mode = this.state.mode();
    const outcome = rival ? this.outcome(model.set, rival, mode, field) : null;
    const x = box.x + 20;
    const w = box.w - 40;
    label(ctx, 'In battle', x, box.y + 312, { size: 16 }, p.muted);
    label(ctx, 'ZL Field', x + w, box.y + 312, { size: 14 }, p.muted, { align: 'right' });

    drawBattleState(ctx, x, box.y + 338, w, battleState(field, outcome, mode, 'yours'));

    // What its side has up (the ones that count depend on who attacks, but all of them are shown).
    const up = [
      [yours.tailwind, 'Tailwind'],
      [yours.helpingHand, 'Helping Hand'],
      [yours.reflect, 'Reflect'],
      [yours.lightScreen, 'Light Screen'],
      [yours.auroraVeil, 'Aurora Veil'],
      [yours.friendGuard, 'Friend Guard'],
    ] as const;
    const effects = up.filter(([on]) => on).map(([, name]) => name);
    label(ctx, effects.length ? effects.join(' · ') : 'Nothing up on its side', x, box.y + 452, { size: 15, bold: effects.length > 0 }, effects.length ? p.accentText : p.muted, { maxWidth: w });

    const item = model.set.item ? this.dex.item(model.set.item) : undefined;
    label(ctx, 'Item', x, box.y + 482, { size: 16 }, p.muted);
    if (item) ctx.images.drawItem(item.id, x + 44, box.y + 470, 24);
    label(ctx, model.set.item || 'None', x + (item ? 74 : 44), box.y + 482, { size: 18 }, model.set.item ? p.ink : p.muted, { maxWidth: w - 74 });
  }

  // ---------------------------------------------------------------- the moves

  private drawMoves(ctx: UiContext, rival: RivalSet | null, mode: CalcMode, outcome: CalcOutcome | null): void {
    const p = ctx.palette;
    const moves = outcome?.moves ?? [];
    const x = BESIDE_COMPACT_X;
    const w = EDIT_RIGHT - x;
    if (rival && moves.length === 0) {
      const box = { x, y: ROWS_Y, w, h: 4 * ROW_H + 3 * ROW_GAP };
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.input, stroke: p.rim, radius: 10, border: 2 });
      const text =
        mode === 'attack'
          ? 'Your Pokémon has no moves yet: give it some on the Details tab.'
          : `This ${rival.source === 'preset' ? 'generic spread' : 'set'} has no moves. Left/right on the rival's card: a common set or one of your teams' has them.`;
      this.wraps.draw(ctx, text, box.x + 24, box.y + 24, box.w - 48, 30, { size: 20 }, p.muted, 4);
      return;
    }
    moves.forEach((move, i) => {
      const box = { x, y: ROWS_Y + i * (ROW_H + ROW_GAP), w, h: ROW_H };
      const focused = ctx.focus.control({ id: `${MOVE_PREFIX}${i}`, ...box, accept: () => undefined });
      this.drawMove(ctx, box, move, focused);
    });
  }

  private drawMove(ctx: UiContext, box: Box, move: MoveCalc, focused: boolean): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.outline : p.rim, radius: 8, border: 2 });
    const cy = box.y + box.h / 2;
    // The move on its type's colour, its category inside on the right (a long name gets an ellipsis).
    const iconX = box.x + 2 + NAME_W - 8 - CATEGORY_ICON_W;
    renderer.rect(box.x + 2, box.y + 2, NAME_W, box.h - 4, { fill: typeRgba(move.type) ?? p.rim, radius: 6 });
    label(ctx, move.move, box.x + 14, cy, { size: 20, bold: true }, WHITE, { maxWidth: iconX - 8 - (box.x + 14) });
    categoryBadge(ctx, move.category, iconX, cy);
    let x = box.x + 2 + NAME_W + 14;

    const tag = moveTag(move);
    if (tag) {
      const tagW = ctx.text.measure(tag, { size: 13, bold: true }) + 14;
      renderer.rect(x, cy - 11, tagW, 22, { fill: [0, 0, 0, 0], stroke: p.teal, radius: 4, border: 1 });
      label(ctx, tag, x + tagW / 2, cy, { size: 13, bold: true }, p.teal, { align: 'center' });
    }
    x += 80;

    const right = box.x + box.w - 12;
    const koW = 118;
    const koX = right - koW;
    const textRight = koX - 14;
    if (move.kind !== 'damage') {
      const text = move.kind === 'status' ? 'No damage' : move.kind === 'immune' ? "It doesn't affect the target" : 'Not in the calc';
      label(ctx, text, x, cy, { size: 18 }, p.muted);
      if (focused) focusRing(ctx, box, 8);
      return;
    }

    // The damage as a bar of the target's HP: up to the lowest roll solid, to the highest lighter.
    const barW = textRight - PERCENT_W - x;
    const bar = { x, y: cy - 13, w: barW, h: 26 };
    const fill = koFill(ctx, move);
    renderer.rect(bar.x, bar.y, bar.w, bar.h, { fill: p.input, stroke: p.rim, radius: 4, border: 2 });
    const inner = bar.w - 6;
    const minW = (inner * Math.min(100, move.minPercent)) / 100;
    const maxW = (inner * Math.min(100, move.maxPercent)) / 100;
    if (maxW > minW) renderer.rect(bar.x + 3 + minW, bar.y + 3, maxW - minW, bar.h - 6, { fill: withAlpha(fill, 0.45), radius: 2 });
    if (minW > 0) renderer.rect(bar.x + 3, bar.y + 3, minW, bar.h - 6, { fill, radius: 2 });
    renderer.rect(bar.x + 3 + inner / 2 - 1, bar.y - 3, 2, bar.h + 6, { fill: p.outline });

    label(ctx, `${percent(move.minPercent)} – ${percent(move.maxPercent)}%`, textRight, cy - 9, { size: 20, bold: true }, p.ink, { align: 'right' });
    label(ctx, `${move.min}–${move.max} HP`, textRight, cy + 14, { size: 14 }, p.muted, { align: 'right' });

    const ko = koBadge(move);
    const koBox = { x: koX, y: cy - 20, w: koW, h: 40 };
    renderer.rect(koBox.x, koBox.y, koBox.w, koBox.h, { fill: ko.tier === 3 ? p.rim : fill, radius: 6 });
    const ink = ko.tier === 3 ? p.muted : p.bar;
    label(ctx, ko.title, koBox.x + koW / 2, cy - 7, { size: 18, bold: true }, ink, { align: 'center' });
    label(ctx, ko.detail, koBox.x + koW / 2, cy + 11, { size: 12, bold: true }, ink, { align: 'center', maxWidth: koW - 8 });
    if (focused) focusRing(ctx, box, 8);
  }

  // ---------------------------------------------------------------- the detail box

  private drawDetail(ctx: UiContext, rival: RivalSet | null, mode: CalcMode, outcome: CalcOutcome | null): void {
    const p = ctx.palette;
    const box = { x: BESIDE_COMPACT_X, y: DETAIL_Y, w: EDIT_RIGHT - BESIDE_COMPACT_X, h: EDIT_BODY_BOTTOM - DETAIL_Y };
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: p.outline, radius: 10, border: 2 });
    const id = this.focus.focused ?? '';
    const move = id.startsWith(MOVE_PREFIX) ? outcome?.moves[Number(id.slice(MOVE_PREFIX.length))] : undefined;
    const x = box.x + 18;
    const width = box.w - 36;
    if (move?.kind === 'damage') {
      this.wraps.draw(ctx, move.desc.replace(' -- ', ' — '), x, box.y + 10, width, 24, { size: 17 }, p.ink, 2);
      if (move.notes.length) this.wraps.draw(ctx, move.notes.join(' · '), x, box.y + 60, width, 22, { size: 15 }, p.muted, 2);
      return;
    }
    if (move) {
      this.wraps.draw(ctx, move.kind === 'immune' ? `${move.move} has no effect on the target (its type or ability).` : `${move.move} doesn't deal damage.`, x, box.y + 10, width, 24, { size: 17 }, p.muted, 2);
      return;
    }
    if (!rival) return;
    // On the rival's card: its set's moves, and how to change it.
    const moves = rival.set.moves.length ? rival.set.moves.join(' · ') : 'No moves (a generic spread: it only takes hits)';
    this.wraps.draw(ctx, `${rival.title}: ${moves}`, x, box.y + 10, width, 24, { size: 17 }, p.ink, 2);
    const source = rival.source === 'common' ? ` · Common sets from the ${this.sets.source}` : '';
    label(ctx, `A: another Pokémon · ◀▶: its other sets${source}`, x, box.y + 72, { size: 15 }, p.muted, { maxWidth: width });
  }

  // ---------------------------------------------------------------- the rival list

  private openPicker(): void {
    this.picking = true;
    this.chooser.open(this.spec());
  }

  private pick(id: string): void {
    const species = this.dex.species(id);
    const first = species ? this.sets.firstSet(species.name) : undefined;
    if (first) this.state.rival.set(first);
    this.picking = false;
    this.focus.focus(RIVAL_ID);
  }

  private spec(): ChooserSpec {
    return {
      noun: 'Pokémon',
      title: 'Rival',
      options: this.options,
      selectedId: toId(this.state.rival()?.species ?? ''),
      rows: 'species',
      searchable: true,
      filters: [
        { name: 'Common sets', test: (option) => this.sets.hasCommon(option.name) },
        { name: 'Your teams', test: (option) => this.sets.inTeams(option.name) },
        { name: 'All', test: () => true },
      ],
      unavailable: '',
      describe: (ctx, box, id) => this.describe(ctx, box, id),
    };
  }

  /** The focused species in the list: its types and the sets it has. */
  private describe(ctx: UiContext, box: Box, id: string): void {
    const p = ctx.palette;
    const species = this.dex.species(id);
    if (!species) return;
    const x = box.x + 24;
    label(ctx, species.name, x, box.y + 36, { size: 28, bold: true }, p.ink, { maxWidth: box.w - 48 });
    typePills(ctx, species.types, x, box.y + 62, 100, 108, 28, 16);
    label(ctx, 'Sets (◀▶ on the rival’s card)', x, box.y + 122, { size: 16 }, p.muted);
    const sets = this.sets.setsFor(species.name).filter((set) => set.source !== 'preset');
    sets.slice(0, 6).forEach((set, i) => {
      const y = box.y + 156 + i * 52;
      label(ctx, set.title, x, y, { size: 19, bold: true }, p.ink, { maxWidth: box.w - 48 });
      label(ctx, [set.set.nature, set.set.item || 'No item', spreadText(set.set)].join(' · '), x, y + 22, { size: 15 }, p.muted, { maxWidth: box.w - 48 });
    });
    const more = sets.length > 6 ? `and ${sets.length - 6} more, ` : '';
    const presets = sets.length ? `${more}plus generic spreads` : 'No common sets: generic spreads (bulky, offensive)';
    label(ctx, presets, x, box.y + 156 + Math.min(6, sets.length) * 52, { size: 16 }, p.muted, { maxWidth: box.w - 48 });
  }

  /** "3 sets", for the list's rows. */
  private setCount(species: string): string {
    const count = this.sets.setsFor(species).filter((set) => set.source === 'common').length;
    return count ? `${count} set${count === 1 ? '' : 's'}` : '';
  }

  private form(set: PokemonSet): DexSpecies | DexMega | undefined {
    return this.dex.mega(set.species, set.item) ?? this.dex.species(set.species);
  }
}

/** "HP 32 / Def 14 / SpD 20", the points it has; '' for none. */
function spreadText(set: PokemonSet): string {
  return STAT_IDS.filter((stat) => (set.evs[stat] ?? 0) > 0)
    .map((stat) => `${STAT_NAMES[stat]} ${set.evs[stat]}`)
    .join(' / ');
}

/** One Pokémon as it battles on this field: its HP left (of its full HP, 0 unknown), its stages and its Speed. */
interface BattleState {
  hp: number;
  maxHp: number;
  boosts: CalcBoosts;
  /** Its Speed after everything (stage, item, ability, Tailwind…); 0 unknown. */
  speed: number;
}

/** Your Pokémon's state or the rival's, whichever of the two attacks. */
function battleState(field: CalcField, outcome: CalcOutcome | null, mode: CalcMode, whose: 'yours' | 'rival'): BattleState {
  const side = field[whose];
  const attacker = (mode === 'attack') === (whose === 'yours');
  if (!outcome) return { hp: side.hp, maxHp: 0, boosts: side.boosts, speed: 0 };
  return attacker
    ? { hp: side.hp, maxHp: outcome.attackerHp, boosts: outcome.attackerBoosts, speed: outcome.speed.attacker }
    : { hp: side.hp, maxHp: outcome.targetHp, boosts: outcome.targetBoosts, speed: outcome.speed.target };
}

/**
 * A Pokémon's state in `w` from the HP line at `cy`: its HP over a bar, then its stages as chips
 * (Atk, SpA, Spe over Def, SpD, lit when raised or lowered) and its Speed after everything in the
 * sixth place.
 */
function drawBattleState(ctx: UiContext, x: number, cy: number, w: number, state: BattleState): void {
  const p = ctx.palette;
  const hpText = state.maxHp ? `HP ${Math.max(1, Math.floor((state.maxHp * state.hp) / 100))} / ${state.maxHp}` : 'HP';
  label(ctx, hpText, x, cy, { size: 16 }, p.muted);
  label(ctx, `${state.hp}%`, x + w, cy, { size: 18, bold: true }, p.ink, { align: 'right' });
  ctx.renderer.rect(x, cy + 12, w, 14, { fill: p.input, stroke: p.rim, radius: 4, border: 2 });
  ctx.renderer.rect(x + 3, cy + 15, ((w - 6) * state.hp) / 100, 8, { fill: state.hp > 50 ? HP_GREEN : state.hp > 20 ? HP_YELLOW : HP_RED, radius: 2 });

  const chipW = (w - 12) / 3;
  const chipAt = (i: number): Box => ({ x: x + (i % 3) * (chipW + 6), y: cy + 38 + Math.floor(i / 3) * 32, w: chipW, h: 26 });
  STAGE_CHIPS.forEach(([stat, name], i) => {
    const chip = chipAt(i);
    const value = state.boosts[stat];
    const ink = value > 0 ? p.accentText : value < 0 ? p.danger : p.muted;
    ctx.renderer.rect(chip.x, chip.y, chip.w, chip.h, { fill: value ? p.select : p.bg, stroke: value ? ink : p.rim, radius: 5, border: value ? 2 : 1 });
    label(ctx, `${name} ${stage(value)}`, chip.x + chip.w / 2, chip.y + chip.h / 2, { size: 15, bold: value !== 0 }, ink, { align: 'center', maxWidth: chip.w - 6 });
  });
  const speed = chipAt(STAGE_CHIPS.length);
  ctx.renderer.rect(speed.x, speed.y, speed.w, speed.h, { fill: p.input, stroke: p.outline, radius: 5, border: 2 });
  label(ctx, `Spe ${state.speed || '—'}`, speed.x + speed.w / 2, speed.y + speed.h / 2, { size: 15, bold: true }, p.ink, { align: 'center', maxWidth: speed.w - 6 });
}

/** "+1", "±0", "−2" */
function stage(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '±0';
}

/** What to flag beside a move: its priority, or that it hits both foes. */
function moveTag(move: MoveCalc): string {
  if (move.priority > 0) return `+${move.priority} PRIO`;
  if (move.alwaysCrit) return 'CRIT';
  return move.spread ? 'SPREAD' : '';
}

/**
 * How many hits it takes, as the badge says it: "2HKO" over "guaranteed", "38% chance" or "possible"
 * (the calc can't put a number on it). The tier (1 a KO in one hit, 2 in two, 3 more) colours it; a
 * chance under even counts as the next tier.
 */
function koBadge(move: MoveCalc): { title: string; detail: string; tier: 1 | 2 | 3 } {
  if (move.hits <= 0) return { title: 'No KO', detail: 'in a few hits', tier: 3 };
  const title = move.hits === 1 ? 'OHKO' : `${move.hits}HKO`;
  const sure = move.chance >= 1;
  const detail = sure ? 'guaranteed' : move.chance <= 0 ? 'possible' : `${Math.max(0.1, Math.round(move.chance * 1000) / 10)}% chance`;
  const tier = Math.min(3, move.hits + (move.chance >= 0.5 ? 0 : 1)) as 1 | 2 | 3;
  return { title, detail, tier };
}

function koFill(ctx: UiContext, move: MoveCalc): Rgba {
  const tier = koBadge(move).tier;
  return tier === 1 ? ctx.palette.danger : tier === 2 ? BAR_FULL : ctx.palette.muted;
}
