import { computed, inject, signal } from '@angular/core';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { Rgba, Texture, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { drawKeyButton, drawNamePlate, drawPlatformTrainer, menuFocus, menuModal, menuPanel } from '@core/gl/ui/menu-kit';
import { UiContext, label, pill } from '@core/gl/ui/retro-kit';
import { ROLE_KEYS } from '@core/input/console-keys';
import { ShowdownFormats } from '@features/connection/showdown-formats';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { HOME_MENU_ITEMS } from '@features/home/state/home-menu';
import { AVATAR_ALIASES } from '@features/trainer-card/data/avatar-aliases';
import { AVATAR_CHOICES } from '@features/trainer-card/data/avatar-choices';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { LadderRating, LadderRatings } from '@features/trainer-card/state/ladder-ratings';
import { PlayerDetails } from '@features/trainer-card/state/player-details';
import { RECENT_COUNT, RecentResults } from '@features/trainer-card/state/recent-results';
import { toId } from '@shared/utils/to-id';

/** Ladder rows the card has room for: the best ones. */
const SHOWN_RATINGS = 4;
/** The avatar picker's grid: 10x4 tiles of 92px, 6px apart. */
const COLUMNS = 10;
const ROWS = 4;
const PER_PAGE = COLUMNS * ROWS;
const TILE = 92;
const GAP = 6;
const PAGE_COUNT = Math.ceil(AVATAR_CHOICES.length / PER_PAGE);
/** Random avatar presses closer together than this are ignored. */
const RANDOM_COOLDOWN_MS = 500;
/** Ratings from here up are amber; the bars go from 1000 to 2000. */
const HIGH_RATING = 1500;
/** The results' fixed colours, the same in every theme (white on them passes AA). */
const WON: Rgba = rgba('#1e7b3c');
const LOST: Rgba = rgba('#b3261e');
const WHITE: Rgba = [1, 1, 1, 1];

/** Our own card, beside the menu's trainer (who stays where the menu has them). */
const PANEL = { x: 500, y: 92, w: 732, h: 548 };
/** Someone else's card: a licence over the page. */
const LICENCE = { x: 80, y: 84, w: 1120, h: 552 };
const PICKER = { x: 96, y: 96, w: 1088, h: 592 };

export const CARD_CLOSE_ID = 'card-close';
export const CARD_AVATAR_ID = 'card-avatar';
export const CARD_HISTORY_ID = 'card-history';
export const CARD_RANDOM_ID = 'card-random';

/**
 * A Trainer Card: the player's own, or someone else's (a challenger's, by name: their avatar from the
 * server, and no picker). Both show the totals across every ladder (battles, wins and losses, win
 * rate) as three big numbers, the latest results as W/L tiles (from their public replays), and the
 * best ladder ratings as rows with a bar. Our own is drawn beside the menu's trainer, who stays where
 * the menu has them (A on them opens the avatar picker), with Random avatar (ROLE_KEYS.randomAvatar,
 * or its button), Battle history (ROLE_KEYS.cardHistory, or its button) and Close; someone else's is a licence over the page, their avatar framed. B or Close
 * closes it (L too, from the menu). The picker shows Showdown's avatars 10x4 a page: the d-pad turns
 * the page past its top or bottom row, L/R turn pages too, A picks, B goes back to the card.
 */
export class TrainerCardView {
  private readonly login = inject(ShowdownLogin);
  private readonly formats = inject(ShowdownFormats);
  private readonly ladder = inject(LadderRatings);
  private readonly recent = inject(RecentResults);
  private readonly playerDetails = inject(PlayerDetails);

  /** The avatar picker is shown over the card. */
  readonly picking = signal(false);
  private readonly page = signal(0);

  constructor(private readonly focus: CanvasFocus) {}

  /** Whose card: someone else's by name, or the player's own (null). */
  private readonly player = signal<string | null>(null);
  private readonly userId = computed(() => toId(this.player() ?? '') || this.login.userId());
  private readonly isSelf = computed(() => this.userId() === this.login.userId());
  /** The details loaded for someone else (none while another player's are still there). */
  private readonly others = computed(() => {
    const state = this.playerDetails.state();
    return state.userId === this.userId() ? state : null;
  });
  private readonly name = computed(() => (this.isSelf() ? this.login.state().name : this.others()?.name || (this.player() ?? '')));
  /** The avatar to show; empty while someone else's isn't known yet. */
  private readonly avatar = computed(() => {
    if (this.isSelf()) return this.login.state().avatar;
    const others = this.others();
    return others?.status === 'loaded' ? others.avatar : '';
  });

  private readonly ratings = computed(() => {
    const state = this.ladder.state();
    return state.userId === this.userId() ? state.ratings : [];
  });

  /** The three big numbers: battles, wins – losses and win rate ("…" while the ratings load). */
  private readonly totals = computed(() => {
    const ratings = this.ratings();
    const pending = this.ladder.state().status === 'loading' && ratings.length === 0 ? '…' : null;
    const wins = sum(ratings, (r) => r.wins);
    const losses = sum(ratings, (r) => r.losses);
    const ties = sum(ratings, (r) => r.ties);
    return [
      { label: 'BATTLES', value: pending ?? String(wins + losses + ties) },
      { label: 'WINS – LOSSES', value: pending ?? `${wins}–${losses}` },
      { label: 'WIN RATE', value: pending ?? (wins + losses === 0 ? '—' : `${Math.round((wins / (wins + losses)) * 100)}%`) },
    ];
  });

  private readonly results = computed(() => {
    const state = this.recent.state();
    return state.userId === this.userId() ? state : null;
  });

  private readonly current = computed(() => AVATAR_ALIASES[this.login.state().avatar] ?? this.login.state().avatar);

  /** Showing someone's card (our own: null): their ratings, results (and details) loaded again. */
  open(player: string | null = null, focusId = CARD_CLOSE_ID): void {
    this.player.set(player);
    this.picking.set(false);
    this.ladder.load(this.userId());
    this.recent.load(this.userId());
    if (!this.isSelf()) this.playerDetails.load(player ?? this.userId());
    this.focus.focus(focusId);
  }

  /** L/R while picking: a page back or forward (the press is used at either end too). */
  turn(by: 1 | -1, slot: number | null = null): boolean {
    const page = this.page() + by;
    if (page < 0 || page >= PAGE_COUNT) return true;
    const focused = this.focus.focused?.startsWith('avatar-') ? Number(this.focus.focused.slice(7)) : 0;
    this.page.set(page);
    const count = Math.min(PER_PAGE, AVATAR_CHOICES.length - page * PER_PAGE);
    this.focus.focus(`avatar-${Math.min(slot ?? focused, count - 1)}`);
    return true;
  }

  /** B while picking: back to the card, on its avatar. */
  stopPicking(): void {
    this.picking.set(false);
    this.focus.focus(CARD_AVATAR_ID);
  }

  /**
   * Y or a Random avatar button (our own card only): a random avatar, and in the picker its page,
   * with it focused. Presses closer than RANDOM_COOLDOWN_MS are used but ignored, so holding or
   * mashing Y doesn't flood the server with /avatar.
   */
  randomize(): boolean {
    if (!this.isSelf()) return false;
    const now = performance.now();
    if (now - this.lastRandom < RANDOM_COOLDOWN_MS) return true;
    this.lastRandom = now;
    this.login.randomizeAvatar();
    if (this.picking()) this.startPicking();
    return true;
  }

  private lastRandom = -Infinity;

  private startPicking(): void {
    this.picking.set(true);
    const index = AVATAR_CHOICES.indexOf(this.current());
    this.page.set(Math.max(0, Math.floor(index / PER_PAGE)));
    this.focus.focus(`avatar-${index === -1 ? 0 : index % PER_PAGE}`);
  }

  /**
   * Draws the card: our own beside the menu's trainer (the menu has drawn the lit side; `ball` is its
   * placeholder for a trainer not loaded yet), someone else's as a licence over the page. `history`
   * opens the battle history (our own card's, when the page gives it).
   */
  draw(ctx: UiContext, close: () => void, history?: () => void, ball: Texture | null = null): void {
    if (this.isSelf() && history) this.drawOwn(ctx, close, history, ball);
    else this.drawLicence(ctx, close);
    if (this.picking()) this.drawPicker(ctx);
  }

  /** Our own: the trainer on the menu's platform (A: the picker), the name plate, the card on the right. */
  private drawOwn(ctx: UiContext, close: () => void, history: () => void, ball: Texture | null): void {
    const p = ctx.palette;
    const avatar = this.avatar() ? ctx.images.pixelArt(avatarUrl(this.avatar())) : null;
    const focused = ctx.focus.control({ id: CARD_AVATAR_ID, x: 80, y: 132, w: 320, h: 380, accept: () => this.startPicking() });
    drawPlatformTrainer(ctx, { avatar, ball, f: focused ? 1 : 0, arrive: 1, time: ctx.now / 1000 });
    if (focused) label(ctx, 'A · CHANGE AVATAR', 240, 104, { size: 14, bold: true }, p.accentText, { align: 'center' });
    const best = this.ratings()[0];
    drawNamePlate(ctx, { name: this.name(), status: '● Online', chips: [...(best ? [{ text: `★ ${best.elo}`, tone: 'muted' as const }] : []), { text: 'Registered', tone: 'muted' }] }, 1);
    drawKeyButton(ctx, CARD_RANDOM_ID, { x: 48, y: 650, w: 236, h: 44 }, ROLE_KEYS.randomAvatar.label, 'Random avatar', () => this.randomize(), false);

    drawKeyButton(ctx, CARD_CLOSE_ID, { x: 1104, y: 26, w: 128, h: 44 }, 'B', 'Close', close, false);
    const plate = HOME_MENU_ITEMS.find((item) => item.id === 'random')?.plate[p.appearance];
    menuPanel(ctx, PANEL, plate ? rgba(plate) : undefined);
    label(ctx, 'TRAINER CARD', PANEL.x + 28, PANEL.y + 40, { size: 30, bold: true }, p.ink);
    drawKeyButton(ctx, CARD_HISTORY_ID, { x: PANEL.x + PANEL.w - 244, y: PANEL.y + 18, w: 220, h: 44 }, ROLE_KEYS.cardHistory.label, 'Battle history', history, false);
    this.drawStats(ctx, PANEL.x + 28, PANEL.y + 74, PANEL.w - 56);
    this.drawResults(ctx, PANEL.x + 28, PANEL.y + 204);
    this.drawLadder(ctx, PANEL.x + 20, PANEL.y + 252, PANEL.w - 40);
    this.drawLegend(ctx, [['A', focused ? 'Change avatar' : 'Select'], [ROLE_KEYS.randomAvatar.label, 'Random'], [ROLE_KEYS.cardHistory.label, 'Battle history'], ['B', 'Close']]);
  }

  /** Someone else's: a licence over the dimmed page, their avatar framed, the numbers beside it. */
  private drawLicence(ctx: UiContext, close: () => void): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const box = LICENCE;
    menuModal(ctx, box, undefined, 0.6);
    // The band along the top, in the accent: TRAINER CARD, and their best rating.
    renderer.rect(box.x, box.y, box.w, 64, { fill: p.accent, radius: 22 });
    renderer.rect(box.x, box.y + 40, box.w, 24, { fill: p.accent });
    label(ctx, 'TRAINER CARD', box.x + 32, box.y + 32, { size: 24, bold: true }, WHITE);
    const best = this.ratings()[0];
    const right = box.x + box.w - 180;
    if (best) label(ctx, `★ ${best.elo} · ${shortName(this.formats.name(best.formatId))}`, right, box.y + 32, { size: 17, bold: true }, WHITE, { align: 'right', maxWidth: 480 });
    drawKeyButton(ctx, CARD_CLOSE_ID, { x: box.x + box.w - 160, y: box.y + 10, w: 140, h: 44 }, 'B', 'Close', close, false);

    // The avatar, framed, lit from above; the name under it.
    const frame = { x: box.x + 32, y: box.y + 92, w: 300, h: 300 };
    renderer.rect(frame.x, frame.y, frame.w, frame.h, { fill: p.hero, fillEnd: p.select, radius: 22 });
    renderer.rect(frame.x, frame.y + frame.h * 0.7, frame.w, frame.h * 0.3, { fill: withAlpha(p.rim, 0.8), radius: 22 });
    const avatar = this.avatar() ? ctx.images.pixelArt(avatarUrl(this.avatar())) : null;
    if (avatar) renderer.rect(frame.x, frame.y, frame.w, frame.h, { fill: WHITE, texture: avatar });
    label(ctx, this.name(), frame.x, frame.y + frame.h + 36, { size: 30, bold: true }, p.ink, { maxWidth: frame.w });

    const x = box.x + 364;
    this.drawStats(ctx, x, box.y + 92, box.w - 364 - 32);
    this.drawResults(ctx, x, box.y + 222);
    this.drawLadder(ctx, x - 8, box.y + 266, box.w - 364 - 24);
    this.drawLegend(ctx, [['B', 'Close']]);
  }

  /** The three big numbers in tiles, `width` across. */
  private drawStats(ctx: UiContext, x: number, y: number, width: number): void {
    const p = ctx.palette;
    const gap = 12;
    const w = (width - gap * 2) / 3;
    this.totals().forEach((total, i) => {
      const tx = x + i * (w + gap);
      ctx.renderer.rect(tx, y, w, 96, { fill: p.panel, stroke: p.rim, border: 1, radius: 16 });
      label(ctx, total.value, tx + 18, y + 38, { size: 32, bold: true }, p.ink, { maxWidth: w - 36 });
      label(ctx, total.label, tx + 18, y + 74, { size: 13, bold: true }, p.muted);
    });
  }

  /** The latest results as W/L tiles, the newest first. */
  private drawResults(ctx: UiContext, x: number, cy: number): void {
    const p = ctx.palette;
    let left = x + label(ctx, `LAST ${RECENT_COUNT}`, x, cy, { size: 13, bold: true }, p.muted) + 14;
    const state = this.results();
    if (!state || (state.status === 'loading' && state.results.length === 0)) {
      label(ctx, 'Loading…', left, cy, { size: 15 }, p.muted);
      return;
    }
    if (state.results.length === 0) {
      label(ctx, state.status === 'error' ? "Couldn't load the replays." : 'No saved battles yet.', left, cy, { size: 15 }, p.muted);
      return;
    }
    for (const result of state.results) {
      const fill = result === 'W' ? WON : result === 'L' ? LOST : p.rim;
      ctx.renderer.rect(left, cy - 15, 30, 30, { fill, radius: 8 });
      label(ctx, result, left + 15, cy, { size: 14, bold: true }, result === 'W' || result === 'L' ? WHITE : p.ink, { align: 'center' });
      left += 36;
    }
  }

  /** The best ladder ratings as rows: the format, the rating with a bar (1000 to 2000, amber from 1500), GXE and W–L. */
  private drawLadder(ctx: UiContext, x: number, y: number, width: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const ratings = this.ratings();
    label(ctx, ratings.length > SHOWN_RATINGS ? `LADDER · BEST ${SHOWN_RATINGS} OF ${ratings.length}` : 'LADDER', x + 8, y + 10, { size: 13, bold: true }, p.muted);
    if (ratings.length === 0) {
      const status = this.ladder.state().status;
      const message = status === 'error' ? "Couldn't load the ratings from Showdown." : status === 'loaded' ? 'No ladder battles yet.' : 'Loading ratings…';
      label(ctx, message, x + 8, y + 50, { size: 18 }, status === 'error' ? p.danger : p.muted);
      return;
    }
    ratings.slice(0, SHOWN_RATINGS).forEach((rating, i) => {
      const ry = y + 26 + i * 64;
      renderer.rect(x, ry, width, 56, { fill: i === 0 ? p.select : p.panel, stroke: p.rim, border: 1, radius: 14 });
      const cy = ry + 28;
      const right = x + width - 18;
      label(ctx, `${rating.wins}–${rating.losses}`, right, cy, { size: 15 }, p.muted, { align: 'right' });
      label(ctx, `${rating.gxe.toFixed(1)}%`, right - 90, cy, { size: 15 }, p.muted, { align: 'right' });
      const barRight = right - 180;
      const barW = 130;
      const barX = barRight - barW;
      renderer.rect(barX, cy - 4, barW, 8, { fill: p.rim, radius: 4 });
      const fill = Math.max(0.04, Math.min(1, (rating.elo - 1000) / 1000));
      renderer.rect(barX, cy - 4, barW * fill, 8, { fill: rating.elo >= HIGH_RATING ? p.teal : p.accent, radius: 4 });
      label(ctx, String(rating.elo), barX - 12, cy, { size: 19, bold: true }, p.ink, { align: 'right' });
      label(ctx, shortName(this.formats.name(rating.formatId)), x + 18, cy, { size: 17, bold: true }, p.ink, { maxWidth: barX - 80 - x - 18 });
    });
  }

  /** The buttons along the bottom, right-aligned. */
  private drawLegend(ctx: UiContext, keys: readonly (readonly [string, string])[]): void {
    const p = ctx.palette;
    const cy = 684;
    let x = 1232;
    for (const [key, text] of [...keys].reverse()) {
      x -= ctx.text.measure(text, { size: 18 });
      label(ctx, text, x, cy, { size: 18 }, p.ink);
      x -= 8 + Math.max(36, ctx.text.measure(key, { size: 14, bold: true }) + 14);
      pill(ctx, key, x, cy, 28);
      x -= 24;
    }
  }

  /** The avatars, a page at a time, over the card. */
  private drawPicker(ctx: UiContext): void {
    const p = ctx.palette;
    const box = PICKER;
    menuModal(ctx, box, undefined, 0.6);
    const x = box.x + 32;
    label(ctx, 'Choose an avatar', x, box.y + 40, { size: 32, bold: true }, p.ink);
    drawKeyButton(ctx, 'picker-random', { x: box.x + box.w - 408, y: box.y + 18, w: 236, h: 44 }, ROLE_KEYS.randomAvatar.label, 'Random avatar', () => this.randomize());
    drawKeyButton(ctx, 'picker-back', { x: box.x + box.w - 160, y: box.y + 18, w: 136, h: 44 }, 'B', 'Back', () => this.stopPicking());

    const page = this.page();
    const first = page * PER_PAGE;
    const avatars = AVATAR_CHOICES.slice(first, first + PER_PAGE);
    // The pages either side, downloaded ahead (a page is 40 sprites).
    for (const near of [page - 1, page + 1]) {
      for (const avatar of AVATAR_CHOICES.slice(Math.max(0, near) * PER_PAGE, Math.max(0, near) * PER_PAGE + PER_PAGE)) ctx.images.prefetch(avatarUrl(avatar));
    }
    const gridW = COLUMNS * TILE + (COLUMNS - 1) * GAP;
    const left = box.x + (box.w - gridW) / 2;
    avatars.forEach((avatar, index) => {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const tile = { x: left + column * (TILE + GAP), y: box.y + 84 + row * (TILE + GAP), w: TILE, h: TILE };
      const current = avatar === this.current();
      const focused = ctx.focus.control({
        id: `avatar-${index}`,
        ...tile,
        accept: () => {
          this.login.setAvatar(avatar);
          this.stopPicking();
        },
        // Up past the top row or down past the bottom one turns the page, keeping the column.
        move: (direction) => {
          if (direction === 'up' && row === 0 && page > 0) return this.turn(-1, (ROWS - 1) * COLUMNS + column);
          if (direction === 'down' && row === ROWS - 1 && page < PAGE_COUNT - 1) return this.turn(1, column);
          return false;
        },
      });
      ctx.renderer.rect(tile.x, tile.y, tile.w, tile.h, { fill: current || focused ? p.select : mixRgba(p.panel, p.rim, 0.4), stroke: current ? p.accentText : p.rim, radius: 14, border: current ? 3 : 1 });
      const sprite = ctx.images.pixelArt(avatarUrl(avatar));
      if (sprite) ctx.renderer.rect(tile.x + 6, tile.y + 6, 80, 80, { fill: WHITE, texture: sprite });
      if (focused) menuFocus(ctx, tile, 14);
    });
    const cy = box.y + box.h - 30;
    const width = pill(ctx, 'L', x, cy);
    label(ctx, `/ R turn pages · Page ${page + 1} of ${PAGE_COUNT} · A choose · ${ROLE_KEYS.randomAvatar.label} random · B back to the card`, x + width + 8, cy, { size: 18 }, p.muted, { fast: true });
  }
}

/** "VGC 2026 Reg M-C": a format's name without its "[Gen 9 Champions]" prefix, so it fits. */
function shortName(name: string): string {
  return name.replace(/^\[[^\]]*\]\s*/, '') || name;
}

function sum(ratings: readonly LadderRating[], value: (rating: LadderRating) => number): number {
  return ratings.reduce((total, rating) => total + value(rating), 0);
}
