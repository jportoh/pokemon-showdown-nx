import { computed, inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { toChips } from '@features/battle/components/battle-conditions/battle-conditions';
import { barColor } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { BattlePokemon, FieldCondition, RequestPokemon, SideId } from '@features/battle/models/battle';
import { BattleChoices } from '@features/battle/state/battle-choices';
import { BattleStore } from '@features/battle/state/battle-store';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { previewTeam } from '@features/battle/state/team-preview';
import { Rgba, rgba } from '@core/gl/gl-renderer';
import { spriteId } from '@shared/utils/sprite-id';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
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

/** One of the column's team tiles. */
export interface Tile {
  id: string;
  side: SideId;
  species: string;
  sprite: string;
  x: number;
  y: number;
  bar: { width: number; color: Rgba } | null;
  fainted: boolean;
  active: boolean;
  /** Our own Pokémon's held item, for its icon in the corner; '' for none or the opponent's. */
  item: string;
  /** The switch it makes (Showdown's switch number) while it can be chosen; null otherwise. */
  switchIndex: number | null;
  /** While choosing, why this one of ours can't come in (A says so in the panel); null otherwise. */
  blocked: string | null;
  /** PokemonInspection's key while it can be pointed at; null otherwise. */
  inspect: string | null;
}

/** What the opponent's card's ZL button does: shows their open team sheet, agrees to open sheets, or waits. */
export type SheetButton = 'sheet' | 'accept' | 'waiting';

/**
 * The battle's right column, as the DOM's: the opponent's team on top and ours at the bottom
 * (BattleTeamPreview: tiles framed while on the field, HP bars once sent out, faded once fainted,
 * blanks for the ones not seen yet, our items in the corner), and the conditions in between
 * (BattleConditions: the opponent's side, the field, ours). Our own tiles are how we switch: while
 * choosing, the ones that can come in light up and A picks them (one that can't says why). The
 * tiles that can be pointed at show everything known of that Pokémon in the panel below: both
 * sides' watching live; in our own battles, the opponent's (their card over the panel) and ours
 * (our Pokémon card, while the turn plays).
 */
export class SideColumnView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly inspection = inject(PokemonInspection);
  private readonly choices = inject(BattleChoices);

  /** Our switches by species while one is being chosen (allowed or not, with why). */
  private readonly switches = computed(() => {
    if (this.store.watching() || this.choices.slot() === null || this.choices.pendingMove()) return [];
    return this.choices.switchOptions();
  });

  readonly tiles = computed(() => ({ p1: this.tilesOf('p1'), p2: this.tilesOf('p2') }));

  /** A tile by its id. */
  tile(id: string | null): Tile | null {
    if (!id) return null;
    return [...this.tiles().p1, ...this.tiles().p2].find((t) => t.id === id) ?? null;
  }

  /** The first of our Pokémon that can come in (a forced switch's focus); null when none can. */
  firstSwitch(): string | null {
    return this.tiles().p1.find((t) => t.switchIndex !== null)?.id ?? null;
  }

  draw(ctx: ScreenContext, sheet: { button: SheetButton; open: boolean; press: () => void } | null): void {
    this.drawTeam(ctx, 'p2', CARDS.teamP2, sheet);
    this.drawConditions(ctx, 'p2', CARDS.conditionsP2);
    this.drawConditions(ctx, 'field', CARDS.conditionsField);
    this.drawConditions(ctx, 'p1', CARDS.conditionsP1);
    this.drawTeam(ctx, 'p1', CARDS.teamP1, null);
  }

  /** A: picks the switch, or says why it can't come in. */
  private pick(tile: Tile): void {
    if (tile.blocked !== null) this.choices.notice.set(tile.blocked);
    if (tile.switchIndex !== null) {
      this.choices.hoveredSwitch.set(null);
      this.choices.chooseSwitch(tile.switchIndex);
    }
  }

  private tilesOf(side: SideId): Tile[] {
    if (!this.store.started()) return [];
    const sideState = this.store.sides()[side];
    const own = side === 'p1' ? this.store.team() : [];
    // Without a team preview, our side's team in the request's order.
    const team = previewTeam(sideState.preview.length === 0 && own.length > 0 ? { ...sideState, preview: own.map(speciesOf) } : sideState);
    const unseen = sideState.preview.length > 0 ? 0 : Math.max(0, Math.min(MAX_TEAM, sideState.teamSize) - team.length);
    // Watching live, both sides; in our own battles both too (ours show their card while the turn plays).
    const inspectable = this.store.spectating() || !this.store.replay();
    const top = side === 'p2' ? CARDS.teamP2 : CARDS.teamP1;
    const place = (i: number) => ({ x: COLUMN_X + 17 + (i % PER_ROW) * (TILE + 10), y: top + 26 + Math.floor(i / PER_ROW) * (TILE + 8) });
    const switches = side === 'p1' ? this.switches() : [];
    const members = team.map(({ species, seen, active }, i): Tile => {
      const fraction = seen && seen.maxHp > 0 ? seen.hp / seen.maxHp : 0;
      const option = switches.find((o) => o.species === species || o.species.startsWith(`${species}-`));
      const ownMember = own.find((member) => speciesOf(member) === species);
      const blocked = switches.length === 0 || option?.allowed ? null : (option?.blocked ?? `${memberName(species, seen, ownMember)} wasn't brought to this battle.`);
      return {
        id: `tile-${side}-${i}`,
        side,
        species,
        sprite: seen?.sprite || (this.dex.species(species)?.sprite ?? spriteId(species)),
        ...place(i),
        bar: seen && !seen.fainted ? { width: Math.max(1, Math.round(fraction * BAR_W)), color: rgba(barColor(fraction)) } : null,
        fainted: !!seen?.fainted,
        active,
        item: seen?.fainted ? '' : (ownMember?.item ?? ''),
        switchIndex: option?.allowed ? option.index : null,
        blocked,
        inspect: inspectable ? this.inspection.keyOf(side, species) : null,
      };
    });
    const blanks = Array.from({ length: unseen }, (_, n): Tile => ({
      id: `tile-${side}-${members.length + n}`,
      side,
      species: '',
      sprite: '',
      ...place(members.length + n),
      bar: null,
      fainted: false,
      active: false,
      item: '',
      switchIndex: null,
      blocked: null,
      inspect: null,
    }));
    return [...members, ...blanks];
  }

  private drawTeam(ctx: ScreenContext, side: SideId, top: number, sheet: { button: SheetButton; open: boolean; press: () => void } | null): void {
    const { renderer } = ctx;
    renderer.rect(COLUMN_X, top, CARD_W, TEAM_H, { fill: INK.card, radius: 6 });
    const owner = this.store.sides()[side].name || (side === 'p2' ? 'Opponent' : 'Player');
    write(ctx, owner.toUpperCase(), COLUMN_X + 10, top + 12, { size: 12, bold: true }, side === 'p1' ? INK.sky300 : INK.red300, 'left', sheet ? 160 : 251);
    if (sheet) {
      const label = { sheet: 'Sheet', accept: 'Accept', waiting: 'Waiting' }[sheet.button];
      hint(ctx, 'side-sheet', { x: COLUMN_X + 176, y: top + 2, w: 88, h: 20 }, 'ZL', label, sheet.open, sheet.press);
    }

    const shown = this.inspection.shown();
    const shownKey = shown ? this.inspection.keyOf(shown.side, shown.member.species) : null;
    for (const tile of this.tiles()[side]) {
      const box = { x: tile.x, y: tile.y, w: TILE, h: TILE };
      const usable = tile.switchIndex !== null || tile.blocked !== null || tile.inspect !== null;
      const focused = usable && ctx.focus.control({ id: tile.id, ...box, accept: () => this.pick(tile) });
      const pointed = tile.inspect !== null && tile.inspect === shownKey;
      let fill = tile.fainted ? INK.fainted : tile.active ? INK.selected : INK.header;
      let border = tile.fainted ? INK.gray700 : tile.active ? INK.sky300 : INK.gray600;
      if (tile.switchIndex !== null) {
        fill = rgba('#3a4a68');
        border = INK.gray100;
      } else if (pointed) {
        border = INK.yellow300;
      }
      renderer.rect(box.x, box.y, TILE, TILE, { fill, stroke: border, radius: 6, border: 1 });
      const sprite = ctx.images.sprite(tile.sprite, false, ImagePriority.Screen);
      if (sprite) renderer.rect(box.x + 4, box.y + 1, 64, 64, { fill: [1, 1, 1, tile.fainted ? 0.3 : 1], texture: sprite });
      const icon = tile.item ? ctx.images.image(`items/${tile.item}.png`) : null;
      if (icon) renderer.rect(box.x + 45, box.y + 35, 24, 24, { fill: INK.white, texture: icon });
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

/** "Garchomp, L50, M" → "Garchomp". */
function speciesOf(pokemon: RequestPokemon): string {
  return pokemon.details.split(',')[0];
}

/** Its nickname when known, else its species. */
function memberName(species: string, seen: BattlePokemon | undefined, own: RequestPokemon | undefined): string {
  return seen?.name ?? (own ? own.ident.slice(own.ident.indexOf(': ') + 2) : species);
}
