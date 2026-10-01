import { computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { toChips } from '@features/battle/components/battle-conditions/battle-conditions';
import { barColor } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { FieldCondition, SideId } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { previewTeam } from '@features/battle/state/team-preview';
import { Rgba, rgba } from '@features/gl-home/gl/gl-renderer';
import { spriteId } from '@shared/utils/sprite-id';
import { ImagePriority } from '../sprite-bitmaps';
import { INK, ScreenContext, hint, ring, write } from './screen-context';

const COLUMN_X = 1003;
const CARD_W = 271;
const TEAM_H = 188;
const CONDITIONS_H = 64;
const TILE = 72;
const PER_ROW = 3;
const BAR_W = 56;
const MAX_TEAM = 6;

/** Where each card of the column sits. */
const CARDS = {
  teamP2: 56,
  conditionsP2: 265,
  conditionsField: 350,
  conditionsP1: 435,
  teamP1: 520,
} as const;

interface Tile {
  id: string;
  species: string;
  sprite: string;
  x: number;
  y: number;
  bar: { width: number; color: Rgba } | null;
  fainted: boolean;
  active: boolean;
  /** PokemonInspection's key while it can be pointed at (watching live); null otherwise. */
  inspect: string | null;
}

/**
 * The battle's right column, as the DOM's: the opponent's team on top and ours at the bottom
 * (BattleTeamPreview: tiles framed while on the field, HP bars once sent out, faded once fainted,
 * blanks for the ones not seen yet), and the conditions in between (BattleConditions: the opponent's
 * side, the field, ours). Watching live, both teams' tiles take the d-pad: the panel below shows
 * everything known of the one pointed at.
 */
export class SideColumnView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly inspection = inject(PokemonInspection);

  /** Tiles that can be pointed at: both sides' watching live (replays have no panel for them). */
  private readonly inspectable = computed(() => this.store.spectating());

  private readonly tiles = computed(() => ({ p1: this.tilesOf('p1'), p2: this.tilesOf('p2') }));

  /** Every tile that takes the d-pad, for the screen's focus. */
  readonly focusable = computed(() => [...this.tiles().p2, ...this.tiles().p1].filter((t) => t.inspect !== null).map((t) => t.id));

  /** The inspection key of a tile id, to follow the focus. */
  inspectKeyOf(id: string): string | null {
    return [...this.tiles().p1, ...this.tiles().p2].find((t) => t.id === id)?.inspect ?? null;
  }

  draw(ctx: ScreenContext, sheet: { label: string; open: boolean; press: () => void } | null): void {
    this.drawTeam(ctx, 'p2', CARDS.teamP2, sheet);
    this.drawConditions(ctx, 'p2', CARDS.conditionsP2);
    this.drawConditions(ctx, 'field', CARDS.conditionsField);
    this.drawConditions(ctx, 'p1', CARDS.conditionsP1);
    this.drawTeam(ctx, 'p1', CARDS.teamP1, null);
  }

  private tilesOf(side: SideId): Tile[] {
    if (!this.store.started()) return [];
    const team = previewTeam(this.store.sides()[side]);
    const sideState = this.store.sides()[side];
    const unseen = sideState.preview.length > 0 ? 0 : Math.max(0, Math.min(MAX_TEAM, sideState.teamSize) - team.length);
    const top = side === 'p2' ? CARDS.teamP2 : CARDS.teamP1;
    const place = (i: number) => ({ x: COLUMN_X + 17 + (i % PER_ROW) * (TILE + 10), y: top + 26 + Math.floor(i / PER_ROW) * (TILE + 8) });
    const members = team.map(({ species, seen, active }, i): Tile => {
      const fraction = seen && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
      return {
        id: `tile-${side}-${i}`,
        species,
        sprite: seen?.sprite || (this.dex.species(species)?.sprite ?? spriteId(species)),
        ...place(i),
        bar: seen && !seen.fainted ? { width: Math.max(1, Math.round(fraction * BAR_W)), color: rgba(barColor(fraction)) } : null,
        fainted: !!seen?.fainted,
        active,
        inspect: this.inspectable() ? this.inspection.keyOf(side, species) : null,
      };
    });
    const blanks = Array.from({ length: unseen }, (_, n): Tile => ({
      id: `tile-${side}-${members.length + n}`,
      species: '',
      sprite: '',
      ...place(members.length + n),
      bar: null,
      fainted: false,
      active: false,
      inspect: null,
    }));
    return [...members, ...blanks];
  }

  private drawTeam(ctx: ScreenContext, side: SideId, top: number, sheet: { label: string; open: boolean; press: () => void } | null): void {
    const { renderer } = ctx;
    renderer.rect(COLUMN_X, top, CARD_W, TEAM_H, { fill: INK.card, radius: 6 });
    const owner = this.store.sides()[side].name || (side === 'p2' ? 'Opponent' : 'Player');
    write(ctx, owner.toUpperCase(), COLUMN_X + 10, top + 12, { size: 12, bold: true }, side === 'p1' ? INK.sky300 : INK.red300, 'left', sheet ? 160 : 251);
    if (sheet) hint(ctx, 'side-sheet', { x: COLUMN_X + 176, y: top + 2, w: 88, h: 20 }, 'ZL', sheet.label, sheet.open, sheet.press);

    const shown = this.inspection.shown();
    const shownKey = shown ? this.inspection.keyOf(shown.side, shown.member.species) : null;
    for (const tile of this.tiles()[side]) {
      const box = { x: tile.x, y: tile.y, w: TILE, h: TILE };
      const focused = tile.inspect !== null && ctx.focus.control({ id: tile.id, ...box });
      const pointed = tile.inspect !== null && tile.inspect === shownKey;
      const fill = tile.fainted ? INK.fainted : tile.active ? INK.selected : INK.header;
      const border = pointed ? INK.yellow300 : tile.fainted ? INK.gray700 : tile.active ? INK.sky300 : INK.gray600;
      renderer.rect(box.x, box.y, TILE, TILE, { fill, stroke: border, radius: 6, border: 1 });
      const sprite = ctx.images.sprite(tile.sprite, false, ImagePriority.Screen);
      if (sprite) renderer.rect(box.x + 4, box.y + 1, 64, 64, { fill: [1, 1, 1, tile.fainted ? 0.3 : 1], texture: sprite });
      if (tile.bar) {
        renderer.rect(box.x + 8, box.y + 63, BAR_W, 4, { fill: INK.gray700, radius: 1 });
        renderer.rect(box.x + 8, box.y + 63, tile.bar.width, 4, { fill: tile.bar.color, radius: 1 });
      }
      if (focused) ring(ctx, box, 6);
    }
  }

  private drawConditions(ctx: ScreenContext, of: 'field' | SideId, top: number): void {
    const { renderer } = ctx;
    renderer.rect(COLUMN_X, top, CARD_W, CONDITIONS_H, { fill: INK.card, radius: 6 });
    write(ctx, of === 'field' ? 'FIELD' : 'SIDE', COLUMN_X + 10, top + 12, { size: 12, bold: true }, INK.gray300);
    const field = this.store.field();
    const conditions = of === 'field' ? [field.weather, field.terrain, ...field.rooms].filter((c): c is FieldCondition => !!c) : field.sides[of];
    const chips = toChips(conditions, this.store.turn());
    if (chips.length === 0) {
      write(ctx, 'None', COLUMN_X + 10, top + 40, { size: 14 }, INK.gray400);
      return;
    }
    for (const chip of chips) {
      const x = COLUMN_X + chip.left;
      const y = top + 24;
      renderer.rect(x, y, 81, 34, { fill: rgba(chip.color), radius: 2 });
      write(ctx, chip.name, x + 40.5, y + (chip.pips.length > 0 ? 12 : 17), { size: 12, bold: true }, INK.white, 'center', 77);
      for (const pip of chip.pips) {
        renderer.rect(x + pip.left, y + 23, pip.width, 6, { fill: pip.on ? INK.white : [0, 0, 0, 0.35], radius: 1 });
      }
    }
  }
}
