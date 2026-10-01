import { computed, inject, linkedSignal } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { abilityName, itemName } from '@core/dex/names';
import { movePills, sheetRows } from '@features/battle/components/battle-team-select/sheet-rows';
import { BattleRequest } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { Rgba, rgba } from '@core/gl/gl-renderer';
import { spriteId } from '@shared/utils/sprite-id';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { retroPalette } from './overlay-views';
import { INK, ScreenContext, hint, ring, write } from './screen-context';
import { SheetButton } from './side-column-view';

const TOP = 48;
const SLOTS = 6;
const ROW_TOP = 52;
const ROW_STEP = 96;
const PILL_W = 150;
export const DONE_ID = 'team-done';

/**
 * Team preview in formats played with our own teams, as BattleTeamSelect: the server waits for us to
 * pick the Pokémon we bring, in order (the first ones lead: two in doubles, one in singles). Over the
 * whole stage under the header (1280x672). Ours are six rows on the left, A adds one to the order or
 * takes it out (its number on it, the leads marked); theirs on the right (item, ability and moves
 * from their open team sheet, when there's one); "VS" between. Done sends the order; B takes the last
 * pick back; ZL agrees to open team sheets or shows theirs. After Done it stands by, the picks kept,
 * until the battle starts.
 */
export class TeamSelectView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly palette = retroPalette();

  /** The server's team preview request, while it waits for our choice. */
  private readonly pending = computed(() => {
    const request = this.store.request();
    return request?.teamPreview && !this.store.result() && !this.store.watching() ? request : null;
  });

  /** The request answered (Done), kept until the battle starts so both teams stay in view. */
  private readonly answered = linkedSignal({ source: () => this.store.teamPreview(), computation: (): BattleRequest | null => null });

  private readonly request = computed(() => this.pending() ?? (this.store.teamPreview() ? this.answered() : null));

  /** Our choice is sent: the opponent is still choosing theirs. */
  readonly standingBy = computed(() => !this.pending() && this.request() !== null);

  readonly shown = computed(() => this.request() !== null);

  private readonly leads = computed(() => (this.store.gameType() === 'doubles' ? 2 : 1));

  private readonly toBring = computed(() => {
    const request = this.request();
    return request ? Math.min(request.maxChosenTeamSize ?? request.side.pokemon.length, request.side.pokemon.length) : 0;
  });

  /** The team's positions (0-based) in the order picked; a new request starts over. */
  private readonly order = linkedSignal({ source: this.request, computation: (): number[] => [] });

  private readonly ready = computed(() => {
    const count = this.order().length;
    const request = this.request();
    if (!request) return false;
    return request.maxChosenTeamSize ? count === this.toBring() : count >= Math.min(this.leads(), this.toBring());
  });

  private readonly own = computed(() => {
    const team = this.request()?.side.pokemon ?? [];
    const order = this.order();
    return team.slice(0, SLOTS).map((pokemon, i) => {
      const species = pokemon.details.split(', ')[0];
      const place = order.indexOf(i);
      return {
        id: `pick-${i}`,
        index: i,
        y: TOP + ROW_TOP + i * ROW_STEP,
        sprite: this.dex.mega(species, pokemon.item)?.sprite ?? spriteId(species),
        name: species,
        item: itemName(pokemon.item) || 'No item',
        itemId: pokemon.item,
        ability: abilityName(pokemon.ability ?? ''),
        moves: movePills(pokemon.moves.slice(0, 4).map((move) => this.dex.move(move)?.name ?? move), 4, 20),
        order: place === -1 ? null : place + 1,
        lead: place !== -1 && place < this.leads(),
      };
    });
  });

  private readonly theirs = computed(() => sheetRows(this.store.sides().p2.preview, this.store.teamSheets().p2, this.dex, 4, 20).slice(0, SLOTS));

  /** The first of ours, where the focus starts. */
  readonly firstId = 'pick-0';

  /** A: adds the Pokémon to the order (while there's room), or takes it out; true once all are picked (on to Done). */
  toggle(index: number): boolean {
    if (this.standingBy()) return false;
    const order = this.order();
    if (order.includes(index)) this.order.set(order.filter((i) => i !== index));
    else if (order.length < this.toBring()) this.order.set([...order, index]);
    return this.order().length === this.toBring();
  }

  /** B: takes the last pick back. */
  undo(): void {
    if (!this.standingBy()) this.order.update((order) => order.slice(0, -1));
  }

  private done(): void {
    const request = this.pending();
    if (!request || !this.ready()) return;
    this.answered.set(request);
    this.store.choose(`team ${this.order().map((i) => i + 1).join('')}`);
  }

  draw(ctx: ScreenContext, sheet: { button: SheetButton; press: () => void } | null, onAllPicked: () => void): void {
    const { renderer } = ctx;
    const p = this.palette;
    renderer.rect(0, TOP, 1280, 672, { fill: p.bg });
    const opponent = this.store.sides().p2.name;
    const leads = this.leads();
    const title = this.standingBy() ? `Standing by… ${opponent || 'the opponent'} is choosing` : `Choose ${this.toBring()} Pokémon · the first ${leads === 1 ? 'one leads' : `${leads} lead`}`;
    write(ctx, title, 16, TOP + 28, { size: 24, bold: true }, p.ink, 'left', 560);
    write(ctx, opponent, 704, TOP + 28, { size: 18, bold: true }, INK.red300, 'left', 436);
    if (sheet) {
      const label = { sheet: 'Sheet', accept: 'Accept', waiting: 'Waiting' }[sheet.button];
      hint(ctx, 'select-sheet', { x: 1152, y: TOP + 12, w: 112, h: 32 }, 'ZL', label, false, sheet.press, { fill: p.panel, border: p.outline });
    }

    for (const row of this.own()) {
      const box = { x: 16, y: row.y, w: 560, h: 88 };
      const focused = ctx.focus.control({
        id: row.id,
        ...box,
        accept: () => {
          if (this.toggle(row.index)) onAllPicked();
        },
      });
      const chosen = row.order !== null;
      renderer.rect(box.x, box.y, box.w, box.h, { fill: chosen ? p.select : p.panel, stroke: chosen ? p.accentText : p.outline, radius: 12, border: 4 });
      // Its place in the order: a numbered disc, the leads in the accent colour.
      if (row.order === null) renderer.rect(box.x + 10, box.y + 24, 40, 40, { fill: [0, 0, 0, 0], stroke: p.outline, radius: 20, border: 2 });
      else renderer.rect(box.x + 10, box.y + 24, 40, 40, { fill: row.lead ? p.accent : p.teal, radius: 20 });
      if (row.order !== null) write(ctx, String(row.order), box.x + 30, box.y + 44, { size: 20, bold: true }, row.lead ? INK.white : p.bg, 'center');
      const sprite = ctx.images.sprite(row.sprite, false, ImagePriority.Screen);
      if (sprite) renderer.rect(box.x + 58, box.y + 2, 80, 80, { fill: INK.white, texture: sprite });
      write(ctx, row.name, box.x + 146, box.y + 18, { size: 20, bold: true }, p.ink, 'left', 232);
      ctx.images.drawItem(row.itemId, box.x + 144, box.y + 34, 24);
      write(ctx, row.item, box.x + 172, box.y + 46, { size: 16 }, p.muted, 'left', 206);
      write(ctx, row.ability, box.x + 146, box.y + 70, { size: 14 }, p.muted, 'left', 176);
      if (row.lead) write(ctx, 'LEAD', box.x + 378, box.y + 70, { size: 12, bold: true }, p.accentText, 'right');
      this.drawPills(ctx, box.x + 378, box.y, row.moves);
      if (focused) ring(ctx, box, 12);
    }

    write(ctx, 'VS', 640, TOP + 336, { size: 48, bold: true }, p.accentText, 'center');

    this.theirs().forEach((row, i) => {
      const x = 704;
      const y = TOP + ROW_TOP + i * ROW_STEP;
      renderer.rect(x, y, 560, 88, { fill: p.panel, stroke: INK.red300, radius: 12, border: 4 });
      const sprite = ctx.images.sprite(row.sprite, false, ImagePriority.Screen);
      if (sprite) renderer.rect(x + 10, y + 2, 80, 80, { fill: INK.white, texture: sprite });
      write(ctx, row.name, x + 98, y + 18, { size: 20, bold: true }, p.ink, 'left', 280);
      if (row.sheet) {
        ctx.images.drawItem(row.sheet.itemId, x + 96, y + 34, 24);
        write(ctx, row.sheet.item, x + 124, y + 46, { size: 16 }, p.muted, 'left', 254);
        write(ctx, row.sheet.ability, x + 98, y + 70, { size: 14 }, p.muted, 'left', 280);
        this.drawPills(ctx, x + 378, y, row.sheet.moves);
      } else {
        write(ctx, row.types, x + 98, y + 46, { size: 16 }, p.muted, 'left', 280);
      }
    });

    const standing = this.standingBy();
    write(ctx, standing ? 'Team sent · standing by' : `${this.order().length}/${this.toBring()} chosen`, 16, TOP + 648, { size: 18 }, p.muted, 'left', 376);
    const done = { x: 396, y: TOP + 628, w: 180, h: 40 };
    const ready = this.ready() && !standing;
    const focused = ctx.focus.control({ id: DONE_ID, ...done, accept: () => this.done() });
    renderer.rect(done.x, done.y, done.w, done.h, { fill: ready ? p.accent : INK.gray700, stroke: ready ? p.bar : INK.gray600, radius: 6, border: 2 });
    write(ctx, standing ? 'Sent' : 'Done', done.x + 90, done.y + 20, { size: 20, bold: true }, ready ? INK.white : INK.gray400, 'center');
    if (focused) ring(ctx, done, 6);
    write(ctx, this.hint(sheet?.button ?? null), 1264, TOP + 648, { size: 16 }, p.muted, 'right', 560);
  }

  private hint(sheet: SheetButton | null): string {
    if (this.standingBy()) return sheet === 'sheet' ? 'ZL their full team sheet' : '';
    if (sheet === 'sheet') return 'A pick · B undo · ZL their full team sheet';
    if (sheet === 'accept') return 'A pick · B undo · ZL accept open team sheets';
    if (sheet === 'waiting') return 'A pick · B undo · Waiting for their answer on sheets';
    return 'A pick · B undo';
  }

  private drawPills(ctx: ScreenContext, x: number, y: number, moves: readonly { name: string; top: number; color: string }[]): void {
    for (const move of moves) {
      ctx.renderer.rect(x + 16, y + move.top, PILL_W, 18, { fill: rgba(move.color || '#4b5563') as Rgba, radius: 2 });
      write(ctx, move.name, x + 16 + PILL_W / 2, y + move.top + 9, { size: 12, bold: true }, INK.white, 'center', PILL_W - 4);
    }
  }
}
