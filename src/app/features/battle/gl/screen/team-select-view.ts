import { computed, inject, linkedSignal } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { abilityName, itemName } from '@core/dex/names';
import { speciesInfo } from '@core/dex/species';
import { Rgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { ACCEPT_FILL } from '@core/gl/ui/hold-action';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { MovePill, movePills, sheetRows } from '@features/battle/gl/screen/sheet-rows';
import { BattleRequest } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { retroPalette } from './overlay-views';
import { INK, ScreenContext, hint, ring, write } from './screen-context';

const TOP = 44;
const SLOTS = 6;
/** The icon columns down each edge: ours on the left, theirs on the right. */
const ICON = 88;
const ICON_STEP = 96;
const ICON_TOP = 56;
const OWN_COLUMN = 16;
const FOE_COLUMN = 1176;
/** The seam between the halves runs from the top's (700, 44) to the foot's (580, 720). */
const SEAM_ANGLE = Math.atan2(120, 676);
const SEAM_MID = { x: 640, y: 382 };
/** Each side's Pokémon in focus, big, over its card. */
const HERO = { own: { x: 340, size: 288 }, foe: { x: 940, size: 256 }, feetY: 400 };
const CARD = { own: 124, foe: 716, y: 432, w: 440, h: 168 };
/** The four we bring along the foot: two leads, two in the back. */
const BRING_SLOT = { x: 424, y: 616, h: 96, width: 448, gap: 12 };
const DONE_BOX = { x: 884, y: 636, w: 160, h: 56 };
const SHEET_BOX = { x: 1052, y: 648, w: 116, h: 32 };
const SWAP_MS = 280;
const POP_MS = 200;
export const DONE_ID = 'team-done';

/** What ZL does about the opponent's open team sheet: shows it, agrees to open sheets, or waits. */
export type SheetButton = 'sheet' | 'accept' | 'waiting';

/** One Pokémon as its side's big card shows it. */
interface HeroSet {
  sprite: string;
  name: string;
  types: readonly string[];
  /** Item, ability and moves: always ours; theirs only from an open team sheet. */
  set: { item: string; itemId: string; ability: string; moves: readonly MovePill[] } | null;
  /** Without their sheet: the abilities it may have. */
  abilities: string;
  speed: number | null;
}

/**
 * Team preview in formats played with our own teams, face to face (BattleTeamSelect): the server
 * waits for us to pick the Pokémon we bring, in order (the first ones lead). The stage under the top
 * bar is split on a diagonal, ours on the left and theirs on the right: each side's six as icons
 * down its edge, the one in focus big in the middle over a card with its set (theirs from their open
 * team sheet), so the two can be weighed against each other. ▲▼ go down a column, ◀▶ cross over; A
 * on ours adds it to the four slots along the foot (two leads, two back) or takes it out; B takes the
 * last pick back; Done sends the order; ZL agrees to open team sheets or shows theirs. After Done it
 * stands by, the picks kept, until the battle starts.
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

  private readonly own = computed((): HeroSet[] =>
    (this.request()?.side.pokemon ?? []).slice(0, SLOTS).map((pokemon) => {
      const species = pokemon.details.split(', ')[0];
      const info = speciesInfo(species);
      return {
        sprite: this.dex.mega(species, pokemon.item)?.sprite ?? spriteId(species),
        name: species,
        types: info?.types ?? [],
        set: {
          item: itemName(pokemon.item) || 'No item',
          itemId: pokemon.item,
          ability: abilityName(pokemon.ability ?? ''),
          moves: movePills(pokemon.moves.slice(0, 4).map((move) => this.dex.move(move)?.name ?? move), 0, 0),
        },
        abilities: '',
        speed: info?.baseStats.spe ?? null,
      };
    }),
  );

  private readonly theirs = computed((): HeroSet[] =>
    sheetRows(this.store.sides().p2.preview, this.store.teamSheets().p2, this.dex, 0, 0)
      .slice(0, SLOTS)
      .map((row) => {
        const info = speciesInfo(row.name);
        return {
          sprite: row.sprite,
          name: row.name,
          types: info?.types ?? [],
          set: row.sheet,
          abilities: info ? info.abilities.filter(Boolean).join(' / ') : '',
          speed: info?.baseStats.spe ?? null,
        };
      }),
  );

  /** Each side's Pokémon in focus (the last one the focus was on), and since when, for its slide in. */
  private shownOwn = { index: 0, since: -1e4 };
  private shownFoe = { index: 0, since: -1e4 };
  private ownActive = true;
  /** When each bring slot was filled, for its pop. */
  private filledAt: number[] = [];

  /** The first of ours, where the focus starts. */
  readonly firstId = 'pick-0';

  /** A: adds the Pokémon to the order (while there's room), or takes it out; true once all are picked (on to Done). */
  toggle(index: number, now = 0): boolean {
    if (this.standingBy()) return false;
    const order = this.order();
    if (order.includes(index)) this.order.set(order.filter((i) => i !== index));
    else if (order.length < this.toBring()) {
      this.filledAt[order.length] = now;
      this.order.set([...order, index]);
    }
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

  /** `sheet.held`: how full Accept is while ZL is held (accepting open team sheets), 0 to 1. */
  draw(ctx: ScreenContext, sheet: { button: SheetButton; press: () => void; held: number } | null, onAllPicked: () => void): void {
    const { renderer } = ctx;
    const p = this.palette;
    this.followFocus(ctx);
    renderer.rect(0, TOP, 1280, 720 - TOP, { fill: p.bg });
    this.drawHalves(ctx);

    const own = this.own();
    const theirs = this.theirs();
    const order = this.order();
    const leads = this.leads();
    const standing = this.standingBy();
    const opponent = this.store.sides().p2.name || 'the opponent';
    const title = standing ? `Standing by… ${opponent} is choosing` : `Choose ${this.toBring()} · the first ${leads === 1 ? 'one leads' : `${leads} lead`}`;
    write(ctx, title, 640, TOP + 24, { size: 20, bold: true }, p.ink, 'center', 560);
    write(ctx, 'VS', 640, 300, { size: 64, bold: true }, p.teal, 'center');

    // The columns: A on ours picks it; ◀▶ cross to the other column, at the one shown there.
    own.forEach((set, i) => {
      const box = { x: OWN_COLUMN, y: ICON_TOP + i * ICON_STEP, w: ICON, h: ICON };
      const focused = ctx.focus.control({
        id: `pick-${i}`,
        ...box,
        accept: () => {
          if (this.toggle(i, ctx.now)) onAllPicked();
        },
        move: (direction) => this.moveFromColumn(ctx, 'own', i, direction),
      });
      const place = order.indexOf(i);
      this.drawIcon(ctx, box, set, true, i === this.shownOwn.index, focused, place === -1 ? null : place + 1, place !== -1 && place < leads, place === -1 && this.ready());
    });
    theirs.forEach((set, i) => {
      const box = { x: FOE_COLUMN, y: ICON_TOP + i * ICON_STEP, w: ICON, h: ICON };
      const focused = ctx.focus.control({
        id: `foe-${i}`,
        ...box,
        // A on theirs goes back to ours.
        accept: () => ctx.focus.focus(`pick-${this.shownOwn.index}`),
        move: (direction) => this.moveFromColumn(ctx, 'foe', i, direction),
      });
      this.drawIcon(ctx, box, set, false, i === this.shownFoe.index, focused, null, false, false);
    });

    const ownHero = own[this.shownOwn.index];
    const foeHero = theirs[this.shownFoe.index];
    if (ownHero) this.drawHero(ctx, ownHero, true, this.ownActive || standing);
    if (foeHero) this.drawHero(ctx, foeHero, false, !this.ownActive || standing);

    this.drawSlots(ctx, own);

    const ready = this.ready() && !standing;
    const focused = ctx.focus.control({ id: DONE_ID, ...DONE_BOX, accept: () => this.done(), move: (direction) => this.moveFromDone(ctx, direction) });
    renderer.rect(DONE_BOX.x, DONE_BOX.y, DONE_BOX.w, DONE_BOX.h, { fill: ready ? p.accent : INK.gray700, stroke: ready ? p.accentText : INK.gray600, radius: 8, border: 2 });
    write(ctx, standing ? 'Sent' : 'Done', DONE_BOX.x + DONE_BOX.w / 2, DONE_BOX.y + DONE_BOX.h / 2, { size: 22, bold: true }, ready ? INK.white : INK.gray400, 'center');
    if (focused) ring(ctx, DONE_BOX, 8);
    if (sheet) {
      const label = { sheet: 'Sheet', accept: 'Accept', waiting: 'Waiting' }[sheet.button];
      const held = sheet.button === 'accept' ? { progress: sheet.held, color: ACCEPT_FILL } : undefined;
      hint(ctx, 'select-sheet', SHEET_BOX, 'ZL', label, false, sheet.press, { fill: p.panel, border: p.outline }, held);
    }
    const status = standing ? 'Team sent' : `${order.length}/${this.toBring()} chosen`;
    write(ctx, status, CARD.own, 640, { size: 18, bold: true }, ready || standing ? p.teal : p.ink, 'left', 290);
    write(ctx, this.hint(sheet?.button ?? null), CARD.own, 672, { size: 14 }, p.muted, 'left', 290);
    write(ctx, standing ? '' : 'B undo', CARD.own, 696, { size: 14 }, p.muted, 'left', 290);
  }

  /** The side and Pokémon shown follow the focus: a new one slides in. */
  private followFocus(ctx: ScreenContext): void {
    const focused = ctx.focus.focused ?? '';
    const own = focused.startsWith('pick-');
    const foe = focused.startsWith('foe-');
    if (own || foe) {
      const index = Number(focused.slice(own ? 'pick-'.length : 'foe-'.length));
      const shown = own ? this.shownOwn : this.shownFoe;
      if (shown.index !== index) {
        if (own) this.shownOwn = { index, since: ctx.now };
        else this.shownFoe = { index, since: ctx.now };
      }
      this.ownActive = own;
    } else if (focused === DONE_ID) {
      this.ownActive = true;
    }
  }

  /**
   * The d-pad on a column: ▲▼ along it (▼ off ours' foot to Done), ◀▶ across to the other column's
   * Pokémon in view. True when it moved (the focus's own search is not used here).
   */
  private moveFromColumn(ctx: ScreenContext, side: 'own' | 'foe', index: number, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const count = side === 'own' ? this.own().length : this.theirs().length;
    const prefix = side === 'own' ? 'pick-' : 'foe-';
    if (direction === 'up') {
      if (index > 0) ctx.focus.focus(`${prefix}${index - 1}`);
    } else if (direction === 'down') {
      if (index < count - 1) ctx.focus.focus(`${prefix}${index + 1}`);
      else if (side === 'own') ctx.focus.focus(DONE_ID);
    } else if (side === 'own' && direction === 'right' && this.theirs().length > 0) {
      ctx.focus.focus(`foe-${this.shownFoe.index}`);
    } else if (side === 'foe' && direction === 'left' && this.own().length > 0) {
      ctx.focus.focus(`pick-${this.shownOwn.index}`);
    }
    return true;
  }

  private moveFromDone(ctx: ScreenContext, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    if (direction === 'up' || direction === 'left') ctx.focus.focus(`pick-${this.shownOwn.index}`);
    else if (direction === 'right' && this.theirs().length > 0) ctx.focus.focus(`foe-${this.shownFoe.index}`);
    return true;
  }

  /** The two halves' tints, cut by a diagonal seam of light. */
  private drawHalves(ctx: ScreenContext): void {
    const { renderer } = ctx;
    const p = this.palette;
    const size = 1400;
    const dx = (size / 2) * Math.cos(SEAM_ANGLE);
    const dy = (size / 2) * Math.sin(SEAM_ANGLE);
    renderer.clip({ x: 0, y: TOP, w: 1280, h: 720 - TOP });
    renderer.rect(SEAM_MID.x - dx - size / 2, SEAM_MID.y - dy - size / 2, size, size, { fill: withAlpha(p.accent, 0.22), angle: SEAM_ANGLE });
    renderer.rect(SEAM_MID.x + dx - size / 2, SEAM_MID.y + dy - size / 2, size, size, { fill: withAlpha(INK.red800, 0.28), angle: SEAM_ANGLE });
    const glow = this.standingBy() ? 0.6 + 0.3 * Math.sin(ctx.now / 300) : 0.45;
    renderer.rect(SEAM_MID.x - 14, SEAM_MID.y - 360, 28, 720, { fill: withAlpha(p.teal, glow * 0.35), angle: SEAM_ANGLE, softness: 12, additive: true });
    renderer.rect(SEAM_MID.x - 3, SEAM_MID.y - 360, 6, 720, { fill: withAlpha(p.teal, glow), angle: SEAM_ANGLE });
    renderer.clip(null);
  }

  private drawIcon(
    ctx: ScreenContext,
    box: { x: number; y: number; w: number; h: number },
    set: HeroSet,
    own: boolean,
    shown: boolean,
    focused: boolean,
    order: number | null,
    lead: boolean,
    dim: boolean,
  ): void {
    const p = this.palette;
    const edge = own ? p.accentText : INK.red300;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: shown ? p.select : p.panel, stroke: shown ? edge : p.rim, radius: 10, border: shown ? 3 : 2 });
    this.drawSprite(ctx, set.sprite, box.x + 2, box.y + 2, box.w - 4, own, dim ? 0.45 : 1);
    if (order !== null) this.drawBadge(ctx, box.x + box.w - 14, box.y + 14, 13, order, lead);
    if (focused) ring(ctx, box, 10);
  }

  /** The Pokémon in focus on a side: big on its platform, sliding in from its column, over its card. */
  private drawHero(ctx: ScreenContext, set: HeroSet, own: boolean, active: boolean): void {
    const { renderer } = ctx;
    const p = this.palette;
    const edge = own ? p.accentText : INK.red300;
    const hero = own ? HERO.own : HERO.foe;
    const since = own ? this.shownOwn.since : this.shownFoe.since;
    const t = easeOut(Math.min(1, Math.max(0, (ctx.now - since) / SWAP_MS)));
    const slide = (own ? -1 : 1) * 70 * (1 - t);
    renderer.rect(hero.x - 150, HERO.feetY - 28, 300, 56, { fill: withAlpha(edge, active ? 0.55 : 0.25), texture: ctx.disc });
    renderer.rect(hero.x - 144, HERO.feetY - 24, 288, 48, { fill: withAlpha(p.bg, 0.85), texture: ctx.disc });
    this.drawSprite(ctx, set.sprite, hero.x - hero.size / 2 + slide, HERO.feetY - hero.size + 8, hero.size, own, (0.3 + 0.7 * t) * (active ? 1 : 0.7));

    const x = own ? CARD.own : CARD.foe;
    const { y, w, h } = CARD;
    renderer.rect(x, y, w, h, { fill: p.panel, stroke: active ? edge : p.rim, radius: 12, border: active ? 3 : 2 });
    write(ctx, set.name, x + 16, y + 24, { size: 22, bold: true }, p.ink, 'left', w - 32 - set.types.length * 80);
    set.types.forEach((type, i) => {
      const left = x + w - 16 - (set.types.length - i) * 80;
      renderer.rect(left, y + 12, 74, 24, { fill: rgba(typeColor(type) || '#4b5563'), radius: 4 });
      write(ctx, type.toUpperCase(), left + 37, y + 24, { size: 12, bold: true }, INK.white, 'center', 70);
    });
    const speed = set.speed !== null ? `Base Spe ${set.speed}` : '';
    if (!set.set) {
      write(ctx, set.abilities, x + 16, y + 56, { size: 16 }, p.muted, 'left', w - 32);
      write(ctx, speed, x + 16, y + 82, { size: 16 }, p.muted, 'left', w - 32);
      write(ctx, 'No open team sheet: item and moves unknown', x + 16, y + 130, { size: 14 }, p.muted, 'left', w - 32);
      return;
    }
    ctx.images.drawItem(set.set.itemId, x + 12, y + 44, 24);
    const info = [set.set.item, set.set.ability, speed].filter(Boolean).join(' · ');
    write(ctx, info, x + 40, y + 56, { size: 15 }, p.muted, 'left', w - 56);
    set.set.moves.forEach((move, i) => {
      const left = x + 16 + (i % 2) * 208;
      const top = y + 76 + Math.floor(i / 2) * 44;
      renderer.rect(left, top, 200, 38, { fill: rgba(move.color || '#4b5563'), radius: 6 });
      write(ctx, move.name, left + 12, top + 19, { size: 15, bold: true }, INK.white, 'left', 180);
    });
  }

  /** The four slots along the foot: Lead, Lead, Back, Back (as many leads as the format sends out). */
  private drawSlots(ctx: ScreenContext, own: readonly HeroSet[]): void {
    const { renderer } = ctx;
    const p = this.palette;
    const order = this.order();
    const count = this.toBring();
    // Four fill the row; more (formats that bring all six) share it.
    const w = Math.min(100, (BRING_SLOT.width - (count - 1) * BRING_SLOT.gap) / count);
    for (let k = 0; k < count; k++) {
      const x = BRING_SLOT.x + k * (w + BRING_SLOT.gap);
      const { y, h } = BRING_SLOT;
      const lead = k < this.leads();
      const color = lead ? p.accentText : p.teal;
      const picked = own[order[k]];
      renderer.rect(x, y, w, h, { fill: picked ? p.select : withAlpha(p.panel, 0.7), stroke: color, radius: 10, border: 2 });
      write(ctx, lead ? 'LEAD' : 'BACK', x + w / 2, y + h - 11, { size: 12, bold: true }, color, 'center');
      if (picked) {
        const pop = easeOut(Math.min(1, Math.max(0, (ctx.now - (this.filledAt[k] ?? -1e4)) / POP_MS)));
        const size = Math.min(72, w - 8) * (0.6 + 0.4 * pop);
        this.drawSprite(ctx, picked.sprite, x + w / 2 - size / 2, y + 74 - size, size, true, 1);
      } else {
        write(ctx, '?', x + w / 2, y + 40, { size: 28, bold: true }, p.rim, 'center');
      }
    }
  }

  private drawBadge(ctx: ScreenContext, cx: number, cy: number, r: number, order: number, lead: boolean): void {
    const p = this.palette;
    ctx.renderer.rect(cx - r - 2, cy - r - 2, (r + 2) * 2, (r + 2) * 2, { fill: p.bar, radius: r + 2 });
    ctx.renderer.rect(cx - r, cy - r, r * 2, r * 2, { fill: lead ? p.accent : p.teal, radius: r });
    write(ctx, String(order), cx, cy, { size: Math.round(r * 1.2), bold: true }, lead ? INK.white : p.bar, 'center');
  }

  /** A front sprite in a square; ours turned round to face theirs across the seam. */
  private drawSprite(ctx: ScreenContext, sprite: string, x: number, y: number, size: number, flip: boolean, alpha: number): void {
    const texture = ctx.images.sprite(sprite, false, ImagePriority.Screen);
    if (!texture) return;
    const [u0, v0, u1, v1] = texture.uv ?? [0, 0, 1, 1];
    ctx.renderer.rect(x, y, size, size, { fill: [1, 1, 1, alpha] as Rgba, texture, uv: flip ? [u1, v0, u0, v1] : [u0, v0, u1, v1] });
  }

  private hint(sheet: SheetButton | null): string {
    if (this.standingBy()) return sheet === 'sheet' ? 'ZL their full team sheet' : '';
    if (sheet === 'sheet') return 'A pick · ◀▶ sides · ZL their sheet';
    if (sheet === 'accept') return 'A pick · ◀▶ sides · hold ZL: accept sheets';
    if (sheet === 'waiting') return 'A pick · ◀▶ sides · waiting on sheets';
    return 'A pick · ◀▶ sides';
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
