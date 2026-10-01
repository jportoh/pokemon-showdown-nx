import { rgba } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { UiContext, label } from '@core/gl/ui/retro-kit';

/** One Pokémon of the team picked, as its card shows it. */
export interface PreviewCard {
  sprite: string;
  species: string;
  types: readonly { name: string; color: string }[];
  item: string;
  itemId: string;
}

/** Card size and gaps, three per row (TeamPreview's). */
const CARD_W = 228;
const CARD_H = 244;
const CARD_GAP = 16;
const TYPE_W = 96;
const TYPE_GAP = 8;
const WHITE = [1, 1, 1, 1] as const;

/**
 * The team picked on the Battle page, as six cards of three per row (TeamPreview on the canvas): each
 * Pokémon's sprite at its own 96px, its species, types and item. Null cards are empty slots, or "?"
 * ones with random teams. Nothing here takes the focus.
 */
export function drawTeamPreview(ctx: UiContext, x: number, y: number, cards: readonly (PreviewCard | null)[], randomTeams: boolean): void {
  const p = ctx.palette;
  const { renderer } = ctx;
  cards.forEach((card, i) => {
    const cx = x + (i % 3) * (CARD_W + CARD_GAP);
    const cy = y + Math.floor(i / 3) * (CARD_H + CARD_GAP);
    renderer.rect(cx, cy, CARD_W, CARD_H, { fill: p.bg, stroke: p.rim, radius: 8, border: 2 });
    if (!card) {
      if (randomTeams) label(ctx, '?', cx + CARD_W / 2, cy + 112, { size: 80, bold: true }, p.rim, { align: 'center' });
      return;
    }
    const sprite = ctx.images.sprite(card.sprite, false, ImagePriority.Screen);
    if (sprite) renderer.rect(cx + 66, cy + 10, 96, 96, { fill: WHITE, texture: sprite });
    label(ctx, card.species, cx + CARD_W / 2, cy + 126, { size: 20, bold: true }, p.ink, { align: 'center', maxWidth: 208 });
    const first = cx + 2 + (CARD_W - 4 - card.types.length * TYPE_W - (card.types.length - 1) * TYPE_GAP) / 2;
    card.types.forEach((type, t) => {
      const tx = first + t * (TYPE_W + TYPE_GAP);
      renderer.rect(tx, cy + 150, TYPE_W, 28, { fill: rgba(type.color), radius: 6 });
      label(ctx, type.name, tx + TYPE_W / 2, cy + 164, { size: 16, bold: true }, WHITE, { align: 'center', maxWidth: TYPE_W - 8 });
    });
    if (card.item) {
      ctx.images.drawItem(card.itemId, cx + 12, cy + 194, 24);
      label(ctx, card.item, cx + 44, cy + 206, { size: 16 }, p.muted, { maxWidth: 168 });
    }
  });
}
