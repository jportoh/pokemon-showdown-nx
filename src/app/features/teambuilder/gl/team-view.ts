import { inject } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { HOLD_FILL, HoldAction } from '@core/gl/ui/hold-action';
import { Box, UiContext, button, focusRing, label } from '@core/gl/ui/retro-kit';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { MAX_MOVES, MAX_TEAM_SIZE, PokemonSet, Team } from '@features/teambuilder/models/team';
import { TEAM_FORMATS } from '@shared/data/formats';
import { drawHeroName, drawHeroTypes, heroStage } from './hero-view';
import { SpriteStage } from './sprite-stage';
import { shortFormat } from './team-grid-view';
import {
  BESIDE_HERO_X,
  EDIT_BODY_BOTTOM,
  EDIT_BODY_Y,
  EDIT_RIGHT,
  EDIT_X,
  HERO_W,
  RIGHT,
  TOP,
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

/** The six rows beside the card: 80 high, 8 apart, filling the body. */
const ROW_H = 80;
const ROW_STEP = 88;
const SPRITE = 72;
/** The header's middle, under the bar (as the editor's). */
const HEADER_CY = TOP + 30;
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
 * the left as the editor's card shows it (the same place, size and sprite stage, so opening it is
 * seamless; its sprite drops in when it's focused), and its six slots beside it as rows (sprite, name,
 * item and ability, its moves' types as bars, its types). The header has the team's name, Rename, the
 * format (A moves to the next one), Validate (ZL) and Delete (ZR, held down). The rows come in
 * sliding, from the side of the team L/R came from.
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

  /** `place`: "2 / 8", where the team is among them (L/R go through them). */
  draw(ctx: UiContext, team: Team, place: string, actions: TeamActions): void {
    const { now } = ctx;
    this.enteredAt ??= now;
    const focused = this.focus.focused ?? '';
    if (focused.startsWith('slot-')) this.shownSlot = Number(focused.slice(5));
    this.shownSlot = Math.min(this.shownSlot, team.sets.length, MAX_TEAM_SIZE - 1);

    this.drawHeader(ctx, team, place, actions);
    this.drawCard(ctx, team.sets[this.shownSlot]);
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const box = { x: BESIDE_HERO_X, y: EDIT_BODY_Y + i * ROW_STEP, w: EDIT_RIGHT - BESIDE_HERO_X, h: ROW_H };
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

  /** Where it is ("Teams ▶ Rain Team  1 / 8"), then Rename, the format, Validate and Delete. */
  private drawHeader(ctx: UiContext, team: Team, place: string, actions: TeamActions): void {
    const p = ctx.palette;
    let x = EDIT_X;
    x += label(ctx, 'Teams', x, HEADER_CY, { size: 20 }, p.muted);
    x += label(ctx, '▶', x + 10, HEADER_CY, { size: 14 }, p.outline) + 20;
    x += label(ctx, team.name, x, HEADER_CY, { size: 24, bold: true }, p.ink, { maxWidth: 290 });
    label(ctx, place, x + 14, HEADER_CY, { size: 18 }, p.muted);

    const y = TOP + 10;
    const deleteX = EDIT_RIGHT - 150;
    const validateX = deleteX - 12 - 150;
    const formatBox = { x: validateX - 12 - 280, y, w: 280, h: 40 };
    button(ctx, TEAM_RENAME_ID, { x: formatBox.x - 12 - 110, y, w: 110, h: 40 }, 'Rename', { size: 18, accept: actions.rename });

    // A button that moves to the next format (a list of two isn't worth a picker).
    const next = () => {
      const current = TEAM_FORMATS.findIndex((format) => format.id === team.format);
      actions.format(TEAM_FORMATS[(current + 1) % TEAM_FORMATS.length].id);
    };
    const formatFocused = ctx.focus.control({ id: TEAM_FORMAT_ID, ...formatBox, accept: next });
    ctx.renderer.rect(formatBox.x, formatBox.y, formatBox.w, formatBox.h, { fill: formatFocused ? p.select : p.button, stroke: p.outline, radius: 6, border: 2 });
    label(ctx, shortFormat(team.format), formatBox.x + 14, formatBox.y + 20, { size: 18, bold: true }, p.ink, { maxWidth: formatBox.w - 48 });
    arrow(ctx, RIGHT, formatBox.x + formatBox.w - 22, formatBox.y + 13, 2, p.muted);
    if (formatFocused) focusRing(ctx, formatBox);

    shortcutButton(ctx, 'team-validate', { x: validateX, y, w: 150, h: 40 }, 'ZL', 'Validate', { size: 18, accept: actions.validate });
    shortcutButton(ctx, 'team-delete', { x: deleteX, y, w: 150, h: 40 }, 'ZR', 'Delete', {
      size: 18,
      accept: actions.delete,
      held: { progress: this.deleteHold.progress, color: HOLD_FILL },
    });
  }

  /** The focused slot's Pokémon, as the editor's card has it: its stage, types, and its moves under them. */
  private drawCard(ctx: UiContext, set: PokemonSet | undefined): void {
    const p = ctx.palette;
    const box = { x: EDIT_X, y: EDIT_BODY_Y, w: HERO_W, h: EDIT_BODY_BOTTOM - EDIT_BODY_Y };
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: p.outline, radius: 12, border: 2 });
    const form = this.form(set);
    this.stage.draw(ctx, heroStage(box, false), form, set ? `${set.species}?` : 'A: choose its species');
    if (!set) {
      label(ctx, 'Add a Pokémon', box.x + 24, box.y + 34, { size: 32, bold: true }, p.muted);
      return;
    }
    drawHeroName(ctx, box, form, set.species);
    drawHeroTypes(ctx, box, form);

    const moveW = (box.w - 48 - 12) / 2;
    for (let i = 0; i < MAX_MOVES; i++) {
      const mx = box.x + 24 + (i % 2) * (moveW + 12);
      const my = box.y + 436 + Math.floor(i / 2) * 36;
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
