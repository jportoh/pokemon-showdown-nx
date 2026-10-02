import { inject } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { Rgba, withAlpha } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { STAT_IDS } from '@features/teambuilder/data/game-rules';
import { MAX_MOVES, PokemonSet } from '@features/teambuilder/models/team';
import { EDIT_BODY_BOTTOM, EDIT_BODY_Y, EDIT_X, HERO_COMPACT_W, HERO_W, typePills } from './tb-draw';

export type Gender = '' | 'M' | 'F';

export const SPECIES_ID = 'card-species';
export const NICKNAME_ID = 'hero-nickname';
export const GENDER_ID = 'hero-gender';
/** Showdown's limit for a nickname. */
const MAX_NICKNAME_LENGTH = 18;

/** How the sprite comes in: a drop, then a squash as it lands; and how long the card takes to resize. */
const DROP_MS = 260;
const LAND_MS = 200;
const DROP_HEIGHT = 48;
/** The breathing afterwards: a slow stretch, 1.5% at most. */
const BREATH_MS = 2400;
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
  openSpecies: () => void;
  gender: (gender: Gender) => void;
  nickname: (name: string) => void;
}

/**
 * The Pokémon's card, the editor's protagonist: its name, its sprite on a little stage (it drops in
 * and lands when the slot opens or the species changes, then breathes), its types, a place for its
 * Tera Type (once the format has them), its nickname (the canvas keyboard) and gender (left/right).
 * Compact, it steps aside for a list or the Stats: a smaller sprite, its types and its moves. The
 * card resizes between the two, with the sprite moving and scaling across.
 */
export class HeroView {
  private readonly dex = inject(ChampionsDex);
  private readonly keyboard = inject(CanvasKeyboard);

  /** The sprite drawn, and when it appeared (it drops in again for another one). */
  private sprite = '';
  private appearedAt = 0;
  /** The card's width as it was when it started resizing, and when. */
  private resizeFrom = HERO_W;
  private resizedAt = -Infinity;
  private compact = false;

  /** A slot opened: its sprite drops in again, and the card starts at its size. */
  restart(compact: boolean): void {
    this.sprite = '';
    this.compact = compact;
    this.resizedAt = -Infinity;
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
    const box = { x: EDIT_X, y: EDIT_BODY_Y, w: width, h: EDIT_BODY_BOTTOM - EDIT_BODY_Y };
    const p = ctx.palette;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: model.choosingSpecies ? p.accentText : p.outline, radius: 12, border: 2 });

    // Resizing: only the card and its sprite, moving between where each layout has it.
    const k = (HERO_W - width) / (HERO_W - HERO_COMPACT_W);
    const full = this.stage(box, false);
    const small = this.stage({ ...box, w: HERO_COMPACT_W }, true);
    const stage = {
      x: lerp(full.x, small.x, k),
      y: lerp(full.y, small.y, k),
      w: lerp(full.w, small.w, k),
      h: lerp(full.h, small.h, k),
      size: lerp(full.size, small.size, k),
    };
    this.drawStage(ctx, stage, model);
    if (Math.abs(width - target) > 0.5) return;
    if (this.compact) this.drawCompact(ctx, box, model);
    else this.drawFull(ctx, box, model);
  }

  /** The card's width now: easing out towards its size. */
  private width(now: number): number {
    const target = this.compact ? HERO_COMPACT_W : HERO_W;
    const t = Math.min(1, (now - this.resizedAt) / RESIZE_MS);
    return lerp(this.resizeFrom, target, 1 - (1 - t) * (1 - t));
  }

  /** Where the sprite's stage goes in either layout, and the sprite's size on it. */
  private stage(box: Box, compact: boolean): Box & { size: number } {
    return compact ? { x: box.x + 16, y: box.y + 16, w: box.w - 32, h: 200, size: 160 } : { x: box.x + 20, y: box.y + 60, w: box.w - 40, h: 300, size: 240 };
  }

  private drawFull(ctx: UiContext, box: Box, model: HeroModel): void {
    const p = ctx.palette;
    const form = model.mega ?? model.species;
    const set = model.set;

    // The name and the stage are the species' control: A opens the list.
    const speciesBox = { x: box.x + 8, y: box.y + 8, w: box.w - 16, h: 368 };
    const focused = ctx.focus.control({ id: SPECIES_ID, ...speciesBox, accept: model.openSpecies });
    label(ctx, form?.name ?? (set?.species || 'New Pokémon'), box.x + 24, box.y + 34, { size: 32, bold: true }, p.ink, { maxWidth: 290 });
    if (form) label(ctx, `Lv. 50 · BST ${baseStatTotal(form)}`, box.x + box.w - 24, box.y + 36, { size: 18 }, p.muted, { align: 'right' });
    if (focused) focusRing(ctx, speciesBox, 10);

    const pillsY = box.y + 390;
    typePills(ctx, form?.types ?? [], box.x + 24, pillsY, 112, 120, 32, 18);
    // Tera Types aren't in the format yet: their place, greyed out.
    const tera = { x: box.x + box.w - 24 - 156, y: pillsY, w: 156, h: 32 };
    ctx.renderer.rect(tera.x, tera.y, tera.w, tera.h, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 4, border: 2 });
    label(ctx, 'Tera: soon', tera.x + tera.w / 2, tera.y + tera.h / 2, { size: 18 }, p.muted, { align: 'center' });

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

  /** The stage: its ground, the shadow, and the sprite dropping in, landing and breathing. */
  private drawStage(ctx: UiContext, stage: Box & { size: number }, model: HeroModel): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    renderer.rect(stage.x, stage.y, stage.w, stage.h, { fill: p.bg, radius: 10 });
    const form = model.mega ?? model.species;
    const cx = stage.x + stage.w / 2;
    const ground = stage.y + stage.h - stage.size * 0.17;
    if (!form) {
      label(ctx, model.set ? `${model.set.species}?` : 'Choose a species', cx, stage.y + stage.h / 2, { size: 20 }, p.muted, { align: 'center', maxWidth: stage.w - 24 });
      return;
    }
    const texture = ctx.images.sprite(form.sprite, false, ImagePriority.Screen);
    // It appears once it's there: until then (and for another species) the drop starts over.
    if (form.sprite !== this.sprite || !texture) {
      this.sprite = form.sprite;
      this.appearedAt = now;
    }
    const motion = spriteMotion(now - this.appearedAt);
    const shadowW = stage.size * 0.8 * motion.shadow;
    const shadowH = stage.size * 0.11;
    renderer.rect(cx - shadowW / 2, ground - shadowH / 2, shadowW, shadowH, { fill: shadowColor(p.input, motion.alpha), radius: shadowH / 2, softness: 6 });
    if (!texture) return;
    const w = stage.size * motion.sx;
    const h = stage.size * motion.sy;
    // Standing on the ground: the sprites have some room under their feet.
    const feet = ground + stage.size * 0.12;
    renderer.rect(cx - w / 2, feet - h + motion.dy, w, h, { fill: [1, 1, 1, motion.alpha], texture });
  }
}

/** The sprite `ms` after it appeared: its offset, stretch, opacity and how wide its shadow is. */
function spriteMotion(ms: number): { dy: number; sx: number; sy: number; alpha: number; shadow: number } {
  if (ms < DROP_MS) {
    const t = ms / DROP_MS;
    return { dy: -DROP_HEIGHT * (1 - t * t), sx: 0.95, sy: 1.05, alpha: Math.min(1, t * 2), shadow: 0.6 + 0.4 * t };
  }
  if (ms < DROP_MS + LAND_MS) {
    const s = Math.sin((Math.PI * (ms - DROP_MS)) / LAND_MS);
    return { dy: 0, sx: 1 + 0.08 * s, sy: 1 - 0.1 * s, alpha: 1, shadow: 1 + 0.05 * s };
  }
  const breath = Math.sin((2 * Math.PI * (ms - DROP_MS - LAND_MS)) / BREATH_MS);
  return { dy: 0, sx: 1 - 0.008 * breath, sy: 1 + 0.015 * breath, alpha: 1, shadow: 1 };
}

function shadowColor(color: Rgba, alpha: number): Rgba {
  return withAlpha(color, 0.9 * alpha);
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

