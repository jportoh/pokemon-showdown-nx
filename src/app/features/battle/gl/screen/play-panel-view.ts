import { computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { moveInfo } from '@core/dex/moves';
import { PokemonCardMode, pokemonCardView } from '@features/battle/components/battle-pokemon-card/battle-pokemon-card';
import { pokemonInfoView } from '@features/battle/components/battle-pokemon-info/battle-pokemon-info';
import { RequestPokemon } from '@features/battle/models/battle';
import { BattleChoices, TargetOption } from '@features/battle/state/battle-choices';
import { BattleStore, parseCondition } from '@features/battle/state/battle-store';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { Rgba, rgba } from '@core/gl/gl-renderer';
import { typeColor } from '@shared/data/type-colors';
import { INK, ScreenContext, button, hint, ring, write, writeLines } from './screen-context';
import { drawPokemonInfo } from './watch-panel-view';

const PANEL_X = 12;
const PANEL_Y = 548;
/** The panel's content, inside its 12px margin: 961x148. */
const X = PANEL_X + 12;
const Y = PANEL_Y + 12;
const WIDTH = 961;
const GAP = 12;
const BIG_W = Math.floor((WIDTH - GAP) / 2);
const ROW_TOPS = [36, 96];
const CARD_W = 340;
const LEFT_W = WIDTH - GAP - CARD_W;
const MOVE_W = Math.floor((LEFT_W - GAP) / 2);
const MOVE_H = 53;
const MOVE_TOPS = [36, 36 + MOVE_H + 6];
const AMBER: Rgba = rgba('#fcd34d');

/** What the panel's buttons do beyond the battle's own state. */
export interface PlayActions {
  canRematch: boolean;
  rematchLabel: string;
  rematchNote: string;
  rematch: () => void;
  leave: () => void;
}

/**
 * The command panel in our own battles (985x172 under the field), as BattleControls: the four moves
 * two by two on their types' colours (category icon, power, accuracy, PP) beside the card of the
 * Pokémon choosing (switching is done on the team tiles on the right, the card following the one
 * pointed at); the target picker when a move needs one; a forced switch's prompt; what each Pokémon
 * was told to do while the turn plays (Cancel while the opponent still chooses); and at the end, the
 * result with Rematch and Back to Home. An opponent's team tile pointed at shows its card over it all.
 * `draw` returns the ids of the view's buttons in order, so a new view can focus its first.
 */
export class PlayPanelView {
  private readonly store = inject(BattleStore);
  private readonly choices = inject(BattleChoices);
  private readonly inspection = inject(PokemonInspection);
  private readonly dex = inject(ChampionsDex);

  /** Changes whenever a new set of buttons appears, so the focus moves to it. */
  readonly viewKey = computed(() => {
    const request = this.store.request();
    return [this.store.result(), request?.rqid, this.choices.slot(), !!this.choices.pendingMove(), this.store.canUndo()].join('|');
  });

  /** The opponent's team member pointed at on the right; null for none. */
  private readonly opponent = computed(() => {
    const shown = this.inspection.shown();
    return shown?.side === 'p2' ? shown : null;
  });

  private readonly opponentInfo = computed(() => pokemonInfoView(this.opponent(), this.store.sides().p2.name || 'Opponent'));

  private readonly moves = computed(() =>
    this.choices.moves().map((move, i) => {
      const info = this.dex.move(move.id) ?? moveInfo(move.id);
      const type = info?.type ?? '';
      const power = info && info.basePower > 0 ? `${info.basePower} BP` : '';
      const accuracy = info && info.category !== 'Status' ? (info.accuracy > 0 ? `${info.accuracy}%` : 'Never misses') : '';
      return {
        index: i,
        name: move.move,
        disabled: !!move.disabled || move.pp <= 0,
        color: rgba(typeColor(type) || '#4b5563'),
        detail: [type, power, accuracy].filter(Boolean).join(' · '),
        category: (info?.category ?? '').toLowerCase(),
        pp: `${move.pp}/${move.maxpp}`,
        x: X + (i % 2) * (MOVE_W + GAP),
        y: Y + (MOVE_TOPS[Math.floor(i / 2)] ?? 0),
      };
    }),
  );

  /** The Pokémon the card shows: the team member pointed at to switch in (its moves), else the one choosing (its stats). */
  private readonly inspected = computed<{ pokemon: RequestPokemon | null; mode: PokemonCardMode }>(() => {
    const team = this.store.team();
    const pointed = this.choices.slot() !== null ? this.choices.hoveredSwitch() : null;
    if (pointed !== null && team[pointed - 1]) return { pokemon: team[pointed - 1], mode: 'moves' };
    // While the turn plays, one of our team tiles pointed at: that member, with its moves.
    const shown = this.inspection.shown();
    if (this.choices.slot() === null && shown?.side === 'p1') {
      const member = team.find((pokemon) => pokemon.details.split(',')[0] === shown.member.species);
      if (member) return { pokemon: member, mode: 'moves' };
    }
    if (this.choices.forceSwitch()) return { pokemon: null, mode: 'moves' };
    const pokemon = this.choices.pokemon() ?? team.find((member) => member.active && !parseCondition(member.condition, 100).fainted) ?? null;
    return { pokemon, mode: 'stats' };
  });

  private readonly card = computed(() => ({ ...pokemonCardView(this.inspected().pokemon, this.inspected().mode), mode: this.inspected().mode }));

  /** Each active slot's order this turn, on its move type's colour; before any order, who's out there. */
  private readonly plans = computed(() => {
    const submitted = this.choices.submitted();
    const { active } = this.store.sides().p1;
    const slots = this.store.gameType() === 'singles' ? active.slice(0, 1) : active;
    return slots.map((pokemon, slot) => {
      const plan = submitted.find((p) => p.slot === slot);
      const top = MOVE_TOPS[slot] ?? 0;
      if (plan) return { ...plan, top, color: rgba(typeColor(plan.type) || '#374151') };
      const action = !pokemon ? '' : pokemon.fainted ? 'Fainted' : 'Getting ready';
      return { slot, top, name: pokemon?.name ?? '', action, detail: '', color: INK.gray700 };
    });
  });

  draw(ctx: ScreenContext, actions: PlayActions): string[] {
    ctx.renderer.rect(PANEL_X, PANEL_Y, 985, 172, { fill: INK.panel });
    let picks: string[];
    if (this.store.result()) picks = this.drawResult(ctx, actions);
    else if (this.choices.slot() !== null) {
      if (this.choices.pendingMove()) picks = this.drawTargets(ctx);
      else if (this.choices.forceSwitch()) picks = this.drawForcedSwitch(ctx);
      else picks = this.drawMoves(ctx);
    } else picks = this.drawWaiting(ctx);
    const opponent = this.opponent();
    if (opponent) {
      // Over the view, which stays (B goes back to its first button).
      ctx.renderer.rect(PANEL_X, PANEL_Y, 985, 172, { fill: INK.panel });
      write(ctx, `${this.store.sides().p2.name || 'Opponent'}'s team:`, X, Y + 12, { size: 16, bold: true }, INK.white, 'left', 300);
      write(ctx, 'everything seen so far.', X, Y + 36, { size: 16 }, INK.gray200, 'left', 300);
      ctx.renderer.rect(X, Y + 116, 24, 20, { fill: INK.header, radius: 2 });
      write(ctx, 'B', X + 12, Y + 126, { size: 14, bold: true }, INK.white, 'center');
      write(ctx, 'Back to your choices', X + 32, Y + 126, { size: 16 }, INK.gray200);
      drawPokemonInfo(ctx, X + 316, Y, this.opponentInfo());
    }
    return picks;
  }

  private drawResult(ctx: ScreenContext, actions: PlayActions): string[] {
    const result = this.store.result();
    const text = result === 'win' ? 'You won!' : result === 'loss' ? 'You lost.' : 'The battle ended in a tie.';
    write(ctx, text, X, Y + 14, { size: 18, bold: true }, INK.white, 'left', WIDTH);
    const picks: string[] = [];
    if (actions.canRematch) {
      bigButton(ctx, 'result-rematch', { x: X, y: Y + 40, w: 474, h: 60 }, actions.rematchLabel, 'primary', actions.rematch);
      picks.push('result-rematch');
    }
    const leave = actions.canRematch ? { x: X + 486, y: Y + 40, w: 474, h: 60 } : { x: X, y: Y + 40, w: WIDTH, h: 60 };
    bigButton(ctx, 'result-leave', leave, 'Back to Home', 'plain', actions.leave);
    picks.push('result-leave');
    writeLines(ctx, actions.rematchNote, X, Y + 106, WIDTH, 20, { size: 14 }, INK.gray200, 2);
    return picks;
  }

  private drawTargets(ctx: ScreenContext): string[] {
    write(ctx, 'Choose a target', X, Y + 14, { size: 16 }, INK.gray200);
    const picks: string[] = [];
    this.choices.targetOptions().forEach((option, i) => {
      const box = { x: X + (i % 2) * (BIG_W + GAP), y: Y + (ROW_TOPS[Math.floor(i / 2)] ?? 0), w: 474, h: 52 };
      const id = `target-${option.target}`;
      const focused = option.allowed && ctx.focus.control({ id, ...box, accept: () => this.choices.chooseTarget(option.target) });
      if (option.allowed) picks.push(id);
      const look = !option.allowed
        ? { fill: INK.gray700, border: INK.gray600, ink: INK.gray400 }
        : option.foe
          ? { fill: rgba('#7f1d1d'), border: INK.red300, ink: INK.white }
          : { fill: rgba('#1e3a8a'), border: INK.blue300, ink: INK.white };
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: look.fill, stroke: look.border, radius: 6, border: 1 });
      write(ctx, option.pokemon?.name ?? 'Empty', box.x + 12, box.y + 16, { size: 18, bold: true }, look.ink, 'left', 450);
      write(ctx, targetDetail(option), box.x + 12, box.y + 38, { size: 14 }, look.ink, 'left', 450);
      if (focused) ring(ctx, box, 6);
    });
    this.backButton(ctx);
    return picks;
  }

  private drawForcedSwitch(ctx: ScreenContext): string[] {
    const bold = 'Choose a Pokémon to send out';
    const width = write(ctx, bold, X, Y + 14, { size: 16, bold: true }, INK.white);
    write(ctx, ' on your team, on the right →', X + width + 4, Y + 14, { size: 16 }, INK.gray200);
    const name = this.choices.pokemonName();
    if (name) write(ctx, this.choices.pokemonFainted() ? `${name} has fainted.` : `${name} is coming back.`, X, Y + 48, { size: 14 }, INK.gray300, 'left', 609);
    write(ctx, this.choices.notice(), X, Y + 78, { size: 14, bold: true }, AMBER, 'left', 609);
    if (this.choices.canGoBack()) this.backButton(ctx);
    this.drawCard(ctx);
    return [];
  }

  private drawMoves(ctx: ScreenContext): string[] {
    const notice = this.choices.notice();
    const canSwitch = this.choices.switchOptions().some((option) => option.allowed);
    const heading = notice || this.choices.pokemonName();
    const width = write(ctx, heading, X, Y + 14, { size: 16, bold: true }, notice ? AMBER : INK.white, 'left', 627);
    if (!notice) write(ctx, canSwitch ? ' — choose a move, or switch on the right →' : ' — choose a move', X + width + 2, Y + 14, { size: 16 }, INK.gray200, 'left', 625 - width);

    // L does this on the controller; the button is for clicks.
    const megaBox = { x: X + 641, y: Y, w: 168, h: 28 };
    if (this.choices.canMega()) {
      const on = this.choices.mega();
      hint(ctx, 'mega', megaBox, 'L', on ? 'Mega Evolving' : 'Mega Evolve', false, () => this.choices.toggleMega(), on ? { fill: rgba('#6b2a73'), border: rgba('#f0abfc') } : { fill: INK.gray700, border: INK.gray400 });
    } else if (this.choices.teraType()) {
      const on = this.choices.tera();
      const type = this.choices.teraType();
      hint(ctx, 'tera', megaBox, 'L', on ? 'Terastallizing' : `Tera: ${type}`, false, () => this.choices.toggleTera(), on ? { fill: rgba(typeColor(type) || '#374151'), border: INK.white } : { fill: INK.gray700, border: INK.gray500 });
    }
    if (this.choices.canGoBack()) this.backButton(ctx);

    const picks: string[] = [];
    for (const move of this.moves()) {
      const box = { x: move.x, y: move.y, w: MOVE_W, h: MOVE_H };
      const id = `move-${move.index}`;
      const focused = !move.disabled && ctx.focus.control({ id, ...box, accept: () => this.choices.chooseMove(move.index) });
      if (!move.disabled) picks.push(id);
      const ink = move.disabled ? INK.gray400 : INK.white;
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: move.disabled ? INK.gray700 : move.color, stroke: move.disabled ? INK.gray600 : INK.gray300, radius: 6, border: 1 });
      write(ctx, move.name, box.x + 10, box.y + 16, { size: 18, bold: true }, ink, 'left', 200);
      write(ctx, move.pp, box.x + 286, box.y + 16, { size: 14 }, ink, 'right');
      const icon = move.category ? ctx.images.image(`categories/${move.category}.png`) : null;
      if (icon) ctx.renderer.rect(box.x + 10, box.y + 31, 32, 14, { fill: INK.white, texture: icon });
      write(ctx, move.detail, box.x + (move.category ? 48 : 10), box.y + 38, { size: 14 }, ink, 'left', move.category ? 238 : 276);
      if (focused) ring(ctx, box, 6);
    }
    this.drawCard(ctx);
    return picks;
  }

  private drawWaiting(ctx: ScreenContext): string[] {
    const title = this.store.playing() ? (this.store.turn() > 0 ? `Turn ${this.store.turn()} in progress…` : 'The battle is starting…') : 'Waiting for the opponent…';
    write(ctx, title, X, Y + 14, { size: 16 }, INK.gray200, 'left', 609);
    const picks: string[] = [];
    if (this.store.canUndo()) {
      // Showdown's Cancel: while the opponent is still choosing, the choices can be made again (B too).
      button(ctx, 'cancel', { x: X + 821, y: Y, w: 140, h: 28 }, 'B  Cancel', 'plain', () => this.store.undo());
      picks.push('cancel');
    }
    // Each order is a place for the focus to rest while the turn plays (A does nothing there).
    for (const plan of this.plans()) {
      const box = { x: X, y: Y + plan.top, w: 609, h: 53 };
      const id = `plan-${plan.slot}`;
      const focused = ctx.focus.control({ id, ...box });
      picks.push(id);
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: plan.color, stroke: INK.gray500, radius: 6, border: 1 });
      write(ctx, `${plan.name}${plan.detail ? ` · ${plan.detail}` : ''}`, box.x + 12, box.y + 14, { size: 14 }, INK.gray200, 'left', 585);
      write(ctx, plan.action, box.x + 12, box.y + 36, { size: 20, bold: true }, INK.white, 'left', 585);
      if (focused) ring(ctx, box, 6);
    }
    this.drawCard(ctx);
    return picks;
  }

  private backButton(ctx: ScreenContext): void {
    button(ctx, 'choice-back', { x: X + 821, y: Y, w: 140, h: 28 }, 'Back', 'plain', () => this.choices.back());
  }

  /** The Pokémon card (340x112), as BattlePokemonCard: stats of the one choosing, or the moves of the one pointed at. */
  private drawCard(ctx: ScreenContext): void {
    const { renderer } = ctx;
    const v = this.card();
    const x = X + 621;
    const y = Y + 36;
    const moves = v.mode === 'moves';
    renderer.rect(x, y, CARD_W, 112, { fill: rgba(moves ? '#1b3354' : '#1f2937'), stroke: moves ? INK.sky300 : INK.gray500, radius: 6, border: 1 });
    if (!v.name) return;
    const icon = v.itemId ? ctx.images.image(`items/${v.itemId}.png`) : null;
    if (icon) renderer.rect(x + 9, y + 8, 32, 32, { fill: INK.white, texture: icon });
    write(ctx, v.name, x + 50, y + 17, { size: 16, bold: true }, INK.white, 'left', 184);
    if (v.tera) {
      renderer.rect(x + 240, y + 7, 90, 20, { fill: rgba(v.tera.color), stroke: v.tera.done ? INK.white : [0, 0, 0, 0], radius: 10, border: v.tera.done ? 1 : 0 });
      write(ctx, v.tera.text, x + 285, y + 17, { size: 12, bold: true }, INK.white, 'center', 86);
    }
    const itemWidth = write(ctx, v.item, x + 50, y + 38, { size: 14, bold: true }, INK.white, 'left', 280);
    if (v.ability) write(ctx, ` · ${v.ability}`, x + 50 + itemWidth, y + 38, { size: 14 }, INK.gray300, 'left', 280 - itemWidth);
    if (moves) {
      for (const move of v.moves) {
        renderer.rect(x + move.left, y + move.top, 157, 23, { fill: rgba(move.color), radius: 2 });
        write(ctx, move.name, x + move.left + 78.5, y + move.top + 11.5, { size: 14, bold: true }, INK.white, 'center', 151);
      }
    } else if (v.stats.length > 0) {
      renderer.rect(x + 8, y + 54, 322, 50, { fill: rgba('#111827'), radius: 6 });
      for (const stat of v.stats) {
        write(ctx, stat.label.toUpperCase(), x + stat.left + 32, y + 67, { size: 11, bold: true }, INK.gray400, 'center');
        write(ctx, String(stat.value), x + stat.left + 32, y + 88, { size: 18, bold: true }, INK.white, 'center');
      }
    }
  }
}

/** A big button, as the result's: 20px bold text. */
function bigButton(ctx: ScreenContext, id: string, box: { x: number; y: number; w: number; h: number }, label: string, look: 'primary' | 'plain', accept: () => void): void {
  const focused = ctx.focus.control({ id, ...box, accept });
  const primary = look === 'primary';
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: primary ? INK.blue700 : INK.gray600, stroke: primary ? INK.blue300 : INK.gray400, radius: 6, border: 1 });
  write(ctx, label, box.x + box.w / 2, box.y + box.h / 2, { size: 20, bold: true }, INK.white, 'center', box.w - 16);
  if (focused) ring(ctx, box, 6);
}

/** "Foe · 73% HP", "Ally · Fainted". */
function targetDetail({ pokemon, foe }: TargetOption): string {
  if (!pokemon) return '';
  const percent = pokemon.maxHp > 0 ? Math.max(pokemon.hp > 0 ? 1 : 0, Math.round((pokemon.hp / pokemon.maxHp) * 100)) : 0;
  return `${foe ? 'Foe' : 'Ally'} · ${pokemon.fainted ? 'Fainted' : `${percent}% HP`}`;
}
