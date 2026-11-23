import { computed, inject, linkedSignal } from '@angular/core';
import { ROLE_KEYS } from '@core/input/console-keys';
import { ChampionsDex } from '@core/dex/champions-dex';
import { abilityName, itemName } from '@core/dex/names';
import { speciesInfo } from '@core/dex/species';
import { withAlpha } from '@core/gl/gl-renderer';
import { ACCEPT_FILL } from '@core/gl/ui/hold-action';
import { movePills, sheetRows } from '@features/battle/gl/screen/sheet-rows';
import { BattleRequest } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { spriteId } from '@shared/utils/sprite-id';
import { CARD, HeroSet, SLOTS, TOP, drawHalves, drawHero, drawIcon, drawSprite, easeOut, heroFromRow, iconBox } from './face-off';
import { INK, ScreenContext, hint, keyChip, write } from './screen-context';

/** The four we bring along the foot: two leads, two in the back. */
const BRING_SLOT = { x: 424, y: 616, h: 96, width: 448, gap: 12 };
const DONE_BOX = { x: 884, y: 636, w: 160, h: 56 };
const SHEET_BOX = { x: 1052, y: 648, w: 176, h: 32 };
const POP_MS = 200;
/** Done's beat while it waits to be pressed (all picked), and its shake when L comes too soon. */
const DONE_BEAT_MS = 900;
const NUDGE_MS = 420;
export const DONE_ID = 'team-done';

/** What ZL does about the opponent's open team sheet: shows it, agrees to open sheets, or waits. */
export type SheetButton = 'sheet' | 'accept' | 'waiting';

/**
 * Team preview in formats played with our own teams, face to face (BattleTeamSelect): the server
 * waits for us to pick the Pokémon we bring, in order (the first ones lead). The stage under the top
 * bar is split on a diagonal, ours on the left and theirs on the right: each side's six as icons
 * down its edge, the one in focus big in the middle over a card with its set (theirs from their open
 * team sheet), so the two can be weighed against each other. ▲▼ go down a column, ◀▶ cross over; A
 * on ours adds it to the four slots along the foot (two leads, two back) or takes it out; B takes the
 * last pick back; Done sends the order; ZL agrees to open team sheets or shows theirs. After Done it
 * stands by, the picks kept, until the battle starts; B there takes Done back while the opponent is
 * still choosing.
 */
export class TeamSelectView {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);

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

  /**
   * The team's positions (0-based) in the order picked; a new request starts over, the same one shown
   * again (Done taken back) keeps them.
   */
  private readonly order = linkedSignal({
    source: this.request,
    computation: (request, previous?: { source: BattleRequest | null; value: number[] }): number[] =>
      request && previous?.source?.rqid === request.rqid ? previous.value : [],
  });

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
          ability: abilityName(pokemon.ability ?? pokemon.baseAbility ?? ''),
          moves: movePills(pokemon.moves.slice(0, 4).map((move) => this.dex.move(move)?.name ?? move), 0, 0),
        },
        abilities: '',
        speed: info?.baseStats.spe ?? null,
      };
    }),
  );

  private readonly theirs = computed((): HeroSet[] =>
    sheetRows(this.store.sides().p2.preview, this.store.teamSheets().p2, this.dex, 0, 0).slice(0, SLOTS).map(heroFromRow),
  );

  /** Each side's Pokémon in focus (the last one the focus was on), and since when, for its slide in. */
  private shownOwn = { index: 0, since: -1e4 };
  private shownFoe = { index: 0, since: -1e4 };
  private ownActive = true;
  /** When each bring slot was filled, for its pop. */
  private filledAt: number[] = [];
  /** Since when all are picked and Done waits (its beat starts there); null while not. */
  private readySince: number | null = null;
  /** L pressed before all were picked: the count shakes (set on the next frame). */
  private nudgeAt = -1e4;
  private nudgeAsked = false;

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

  /** B: takes the last pick back; after Done, takes Done back while the opponent is still choosing. */
  undo(): void {
    if (!this.standingBy()) this.order.update((order) => order.slice(0, -1));
    else if (this.store.canUndo()) this.store.undo();
  }

  private done(): void {
    const request = this.pending();
    if (!request || !this.ready()) return;
    this.answered.set(request);
    this.store.choose(`team ${this.order().map((i) => i + 1).join('')}`);
  }

  /** L: Done from anywhere on the screen; too soon, the count shakes. False when it isn't ours to use. */
  pressDone(): boolean {
    if (!this.pending()) return false;
    if (this.ready()) this.done();
    else this.nudgeAsked = true;
    return true;
  }

  /** `sheet.held`: how full Accept is while ZL is held (accepting open team sheets), 0 to 1. */
  draw(ctx: ScreenContext, sheet: { button: SheetButton; press: () => void; held: number } | null, onAllPicked: () => void): void {
    const { renderer } = ctx;
    const p = ctx.palette;
    this.followFocus(ctx);
    drawHalves(ctx, p, this.standingBy());

    const own = this.own();
    const theirs = this.theirs();
    const order = this.order();
    const leads = this.leads();
    const standing = this.standingBy();
    const opponent = this.store.sides().p2.name || 'the opponent';
    const title = standing ? `Standing by… ${opponent} is choosing` : `Choose ${this.toBring()} · the first ${leads === 1 ? 'one leads' : `${leads} lead`}`;
    write(ctx, title, 640, TOP + 24, { size: 20, bold: true }, p.ink, 'center', 560);

    // The columns: A on ours picks it; ◀▶ cross to the other column, at the one shown there.
    own.forEach((set, i) => {
      const box = iconBox('left', i);
      const focused = ctx.focus.control({
        id: `pick-${i}`,
        ...box,
        accept: () => {
          if (this.toggle(i, ctx.now)) onAllPicked();
        },
        move: (direction) => this.moveFromColumn(ctx, 'own', i, direction),
      });
      const place = order.indexOf(i);
      const badge = place === -1 ? null : { order: place + 1, lead: place < leads };
      drawIcon(ctx, p, box, set, 'left', i === this.shownOwn.index, focused, badge, place === -1 && this.ready());
    });
    theirs.forEach((set, i) => {
      const box = iconBox('right', i);
      const focused = ctx.focus.control({
        id: `foe-${i}`,
        ...box,
        // A on theirs goes back to ours.
        accept: () => ctx.focus.focus(`pick-${this.shownOwn.index}`),
        move: (direction) => this.moveFromColumn(ctx, 'foe', i, direction),
      });
      drawIcon(ctx, p, box, set, 'right', i === this.shownFoe.index, focused, null, false);
    });

    const ownHero = own[this.shownOwn.index];
    const foeHero = theirs[this.shownFoe.index];
    if (ownHero) drawHero(ctx, p, ownHero, 'left', this.shownOwn.since, this.ownActive || standing);
    if (foeHero) drawHero(ctx, p, foeHero, 'right', this.shownFoe.since, !this.ownActive || standing);

    this.drawSlots(ctx, own);

    const ready = this.ready() && !standing;
    if (!ready) this.readySince = null;
    else if (this.readySince === null) this.readySince = ctx.now;
    if (this.nudgeAsked) {
      this.nudgeAsked = false;
      this.nudgeAt = ctx.now;
    }
    const focused = ctx.focus.control({ id: DONE_ID, ...DONE_BOX, accept: () => this.done(), move: (direction) => this.moveFromDone(ctx, direction) });
    this.drawDone(ctx, ready, standing, focused);
    if (sheet) {
      const label = { sheet: 'Sheet', accept: 'Accept open TS', waiting: 'Waiting' }[sheet.button];
      const held = sheet.button === 'accept' ? { progress: sheet.held, color: ACCEPT_FILL } : undefined;
      hint(ctx, 'select-sheet', SHEET_BOX, 'ZL', label, false, sheet.press, { fill: p.panel, border: p.outline }, held);
    }
    const status = standing ? 'Team sent' : ready ? `Ready! Confirm with ${ROLE_KEYS.previewDone.label}` : `${order.length}/${this.toBring()} chosen`;
    const nudge = (ctx.now - this.nudgeAt) / NUDGE_MS;
    const shake = nudge < 1 ? Math.sin(nudge * 6 * Math.PI) * 8 * (1 - nudge) : 0;
    write(ctx, status, CARD.left + shake, 640, { size: 18, bold: true }, nudge < 1 ? p.danger : ready || standing ? p.teal : p.ink, 'left', 290);
    write(ctx, this.hint(sheet?.button ?? null), CARD.left, 672, { size: 14 }, p.muted, 'left', 290);
    write(ctx, standing ? (this.store.canUndo() ? 'B change picks' : '') : 'B undo', CARD.left, 696, { size: 14 }, p.muted, 'left', 290);
  }

  /**
   * Done, with L's chip. Once all are picked it beats (a glow swelling out of it, the button growing a
   * little) until it's pressed, so it's clear the picks wait for it.
   */
  private drawDone(ctx: ScreenContext, ready: boolean, standing: boolean, focused: boolean): void {
    const { renderer } = ctx;
    const p = ctx.palette;
    let box = DONE_BOX;
    if (ready && this.readySince !== null) {
      const phase = ((ctx.now - this.readySince) % DONE_BEAT_MS) / DONE_BEAT_MS;
      const swell = easeOut(phase);
      const pad = 6 + 22 * swell;
      renderer.rect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, {
        fill: withAlpha(p.accent, 0.55 * (1 - swell)),
        radius: 8 + pad,
        softness: 10,
        additive: true,
      });
      const grow = 1 + 0.05 * Math.max(0, Math.sin(phase * 2 * Math.PI));
      const w = box.w * grow;
      const h = box.h * grow;
      box = { x: box.x - (w - box.w) / 2, y: box.y - (h - box.h) / 2, w, h };
    }
    renderer.rect(box.x, box.y, box.w, box.h, { fill: ready ? p.accent : p.disabledFill, stroke: focused ? p.accentText : ready ? p.accent : p.disabledBorder, radius: box.h / 2, border: focused ? 3 : 1 });
    const cy = box.y + box.h / 2;
    if (standing) {
      write(ctx, 'Sent', box.x + box.w / 2, cy, { size: 22, bold: true }, p.disabledInk, 'center');
    } else {
      const ink = ready ? INK.white : p.disabledInk;
      keyChip(ctx, ROLE_KEYS.previewDone.label, box.x + 16, cy, 28, ready ? withAlpha(INK.white, 0.25) : p.rim, ink);
      write(ctx, 'Done', box.x + 52 + (box.w - 52) / 2 - 6, cy, { size: 22, bold: true }, ink, 'center');
    }
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

  /** The four slots along the foot: Lead, Lead, Back, Back (as many leads as the format sends out). */
  private drawSlots(ctx: ScreenContext, own: readonly HeroSet[]): void {
    const { renderer } = ctx;
    const p = ctx.palette;
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
        drawSprite(ctx, picked.sprite, x + w / 2 - size / 2, y + 74 - size, size, true, 1);
      } else {
        write(ctx, '?', x + w / 2, y + 40, { size: 28, bold: true }, p.rim, 'center');
      }
    }
  }

  private hint(sheet: SheetButton | null): string {
    if (this.standingBy()) return sheet === 'sheet' ? 'ZL their full team sheet' : '';
    if (sheet === 'sheet') return 'A pick · L done · ZL their sheet';
    if (sheet === 'accept') return 'A pick · L done · hold ZL: accept open TS';
    if (sheet === 'waiting') return 'A pick · L done · waiting on sheets';
    return 'A pick · ◀▶ sides · L done';
  }
}
