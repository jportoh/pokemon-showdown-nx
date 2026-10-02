import { inject } from '@angular/core';
import { ChampionsDex, DexItem, DexMega, DexMove, DexSpecies } from '@core/dex/champions-dex';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { Box, UiContext, label } from '@core/gl/ui/retro-kit';
import { STAT_IDS, STAT_NAMES } from '@features/teambuilder/data/game-rules';
import { baseStatTotal } from './hero-view';
import { CATEGORY_FILL, WHITE, WrapCache, tag, typeRgba } from './tb-draw';

/** Showdown's move targets, as the info says them. */
const TARGETS: Readonly<Record<string, string>> = {
  normal: 'One target',
  adjacentFoe: 'One foe',
  any: 'Any target',
  randomNormal: 'A random foe',
  allAdjacentFoes: 'Both foes',
  allAdjacent: 'All adjacent',
  self: 'Self',
  adjacentAlly: 'Ally',
  adjacentAllyOrSelf: 'Self or ally',
  allySide: 'Your side',
  foeSide: "Foes' side",
  allies: 'User and allies',
  all: 'Whole field',
  scripted: 'Varies',
};

const BODY = { size: 20 } as const;

/**
 * What something is, for the editor's info box (wide and short, beside the card) and the lists'
 * detail panel (tall and narrow): a move (its type, category, power, accuracy, PP, target and what it
 * does), an item, an ability, a species (its types, base stats and abilities) or a line of help.
 * Each fills the box given (`tall` for the panel), the frame being the caller's.
 */
export class InfoPanel {
  private readonly dex = inject(ChampionsDex);
  private readonly wraps = new WrapCache();

  move(ctx: UiContext, box: Box, move: DexMove, stab: boolean, tall: boolean): void {
    const p = ctx.palette;
    const facts = [`PP ${move.pp}`, TARGETS[move.target] ?? move.target];
    if (move.priority) facts.push(`Priority ${move.priority > 0 ? '+' : ''}${move.priority}`);
    const power = move.basePower ? String(move.basePower) : '—';
    const accuracy = move.accuracy ? `${move.accuracy}%` : '—';
    if (!tall) {
      const x = box.x + 18;
      let right = x + label(ctx, move.name, x, box.y + 26, { size: 26, bold: true }, p.ink, { maxWidth: 300 }) + 14;
      right += tag(ctx, move.type, right, box.y + 12, typeRgba(move.type) ?? p.rim, 28, 16) + 8;
      tag(ctx, move.category, right, box.y + 12, CATEGORY_FILL[move.category] ?? p.rim, 28, 16);
      if (stab) label(ctx, 'Same type ×1.5', box.x + box.w - 18, box.y + 26, { size: 18 }, p.accentText, { align: 'right' });
      label(ctx, [`Power ${power}`, `Accuracy ${accuracy}`, ...facts].join(' · '), x, box.y + 60, BODY, p.muted, { maxWidth: box.w - 36 });
      this.wraps.draw(ctx, move.desc, x, box.y + 74, box.w - 36, 26, BODY, p.ink, 2);
      return;
    }
    const x = box.x + 24;
    const width = box.w - 48;
    label(ctx, move.name, x, box.y + 40, { size: 30, bold: true }, p.ink, { maxWidth: width });
    const tagW = tag(ctx, move.type, x, box.y + 64, typeRgba(move.type) ?? p.rim);
    tag(ctx, move.category, x + tagW + 8, box.y + 64, CATEGORY_FILL[move.category] ?? p.rim);
    const statW = (width - 12) / 2;
    this.stat(ctx, { x, y: box.y + 110, w: statW, h: 76 }, 'Power', power);
    this.stat(ctx, { x: x + statW + 12, y: box.y + 110, w: statW, h: 76 }, 'Accuracy', accuracy);
    label(ctx, facts.join(' · '), x, box.y + 214, BODY, p.muted, { maxWidth: width });
    this.wraps.draw(ctx, move.desc, x, box.y + 236, width, 28, BODY, p.ink, 8);
    if (stab) label(ctx, 'Same type: ×1.5 power', x, box.y + box.h - 30, { size: 18 }, p.accentText);
  }

  item(ctx: UiContext, box: Box, item: DexItem, tall: boolean): void {
    const p = ctx.palette;
    if (!tall) {
      ctx.images.drawItem(item.id, box.x + 16, box.y + 10, 32);
      label(ctx, item.name, box.x + 56, box.y + 26, { size: 26, bold: true }, p.ink, { maxWidth: box.w - 74 });
      this.wraps.draw(ctx, item.desc, box.x + 18, box.y + 48, box.w - 36, 26, BODY, p.ink, 3);
      return;
    }
    ctx.renderer.rect(box.x + 24, box.y + 24, 80, 80, { fill: p.bg, radius: 10 });
    ctx.images.drawItem(item.id, box.x + 32, box.y + 32, 64);
    this.wraps.draw(ctx, item.name, box.x + 120, box.y + 36, box.w - 144, 32, { size: 26, bold: true }, p.ink, 2);
    this.wraps.draw(ctx, item.desc, box.x + 24, box.y + 124, box.w - 48, 28, BODY, p.ink, 12);
  }

  /** An ability, or a line of help: a title and some text. */
  text(ctx: UiContext, box: Box, title: string, text: string, tall: boolean): void {
    const p = ctx.palette;
    if (!tall) {
      label(ctx, title, box.x + 18, box.y + 26, { size: 26, bold: true }, p.ink, { maxWidth: box.w - 36 });
      this.wraps.draw(ctx, text, box.x + 18, box.y + 48, box.w - 36, 26, BODY, p.ink, 3);
      return;
    }
    this.wraps.draw(ctx, title, box.x + 24, box.y + 22, box.w - 48, 36, { size: 28, bold: true }, p.ink, 2);
    const lines = this.wraps.get(ctx, title, { size: 28, bold: true }, box.w - 48, 2).length;
    this.wraps.draw(ctx, text, box.x + 24, box.y + 34 + lines * 36, box.w - 48, 28, BODY, p.ink, 14);
  }

  /** A species or a Mega: types, base stats, and its abilities (or the one it gets as a Mega). */
  species(ctx: UiContext, box: Box, form: DexSpecies | DexMega, tall: boolean): void {
    const p = ctx.palette;
    const abilities = 'abilities' in form ? `Abilities: ${form.abilities.join(' · ')}` : `Mega Evolves holding ${this.dex.item(form.item)?.name ?? form.item} · ${form.ability}`;
    if (!tall) {
      const x = box.x + 18;
      let right = x + label(ctx, form.name, x, box.y + 26, { size: 26, bold: true }, p.ink, { maxWidth: 300 }) + 14;
      for (const type of form.types) right += tag(ctx, type, right, box.y + 12, typeRgba(type) ?? p.rim, 28, 16) + 8;
      label(ctx, `BST ${baseStatTotal(form)}`, box.x + box.w - 18, box.y + 26, { size: 18 }, p.muted, { align: 'right' });
      label(ctx, STAT_IDS.map((stat) => `${STAT_NAMES[stat]} ${form.baseStats[stat]}`).join(' · '), x, box.y + 60, BODY, p.ink, { maxWidth: box.w - 36 });
      this.wraps.draw(ctx, abilities, x, box.y + 74, box.w - 36, 26, BODY, p.muted, 2);
      return;
    }
    const cx = box.x + box.w / 2;
    ctx.renderer.rect(box.x + 24, box.y + 20, box.w - 48, 150, { fill: p.bg, radius: 10 });
    const sprite = ctx.images.sprite(form.sprite, false, ImagePriority.Screen);
    if (sprite) ctx.renderer.rect(cx - 70, box.y + 22, 140, 140, { fill: WHITE, texture: sprite });
    label(ctx, form.name, cx, box.y + 196, { size: 28, bold: true }, p.ink, { align: 'center', maxWidth: box.w - 48 });
    const tagsW = form.types.reduce((sum, type) => sum + ctx.text.measure(type, { size: 18, bold: true }) + 28, 0) + (form.types.length - 1) * 8;
    let x = cx - tagsW / 2;
    for (const type of form.types) x += tag(ctx, type, x, box.y + 218, typeRgba(type) ?? p.rim) + 8;
    const left = box.x + 24;
    const colW = (box.w - 48 - 16) / 2;
    STAT_IDS.forEach((stat, i) => {
      const sx = left + (i % 2) * (colW + 16);
      const cy = box.y + 280 + Math.floor(i / 2) * 32;
      label(ctx, STAT_NAMES[stat], sx, cy, BODY, p.muted);
      label(ctx, String(form.baseStats[stat]), sx + colW, cy, { size: 22, bold: true }, p.ink, { align: 'right' });
    });
    label(ctx, `BST ${baseStatTotal(form)}`, left, box.y + 380, BODY, p.muted);
    this.wraps.draw(ctx, abilities, left, box.y + 398, box.w - 48, 28, BODY, p.ink, 4);
  }

  /** A number in a box with its name over it (a move's power, its accuracy). */
  private stat(ctx: UiContext, box: Box, name: string, value: string): void {
    const p = ctx.palette;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.bg, radius: 8 });
    label(ctx, name, box.x + 16, box.y + 20, { size: 16 }, p.muted);
    label(ctx, value, box.x + 16, box.y + 50, { size: 32, bold: true }, p.ink, { maxWidth: box.w - 32 });
  }
}
