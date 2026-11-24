import { computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { hasAbilities, hasItems } from '@core/dex/generations';
import { moveInfo } from '@core/dex/moves';
import { abilityName, itemName } from '@core/dex/names';
import { Rgba, Texture, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CATEGORY_ICON_H, CATEGORY_ICON_W, categoryIcon } from '@core/gl/ui/category-icons';
import { SLANT } from '@core/gl/ui/menu-kit';
import { BATTLE_SHORTCUTS } from '@core/input/console-keys';
import { BAR_H, BAR_TOP, BOX_H, DOUBLES, FIELD_TOP, SINGLES } from '@features/battle/gl/field-layout';
import { BattleChoices, TargetOption } from '@features/battle/state/battle-choices';
import { BattleStore } from '@features/battle/state/battle-store';
import { typeColor } from '@shared/data/type-colors';
import { spriteSetOf } from '@shared/utils/sprite-id';
import { foeInk, legendItem } from './header-view';
import { megaSymbolTexture } from './mega-symbol';
import { commandBarFill, drawCommandBar, drawMessage } from './message-box';
import { INK, ScreenContext, button, hint, keyChip, ring, write } from './screen-context';

const X = 16;
const RIGHT = 1264;
const GAP = 12;
/** The four moves in a row, Switch on their right; slanted cards, so each leans 12px over its box. */
const MOVE_W = 252;
const MOVE_H = 86;
const MOVE_Y = BAR_TOP + 12;
const SIDE_X = X + 4 * (MOVE_W + GAP);
const SIDE_W = RIGHT - SIDE_X;
const SIDE_H = 40;
/** Tera's button by the chooser's status box. */
const MEGA_W = 176;
/** Mega's emblem by the chooser's status box: its circle's radius, and its centre left of the box. */
const EMBLEM_R = 30;
const EMBLEM_LEFT = 92;
const MEGA_PINK: Rgba = rgba('#f0abfc');
const MEGA_MAGENTA: Rgba = rgba('#d946ef');
/** Two rows in the bar: the targets' cards on top, the legend under. */
const ROW_1 = BAR_TOP + 12;
const ROW_2 = BAR_TOP + 62;
const ROW_H = 40;
/** Picking a target: the column on the bar's right with Confirm and Back. */
const TARGET_COLUMN_W = 124;
/** The name plate over the bar while choosing: who's choosing, its item and ability. */
const TAB_H = 46;
const TAB_MAX_W = 900;
/** A slanted card's lean (its top edge to the right of its bottom one). */
const LEAN = Math.round((MOVE_H / 2) * SLANT);
const WHITE: Rgba = [1, 1, 1, 1];
/** Skip to end, on the bar's right while the turn plays (as Cancel while the opponent chooses). */
const SKIP_ID = 'skip-to-end';
const SKIP = { x: RIGHT - 190, y: BAR_TOP + Math.round(BAR_H / 2) - 21, w: 190, h: 42 };

/** What the bar's buttons do beyond the battle's own state. */
export interface PlayActions {
  canRematch: boolean;
  rematchLabel: string;
  rematchNote: string;
  rematch: () => void;
  /** The battle again from its start, as a replay. */
  instantReplay: () => void;
  leave: () => void;
  /** Switch: opens the party screen. */
  openParty: () => void;
}

/**
 * The command bar in our own battles, along the stage's foot, always the same size, in the menu's
 * style and the theme's colours. While the turn plays, its message; choosing, the four moves as
 * slanted cards in their types' colours (category, power, PP) with Switch (the party screen, our
 * reserve as Poké Balls) on their right, Mega or Tera (R) by the chooser's status box while it can,
 * and a name plate over the bar with who's choosing (its item and ability, and the first slot's order
 * while the second chooses); picking a target, the move and the targets as cards (the field marks
 * the one pointed at); while the opponent chooses, each order and Cancel; at the end, the result with
 * Rematch, Instant replay and Back to Home. `draw` returns the ids of the view's buttons in order, so a new view can
 * focus its first.
 */
export class PlayPanelView {
  /** The Mega symbol, made on first use. */
  private megaSymbol: Texture | null = null;
  private readonly store = inject(BattleStore);
  private readonly choices = inject(BattleChoices);
  private readonly dex = inject(ChampionsDex);
  /** Each control's eased focus, by id (the cards lift as the focus reaches them). */
  private readonly lift = new Map<string, number>();

  /** Changes whenever a new set of buttons appears, so the focus moves to it. */
  readonly viewKey = computed(() => {
    const request = this.store.request();
    return [this.store.result(), !!this.store.lost(), request?.rqid, this.choices.slot(), !!this.choices.pendingMove(), this.store.canUndo()].join('|');
  });

  /** Choosing a move or its target (the party screen takes forced switches). */
  readonly choosing = computed(() => this.choices.slot() !== null && !this.choices.forceSwitch() && !this.store.result() && !this.store.lost());

  private readonly moves = computed(() =>
    this.choices.moves().map((move, i) => {
      const gen = this.store.gen();
      // The Champions data is Gen 9's; Hidden Power's type (and power, before Gen 6) is in its name.
      const info = (gen === 9 ? this.dex.move(move.id) : undefined) ?? moveInfo(move.id === 'hiddenpower' ? move.move : move.id, gen);
      const type = info?.type ?? '';
      return {
        index: i,
        // "Hidden Power Dark", without the power the request adds before Gen 6 (it has its own column).
        name: move.id === 'hiddenpower' && info ? info.name : move.move,
        disabled: !!move.disabled || move.pp === 0,
        type,
        color: rgba(typeColor(type) || '#4b5563'),
        power: info && info.basePower > 0 ? String(info.basePower) : '',
        category: info?.category ?? '',
        pp: move.pp === undefined ? '' : `${move.pp}/${move.maxpp}`,
        x: X + i * (MOVE_W + GAP),
      };
    }),
  );

  /** The one choosing: its item and ability, from the request (none in the generations without them). */
  private readonly chooser = computed(() => {
    const pokemon = this.choices.pokemon();
    if (!pokemon) return null;
    const gen = this.store.gen();
    return {
      itemId: pokemon.item,
      item: itemName(pokemon.item) || (hasItems(gen) ? 'No item' : ''),
      ability: hasAbilities(gen) ? abilityName(pokemon.ability ?? pokemon.baseAbility ?? '') : '',
    };
  });

  /** How many slots choose this turn: 2 in doubles. */
  private readonly slotCount = computed(() => (this.store.gameType() === 'singles' ? 1 : (this.store.request()?.active?.length ?? 1)));

  /** Our team's Poké Balls on Switch: those that could come in, those on the field, the fainted ones. */
  private readonly reserve = computed(() =>
    this.store
      .team()
      .slice(0, 6)
      .map((pokemon) => (pokemon.condition.endsWith(' fnt') ? 'fainted' : pokemon.active ? 'active' : 'ready')),
  );

  /** Each active slot's order this turn, on its move type's colour; before any order, who's out there. */
  private readonly plans = computed(() => {
    const submitted = this.choices.submitted();
    const { active } = this.store.sides().p1;
    const slots = this.store.gameType() === 'singles' ? active.slice(0, 1) : active;
    return slots.map((pokemon, slot) => {
      const plan = submitted.find((p) => p.slot === slot);
      if (plan) return { ...plan, color: rgba(typeColor(plan.type) || '#4b5563') as Rgba | null };
      const action = !pokemon ? '' : pokemon.fainted ? 'Fainted' : 'Getting ready';
      return { slot, name: pokemon?.name ?? '', action, detail: '', color: null as Rgba | null };
    });
  });

  draw(ctx: ScreenContext, actions: PlayActions): string[] {
    drawCommandBar(ctx);
    if (this.store.result() || this.store.lost()) return this.drawResult(ctx, actions);
    if (this.choices.slot() !== null) {
      // A forced switch is chosen on the party screen.
      if (this.choices.forceSwitch()) return [];
      return this.choices.pendingMove() ? this.drawTargets(ctx) : this.drawMoves(ctx, actions);
    }
    if (!this.store.playing() && this.choices.submitted().length > 0) return this.drawWaiting(ctx);
    if (!this.store.playing()) {
      drawMessage(ctx, this.store.log());
      return [];
    }
    // The turn playing out: its message, and Skip to end on the bar's right.
    drawMessage(ctx, this.store.log(), { x: 28, w: SKIP.x - 28 - GAP });
    const focused = ctx.focus.control({ id: SKIP_ID, ...SKIP, accept: () => this.store.skipToEnd() });
    const p = ctx.palette;
    ctx.renderer.rect(SKIP.x, SKIP.y, SKIP.w, SKIP.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.accentText : p.rim, radius: SKIP.h / 2, border: focused ? 3 : 1 });
    const keyW = keyChip(ctx, 'A', SKIP.x + 8, SKIP.y + SKIP.h / 2, 28);
    write(ctx, 'Skip to end', SKIP.x + keyW + 18, SKIP.y + SKIP.h / 2, { size: 17, bold: true }, p.ink);
    if (focused) ring(ctx, SKIP, SKIP.h / 2);
    return [SKIP_ID];
  }

  /** A control's eased focus, 0 to 1 (`target` 1 while it has the focus). */
  private eased(ctx: ScreenContext, id: string, focused: boolean): number {
    const previous = this.lift.get(id) ?? 0;
    const value = previous + ((focused ? 1 : 0) - previous) * 0.3;
    this.lift.set(id, value);
    return value;
  }

  private drawResult(ctx: ScreenContext, actions: PlayActions): string[] {
    const p = ctx.palette;
    const result = this.store.result();
    // Cut off from the battle after a reconnection: why, in the result's place.
    const lost = result ? null : this.store.lost();
    const text = lost !== null ? 'Disconnected' : result === 'win' ? 'You won!' : result === 'loss' ? 'You lost.' : 'A tie.';
    const rematch = actions.canRematch && lost === null;
    // Instant replay and Back to Home, and Rematch when there is one: narrower, three in the row.
    const buttonW = rematch ? 270 : 340;
    const buttons = lost === null ? (rematch ? 3 : 2) : 1;
    const textW = RIGHT - X - buttons * (buttonW + GAP) - GAP;
    write(ctx, text, X + 12, BAR_TOP + 32, { size: 28, bold: true }, result === 'win' ? p.accentText : p.ink, 'left', textW);
    const note = lost ?? actions.rematchNote;
    const lines = ctx.text.wrap(note, { size: 16 }, textW).slice(0, 2);
    lines.forEach((line, i) => write(ctx, line, X + 12, BAR_TOP + 64 + i * 24, { size: 16 }, p.muted, 'left', textW));
    const picks: string[] = [];
    const leave = { x: RIGHT - buttonW, y: MOVE_Y, w: buttonW, h: MOVE_H };
    const replay = { ...leave, x: leave.x - buttonW - GAP };
    if (rematch) {
      button(ctx, 'result-rematch', { ...replay, x: replay.x - buttonW - GAP }, actions.rematchLabel, 'primary', actions.rematch);
      picks.push('result-rematch');
    }
    // Cut off from the battle, there's no end to watch again.
    if (lost === null) {
      button(ctx, 'result-replay', replay, 'Instant replay', rematch ? 'plain' : 'primary', actions.instantReplay);
      picks.push('result-replay');
    }
    button(ctx, 'result-leave', leave, 'Back to Home', 'plain', actions.leave);
    picks.push('result-leave');
    return picks;
  }

  /** The name plate over the bar's left: who's choosing (1 and 2 in doubles), its item and ability, `extra` after. */
  private drawTab(ctx: ScreenContext, extra?: { text: string; color: Rgba }): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const slot = this.choices.slot() ?? 0;
    const doubles = this.slotCount() > 1;
    const chooser = this.chooser();
    const notice = this.choices.notice();
    const name = this.choices.pokemonName();
    const chip = { size: 14, bold: true };
    const nameW = ctx.text.measure(name, { size: 21, bold: true });
    const itemW = chooser?.item ? Math.min(220, ctx.text.measure(chooser.item, chip)) + 24 + (chooser.itemId ? 24 : 0) : 0;
    const abilityW = chooser?.ability ? Math.min(200, ctx.text.measure(chooser.ability, chip)) + 24 : 0;
    const extraText = notice || extra?.text || '';
    const extraW = extraText ? Math.min(380, ctx.text.measure(extraText, chip) + 24) : 0;
    const width = Math.min(TAB_MAX_W, 12 + (doubles ? 62 : 0) + nameW + 12 + (itemW ? itemW + 8 : 0) + (abilityW ? abilityW + 8 : 0) + (extraW ? extraW + 8 : 0) + 8);
    const top = BAR_TOP - TAB_H;
    const ground = commandBarFill(p);
    renderer.rect(X, top, width, TAB_H + 16, { fill: ground, stroke: p.rim, radius: 14, border: 1 });
    // The plate opens into the bar: its lower edge is the bar itself.
    renderer.rect(X + 1, BAR_TOP, width - 2, 16, { fill: ground });
    const mid = top + TAB_H / 2 + 1;
    let x = X + 12;
    if (doubles) {
      for (let i = 0; i < 2; i++) {
        const on = i === slot;
        renderer.rect(x + i * 30, mid - 12, 24, 24, { fill: on ? p.accent : p.rim, radius: 12 });
        write(ctx, String(i + 1), x + i * 30 + 12, mid, { size: 13, bold: true }, on ? WHITE : p.muted, 'center');
      }
      x += 62;
    }
    write(ctx, name, x, mid, { size: 21, bold: true }, p.ink);
    x += nameW + 12;
    const pill = (text: string, w: number, fill: Rgba, ink: Rgba, item?: string): void => {
      renderer.rect(x, mid - 13, w, 26, { fill, radius: 13 });
      let tx = x + 12;
      if (item) {
        ctx.images.drawItem(item, x + 4, mid - 11, 22);
        tx += 22;
      }
      write(ctx, text, tx, mid, chip, ink, 'left', w - (tx - x) - 10);
      x += w + 8;
    };
    if (chooser) {
      if (itemW) pill(chooser.item, itemW, p.rim, p.ink, chooser.itemId || undefined);
      if (abilityW) pill(chooser.ability, abilityW, p.rim, p.ink);
    }
    if (notice) pill(notice, extraW, p.teal, p.contrast);
    else if (extra) pill(extra.text, extraW, extra.color, WHITE);
  }

  /**
   * A slanted card as the menu's buttons, filled with `color` (a move's type): lifted and edged in the
   * accent while focused, greyed while it can't be picked. `inner` draws what's on it, upright.
   */
  private slantedCard(ctx: ScreenContext, box: { x: number; y: number; w: number; h: number }, color: Rgba, f: number, disabled: boolean): number {
    const p = ctx.palette;
    const { renderer } = ctx;
    const y = box.y - 5 * f;
    if (!disabled) renderer.rect(box.x, y + 8, box.w, box.h, { fill: [0, 0, 0, 0.16 + 0.2 * f], radius: 14, softness: 16, skew: SLANT });
    const fill = disabled ? p.disabledFill : color;
    renderer.rect(box.x, y, box.w, box.h, {
      fill,
      fillEnd: disabled ? fill : mixRgba(color, WHITE, 0.16),
      stroke: disabled ? p.disabledBorder : mixRgba(withAlpha(WHITE, 0.3), p.accentText, f),
      border: 1.5 + 2.5 * f,
      radius: 14,
      skew: SLANT,
    });
    return y;
  }

  private drawMoves(ctx: ScreenContext, actions: PlayActions): string[] {
    const p = ctx.palette;
    const { renderer } = ctx;
    const picks: string[] = [];
    // The second slot shows the first one's order (no ✓: the console's font has none).
    const slot = this.choices.slot() ?? 0;
    const before = slot > 0 ? this.choices.planned().find((plan) => plan.slot === slot - 1) : undefined;
    this.drawTab(ctx, before ? { text: `${before.name} · ${before.action}`, color: rgba(typeColor(before.type) || '#4b5563') } : undefined);

    for (const move of this.moves()) {
      const box = { x: move.x + LEAN, y: MOVE_Y, w: MOVE_W - LEAN, h: MOVE_H };
      const id = `move-${move.index}`;
      const focused = !move.disabled && ctx.focus.control({ id, ...box, accept: () => this.choices.chooseMove(move.index) });
      if (!move.disabled) picks.push(id);
      const f = this.eased(ctx, id, focused);
      const y = this.slantedCard(ctx, box, move.color, f, move.disabled);
      const ink = move.disabled ? p.disabledInk : WHITE;
      // Upright text along the slanted card: the top line starts right of the bottom one.
      write(ctx, move.name, box.x + 16, y + 24, { size: 21, bold: true }, ink, 'left', box.w - 28);
      const rowY = y + 62;
      let x = box.x + 4;
      if (move.type) {
        renderer.rect(x, rowY - 11, 70, 22, { fill: [0, 0, 0, move.disabled ? 0.12 : 0.3], radius: 11 });
        // "FIGHTING", "ELECTRIC"… a size smaller rather than cut.
        const type = move.type.toUpperCase();
        const style = { size: 12, bold: true };
        if (ctx.text.measure(type, style) > 60) style.size = 10;
        write(ctx, type, x + 35, rowY, style, ink, 'center', 64);
        x += 76;
      }
      const icon = categoryIcon(renderer, move.category);
      if (icon) {
        renderer.rect(x, rowY - CATEGORY_ICON_H / 2, CATEGORY_ICON_W, CATEGORY_ICON_H, { fill: move.disabled ? [1, 1, 1, 0.5] : WHITE, texture: icon });
        x += CATEGORY_ICON_W + 8;
      }
      if (move.power) write(ctx, move.power, x, rowY, { size: 16, bold: true }, ink);
      write(ctx, move.pp, box.x + box.w - 14 - LEAN, rowY, { size: 15, bold: true }, withAlpha(ink, move.disabled ? 1 : 0.9), 'right');
    }

    // Switch, as tall as the moves: the party screen, our team as Poké Balls (the ones that could come in bright).
    const switches = this.choices.switchOptions().filter((option) => option.allowed).length;
    const switchBox = { x: SIDE_X + LEAN, y: MOVE_Y, w: SIDE_W - LEAN, h: MOVE_H };
    const switchFocused = ctx.focus.control({ id: 'switch', ...switchBox, accept: actions.openParty });
    const f = this.eased(ctx, 'switch', switchFocused);
    const y = switchBox.y - 5 * f;
    renderer.rect(switchBox.x, y + 8, switchBox.w, switchBox.h, { fill: [0, 0, 0, 0.12 + 0.2 * f], radius: 14, softness: 16, skew: SLANT });
    const body = mixRgba(p.panel, p.select, Math.max(f, 0.35));
    renderer.rect(switchBox.x, y, switchBox.w, switchBox.h, {
      fill: switches > 0 ? body : p.disabledFill,
      fillEnd: switches > 0 ? mixRgba(body, p.accent, 0.25) : p.disabledFill,
      stroke: mixRgba(p.rim, p.accentText, f),
      border: 1 + 3 * f,
      radius: 14,
      skew: SLANT,
    });
    // Well inside the slanted edge (it leans out under the middle): X's chip, then the title;
    // under it the team as balls (the ones that could come in bright), or why none can.
    const ink = switches > 0 ? p.ink : p.disabledInk;
    let tx = switchBox.x + 20;
    tx += keyChip(ctx, BATTLE_SHORTCUTS.party.label, tx, y + 26, 24) + 8;
    write(ctx, 'SWITCH', tx, y + 26, { size: 21, bold: true }, ink, 'left', switchBox.x + switchBox.w - 12 - tx);
    const trapped = this.choices.trapped();
    if (switches > 0) {
      this.reserve().forEach((state, i) => {
        const bx = switchBox.x + 16 + i * 20;
        const by = y + 50;
        const fainted = state === 'fainted';
        const alpha = state === 'active' ? 0.45 : 1;
        renderer.rect(bx, by, 16, 8, { fill: fainted ? INK.gray600 : withAlpha(rgba('#e8473c'), alpha), radius: 4 });
        renderer.rect(bx, by + 8, 16, 8, { fill: fainted ? INK.gray500 : withAlpha(rgba('#f4f4f4'), alpha), radius: 4 });
        renderer.rect(bx, by + 7, 16, 2, { fill: withAlpha(rgba('#222222'), alpha) });
        renderer.rect(bx, by, 16, 16, { fill: [0, 0, 0, 0], stroke: withAlpha(rgba('#222222'), alpha), radius: 8, border: 1.5 });
      });
    } else {
      write(ctx, trapped ? 'Trapped!' : 'None left', switchBox.x + 16, y + 58, { size: 15, bold: true }, trapped ? p.danger : p.muted, 'left', switchBox.w - 36);
    }

    // Mega or Tera, only while it can: by the chooser's status box, on the field. R does it on the
    // controller; the button is for clicks.
    const megaBox = this.megaBox();
    if (this.choices.canMega()) {
      this.drawMegaEmblem(ctx, megaBox);
    } else if (this.choices.teraType()) {
      const on = this.choices.tera();
      const type = this.choices.teraType();
      const color = rgba(typeColor(type) || '#4b5563');
      hint(ctx, 'tera', megaBox, 'R', on ? 'Terastallizing' : `Tera: ${type}`, false, () => this.choices.toggleTera(), on ? { fill: color, border: WHITE, ink: WHITE } : undefined);
    }
    // The first move takes the focus; Switch after them.
    return [...picks, 'switch'];
  }

  /**
   * Mega Evolution's emblem, as the newer games show it: the Mega symbol (the helix on its rainbow
   * sphere), a ring of sparkles turning round it, "MEGA EVOLVE" and R's chip under. Chosen, it lights
   * up (the sparkles race, the ring turns white) and reads "MEGA EVOLVING". Left of the chooser's
   * status box; R does it on the controller, a click on it in a browser.
   */
  private drawMegaEmblem(ctx: ScreenContext, box: { x: number; y: number; w: number; h: number }): void {
    const { renderer, now } = ctx;
    const on = this.choices.mega();
    const cx = this.megaBoxCenter(box);
    const cy = box.y + box.h / 2 - 14;
    const R = EMBLEM_R;
    const area = { x: cx - 74, y: cy - R - 14, w: 148, h: 2 * R + 50 };
    ctx.focus.control({ id: 'mega', ...area, accept: () => this.choices.toggleMega(), skip: true });

    // The aura, breathing.
    const breath = 0.5 + 0.5 * Math.sin(now / (on ? 180 : 420));
    const aura = R * (on ? 2 : 1.7);
    renderer.rect(cx - aura, cy - aura, aura * 2, aura * 2, { fill: withAlpha(MEGA_MAGENTA, (on ? 0.5 : 0.28) + 0.15 * breath), texture: ctx.disc, additive: true });
    // The sparkles, turning round it (faster once chosen), each twinkling on its own beat.
    const count = 18;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + now / (on ? 500 : 1600);
      const twinkle = 0.5 + 0.5 * Math.sin(now / 160 + i * 1.7);
      const radius = R + 8 + 3 * Math.sin(now / 300 + i);
      const size = 2 + 3 * twinkle;
      const color = i % 3 === 0 ? INK.white : i % 3 === 1 ? MEGA_PINK : MEGA_MAGENTA;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      renderer.rect(x - size / 2, y - size / 2, size, size, { fill: withAlpha(color, 0.5 + 0.5 * twinkle), radius: size / 2, additive: true });
    }
    // The symbol, ringed.
    this.megaSymbol ??= megaSymbolTexture(renderer);
    renderer.rect(cx - R, cy - R, R * 2, R * 2, { fill: INK.white, texture: this.megaSymbol });
    renderer.rect(cx - R, cy - R, R * 2, R * 2, { fill: [0, 0, 0, 0], stroke: on ? INK.white : MEGA_PINK, radius: R, border: on ? 3 : 2 });
    if (on) renderer.rect(cx - R, cy - R, R * 2, R * 2, { fill: withAlpha(MEGA_PINK, 0.25 * breath), radius: R, additive: true });

    // Under it: R's chip and the label, on a dark band so they read over any sky.
    const label = on ? 'MEGA EVOLVING' : 'MEGA EVOLVE';
    const font = { size: 15, bold: true };
    const width = 22 + 6 + ctx.text.measure(label, font);
    const left = cx - width / 2;
    const y = cy + R + 16;
    renderer.rect(left - 8, y - 13, width + 16, 26, { fill: [0.07, 0.04, 0.12, 0.78], radius: 13 });
    keyChip(ctx, 'R', left, y, 20, INK.white, rgba('#111111'));
    write(ctx, label, left + 28, y, font, on ? MEGA_PINK : INK.white);
  }

  /** Where Mega's emblem is centred, left of the chooser's status box. */
  private megaBoxCenter(box: { x: number; w: number }): number {
    return box.x + box.w + 10 - EMBLEM_LEFT;
  }

  /** Mega's (or Tera's) button: on the field, left of the chooser's status box (which stays put whatever the camera does). */
  private megaBox(): { x: number; y: number; w: number; h: number } {
    const layout = this.store.gameType() === 'singles' ? SINGLES : DOUBLES;
    const stand = layout.stands[this.choices.slot() === 1 ? 'p1b' : 'p1a'] ?? layout.stands['p1a'];
    return { x: stand.boxLeft - MEGA_W - 10, y: FIELD_TOP + stand.boxTop + (BOX_H - SIDE_H) / 2, w: MEGA_W, h: SIDE_H };
  }

  /**
   * Picking a target: the name plate (who's choosing, or why that target can't be picked), the move on
   * its type's colour, then each Pokémon it can hit as a card with its picture, as wide as fits beside
   * the column on the right: A's Confirm over a Back button (B on the controller).
   */
  private drawTargets(ctx: ScreenContext): string[] {
    const p = ctx.palette;
    const { renderer } = ctx;
    this.drawTab(ctx);
    const pending = this.choices.pendingMove();
    const move = pending ? this.moves()[pending.move] : null;
    let x = X;
    if (move) {
      const w = Math.min(220, ctx.text.measure(move.name, { size: 19, bold: true }) + 32);
      renderer.rect(x, ROW_1 + 4, w, ROW_H, { fill: move.color, radius: 12 });
      write(ctx, move.name, x + 16, ROW_1 + 4 + ROW_H / 2, { size: 19, bold: true }, WHITE, 'left', w - 28);
      x += w + 12;
      write(ctx, '→', x, ROW_1 + 4 + ROW_H / 2, { size: 22, bold: true }, p.muted);
      x += 34;
    }

    const picks: string[] = [];
    const set = spriteSetOf(this.store.gen());
    const options = this.choices.targetOptions();
    // The cards share what's left of the row beside the right column, none wider than 300.
    const room = RIGHT - TARGET_COLUMN_W - GAP - x;
    const fitW = Math.floor((room - (options.length - 1) * 10) / Math.max(1, options.length));
    for (const option of options) {
      const label = targetLabel(option);
      const box = { x, y: BAR_TOP + 14, w: Math.min(fitW, Math.max(210, Math.min(300, ctx.text.measure(label, { size: 18, bold: true }) + 104))), h: 78 };
      const id = targetId(option.target);
      const focused = option.allowed && ctx.focus.control({ id, ...box, accept: () => this.choices.chooseTarget(option.target) });
      if (option.allowed) picks.push(id);
      const f = this.eased(ctx, id, focused);
      const y = box.y - 4 * f;
      const fill = !option.allowed ? p.disabledFill : mixRgba(p.panel, p.select, Math.max(f, 0.4));
      renderer.rect(box.x, y, box.w, box.h, { fill, stroke: !option.allowed ? p.disabledBorder : mixRgba(p.rim, p.accentText, f), radius: 14, border: 1 + 2 * f });
      const sprite = option.pokemon ? ctx.images.sprite(option.pokemon.sprite, false, ImagePriority.Screen, set) : null;
      renderer.rect(box.x + 10, y + 11, 56, 56, { fill: p.rim, radius: 12 });
      if (sprite) renderer.rect(box.x + 10, y + 11, 56, 56, { fill: [1, 1, 1, option.allowed ? 1 : 0.4], texture: sprite });
      const ink = option.allowed ? p.ink : p.disabledInk;
      write(ctx, label, box.x + 78, y + 28, { size: 18, bold: true }, ink, 'left', box.w - 90);
      const side = option.foe ? 'FOE' : 'ALLY';
      const sideW = ctx.text.measure(side, { size: 12, bold: true }) + 18;
      renderer.rect(box.x + 78, y + 44, sideW, 22, { fill: p.rim, radius: 11 });
      write(ctx, side, box.x + 78 + sideW / 2, y + 55, { size: 12, bold: true }, option.foe ? foeInk(p) : p.accentText, 'center');
      x += box.w + 10;
    }

    // The right column: A's Confirm, and Back for clicks (B on the controller). The notice is on the plate.
    const column = RIGHT - TARGET_COLUMN_W;
    legendItem(ctx, 'A', 'Confirm', column + 8, BAR_TOP + 32);
    hint(ctx, 'choice-back', { x: column, y: BAR_TOP + 54, w: TARGET_COLUMN_W, h: 34 }, 'B', 'Back', false, () => this.choices.back());
    return picks;
  }

  /** While the opponent chooses: each of our orders on its move's type colour, and Cancel. */
  private drawWaiting(ctx: ScreenContext): string[] {
    const p = ctx.palette;
    const plans = this.plans();
    const width = plans.length > 1 ? (RIGHT - X - GAP) / 2 : RIGHT - X;
    plans.forEach((plan, i) => {
      const box = { x: X + i * (width + GAP), y: ROW_1, w: width, h: ROW_H };
      const fill = plan.color ?? p.rim;
      const ink = plan.color ? WHITE : p.ink;
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, radius: 12 });
      const head = `${plan.name} · ${plan.action}`;
      const headW = write(ctx, head, box.x + 16, box.y + ROW_H / 2, { size: 18, bold: true }, ink, 'left', box.w - 32);
      if (plan.detail && headW < box.w - 80) write(ctx, plan.detail, box.x + 28 + headW, box.y + ROW_H / 2, { size: 15 }, withAlpha(ink, 0.85), 'left', box.w - 44 - headW);
    });
    const opponent = this.store.sides().p2.name || 'the opponent';
    write(ctx, `Waiting for ${opponent}…`, X, ROW_2 + ROW_H / 2, { size: 20, bold: true }, p.muted, 'left', 800);
    if (!this.store.canUndo()) return [];
    // Showdown's Cancel: while the opponent is still choosing, the choices can be made again (B too).
    const cancel = { x: RIGHT - 150, y: ROW_2 - 2, w: 150, h: 42 };
    const focused = ctx.focus.control({ id: 'cancel', ...cancel, accept: () => this.store.undo() });
    ctx.renderer.rect(cancel.x, cancel.y, cancel.w, cancel.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.accentText : p.rim, radius: 21, border: focused ? 3 : 1 });
    const keyW = keyChip(ctx, 'B', cancel.x + 8, cancel.y + cancel.h / 2, 28);
    write(ctx, 'Cancel', cancel.x + keyW + 18, cancel.y + cancel.h / 2, { size: 17, bold: true }, p.ink);
    if (focused) ring(ctx, cancel, 21);
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

/** "Garchomp", "Kingambit (ally)", "Garchomp (fainted)". */
function targetLabel({ pokemon }: TargetOption): string {
  if (!pokemon) return 'Empty';
  return `${pokemon.name}${pokemon.fainted ? ' (fainted)' : ''}`;
}
