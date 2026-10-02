import { inject } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { PokemonSet } from '@features/teambuilder/models/team';
import { GENDER_ID, NICKNAME_ID, SPECIES_ID } from './hero-view';
import { InfoPanel } from './info-panel';
import { BESIDE_HERO_X, CATEGORY_FILL, EDIT_BODY_BOTTOM, EDIT_BODY_Y, EDIT_RIGHT, WHITE, typeRgba } from './tb-draw';

/** The fields a list is opened for. */
export type DetailsField = 'species' | 'item' | 'ability' | 'move0' | 'move1' | 'move2' | 'move3';

export function cardId(field: DetailsField): string {
  return field === 'species' ? SPECIES_ID : `card-${field}`;
}

const ROW_H = 56;
const ROW_STEP = 64;
const ROWS: readonly DetailsField[] = ['item', 'ability', 'move0', 'move1', 'move2', 'move3'];
/** The short names of the categories, in the rows. */
const CATEGORY_SHORT: Readonly<Record<string, string>> = { Physical: 'Phys', Special: 'Spec', Status: 'Status' };

/** What the rows show and do. */
export interface RowsModel {
  set: PokemonSet | undefined;
  species: DexSpecies | undefined;
  mega: DexMega | undefined;
  open: (field: DetailsField) => void;
}

/**
 * Beside the Pokémon's card on the Details tab: what it carries, a row each (its item, its ability,
 * its four moves, in their types' colours), and under them the info box, which says what the focused
 * row is (or the card's field: the species' stats and abilities, or what the nickname and gender do),
 * the way the games' summary screen does. A on a row opens its list.
 */
export class SetRowsView {
  private readonly dex = inject(ChampionsDex);
  private readonly info = new InfoPanel();

  draw(ctx: UiContext, model: RowsModel): void {
    const x = BESIDE_HERO_X;
    const w = EDIT_RIGHT - x;
    ROWS.forEach((field, i) => this.drawRow(ctx, { x, y: EDIT_BODY_Y + i * ROW_STEP, w, h: ROW_H }, field, model));
    const top = EDIT_BODY_Y + ROWS.length * ROW_STEP + 4;
    const box = { x, y: top, w, h: EDIT_BODY_BOTTOM - top };
    const p = ctx.palette;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.panel, stroke: p.rim, radius: 10, border: 2 });
    this.drawInfo(ctx, box, model);
  }

  private drawRow(ctx: UiContext, box: Box, field: DetailsField, model: RowsModel): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const set = model.set;
    const focused = !!set && ctx.focus.control({ id: cardId(field), ...box, accept: () => model.open(field) });
    const slot = field.startsWith('move') ? Number(field.slice(4)) : -1;
    const moveName = slot >= 0 ? (set?.moves[slot] ?? '') : '';
    const move = moveName ? this.dex.move(moveName) : undefined;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : set ? p.panel : p.bg, stroke: p.rim, radius: 8, border: 2 });
    renderer.rect(box.x, box.y, 10, box.h, { fill: (move && typeRgba(move.type)) || p.rim, radius: 4 });
    const cy = box.y + box.h / 2;
    label(ctx, slot >= 0 ? `Move ${slot + 1}` : field === 'item' ? 'Item' : 'Ability', box.x + 26, cy, { size: 16 }, p.muted, { maxWidth: 76 });
    const left = box.x + 112;

    if (field === 'item') {
      const item = set?.item ? this.dex.item(set.item) : undefined;
      if (item) ctx.images.drawItem(item.id, left, box.y + 12, 32);
      label(ctx, set?.item || 'No item', left + (item ? 42 : 0), cy, { size: 24, bold: !!set?.item }, set?.item ? p.ink : p.muted, { maxWidth: box.w - 170 });
    } else if (field === 'ability') {
      label(ctx, set?.ability || 'No ability', left, cy, { size: 24, bold: !!set?.ability }, set?.ability ? p.ink : p.muted, { maxWidth: box.w - 130 });
    } else {
      label(ctx, moveName || 'No move', left, cy, { size: 24, bold: !!moveName }, moveName ? p.ink : p.muted, { maxWidth: box.w - 380 });
      if (move) {
        const right = box.x + box.w - 16;
        label(ctx, move.basePower ? String(move.basePower) : '—', right, cy, { size: 24, bold: true }, p.ink, { align: 'right', fast: true });
        const category = { x: right - 52 - 70, y: cy - 13, w: 70, h: 26 };
        renderer.rect(category.x, category.y, category.w, category.h, { fill: CATEGORY_FILL[move.category] ?? p.rim, radius: 4 });
        label(ctx, CATEGORY_SHORT[move.category] ?? move.category, category.x + category.w / 2, cy, { size: 16, bold: true }, WHITE, { align: 'center' });
        const type = { x: category.x - 8 - 96, y: cy - 13, w: 96, h: 26 };
        renderer.rect(type.x, type.y, type.w, type.h, { fill: typeRgba(move.type) ?? p.rim, radius: 4 });
        label(ctx, move.type, type.x + type.w / 2, cy, { size: 16, bold: true }, WHITE, { align: 'center' });
      }
    }
    if (focused) focusRing(ctx, box, 8);
  }

  /** The info box: what the focused row or card field is. */
  private drawInfo(ctx: UiContext, box: Box, model: RowsModel): void {
    const set = model.set;
    const form = model.mega ?? model.species;
    const focused = ctx.focus.focused ?? '';
    if (focused === NICKNAME_ID) {
      this.info.text(ctx, box, 'Nickname', `Shown in battle instead of ${form?.name ?? 'its species'}. A to type one; leave it empty to use the species' name.`, false);
      return;
    }
    if (focused === GENDER_ID) {
      this.info.text(ctx, box, 'Gender', 'Left/right change it. With Either, the game picks one when the battle starts.', false);
      return;
    }
    const field = ROWS.find((f) => cardId(f) === focused);
    if (set && field === 'item' && set.item) {
      const item = this.dex.item(set.item);
      if (item) return this.info.item(ctx, box, item, false);
    }
    if (set && field === 'ability' && set.ability) {
      const desc = this.dex.ability(set.ability)?.desc ?? '';
      const mega = model.mega ? ` Once it Mega Evolves: ${model.mega.ability}.` : '';
      return this.info.text(ctx, box, set.ability, `${desc}${mega}`, false);
    }
    if (set && field?.startsWith('move')) {
      const move = this.dex.move(set.moves[Number(field.slice(4))] ?? '');
      if (move) return this.info.move(ctx, box, move, !!form?.types.includes(move.type), false);
    }
    if (field) {
      const what = field === 'item' ? 'an item' : field === 'ability' ? 'an ability' : 'a move';
      return this.info.text(ctx, box, field === 'item' ? 'No item' : field === 'ability' ? 'No ability' : 'No move', `Press A to choose ${what}.`, false);
    }
    if (form) return this.info.species(ctx, box, form, false);
    this.info.text(ctx, box, 'New Pokémon', 'Press A on the card to choose its species.', false);
  }
}
