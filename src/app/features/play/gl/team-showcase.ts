import { Texture, mixRgba, withAlpha } from '@core/gl/gl-renderer';
import { battlePlate } from '@features/play/gl/format-carousel';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { Box, UiContext, label, pill } from '@core/gl/ui/retro-kit';
import { CarouselMotion, drawCarouselCard, sideFade } from '@features/play/gl/carousel';
import { typePills } from '@features/teambuilder/gl/tb-draw';
import { MAX_TEAM_SIZE } from '@features/teambuilder/models/team';

/** The team picked, big in the middle; the others 900px apart, smaller, peeking in at the sides. */
export const TEAM_CARD: Box = { x: 180, y: 230, w: 920, h: 340 };
const STEP = 900;
const SIDE_SCALE = 0.84;
/** Six columns, one per Pokémon. */
const TILE_W = 140;
const TILE_H = 262;
const TILE_STEP = 148;
const TILE_TOP = 62;
const SPRITE = 96;
const TYPE_W = 62;
const TYPE_GAP = 6;
const ITEM = 24;
/** Teams go round only with three or more: with two, the other one would peek in at both sides. */
const WRAP_FROM = 3;

/** One Pokémon of a team, as its column shows it. */
export interface ShowcaseMember {
  sprite: string;
  species: string;
  types: readonly string[];
  item: string;
  itemId: string;
  ability: string;
}

export interface ShowcaseTeam {
  name: string;
  members: readonly ShowcaseMember[];
}

export interface TeamShowcaseModel {
  teams: readonly ShowcaseTeam[];
  index: number;
  /** Random teams: one card of Poké Balls. */
  random: boolean;
  formatLabel: string;
  focused: boolean;
  /** A search is under way: the team can't change. */
  locked: boolean;
  ball: Texture | null;
  /** A: the list of teams (or, with none, the Teambuilder). */
  open: () => void;
  step: (by: 1 | -1) => void;
}

/**
 * The Battle page's teams for the format picked, as a carousel (TeamShowcase): the team picked in the
 * middle, 920px wide, a column per Pokémon (its sprite on a little platform, species, types, item
 * and ability); the teams before and after it peek in at the sides when there are three or more.
 * L/R turn it (the page's call), so do left/right while it has the focus; A opens the list. Random
 * formats show one card of Poké Balls, and a format with no team yet a card that leads to the
 * Teambuilder.
 */
export class TeamShowcaseView {
  private readonly motion = new CarouselMotion();
  private shownFormat = '';

  draw(ctx: UiContext, model: TeamShowcaseModel): void {
    const box = TEAM_CARD;
    const count = model.teams.length;
    // Another format's teams: no slide from the old ones.
    if (model.formatLabel !== this.shownFormat) {
      this.shownFormat = model.formatLabel;
      this.motion.snap(model.index);
    }
    const wraps = count >= WRAP_FROM;
    this.motion.follow(model.index, count, wraps, ctx.now);
    // Random formats have nothing to pick: no control, the focus goes elsewhere.
    const focused =
      !model.random &&
      ctx.focus.control({
        id: 'team',
        ...box,
        accept: () => !model.locked && model.open(),
        move: (direction) => {
          if (direction !== 'left' && direction !== 'right') return false;
          if (!model.locked && count > 1) model.step(direction === 'left' ? -1 : 1);
          return true;
        },
      });
    if (model.random) {
      this.drawRandom(ctx, focused, model.ball);
      return;
    }
    if (count === 0) {
      this.drawEmpty(ctx, model, focused);
      return;
    }
    for (const { index, offset } of this.motion.cards(count, wraps, 1.7)) {
      const middle = Math.abs(offset) < 0.5;
      const fade = middle ? 0 : sideFade(offset, model.locked ? 0.8 : 0.45);
      drawCarouselCard(ctx, box, offset, STEP, SIDE_SCALE, fade, () => this.drawTeam(ctx, model, index, middle, middle && focused));
    }
    if (count > 1 && !model.locked) this.drawPills(ctx, model);
  }

  private frame(ctx: UiContext, middle: boolean, focused: boolean): void {
    const p = ctx.palette;
    const box = TEAM_CARD;
    // The menu's panel: Battle's colour fading into the panel, a soft shadow under it.
    ctx.renderer.rect(box.x, box.y + 12, box.w, box.h, { fill: [0, 0, 0, middle ? 0.2 : 0.1], radius: 22, softness: 30 });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, {
      fill: mixRgba(battlePlate(p.appearance), focused ? p.select : p.panel, 0.4),
      fillEnd: focused ? p.select : p.panel,
      stroke: focused ? p.accentText : p.rim,
      radius: 22,
      border: focused ? 4 : 1,
    });
  }

  private tile(ctx: UiContext, k: number): Box {
    const p = ctx.palette;
    const tile = {
      x: TEAM_CARD.x + 20 + k * TILE_STEP,
      y: TEAM_CARD.y + TILE_TOP,
      w: TILE_W,
      h: TILE_H,
    };
    ctx.renderer.rect(tile.x, tile.y, tile.w, tile.h, {
      fill: withAlpha(p.bg, 0.7),
      stroke: p.rim,
      radius: 10,
      border: 2,
    });
    return tile;
  }

  private drawTeam(ctx: UiContext, model: TeamShowcaseModel, index: number, middle: boolean, focused: boolean): void {
    const p = ctx.palette;
    const box = TEAM_CARD;
    const team = model.teams[index];
    this.frame(ctx, middle, focused);
    label(ctx, team.name, box.x + 28, box.y + 34, { size: 26, bold: true }, p.ink, {
      maxWidth: 520,
    });
    label(ctx, `${index + 1} of ${model.teams.length} · ${model.formatLabel}`, box.x + box.w - 28, box.y + 35, { size: 15, bold: true }, p.muted, {
      align: 'right',
      maxWidth: 330,
    });
    for (let k = 0; k < MAX_TEAM_SIZE; k++) {
      const tile = this.tile(ctx, k);
      const member = team.members[k];
      if (member) this.drawMember(ctx, tile, member, middle ? (focused ? 10 : 3) : 0, k);
    }
    if (focused) ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: ctx.palette.accentText, border: 4, radius: 22 });
  }

  /** A Pokémon's column; `hop` px high at most, in a wave along the team. */
  private drawMember(ctx: UiContext, tile: Box, member: ShowcaseMember, hop: number, k: number): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const cx = tile.x + tile.w / 2;
    // The little platform it stands on, under its feet (the sprites have some room under them).
    renderer.rect(cx - 48, tile.y + 92, 96, 16, {
      fill: withAlpha(p.outline, 0.3),
      radius: 8,
      softness: 3,
    });
    const texture = ctx.images.sprite(member.sprite, false, ImagePriority.Screen);
    const lift = hop > 0 ? Math.max(0, Math.sin(now / 160 - k * 0.6)) * hop : 0;
    if (texture)
      renderer.rect(cx - SPRITE / 2, tile.y + 14 - lift, SPRITE, SPRITE, {
        fill: [1, 1, 1, 1],
        texture,
      });
    label(ctx, member.species, cx, tile.y + 138, { size: 17, bold: true }, p.ink, {
      align: 'center',
      maxWidth: tile.w - 12,
    });
    const typesW = member.types.length * TYPE_W + (member.types.length - 1) * TYPE_GAP;
    typePills(ctx, member.types, cx - typesW / 2, tile.y + 152, TYPE_W, TYPE_W + TYPE_GAP, 20, 11);
    renderer.rect(tile.x + 12, tile.y + 184, tile.w - 24, 2, { fill: p.rim });
    if (member.item) {
      ctx.images.drawItem(member.itemId, tile.x + 8, tile.y + 196, ITEM);
      label(ctx, member.item, tile.x + 38, tile.y + 208, { size: 13 }, p.ink, {
        maxWidth: tile.w - 44,
      });
    } else {
      label(ctx, 'No item', cx, tile.y + 208, { size: 13 }, p.muted, { align: 'center' });
    }
    if (member.ability)
      label(ctx, member.ability, cx, tile.y + 240, { size: 13 }, p.muted, {
        align: 'center',
        maxWidth: tile.w - 12,
      });
  }

  private drawRandom(ctx: UiContext, focused: boolean, ball: Texture | null): void {
    const p = ctx.palette;
    const { renderer, now } = ctx;
    const box = TEAM_CARD;
    this.frame(ctx, true, focused);
    label(ctx, 'Random team', box.x + 28, box.y + 34, { size: 26, bold: true }, p.ink);
    label(ctx, 'Showdown hands each player a team when the battle starts', box.x + box.w - 28, box.y + 35, { size: 15 }, p.muted, { align: 'right', maxWidth: 560 });
    for (let k = 0; k < MAX_TEAM_SIZE; k++) {
      const tile = this.tile(ctx, k);
      const cx = tile.x + tile.w / 2;
      if (ball) {
        const size = ball.width * 2.5;
        renderer.rect(cx - size / 2, tile.y + 44, size, size, {
          fill: [1, 1, 1, 1],
          texture: ball,
          angle: Math.sin(now / 400 + k) * 0.3,
        });
      }
      label(ctx, '?', cx, tile.y + 150, { size: 30, bold: true }, p.outline, { align: 'center' });
      label(ctx, 'Random set', cx, tile.y + 200, { size: 14 }, p.muted, { align: 'center' });
    }
  }

  private drawEmpty(ctx: UiContext, model: TeamShowcaseModel, focused: boolean): void {
    const p = ctx.palette;
    const box = TEAM_CARD;
    this.frame(ctx, true, focused);
    label(ctx, `No teams for ${model.formatLabel}`, box.x + box.w / 2, box.y + box.h / 2 - 24, { size: 28, bold: true }, p.ink, { align: 'center', maxWidth: box.w - 60 });
    label(ctx, 'Press A to build one in the Teambuilder', box.x + box.w / 2, box.y + box.h / 2 + 22, { size: 18 }, p.muted, { align: 'center' });
    if (focused) ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: ctx.palette.accentText, border: 4, radius: 22 });
  }

  /** L and R in the gaps between the cards (a click turns it too). */
  private drawPills(ctx: UiContext, model: TeamShowcaseModel): void {
    const cy = TEAM_CARD.y + TEAM_CARD.h / 2;
    const keys = [
      { id: 'team-prev', key: 'L', x: TEAM_CARD.x - 44, by: -1 as const },
      { id: 'team-next', key: 'R', x: TEAM_CARD.x + TEAM_CARD.w + 8, by: 1 as const },
    ];
    for (const key of keys) {
      ctx.focus.control({
        id: key.id,
        x: key.x,
        y: cy - 16,
        w: 36,
        h: 32,
        skip: true,
        accept: () => model.step(key.by),
      });
      pill(ctx, key.key, key.x, cy, 28);
    }
  }
}
