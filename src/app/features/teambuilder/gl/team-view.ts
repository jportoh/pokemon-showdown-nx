import { inject } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { HOLD_FILL, HoldAction } from '@core/gl/ui/hold-action';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { MAX_MOVES, MAX_TEAM_SIZE, PokemonSet, Team } from '@features/teambuilder/models/team';
import { TEAM_FORMATS } from '@shared/data/formats';
import { drawHeroName, drawHeroTypes, heroStage, heroTypesTop } from './hero-view';
import { SpriteStage } from './sprite-stage';
import { shortFormat } from './team-grid-view';
import {
  BESIDE_HERO_X,
  CardTop,
  EDIT_BODY_BOTTOM,
  EDIT_BODY_Y,
  EDIT_RIGHT,
  EDIT_X,
  HERO_W,
  RIGHT,
  TEAM_BODY_Y,
  WHITE,
  arrow,
  entrance,
  fadeIn,
  shortcutButton,
  typePills,
  typeRgba,
} from './tb-draw';

export const MAX_TEAM_NAME_LENGTH = 30;
export const TEAM_RENAME_ID = 'team-rename';
export const TEAM_FORMAT_ID = 'team-format';

/** The team's name and format over the rows, as chips (with Validate and Delete). */
const CHIP_H = 46;
/** The six rows beside the card, under the chips: 78 high, 8 apart, filling the body. */
const ROWS_Y = TEAM_BODY_Y + CHIP_H + 10;
const ROW_H = 78;
const ROW_STEP = 86;
const SPRITE = 72;
/** The card's line (item, ability) between its types and its moves. */
const CARD_LINES_Y = 434;
/** The rows come in one after another, sliding this far. */
const STAGGER_MS = 50;
const SLIDE = 28;

export function slotId(index: number): string {
  return `slot-${index}`;
}

/** What the team's page does. */
export interface TeamActions {
  rename: () => void;
  format: (id: string) => void;
  validate: () => void;
  delete: () => void;
  edit: (index: number) => void;
}

/**
 * A team (the teambuilder's second page), laid out as the games' party screen: the focused Pokémon on
 * the left as the editor's card shows it (the same sprite stage, its sprite dropping in when it's
 * focused; the card slides between this page's height and the editor's, so opening it is seamless),
 * and its six slots beside it as rows (sprite, name, item and ability, its moves' types as bars, its
 * types). Over the rows, the team's name (A renames it), its format (A moves to the next one),
 * Validate (ZL) and Delete (ZR, held down). The rows come in sliding, from the side of the team L/R
 * came from. The page bar says which team it is.
 */
export class TeamView {
  private readonly dex = inject(ChampionsDex);
  private readonly keyboard = inject(CanvasKeyboard);

  /** Delete, filling while ZR is held. */
  private readonly deleteHold = new HoldAction(inject(KeyboardNavigation), 'buttonZR');

  /** The slot the card shows: the focused row's, or the last one focused. */
  private shownSlot = 0;
  /** When the rows came in (on the next frame after enter()) and from which side. */
  private enteredAt: number | null = null;
  private from: 1 | -1 = 1;
  /** The card goes back up from where the editor had it. */
  private readonly cardTop = new CardTop();

  constructor(
    private readonly focus: CanvasFocus,
    private readonly stage: SpriteStage,
  ) {}

  /** Another team, or the same one shown again: nothing pending. */
  reset(): void {
    this.deleteHold.reset();
  }

  /** The team is shown: its rows come in, from the right (or from the side of the team before it). */
  enter(from: 1 | -1 = 1): void {
    this.enteredAt = null;
    this.from = from;
  }

  /** Back from the editor: the card slides up from the editor's card, under its tabs. */
  backFromEditor(): void {
    this.cardTop.slideFrom(EDIT_BODY_Y);
  }

  /** The slot shown on the card (the focused one, or the last focused). */
  get slot(): number {
    return this.shownSlot;
  }

  /** ZR: starts filling Delete; held to the end, the team is deleted (see stepDelete). */
  pressDelete(): void {
    this.deleteHold.press();
  }

  /** Every frame: Delete's hold, while the team is shown; true on the frame it fills up. */
  stepDelete(now: number, shown: boolean): boolean {
    return this.deleteHold.step(now, shown);
  }

  rename(team: Team, renamed: (name: string) => void): void {
    this.deleteHold.reset();
    this.keyboard.open({
      label: 'Team name',
      value: team.name,
      maxLength: MAX_TEAM_NAME_LENGTH,
      done: (value) => {
        this.focus.focus(TEAM_RENAME_ID);
        if (value === null) return;
        // A team always has a name: an empty one keeps the name it had.
        const name = value.trim();
        if (name) renamed(name);
      },
    });
  }

  draw(ctx: UiContext, team: Team, actions: TeamActions): void {
    const { now } = ctx;
    this.enteredAt ??= now;
    const focused = this.focus.focused ?? '';
    if (focused.startsWith('slot-')) this.shownSlot = Number(focused.slice(5));
    this.shownSlot = Math.min(this.shownSlot, team.sets.length, MAX_TEAM_SIZE - 1);

    this.drawChips(ctx, team, actions);
    this.drawCard(ctx, team.sets[this.shownSlot]);
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const box = { x: BESIDE_HERO_X, y: ROWS_Y + i * ROW_STEP, w: EDIT_RIGHT - BESIDE_HERO_X, h: ROW_H };
      const set = team.sets[i];
      // The slot after the last Pokémon adds one; the ones after it are only places.
      const reachable = !!set || i === team.sets.length;
      const isFocused = reachable && ctx.focus.control({ id: slotId(i), ...box, accept: () => actions.edit(i) });
      const shown = entrance(now, this.enteredAt, i * STAGGER_MS);
      const drawn = { ...box, x: box.x + (1 - shown) * SLIDE * this.from };
      if (set) this.drawRow(ctx, drawn, set, isFocused);
      else this.drawEmpty(ctx, drawn, reachable, isFocused);
      fadeIn(ctx, drawn, shown);
    }
  }

  /**
   * Over the rows: the team's name (A renames it) and format (A moves to the next one) as chips, then
   * Validate (ZL) and Delete (ZR, held down; it fills up red) on the right.
   */
  private drawChips(ctx: UiContext, team: Team, actions: TeamActions): void {
    const p = ctx.palette;
    const y = TEAM_BODY_Y;
    const buttonW = 116;
    const deleteX = EDIT_RIGHT - buttonW;
    const validateX = deleteX - 10 - buttonW;
    const formatBox = { x: validateX - 12 - 220, y, w: 220, h: CHIP_H };
    const nameBox = { x: BESIDE_HERO_X, y, w: formatBox.x - 12 - BESIDE_HERO_X, h: CHIP_H };
    this.chip(ctx, TEAM_RENAME_ID, nameBox, 'Name', team.name, actions.rename);

    // A chip that moves to the next format (a list of two isn't worth a picker).
    const next = () => {
      const current = TEAM_FORMATS.findIndex((format) => format.id === team.format);
      actions.format(TEAM_FORMATS[(current + 1) % TEAM_FORMATS.length].id);
    };
    this.chip(ctx, TEAM_FORMAT_ID, formatBox, '', shortFormat(team.format), next, true);

    const buttonY = y + 4;
    shortcutButton(ctx, 'team-validate', { x: validateX, y: buttonY, w: buttonW, h: CHIP_H - 8 }, 'ZL', 'Validate', { size: 17, accept: actions.validate });
    shortcutButton(ctx, 'team-delete', { x: deleteX, y: buttonY, w: buttonW, h: CHIP_H - 8 }, 'ZR', 'Delete', {
      size: 17,
      accept: actions.delete,
      held: { progress: this.deleteHold.progress, color: HOLD_FILL },
    });
  }

  /** A chip: what it is (muted, if it says), its value (bold), and a ▶ when A steps it to the next value. */
  private chip(ctx: UiContext, id: string, box: Box, name: string, value: string, accept: () => void, steps = false): void {
    const p = ctx.palette;
    const focused = ctx.focus.control({ id, ...box, accept });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.outline : p.rim, radius: 8, border: 2 });
    const cy = box.y + box.h / 2;
    const valueX = box.x + 14 + (name ? label(ctx, name, box.x + 14, cy, { size: 17 }, p.muted) + 10 : 0);
    const right = box.x + box.w - (steps ? 30 : 14);
    label(ctx, value, valueX, cy, { size: 18, bold: true }, p.ink, { maxWidth: right - valueX });
    if (steps) arrow(ctx, RIGHT, box.x + box.w - 20, cy - 7, 2, p.muted);
    if (focused) focusRing(ctx, box, 8);
  }

  /**
   * The focused slot's Pokémon, as the editor's card has it (its stage, its types), then its item and
   * ability and its moves at the bottom. It's as tall as the page, from under the bar.
   */
  private drawCard(ctx: UiContext, set: PokemonSet | undefined): void {
    const p = ctx.palette;
    const top = this.cardTop.at(ctx.now, TEAM_BODY_Y);
    const box = { x: EDIT_X, y: top, w: HERO_W, h: EDIT_BODY_BOTTOM - top };
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: p.outline, radius: 12, border: 2 });
    const form = this.form(set);
    this.stage.draw(ctx, heroStage(box, false), form, set ? `${set.species}?` : 'A: choose its species');
    if (!set) {
      label(ctx, 'Add a Pokémon', box.x + 24, box.y + 34, { size: 32, bold: true }, p.muted);
      return;
    }
    drawHeroName(ctx, box, form, set.species);
    drawHeroTypes(ctx, box, form, heroTypesTop(top));

    // The item and ability over the moves' two columns. Sliding back up from the editor's shorter
    // card, there's no room for them yet.
    const moveW = (box.w - 48 - 12) / 2;
    if (top === TEAM_BODY_Y) {
      const item = set.item ? this.dex.item(set.item) : undefined;
      this.cardLine(ctx, box.x + 24, box.y + CARD_LINES_Y, moveW, 'Item', set.item || 'None', item?.id);
      this.cardLine(ctx, box.x + 24 + moveW + 12, box.y + CARD_LINES_Y, moveW, 'Ability', set.ability || 'None');
    }

    for (let i = 0; i < MAX_MOVES; i++) {
      const mx = box.x + 24 + (i % 2) * (moveW + 12);
      const my = box.y + box.h - 16 - 66 + Math.floor(i / 2) * 36;
      const name = set.moves[i] ?? '';
      const color = name ? typeRgba(this.dex.move(name)?.type ?? '') : null;
      if (!name) {
        ctx.renderer.rect(mx, my, moveW, 30, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 6, border: 2 });
        label(ctx, '—', mx + 14, my + 15, { size: 18 }, p.muted);
        continue;
      }
      ctx.renderer.rect(mx, my, moveW, 30, { fill: color ?? p.rim, radius: 6 });
      label(ctx, name, mx + 12, my + 15, { size: 18, bold: true }, WHITE, { maxWidth: moveW - 24 });
    }
  }

  /** "Item  Sitrus Berry" on the card, `width` wide and centred on `cy`, with the item's icon when it has one. */
  private cardLine(ctx: UiContext, x: number, cy: number, width: number, name: string, value: string, icon?: string): void {
    const p = ctx.palette;
    let valueX = x + label(ctx, name, x, cy, { size: 17 }, p.muted) + 10;
    if (icon) {
      ctx.images.drawItem(icon, valueX, cy - 12, 24);
      valueX += 28;
    }
    label(ctx, value, valueX, cy, { size: 19, bold: true }, p.ink, { maxWidth: x + width - valueX });
  }

  /** A Pokémon's row: the ▶ while focused, its sprite (hopping then), name, item and ability, its moves' types, its types. */
  private drawRow(ctx: UiContext, box: Box, set: PokemonSet, focused: boolean): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.outline : p.rim, radius: 10, border: 2 });
    const cy = box.y + box.h / 2;
    if (focused) arrow(ctx, RIGHT, box.x + 12 + 3 * (0.5 + 0.5 * Math.sin(now / 160)), cy - 10, 3, p.accentText);

    const form = this.form(set);
    const sprite = form ? ctx.images.sprite(form.sprite, false, ImagePriority.Screen) : null;
    const hop = focused ? -3 * Math.abs(Math.sin(now / 280)) : 0;
    if (sprite) renderer.rect(box.x + 40, box.y + (box.h - SPRITE) / 2 + hop, SPRITE, SPRITE, { fill: WHITE, texture: sprite });

    // From the right: the types (room for two), the moves' types as bars, then the name gets the rest.
    const pillsRight = box.x + box.w - 18;
    const types = form?.types ?? [];
    typePills(ctx, types, pillsRight - (types.length * 100 - 8), cy - 14, 92, 100, 28, 16);
    const barsX = pillsRight - 192 - 24 - (MAX_MOVES * 12 + (MAX_MOVES - 1) * 6);
    for (let i = 0; i < MAX_MOVES; i++) {
      const move = set.moves[i] ? this.dex.move(set.moves[i]) : undefined;
      const bar = { x: barsX + i * 18, y: cy - 16, w: 12, h: 32 };
      if (move) renderer.rect(bar.x, bar.y, bar.w, bar.h, { fill: typeRgba(move.type) ?? p.rim, radius: 3 });
      else renderer.rect(bar.x, bar.y, bar.w, bar.h, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 3, border: 2 });
    }

    const left = box.x + 128;
    const width = barsX - 20 - left;
    label(ctx, set.name || form?.name || set.species, left, box.y + 27, { size: 24, bold: true }, p.ink, { maxWidth: width });
    const item = set.item ? this.dex.item(set.item) : undefined;
    if (item) ctx.images.drawItem(item.id, left, box.y + 44, 24);
    const textX = item ? left + 30 : left;
    label(ctx, `${set.item || 'No item'} · ${set.ability || 'No ability'}`, textX, box.y + 57, { size: 18 }, p.muted, { maxWidth: width - (textX - left) });
    if (focused) focusRing(ctx, box, 10);
  }

  /** The slot after the last Pokémon (A adds one there), or a place for one later. */
  private drawEmpty(ctx: UiContext, box: Box, next: boolean, focused: boolean): void {
    const p = ctx.palette;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : [0, 0, 0, 0], stroke: next ? p.outline : p.rim, radius: 10, border: 2 });
    if (!next) return;
    const cy = box.y + box.h / 2;
    if (focused) arrow(ctx, RIGHT, box.x + 12 + 3 * (0.5 + 0.5 * Math.sin(ctx.now / 160)), cy - 10, 3, p.accentText);
    label(ctx, '+ Add Pokémon', box.x + 40, cy, { size: 22, bold: focused }, focused ? p.ink : p.muted);
    if (focused) focusRing(ctx, box, 10);
  }

  /** The form it battles in: what it Mega Evolves into when it holds its Mega Stone. */
  private form(set: PokemonSet | undefined): DexSpecies | DexMega | undefined {
    if (!set) return undefined;
    return this.dex.mega(set.species, set.item) ?? this.dex.species(set.species);
  }
}
