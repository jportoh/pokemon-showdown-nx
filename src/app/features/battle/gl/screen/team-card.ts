import { ChampionsDex } from '@core/dex/champions-dex';
import { moveInfo } from '@core/dex/moves';
import { abilityName, itemName } from '@core/dex/names';
import { speciesInfo } from '@core/dex/species';
import { Rgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { barColor } from '@features/battle/gl/hp-bar';
import { pokemonInfoView } from '@features/battle/gl/screen/pokemon-info-view';
import { RequestPokemon } from '@features/battle/models/battle';
import { parseCondition } from '@features/battle/state/battle-store';
import { InspectedMember } from '@features/battle/state/pokemon-inspection';
import { STATUS } from '@features/battle/state/status-conditions';
import { typeColor } from '@shared/data/type-colors';
import { SpriteSet, spriteId, spriteSetOf } from '@shared/utils/sprite-id';
import { INK, ScreenContext, ring, write } from './screen-context';

/** A team card's size: two side by side and three down fill the stage under the top bar. */
export const CARD_W = 616;
export const CARD_H = 196;

const SPRITE_BOX = 132;
const TEXT_X = 160;
const TEXT_W = 236;
const MOVES_X = 404;
const MOVE_W = CARD_W - MOVES_X - 12;
const MOVE_H = 38;
const MOVE_GAP = 8;
const HP_BAR = 150;
const TYPE_W = 84;
const STATUS_W = 50;

export interface CardMove {
  name: string;
  color: string;
  known: boolean;
}

/** One team member as the party screen and Battle info show it: everything known of it. */
export interface TeamCard {
  sprite: string;
  /** Gen 3 battles show Ruby/Sapphire's sprites. */
  spriteSet: SpriteSet;
  name: string;
  types: { text: string; color: string; tera: boolean }[];
  hp: { fraction: number; text: string } | null;
  status: { text: string; color: string } | null;
  itemId: string;
  item: string;
  itemKnown: boolean;
  ability: string;
  abilityKnown: boolean;
  moves: CardMove[];
  /** Where it is: "On the field", "Fainted", "Coming in"…; '' for none. */
  state: string;
  fainted: boolean;
}

/** One of our own Pokémon from the server's request: exact HP, item, ability and moves. */
export function ownCard(pokemon: RequestPokemon, dex: ChampionsDex, state = '', gen = 9): TeamCard {
  const species = pokemon.details.split(',')[0];
  const { hp, maxHp, status, fainted } = parseCondition(pokemon.condition, 100);
  const tera = pokemon.terastallized ?? '';
  const types = tera ? [tera] : (speciesInfo(species, gen)?.types ?? []);
  const item = itemName(pokemon.item);
  return {
    sprite: dex.species(species)?.sprite ?? spriteId(species),
    spriteSet: spriteSetOf(gen),
    name: pokemon.ident.slice(pokemon.ident.indexOf(': ') + 2),
    types: types.map((type) => ({ text: tera ? `Tera ${type}` : type, color: typeColor(type) || '#374151', tera: !!tera })),
    hp: { fraction: maxHp > 0 ? hp / maxHp : 0, text: fainted ? '0%' : `${hp}/${maxHp}` },
    status: STATUS[status] ? { text: STATUS[status].text, color: STATUS[status].color } : null,
    itemId: fainted ? '' : pokemon.item,
    item: item || 'No item',
    itemKnown: !!item,
    ability: abilityName(pokemon.ability ?? pokemon.baseAbility ?? ''),
    abilityKnown: true,
    moves: pokemon.moves.slice(0, 4).map((id) => {
      const info = moveInfo(id, gen);
      return { name: info?.name ?? id, color: typeColor(info?.type ?? '') || '#4b5563', known: true };
    }),
    state: state || (fainted ? 'Fainted' : pokemon.active ? 'On the field' : ''),
    fainted,
  };
}

/** A team member as far as the battle has shown it (an opponent's, or either side's watching). */
export function seenCard(inspected: InspectedMember, dex: ChampionsDex, gen = 9): TeamCard {
  const view = pokemonInfoView(inspected, '', gen);
  const seen = inspected.member.seen;
  const fraction = seen && !seen.fainted && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
  const state = seen?.fainted ? 'Fainted' : inspected.member.active ? 'On the field' : seen ? '' : 'Not seen yet';
  return {
    sprite: seen?.sprite || (dex.species(inspected.member.species)?.sprite ?? spriteId(inspected.member.species)),
    spriteSet: spriteSetOf(gen),
    name: view.name,
    types: view.types.map((type) => ({ text: type.text, color: type.color, tera: type.tera })),
    hp: view.hp ? { fraction, text: view.hp.text } : null,
    status: view.status ? { text: view.status.text, color: view.status.color } : null,
    itemId: view.itemId,
    item: view.item,
    itemKnown: view.itemKnown,
    ability: view.ability,
    abilityKnown: view.abilityKnown,
    moves: view.moves.map((move) => ({ name: move.known ? move.name : '?', color: move.color, known: move.known })),
    state,
    fainted: !!seen?.fainted,
  };
}

/**
 * A team card, 616x196: the sprite, name and types; HP, status, item and ability; the four moves down
 * the right on their types' colours. Dimmed while it can't be picked; the yellow ring while focused.
 */
export function drawTeamCard(
  ctx: ScreenContext,
  x: number,
  y: number,
  card: TeamCard,
  look: { border: Rgba; dim?: boolean; focused?: boolean },
): void {
  const { renderer } = ctx;
  const fade = look.dim ? 0.55 : 1;
  renderer.rect(x, y, CARD_W, CARD_H, { fill: look.dim ? INK.fainted : INK.card, stroke: withAlpha(look.border, fade), radius: 12, border: 2 });
  renderer.rect(x + 12, y + 32, SPRITE_BOX, SPRITE_BOX, { fill: INK.header, radius: 10 });
  const sprite = ctx.images.sprite(card.sprite, false, ImagePriority.Screen, card.spriteSet);
  if (sprite) renderer.rect(x + 14, y + 34, SPRITE_BOX - 4, SPRITE_BOX - 4, { fill: [1, 1, 1, card.fainted ? 0.35 : fade], texture: sprite });

  const ink = withAlpha(INK.white, fade);
  const muted = withAlpha(INK.gray300, fade);
  write(ctx, card.name, x + TEXT_X, y + 26, { size: 24, bold: true }, ink, 'left', card.state ? TEXT_W - 8 : TEXT_W);

  card.types.forEach((type, i) => {
    const width = type.tera ? TYPE_W * 1.4 : TYPE_W;
    const left = x + TEXT_X + i * (TYPE_W + 6);
    renderer.rect(left, y + 46, width, 24, { fill: withAlpha(rgba(type.color), fade), stroke: type.tera ? ink : [0, 0, 0, 0], radius: 4, border: type.tera ? 1 : 0 });
    write(ctx, type.text.toUpperCase(), left + width / 2, y + 58, { size: 14, bold: true }, ink, 'center', width - 6);
  });

  // The status at the end of the types' row, where it always fits (by the HP, "375/375" left no room).
  if (card.status) {
    const left = x + TEXT_X + TEXT_W - STATUS_W;
    renderer.rect(left, y + 47, STATUS_W, 22, { fill: withAlpha(rgba(card.status.color), fade), radius: 4 });
    write(ctx, card.status.text, left + STATUS_W / 2, y + 58, { size: 14, bold: true }, ink, 'center');
  }

  if (card.hp) {
    // The bar gives way to the HP text, which ends where the moves start.
    const style = { size: 20, bold: true };
    const bar = Math.min(HP_BAR, TEXT_W - 10 - ctx.text.measure(card.hp.text, style));
    renderer.rect(x + TEXT_X, y + 84, bar, 12, { fill: INK.gray700, radius: 3 });
    const width = Math.round(bar * Math.max(0, Math.min(1, card.hp.fraction)));
    if (width > 0) renderer.rect(x + TEXT_X, y + 84, width, 12, { fill: withAlpha(rgba(barColor(card.hp.fraction)), fade), radius: 3 });
    write(ctx, card.hp.text, x + TEXT_X + bar + 10, y + 90, style, ink);
  }

  ctx.images.drawItem(card.itemId, x + TEXT_X - 2, y + 112, 28);
  const itemLeft = card.itemId ? TEXT_X + 30 : TEXT_X;
  write(ctx, card.item, x + itemLeft, y + 127, { size: 18, bold: card.itemKnown }, card.itemKnown ? ink : muted, 'left', TEXT_W - (itemLeft - TEXT_X));
  write(ctx, card.ability, x + TEXT_X, y + 158, { size: 18, bold: card.abilityKnown }, card.abilityKnown ? muted : withAlpha(INK.gray400, fade), 'left', TEXT_W);

  if (card.state) {
    const width = ctx.text.measure(card.state, { size: 14, bold: true }) + 20;
    const fill = card.fainted ? rgba('#7f1d1d') : card.state === 'On the field' ? INK.selected : INK.gray700;
    renderer.rect(x + 12, y + 8, width, 22, { fill, radius: 11 });
    write(ctx, card.state, x + 12 + width / 2, y + 19, { size: 14, bold: true }, INK.white, 'center');
  }

  card.moves.forEach((move, i) => {
    const top = y + 14 + i * (MOVE_H + MOVE_GAP);
    renderer.rect(x + MOVES_X, top, MOVE_W, MOVE_H, { fill: withAlpha(rgba(move.known ? move.color : '#111827'), fade), radius: 6 });
    // Long names ("Hidden Power Flying") a size smaller rather than cut.
    const room = MOVE_W - 20;
    const style = { size: 18, bold: move.known };
    if (ctx.text.measure(move.name, style) > room) style.size = 15;
    write(ctx, move.name, x + MOVES_X + 12, top + MOVE_H / 2, style, move.known ? ink : withAlpha(INK.gray400, fade), 'left', room);
  });

  if (look.focused) ring(ctx, { x, y, w: CARD_W, h: CARD_H }, 12);
}
