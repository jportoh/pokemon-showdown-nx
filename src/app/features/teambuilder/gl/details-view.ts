import { inject } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { Box, UiContext, label } from '@core/gl/ui/retro-kit';
import { STAT_IDS } from '@features/teambuilder/data/game-rules';
import { MAX_MOVES, PokemonSet } from '@features/teambuilder/models/team';
import { LEFT, ON_TYPE, RIGHT, WHITE, WrapCache, arrow, card, ring, typePills, typeRgba } from './tb-draw';

/** The fields a card opens a list for. */
export type DetailsField = 'species' | 'item' | 'ability' | 'move0' | 'move1' | 'move2' | 'move3';
export type Gender = '' | 'M' | 'F';

export function cardId(field: DetailsField): string {
  return `card-${field}`;
}

/** What the cards show and do. */
export interface DetailsModel {
  /** None yet in a new slot, where only the species can be chosen. */
  set: PokemonSet | undefined;
  species: DexSpecies | undefined;
  /** What it Mega Evolves into, when it holds its stone. */
  mega: DexMega | undefined;
  /** The field whose list is open beside the cards. */
  activeField: DetailsField | null;
  open: (field: DetailsField) => void;
  gender: (gender: Gender) => void;
}

/**
 * The Details tab's cards (SetDetails on the canvas), 420x552: the species (its sprite in the form it
 * battles in, types, base stat total and gender, which left/right change), the item and the ability
 * with a line or two of what they do, and the moves as a 2x2 grid of cards in their types' colours.
 * A on a card opens its list beside them.
 */
export class DetailsView {
  private readonly dex = inject(ChampionsDex);
  private readonly wraps = new WrapCache();

  draw(ctx: UiContext, x: number, y: number, model: DetailsModel): void {
    this.drawSpecies(ctx, { x, y, w: 420, h: 208 }, model);
    this.drawItem(ctx, { x, y: y + 216, w: 420, h: 84 }, model);
    this.drawAbility(ctx, { x, y: y + 308, w: 420, h: 84 }, model);
    for (let i = 0; i < MAX_MOVES; i++) {
      this.drawMove(ctx, { x: x + (i % 2) * 214, y: y + 400 + Math.floor(i / 2) * 80, w: 206, h: 72 }, i, model);
    }
  }

  /** A card's control (none while disabled); true when focused. */
  private control(ctx: UiContext, field: DetailsField, box: Box, model: DetailsModel, disabled = false, move?: (direction: 'up' | 'down' | 'left' | 'right') => boolean): boolean {
    if (disabled) return false;
    return ctx.focus.control({ id: cardId(field), ...box, accept: () => model.open(field), move });
  }

  private drawSpecies(ctx: UiContext, box: Box, model: DetailsModel): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const genders = gendersOf(model.species);
    const canChange = !!model.set && genders.length > 1;
    const focused = this.control(ctx, 'species', box, model, false, (direction) => {
      if (!canChange || (direction !== 'left' && direction !== 'right')) return false;
      const index = Math.max(0, genders.indexOf(model.set?.gender ?? ''));
      model.gender(genders[(index + (direction === 'right' ? 1 : -1) + genders.length) % genders.length]);
      return true;
    });
    card(ctx, box, { active: model.activeField === 'species', focused });
    renderer.rect(box.x + 16, box.y + 16, 176, 176, { fill: p.bg, stroke: p.rim, radius: 6, border: 1 });
    const form = model.mega ?? model.species;
    const sprite = form ? ctx.images.sprite(form.sprite, false, ImagePriority.Screen) : null;
    if (sprite) renderer.rect(box.x + 20, box.y + 20, 168, 168, { fill: WHITE, texture: sprite });

    const left = box.x + 206;
    label(ctx, form?.name ?? (model.set?.species || 'Choose a species'), left, box.y + 40, { size: 20, bold: true }, p.ink, { maxWidth: 200 });
    typePills(ctx, form?.types ?? [], left, box.y + 62);
    if (form) label(ctx, `BST ${STAT_IDS.reduce((sum, stat) => sum + form.baseStats[stat], 0)}`, left, box.y + 102, { size: 14 }, p.muted);

    // The gender, changed in place with left/right.
    renderer.rect(left, box.y + 148, 200, 44, { fill: p.bg, stroke: p.rim, radius: 6, border: 1 });
    label(ctx, 'Gender', left + 10, box.y + 170, { size: 14, bold: true }, p.muted);
    if (canChange) {
      arrow(ctx, LEFT, left + 84, box.y + 163, 2, p.muted);
      arrow(ctx, RIGHT, left + 180, box.y + 163, 2, p.muted);
    }
    label(ctx, genderName(model), left + 136, box.y + 170, { size: 16, bold: true }, p.ink, { align: 'center', maxWidth: 80 });
    ring(ctx, box, focused);
  }

  private drawItem(ctx: UiContext, box: Box, model: DetailsModel): void {
    const p = ctx.palette;
    const set = model.set;
    const focused = this.control(ctx, 'item', box, model, !set);
    card(ctx, box, { active: model.activeField === 'item', focused, disabled: !set });
    const item = set?.item ? this.dex.item(set.item) : undefined;
    if (item) ctx.images.drawItem(item.id, box.x + 10, box.y + 26, 32);
    label(ctx, set?.item || 'No item', box.x + 50, box.y + 24, { size: 18, bold: true }, set ? p.ink : p.muted, { maxWidth: 356 });
    const desc = !set?.item ? 'Choose an item' : (item?.desc ?? '');
    this.wraps.draw(ctx, desc, box.x + 50, box.y + 38, 356, 18, { size: 12 }, p.muted, 2);
    ring(ctx, box, focused);
  }

  private drawAbility(ctx: UiContext, box: Box, model: DetailsModel): void {
    const p = ctx.palette;
    const set = model.set;
    const focused = this.control(ctx, 'ability', box, model, !set);
    card(ctx, box, { active: model.activeField === 'ability', focused, disabled: !set });
    label(ctx, set?.ability || 'No ability', box.x + 16, box.y + 24, { size: 18, bold: true }, set ? p.ink : p.muted, { maxWidth: 390 });
    // What it does, or, for a Mega, the ability it gets once it Mega Evolves.
    const desc = model.mega
      ? `Becomes ${model.mega.ability} when it Mega Evolves`
      : !set?.ability
        ? 'Choose an ability'
        : (this.dex.ability(set.ability)?.desc ?? '');
    this.wraps.draw(ctx, desc, box.x + 16, box.y + 38, 390, 18, { size: 12 }, p.muted, 2);
    ring(ctx, box, focused);
  }

  private drawMove(ctx: UiContext, box: Box, index: number, model: DetailsModel): void {
    const p = ctx.palette;
    const field = `move${index}` as DetailsField;
    const set = model.set;
    const name = set?.moves[index] ?? '';
    const move = name ? this.dex.move(name) : undefined;
    const color = move ? typeRgba(move.type) : null;
    const active = model.activeField === field;
    const focused = this.control(ctx, field, box, model, !set);
    if (color) card(ctx, box, { active }, color);
    else card(ctx, box, { active, focused, disabled: !set }, active || focused ? p.select : p.bg);
    label(ctx, name || 'No move', box.x + 12, box.y + 22, { size: 18, bold: true }, color ? WHITE : p.muted, { maxWidth: 182 });
    const detail = move ? [move.type, move.basePower ? `${move.basePower} BP` : ''].filter(Boolean).join(' · ') : name ? '' : 'Choose a move';
    const icon = move ? ctx.images.image(`categories/${move.category.toLowerCase()}.png`) : null;
    if (icon) ctx.renderer.rect(box.x + 12, box.y + 45, 32, 14, { fill: WHITE, texture: icon });
    label(ctx, detail, box.x + (move ? 50 : 12), box.y + 52, { size: 14 }, color ? ON_TYPE : p.muted, { maxWidth: move ? 144 : 182 });
    ring(ctx, box, focused);
  }
}

/** '' is "either"; single-gender and genderless species only have what they can be. */
function gendersOf(species: DexSpecies | undefined): readonly Gender[] {
  const gender = species?.gender;
  return gender === 'N' || gender === 'M' || gender === 'F' ? [] : ['', 'M', 'F'];
}

function genderName(model: DetailsModel): string {
  const species = model.species;
  if (!model.set || !species) return '—';
  if (species.gender === 'N') return 'None';
  const gender = species.gender || model.set.gender;
  return gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Either';
}
