import { inject } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { STAT_IDS } from '@features/teambuilder/data/game-rules';
import { MAX_MOVES, PokemonSet } from '@features/teambuilder/models/team';
import { SpriteStage } from './sprite-stage';
import { CardTop, EDIT_BODY_BOTTOM, EDIT_BODY_Y, EDIT_X, HERO_COMPACT_W, HERO_W, TEAM_BODY_Y, typePills } from './tb-draw';

export type Gender = '' | 'M' | 'F';

export const SPECIES_ID = 'card-species';
/** The Details rows' first one (see set-rows-view's cardId). */
const ITEM_ID = 'card-item';
export const NICKNAME_ID = 'hero-nickname';
export const GENDER_ID = 'hero-gender';
/** Showdown's limit for a nickname. */
const MAX_NICKNAME_LENGTH = 18;

/** How long the card takes to resize. */
const RESIZE_MS = 220;

/** What the card shows and changes. */
export interface HeroModel {
  set: PokemonSet | undefined;
  species: DexSpecies | undefined;
  /** What it Mega Evolves into, when it holds its stone: the card shows that form. */
  mega: DexMega | undefined;
  /** A list or the Stats are beside it: the card makes room for them (no controls then). */
  compact: boolean;
  /** The species list is open. */
  choosingSpecies: boolean;
  /** The move a move list would replace, lit in the compact card's moves; -1 for none. */
  replacingMove: number;
  /** Draws what the compact card shows under its types instead of its moves and item (the Calcs tab's battle state). */
  under?: (ctx: UiContext, box: Box) => void;
  openSpecies: () => void;
  gender: (gender: Gender) => void;
  nickname: (name: string) => void;
}

/**
 * The Pokémon's card, the editor's protagonist: its name, its sprite on a little stage (shared with
 * the team, where it dropped in when the slot was focused; another species drops in again), its
 * types, a place for its Tera Type (once the format has them), its nickname (the canvas keyboard)
 * and gender (left/right). Compact, it steps aside for a list or the Stats: a smaller sprite, its
 * types and its moves. The card resizes between the two, with the sprite moving and scaling across.
 */
export class HeroView {
  private readonly dex = inject(ChampionsDex);
  private readonly keyboard = inject(CanvasKeyboard);

  /** The card's width as it was when it started resizing, and when. */
  private resizeFrom = HERO_W;
  private resizedAt = -Infinity;
  private compact = false;
  /** The card comes down from where the team's page had it. */
  private readonly top = new CardTop();

  constructor(private readonly stage: SpriteStage) {}

  /** A slot opened from the team: the card starts at its size, sliding down from the team's card. */
  restart(compact: boolean): void {
    this.compact = compact;
    this.resizedAt = -Infinity;
    this.top.slideFrom(TEAM_BODY_Y);
  }

  draw(ctx: UiContext, model: HeroModel): void {
    const { now } = ctx;
    if (model.compact !== this.compact) {
      this.resizeFrom = this.width(now);
      this.resizedAt = now;
      this.compact = model.compact;
    }
    const width = this.width(now);
    const target = this.compact ? HERO_COMPACT_W : HERO_W;
    const top = this.top.at(now, EDIT_BODY_Y);
    const box = { x: EDIT_X, y: top, w: width, h: EDIT_BODY_BOTTOM - top };
    const p = ctx.palette;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: model.choosingSpecies ? p.accentText : p.outline, radius: 12, border: 2 });

    // Resizing: only the card and its sprite, moving between where each layout has it.
    const k = (HERO_W - width) / (HERO_W - HERO_COMPACT_W);
    const full = heroStage(box, false);
    const small = heroStage({ ...box, w: HERO_COMPACT_W }, true);
    const stage = {
      x: lerp(full.x, small.x, k),
      y: lerp(full.y, small.y, k),
      w: lerp(full.w, small.w, k),
      h: lerp(full.h, small.h, k),
      size: lerp(full.size, small.size, k),
    };
    this.stage.draw(ctx, stage, model.mega ?? model.species, model.set ? `${model.set.species}?` : 'Choose a species');
    if (Math.abs(width - target) > 0.5) return;
    if (top !== EDIT_BODY_Y) {
      // Coming down from the team's card: its name and types come along (the rest waits).
      if (!this.compact) {
        const form = model.mega ?? model.species;
        drawHeroName(ctx, box, form, model.set?.species || 'New Pokémon');
        drawHeroTypes(ctx, box, form, heroTypesTop(top));
      }
      return;
    }
    if (this.compact) this.drawCompact(ctx, box, model);
    else this.drawFull(ctx, box, model);
  }

  /** The card's width now: easing out towards its size. */
  private width(now: number): number {
    const target = this.compact ? HERO_COMPACT_W : HERO_W;
    const t = Math.min(1, (now - this.resizedAt) / RESIZE_MS);
    return lerp(this.resizeFrom, target, 1 - (1 - t) * (1 - t));
  }

  private drawFull(ctx: UiContext, box: Box, model: HeroModel): void {
    const form = model.mega ?? model.species;
    const set = model.set;

    // The name and the stage are the species' control: A opens the list.
    const speciesBox = { x: box.x + 8, y: box.y + 8, w: box.w - 16, h: 368 };
    // Right goes to the rows' first one (the item), not the one level with the tall card's middle.
    const focused = ctx.focus.control({
      id: SPECIES_ID,
      ...speciesBox,
      accept: model.openSpecies,
      move: (direction) => direction === 'right' && ctx.focus.has(ITEM_ID) && (ctx.focus.focus(ITEM_ID), true),
    });
    drawHeroName(ctx, box, form, set?.species || 'New Pokémon');
    if (focused) focusRing(ctx, speciesBox, 10);
    drawHeroTypes(ctx, box, form);

    const fieldW = (box.w - 48 - 12) / 2;
    const fieldY = box.y + box.h - 16 - 64;
    this.drawNickname(ctx, { x: box.x + 24, y: fieldY, w: fieldW, h: 64 }, model);
    this.drawGender(ctx, { x: box.x + 24 + fieldW + 12, y: fieldY, w: fieldW, h: 64 }, model);
  }

  private drawNickname(ctx: UiContext, box: Box, model: HeroModel): void {
    const p = ctx.palette;
    const set = model.set;
    const focused = !!set && ctx.focus.control({
      id: NICKNAME_ID,
      ...box,
      accept: () =>
        this.keyboard.open({
          label: 'Nickname',
          value: set.name,
          maxLength: MAX_NICKNAME_LENGTH,
          hint: () => 'Empty: it goes by its species name. OK keeps it.',
          done: (value) => {
            if (value !== null) model.nickname(value.trim());
          },
        }),
    });
    field(ctx, box, focused, !set);
    label(ctx, 'Nickname', box.x + 14, box.y + 18, { size: 16 }, p.muted);
    label(ctx, set?.name || 'None', box.x + 14, box.y + 44, { size: 22, bold: !!set?.name }, set?.name ? p.ink : p.muted, { maxWidth: box.w - 28 });
    if (focused) focusRing(ctx, box, 8);
  }

  private drawGender(ctx: UiContext, box: Box, model: HeroModel): void {
    const p = ctx.palette;
    const genders = gendersOf(model.species);
    const canChange = !!model.set && genders.length > 1;
    // A steps to the next one; the d-pad only moves on, so passing through never changes it.
    const next = () => {
      const index = Math.max(0, genders.indexOf(model.set?.gender ?? ''));
      model.gender(genders[(index + 1) % genders.length]);
    };
    const focused = canChange && ctx.focus.control({ id: GENDER_ID, ...box, accept: next });
    field(ctx, box, focused, !canChange);
    label(ctx, 'Gender', box.x + 14, box.y + 18, { size: 16 }, p.muted);
    label(ctx, genderName(model), box.x + 14, box.y + 44, { size: 22, bold: true }, p.ink, { maxWidth: box.w - 28 });
    if (focused) focusRing(ctx, box, 8);
  }

  private drawCompact(ctx: UiContext, box: Box, model: HeroModel): void {
    const p = ctx.palette;
    const form = model.mega ?? model.species;
    const set = model.set;
    const cx = box.x + box.w / 2;
    label(ctx, set?.name || form?.name || 'New Pokémon', cx, box.y + 242, { size: 26, bold: true }, p.ink, { align: 'center', maxWidth: box.w - 24 });
    const types = form?.types ?? [];
    const pillsW = types.length * 100 + Math.max(0, types.length - 1) * 8;
    typePills(ctx, types, cx - pillsW / 2, box.y + 264, 100, 108, 28, 16);
    if (!set) return;
    if (model.under) {
      model.under(ctx, box);
      return;
    }

    label(ctx, 'Moves', box.x + 20, box.y + 320, { size: 16 }, p.muted);
    for (let i = 0; i < MAX_MOVES; i++) {
      const move = set.moves[i] ?? '';
      const lit = i === model.replacingMove;
      label(ctx, `${lit ? '▶ ' : ''}${move || '—'}`, box.x + 20, box.y + 350 + i * 30, { size: 18, bold: lit }, lit ? p.accentText : move ? p.ink : p.muted, { maxWidth: box.w - 40 });
    }
    label(ctx, 'Item', box.x + 20, box.y + 482, { size: 16 }, p.muted);
    const item = set.item ? this.dex.item(set.item) : undefined;
    if (item) ctx.images.drawItem(item.id, box.x + 64, box.y + 470, 24);
    label(ctx, set.item || 'None', box.x + (item ? 94 : 64), box.y + 482, { size: 18 }, set.item ? p.ink : p.muted, { maxWidth: box.w - 114 });
  }
}

/** Where the sprite's stage goes in the full card or the compact one, and the sprite's size on it. */
export function heroStage(box: Box, compact: boolean): Box & { size: number } {
  return compact ? { x: box.x + 16, y: box.y + 16, w: box.w - 32, h: 200, size: 160 } : { x: box.x + 20, y: box.y + 60, w: box.w - 40, h: 300, size: 240 };
}

/** The full card's name over the stage, and its level and base stat total. */
export function drawHeroName(ctx: UiContext, box: Box, form: DexSpecies | DexMega | undefined, fallback: string): void {
  const p = ctx.palette;
  label(ctx, form?.name ?? fallback, box.x + 24, box.y + 34, { size: 32, bold: true }, p.ink, { maxWidth: 290 });
  if (form) label(ctx, `Lv. 50 · BST ${baseStatTotal(form)}`, box.x + box.w - 24, box.y + 36, { size: 18 }, p.muted, { align: 'right' });
}

/** Where the full card's types go from its top: in the editor, room for the species' focus ring. */
const EDITOR_TYPES_Y = 390;
/** On the team's card, which has no focus ring, close under the stage. */
export const TEAM_TYPES_Y = 372;

/**
 * Where the types go on a card whose top is at `top`: the team's place at the team's height, the
 * editor's at the editor's, and in between while the card slides from one to the other.
 */
export function heroTypesTop(top: number): number {
  const k = Math.max(0, Math.min(1, (top - TEAM_BODY_Y) / (EDIT_BODY_Y - TEAM_BODY_Y)));
  return TEAM_TYPES_Y + (EDITOR_TYPES_Y - TEAM_TYPES_Y) * k;
}

/** The full card's types under the stage (the teambuilder's formats have no Tera Types to show), `top` from the card's top. */
export function drawHeroTypes(ctx: UiContext, box: Box, form: DexSpecies | DexMega | undefined, top = EDITOR_TYPES_Y): void {
  typePills(ctx, form?.types ?? [], box.x + 24, box.y + top, 112, 120, 32, 18);
}

/** A field of the card (nickname, gender): lit while focused, dimmed when it can't change. */
function field(ctx: UiContext, box: Box, focused: boolean, disabled: boolean): void {
  const p = ctx.palette;
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.bg, stroke: disabled ? p.bg : p.rim, radius: 8, border: 2 });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function baseStatTotal(form: DexSpecies | DexMega): number {
  return STAT_IDS.reduce((sum, stat) => sum + form.baseStats[stat], 0);
}

/** '' is "either"; single-gender and genderless species only have what they can be. */
function gendersOf(species: DexSpecies | undefined): readonly Gender[] {
  const gender = species?.gender;
  return gender === 'N' || gender === 'M' || gender === 'F' ? [] : ['', 'M', 'F'];
}

function genderName(model: HeroModel): string {
  const species = model.species;
  if (!model.set || !species) return '—';
  if (species.gender === 'N') return 'None';
  const gender = species.gender || model.set.gender;
  return gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Either';
}
