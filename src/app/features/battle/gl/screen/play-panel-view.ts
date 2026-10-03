import { computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { moveInfo } from '@core/dex/moves';
import { abilityName, itemName } from '@core/dex/names';
import { Rgba, rgba } from '@core/gl/gl-renderer';
import { CATEGORY_ICON_H, CATEGORY_ICON_W, categoryIcon } from '@core/gl/ui/category-icons';
import { BAR_TOP, BOX_H, DOUBLES, FIELD_TOP, SINGLES } from '@features/battle/gl/field-layout';
import { BattleChoices, TargetOption } from '@features/battle/state/battle-choices';
import { BattleStore } from '@features/battle/state/battle-store';
import { typeColor } from '@shared/data/type-colors';
import { BAR_FILL, drawCommandBar, drawMessage } from './message-box';
import { INK, ScreenContext, button, hint, ring, write, writeLines } from './screen-context';

const X = 16;
const RIGHT = 1264;
const GAP = 12;
/** The four moves in a row, Switch on their right. */
const MOVE_W = 252;
const MOVE_H = 86;
const MOVE_Y = BAR_TOP + 12;
const SIDE_X = X + 4 * (MOVE_W + GAP);
const SIDE_W = RIGHT - SIDE_X;
const SIDE_H = 40;
/** Mega's (or Tera's) button by the chooser's status box. */
const MEGA_W = 176;
/** Two rows of 40px in the bar: chips on top, the legend or a second line under. */
const ROW_1 = BAR_TOP + 14;
const ROW_2 = BAR_TOP + 62;
const ROW_H = 40;
/** The tab over the bar while choosing: who's choosing, its item and ability. */
const TAB_H = 40;
const TAB_MAX_W = 880;
const AMBER: Rgba = rgba('#fcd34d');
/** Type colours on the dark bar (Dark, Ghost) need an edge to stand out. */
const TYPE_EDGE: Rgba = [1, 1, 1, 0.35];

/** What the bar's buttons do beyond the battle's own state. */
export interface PlayActions {
  canRematch: boolean;
  rematchLabel: string;
  rematchNote: string;
  rematch: () => void;
  leave: () => void;
  /** Switch: opens the party screen. */
  openParty: () => void;
}

/**
 * The command bar in our own battles, along the stage's foot, always the same size. While the turn
 * plays, its message; choosing, the four moves in a row on their types' colours (category, power, PP)
 * with Switch (the party screen) on their right, Mega or Tera (L) by the chooser's status box while it
 * can, and a tab over the bar with who's choosing (its item and ability, and the first slot's order while the second chooses); picking a
 * target, the move and the targets as chips (the field marks the one pointed at); while the opponent
 * chooses, each order and Cancel; at the end, the result with Rematch and Back to Home. `draw` returns
 * the ids of the view's buttons in order, so a new view can focus its first.
 */
export class PlayPanelView {
  private readonly store = inject(BattleStore);
  private readonly choices = inject(BattleChoices);
  private readonly dex = inject(ChampionsDex);

  /** Changes whenever a new set of buttons appears, so the focus moves to it. */
  readonly viewKey = computed(() => {
    const request = this.store.request();
    return [this.store.result(), request?.rqid, this.choices.slot(), !!this.choices.pendingMove(), this.store.canUndo()].join('|');
  });

  /** Choosing a move or its target (the party screen takes forced switches). */
  readonly choosing = computed(() => this.choices.slot() !== null && !this.choices.forceSwitch() && !this.store.result());

  private readonly moves = computed(() =>
    this.choices.moves().map((move, i) => {
      const info = this.dex.move(move.id) ?? moveInfo(move.id);
      const type = info?.type ?? '';
      return {
        index: i,
        name: move.move,
        disabled: !!move.disabled || move.pp <= 0,
        type,
        color: rgba(typeColor(type) || '#4b5563'),
        power: info && info.basePower > 0 ? String(info.basePower) : '',
        category: info?.category ?? '',
        pp: `${move.pp}/${move.maxpp}`,
        x: X + i * (MOVE_W + GAP),
      };
    }),
  );

  /** The one choosing: its item and ability, from the request. */
  private readonly chooser = computed(() => {
    const pokemon = this.choices.pokemon();
    if (!pokemon) return null;
    return {
      itemId: pokemon.item,
      item: itemName(pokemon.item) || 'No item',
      ability: abilityName(pokemon.ability ?? ''),
    };
  });

  /** How many slots choose this turn: 2 in doubles. */
  private readonly slotCount = computed(() => (this.store.gameType() === 'singles' ? 1 : (this.store.request()?.active?.length ?? 1)));

  /** Each active slot's order this turn, on its move type's colour; before any order, who's out there. */
  private readonly plans = computed(() => {
    const submitted = this.choices.submitted();
    const { active } = this.store.sides().p1;
    const slots = this.store.gameType() === 'singles' ? active.slice(0, 1) : active;
    return slots.map((pokemon, slot) => {
      const plan = submitted.find((p) => p.slot === slot);
      if (plan) return { ...plan, color: rgba(typeColor(plan.type) || '#374151') };
      const action = !pokemon ? '' : pokemon.fainted ? 'Fainted' : 'Getting ready';
      return { slot, name: pokemon?.name ?? '', action, detail: '', color: INK.gray700 };
    });
  });

  draw(ctx: ScreenContext, actions: PlayActions): string[] {
    drawCommandBar(ctx);
    if (this.store.result()) return this.drawResult(ctx, actions);
    if (this.choices.slot() !== null) {
      // A forced switch is chosen on the party screen.
      if (this.choices.forceSwitch()) return [];
      return this.choices.pendingMove() ? this.drawTargets(ctx) : this.drawMoves(ctx, actions);
    }
    if (!this.store.playing() && this.choices.submitted().length > 0) return this.drawWaiting(ctx);
    drawMessage(ctx, this.store.log());
    return [];
  }

  private drawResult(ctx: ScreenContext, actions: PlayActions): string[] {
    const result = this.store.result();
    const text = result === 'win' ? 'You won!' : result === 'loss' ? 'You lost.' : 'A tie.';
    const buttonW = 340;
    const textW = RIGHT - X - 2 * (buttonW + GAP) - GAP;
    write(ctx, text, X + 12, BAR_TOP + 32, { size: 28, bold: true }, INK.white, 'left', textW);
    writeLines(ctx, actions.rematchNote, X + 12, BAR_TOP + 52, textW, 24, { size: 16 }, INK.gray200, 2);
    const picks: string[] = [];
    const leave = { x: RIGHT - buttonW, y: MOVE_Y, w: buttonW, h: MOVE_H };
    if (actions.canRematch) {
      bigButton(ctx, 'result-rematch', { ...leave, x: leave.x - buttonW - GAP }, actions.rematchLabel, 'primary', actions.rematch);
      picks.push('result-rematch');
    }
    bigButton(ctx, 'result-leave', leave, 'Back to Home', 'plain', actions.leave);
    picks.push('result-leave');
    return picks;
  }

  /** The tab over the bar's left: who's choosing (1 and 2 in doubles), its item and ability, `extra` after. */
  private drawTab(ctx: ScreenContext, extra?: { text: string; color: Rgba }): void {
    const { renderer } = ctx;
    const slot = this.choices.slot() ?? 0;
    const doubles = this.slotCount() > 1;
    const chooser = this.chooser();
    const notice = this.choices.notice();
    const name = this.choices.pokemonName();
    const nameW = ctx.text.measure(name, { size: 22, bold: true });
    const info = chooser ? `${chooser.item} · ${chooser.ability}` : '';
    const infoW = info ? Math.min(360, ctx.text.measure(info, { size: 18 })) + 34 : 0;
    const extraText = notice || extra?.text || '';
    const extraW = extraText ? Math.min(400, ctx.text.measure(extraText, { size: 16, bold: true }) + 24) + 14 : 0;
    const width = Math.min(TAB_MAX_W, 14 + (doubles ? 64 : 0) + nameW + 14 + infoW + extraW + 14);
    const top = BAR_TOP - TAB_H;
    renderer.rect(X, top, width, TAB_H + 14, { fill: BAR_FILL, stroke: INK.sky300, radius: 12, border: 3 });
    // The tab opens into the bar: its lower edge is the bar itself.
    renderer.rect(X, BAR_TOP + 3, width, 14, { fill: BAR_FILL });
    const mid = top + TAB_H / 2 + 2;
    let x = X + 14;
    if (doubles) {
      for (let i = 0; i < 2; i++) {
        const on = i === slot;
        renderer.rect(x + i * 32, mid - 13, 26, 26, { fill: on ? INK.blue700 : INK.gray700, stroke: on ? INK.blue300 : INK.gray600, radius: 13, border: 2 });
        write(ctx, String(i + 1), x + i * 32 + 13, mid, { size: 15, bold: true }, INK.white, 'center');
      }
      x += 64;
    }
    write(ctx, name, x, mid, { size: 22, bold: true }, INK.white);
    x += nameW + 14;
    if (chooser) {
      ctx.images.drawItem(chooser.itemId, x - 2, mid - 14, 28);
      write(ctx, info, x + 30, mid, { size: 18 }, INK.gray300, 'left', infoW - 34);
      x += infoW;
    }
    if (notice) write(ctx, notice, x, mid, { size: 16, bold: true }, AMBER, 'left', extraW - 14);
    else if (extra) {
      const w = extraW - 14;
      renderer.rect(x, mid - 14, w, 28, { fill: extra.color, stroke: TYPE_EDGE, radius: 6, border: 1 });
      write(ctx, extra.text, x + 12, mid, { size: 16, bold: true }, INK.white, 'left', w - 24);
    }
  }

  private drawMoves(ctx: ScreenContext, actions: PlayActions): string[] {
    const { renderer } = ctx;
    const picks: string[] = [];
    // The second slot shows the first one's order.
    const slot = this.choices.slot() ?? 0;
    const before = slot > 0 ? this.choices.planned().find((plan) => plan.slot === slot - 1) : undefined;
    this.drawTab(ctx, before ? { text: `✓ ${before.name} · ${before.action}`, color: rgba(typeColor(before.type) || '#374151') } : undefined);

    for (const move of this.moves()) {
      const box = { x: move.x, y: MOVE_Y, w: MOVE_W, h: MOVE_H };
      const id = `move-${move.index}`;
      const focused = !move.disabled && ctx.focus.control({ id, ...box, accept: () => this.choices.chooseMove(move.index) });
      if (!move.disabled) picks.push(id);
      const ink = move.disabled ? INK.gray400 : INK.white;
      renderer.rect(box.x, box.y, box.w, box.h, { fill: move.disabled ? INK.gray700 : move.color, stroke: move.disabled ? INK.gray600 : [1, 1, 1, 0.35], radius: 10, border: 2 });
      write(ctx, move.name, box.x + 14, box.y + 24, { size: 22, bold: true }, ink, 'left', MOVE_W - 28);
      // Type, category icon, power; PP on the right.
      const rowY = box.y + 62;
      let x = box.x + 14;
      if (move.type) {
        renderer.rect(x, rowY - 11, 66, 22, { fill: [0, 0, 0, 0.3], stroke: [1, 1, 1, 0.35], radius: 4, border: 1 });
        write(ctx, move.type.toUpperCase(), x + 33, rowY, { size: 13, bold: true }, ink, 'center', 62);
        x += 72;
      }
      const icon = categoryIcon(renderer, move.category);
      if (icon) {
        renderer.rect(x, rowY - CATEGORY_ICON_H / 2, CATEGORY_ICON_W, CATEGORY_ICON_H, { fill: move.disabled ? [1, 1, 1, 0.5] : INK.white, texture: icon });
        x += CATEGORY_ICON_W + 8;
      }
      if (move.power) write(ctx, move.power, x, rowY, { size: 16, bold: true }, move.disabled ? INK.gray400 : INK.gray100);
      write(ctx, move.pp, box.x + MOVE_W - 14, rowY, { size: 16, bold: true }, ink, 'right');
      if (focused) ring(ctx, box, 10);
    }

    // Switch, as tall as the moves: the party screen.
    const switches = this.choices.switchOptions().filter((option) => option.allowed).length;
    const switchBox = { x: SIDE_X, y: MOVE_Y, w: SIDE_W, h: MOVE_H };
    const switchFocused = ctx.focus.control({ id: 'switch', ...switchBox, accept: actions.openParty });
    renderer.rect(switchBox.x, switchBox.y, switchBox.w, switchBox.h, { fill: switches > 0 ? rgba('#1e3a5f') : INK.gray700, stroke: switches > 0 ? INK.sky300 : INK.gray600, radius: 10, border: 2 });
    write(ctx, 'Switch', switchBox.x + switchBox.w / 2, switchBox.y + 30, { size: 26, bold: true }, switches > 0 ? INK.white : INK.gray400, 'center');
    write(ctx, switches > 0 ? `${switches} in reserve ▶` : 'None left', switchBox.x + switchBox.w / 2, switchBox.y + 62, { size: 16 }, switches > 0 ? INK.gray200 : INK.gray400, 'center');
    if (switchFocused) ring(ctx, switchBox, 10);

    // Mega or Tera, only while it can: by the chooser's status box, on the field. L does it on the
    // controller; the button is for clicks.
    const megaBox = this.megaBox();
    if (this.choices.canMega()) {
      const on = this.choices.mega();
      hint(ctx, 'mega', megaBox, 'L', on ? 'Mega Evolving' : 'Mega Evolve', false, () => this.choices.toggleMega(), on ? { fill: rgba('#6b2a73'), border: rgba('#f0abfc') } : { fill: INK.gray700, border: INK.gray400 });
    } else if (this.choices.teraType()) {
      const on = this.choices.tera();
      const type = this.choices.teraType();
      hint(ctx, 'tera', megaBox, 'L', on ? 'Terastallizing' : `Tera: ${type}`, false, () => this.choices.toggleTera(), on ? { fill: rgba(typeColor(type) || '#374151'), border: INK.white } : { fill: INK.gray700, border: INK.gray500 });
    }
    // The first move takes the focus; Switch after them.
    return [...picks, 'switch'];
  }

  /** Mega's (or Tera's) button: on the field, left of the chooser's status box (which stays put whatever the camera does). */
  private megaBox(): { x: number; y: number; w: number; h: number } {
    const layout = this.store.gameType() === 'singles' ? SINGLES : DOUBLES;
    const stand = layout.stands[this.choices.slot() === 1 ? 'p1b' : 'p1a'] ?? layout.stands['p1a'];
    return { x: stand.boxLeft - MEGA_W - 10, y: FIELD_TOP + stand.boxTop + (BOX_H - SIDE_H) / 2, w: MEGA_W, h: SIDE_H };
  }

  private drawTargets(ctx: ScreenContext): string[] {
    const { renderer } = ctx;
    const pending = this.choices.pendingMove();
    const move = pending ? this.moves()[pending.move] : null;
    let x = X;
    if (move) {
      const w = ctx.text.measure(move.name, { size: 21, bold: true }) + 28;
      renderer.rect(x, ROW_1, w, ROW_H, { fill: move.color, stroke: TYPE_EDGE, radius: 8, border: 2 });
      write(ctx, move.name, x + 14, ROW_1 + ROW_H / 2, { size: 21, bold: true }, INK.white);
      x += w + 12;
      write(ctx, '→', x, ROW_1 + ROW_H / 2, { size: 22, bold: true }, INK.gray300);
      x += 34;
    }

    const picks: string[] = [];
    for (const option of this.choices.targetOptions()) {
      const label = targetLabel(option);
      const box = { x, y: ROW_1, w: ctx.text.measure(label, { size: 20, bold: true }) + 32, h: ROW_H };
      const id = targetId(option.target);
      const focused = option.allowed && ctx.focus.control({ id, ...box, accept: () => this.choices.chooseTarget(option.target) });
      if (option.allowed) picks.push(id);
      const look = !option.allowed
        ? { fill: INK.gray700, border: INK.gray600, ink: INK.gray400 }
        : focused
          ? { fill: INK.blue700, border: INK.yellow300, ink: INK.white }
          : { fill: INK.card, border: option.foe ? INK.gray500 : INK.sky300, ink: INK.white };
      renderer.rect(box.x, box.y, box.w, box.h, { fill: look.fill, stroke: look.border, radius: 8, border: 2 });
      write(ctx, label, box.x + 16, box.y + ROW_H / 2, { size: 20, bold: true }, look.ink);
      x += box.w + 10;
    }

    const notice = this.choices.notice();
    write(ctx, notice || '◀ ▶ Target   ·   A Confirm   ·   B Back to moves', X, ROW_2 + ROW_H / 2, { size: 18, bold: !!notice }, notice ? AMBER : INK.gray300, 'left', 1000);
    // For clicks: B does this on the controller.
    hint(ctx, 'choice-back', { x: RIGHT - 170, y: ROW_2, w: 170, h: 36 }, 'B', 'Back', false, () => this.choices.back());
    return picks;
  }

  private drawWaiting(ctx: ScreenContext): string[] {
    const plans = this.plans();
    const width = plans.length > 1 ? (RIGHT - X - GAP) / 2 : RIGHT - X;
    plans.forEach((plan, i) => {
      const box = { x: X + i * (width + GAP), y: ROW_1, w: width, h: ROW_H };
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: plan.color, stroke: TYPE_EDGE, radius: 8, border: 2 });
      const head = `${plan.name} · ${plan.action}`;
      const headW = write(ctx, head, box.x + 14, box.y + ROW_H / 2, { size: 18, bold: true }, INK.white, 'left', box.w - 28);
      if (plan.detail && headW < box.w - 80) write(ctx, plan.detail, box.x + 26 + headW, box.y + ROW_H / 2, { size: 15 }, INK.gray200, 'left', box.w - 40 - headW);
    });
    const opponent = this.store.sides().p2.name || 'the opponent';
    write(ctx, `Waiting for ${opponent}…`, X, ROW_2 + ROW_H / 2, { size: 20, bold: true }, INK.gray300, 'left', 800);
    if (!this.store.canUndo()) return [];
    // Showdown's Cancel: while the opponent is still choosing, the choices can be made again (B too).
    button(ctx, 'cancel', { x: RIGHT - 160, y: ROW_2, w: 160, h: 36 }, 'B  Cancel', 'plain', () => this.store.undo());
    return ['cancel'];
  }
}

/** A target button's id: its Showdown target number. */
export function targetId(target: number): string {
  return `target-${target}`;
}

/** The field slot a target number points at: 1, 2 the foes' slots; -1, -2 ours. */
export function targetSlot(target: number): string {
  return `${target > 0 ? 'p2' : 'p1'}${Math.abs(target) === 1 ? 'a' : 'b'}`;
}

/** A big button, as the result's: 24px bold text. */
function bigButton(ctx: ScreenContext, id: string, box: { x: number; y: number; w: number; h: number }, label: string, look: 'primary' | 'plain', accept: () => void): void {
  const focused = ctx.focus.control({ id, ...box, accept });
  const primary = look === 'primary';
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: primary ? INK.blue700 : INK.gray600, stroke: primary ? INK.blue300 : INK.gray400, radius: 10, border: 2 });
  write(ctx, label, box.x + box.w / 2, box.y + box.h / 2, { size: 24, bold: true }, INK.white, 'center', box.w - 16);
  if (focused) ring(ctx, box, 10);
}

/** "Garchomp", "Kingambit (ally)", "Garchomp (fainted)". */
function targetLabel({ pokemon, foe }: TargetOption): string {
  if (!pokemon) return 'Empty';
  return `${pokemon.name}${pokemon.fainted ? ' (fainted)' : foe ? '' : ' (ally)'}`;
}
