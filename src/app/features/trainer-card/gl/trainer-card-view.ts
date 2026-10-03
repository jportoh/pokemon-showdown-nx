import { computed, inject, signal } from '@angular/core';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { UiContext, button, focusRing, label, pill, retroBox } from '@core/gl/ui/retro-kit';
import { ShowdownFormats } from '@features/connection/showdown-formats';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { AVATAR_ALIASES } from '@features/trainer-card/data/avatar-aliases';
import { AVATAR_CHOICES } from '@features/trainer-card/data/avatar-choices';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { LadderRating, LadderRatings } from '@features/trainer-card/state/ladder-ratings';
import { PlayerDetails } from '@features/trainer-card/state/player-details';
import { toId } from '@shared/utils/to-id';
import { BOX, INNER_X, INNER_Y } from '@features/home/gl/login-view';

/** Ladder rows the card has room for: the best ones. */
const SHOWN_RATINGS = 4;
/** The avatar picker's grid: 10x4 tiles of 92px, 6px apart. */
const COLUMNS = 10;
const ROWS = 4;
const PER_PAGE = COLUMNS * ROWS;
const TILE = 92;
const GAP = 6;
const PAGE_COUNT = Math.ceil(AVATAR_CHOICES.length / PER_PAGE);

export const CARD_CLOSE_ID = 'card-close';
export const CARD_AVATAR_ID = 'card-avatar';
export const CARD_HISTORY_ID = 'card-history';

/**
 * A Trainer Card, Gen 3 style: the player's own, or someone else's (a
 * challenger's, by name: their avatar from the server, and no picker). The avatar in a frame (our own:
 * A opens the avatar picker over the card), the name and totals across every ladder (battles, wins and
 * losses, win rate), and the best ladder ratings, loaded each time it's shown. Our own card has Battle history (the page that lists our battles, when the menu gives it). B or Close closes it
 * (L too, from the menu). The picker shows Showdown's avatars 10x4 a page: the d-pad turns the page
 * past its top or bottom row, L/R turn pages too, A picks, B goes back to the card.
 */
export class TrainerCardView {
  private readonly login = inject(ShowdownLogin);
  private readonly formats = inject(ShowdownFormats);
  private readonly ladder = inject(LadderRatings);
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

  private readonly details = computed(() => {
    const ratings = this.ratings();
    const pending = this.ladder.state().status === 'loading' && ratings.length === 0 ? '…' : null;
    const wins = sum(ratings, (r) => r.wins);
    const losses = sum(ratings, (r) => r.losses);
    const ties = sum(ratings, (r) => r.ties);
    return [
      { label: 'Name', value: this.name() },
      { label: 'Battles', value: pending ?? String(wins + losses + ties) },
      { label: 'Wins – Losses', value: pending ?? `${wins} – ${losses}` },
      { label: 'Win rate', value: pending ?? (wins + losses === 0 ? '—' : `${Math.round((wins / (wins + losses)) * 100)}%`) },
    ];
  });

  private readonly current = computed(() => AVATAR_ALIASES[this.login.state().avatar] ?? this.login.state().avatar);

  /** Showing someone's card (our own: null): their ratings (and details) loaded again, Close focused. */
  open(player: string | null = null, focusId = CARD_CLOSE_ID): void {
    this.player.set(player);
    this.picking.set(false);
    this.ladder.load(this.userId());
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

  /** `history` opens the battle history (a button on our own card when given). */
  draw(ctx: UiContext, close: () => void, history?: () => void): void {
    if (this.picking()) this.drawPicker(ctx);
    else this.drawCard(ctx, close, history);
  }

  private drawCard(ctx: UiContext, close: () => void, history?: () => void): void {
    const p = ctx.palette;
    const x = INNER_X + 48;
    retroBox(ctx, BOX);
    label(ctx, 'Trainer Card', x, INNER_Y + 52, { size: 40, bold: true }, p.ink);
    button(ctx, CARD_CLOSE_ID, { x: INNER_X + 876, y: INNER_Y + 28, w: 158, h: 48 }, 'Close', { shortcut: 'B', size: 20, accept: close });
    if (history && this.isSelf()) button(ctx, CARD_HISTORY_ID, { x: INNER_X + 646, y: INNER_Y + 28, w: 214, h: 48 }, 'Battle history', { size: 20, accept: history });
    ctx.renderer.rect(x, INNER_Y + 92, 986, 3, { fill: p.outline });

    this.details().forEach((row, i) => {
      const y = INNER_Y + 124 + i * 52;
      label(ctx, row.label, x, y + 16, { size: 20 }, p.muted);
      label(ctx, row.value, INNER_X + 308, y + 16, { size: 24, bold: true }, p.ink, { maxWidth: 480 });
      ctx.renderer.rect(x, y + 36, 740, 2, { fill: p.select });
    });

    // The avatar, twice its 80px, in a frame that's the button to change it (on our own card).
    const frame = { x: INNER_X + 826, y: INNER_Y + 112, w: 208, h: 208 };
    const self = this.isSelf();
    const focused = self && ctx.focus.control({
      id: CARD_AVATAR_ID,
      ...frame,
      accept: () => {
        this.picking.set(true);
        const index = AVATAR_CHOICES.indexOf(this.current());
        this.page.set(Math.max(0, Math.floor(index / PER_PAGE)));
        this.focus.focus(`avatar-${index === -1 ? 0 : index % PER_PAGE}`);
      },
    });
    ctx.renderer.rect(frame.x, frame.y, frame.w, frame.h, { fill: focused ? p.select : p.bg, stroke: p.outline, radius: 8, border: 4 });
    const avatar = this.avatar() ? ctx.images.pixelArt(avatarUrl(this.avatar())) : null;
    if (avatar) ctx.renderer.rect(frame.x + 24, frame.y + (self ? 8 : 24), 160, 160, { fill: [1, 1, 1, 1], texture: avatar });
    if (self) {
      ctx.renderer.rect(frame.x + 12, frame.y + 172, 184, 28, { fill: p.select, radius: 3 });
      label(ctx, 'Change avatar', frame.x + 104, frame.y + 186, { size: 18, bold: true }, p.ink, { align: 'center' });
    }
    if (focused) focusRing(ctx, frame, 8);

    ctx.renderer.rect(x, INNER_Y + 336, 986, 3, { fill: p.outline });
    const ratings = this.ratings();
    const title = ratings.length > SHOWN_RATINGS ? `Ladder · best ${SHOWN_RATINGS} of ${ratings.length}` : 'Ladder';
    label(ctx, title, x, INNER_Y + 366, { size: 20, bold: true }, p.ink);
    if (ratings.length > 0) {
      label(ctx, 'Elo', INNER_X + 580, INNER_Y + 366, { size: 18 }, p.muted);
      label(ctx, 'GXE', INNER_X + 720, INNER_Y + 366, { size: 18 }, p.muted);
      label(ctx, 'W – L', INNER_X + 860, INNER_Y + 366, { size: 18 }, p.muted);
      ratings.slice(0, SHOWN_RATINGS).forEach((rating, i) => {
        const y = INNER_Y + 410 + i * 40;
        label(ctx, this.formats.name(rating.formatId), x, y, { size: 20 }, p.ink, { maxWidth: 516 });
        label(ctx, String(rating.elo), INNER_X + 580, y, { size: 20, bold: true }, p.ink);
        label(ctx, `${rating.gxe.toFixed(1)}%`, INNER_X + 720, y, { size: 20 }, p.ink);
        label(ctx, `${rating.wins} – ${rating.losses}`, INNER_X + 860, y, { size: 20 }, p.ink);
      });
    } else {
      const status = this.ladder.state().status;
      const error = status === 'error';
      const message = error ? "Couldn't load the ratings from Showdown." : status === 'loaded' ? 'No ladder battles yet.' : 'Loading ratings…';
      label(ctx, message, x, INNER_Y + 410, { size: 20 }, error ? p.danger : p.muted);
    }
  }

  private drawPicker(ctx: UiContext): void {
    const p = ctx.palette;
    const x = INNER_X + 48;
    retroBox(ctx, BOX);
    label(ctx, 'Choose an avatar', x, INNER_Y + 52, { size: 40, bold: true }, p.ink);
    button(ctx, 'picker-back', { x: INNER_X + 876, y: INNER_Y + 28, w: 158, h: 48 }, 'Back', { shortcut: 'B', size: 20, accept: () => this.stopPicking() });

    const page = this.page();
    const first = page * PER_PAGE;
    const avatars = AVATAR_CHOICES.slice(first, first + PER_PAGE);
    // The pages either side, downloaded ahead (a page is 40 sprites).
    for (const near of [page - 1, page + 1]) {
      for (const avatar of AVATAR_CHOICES.slice(Math.max(0, near) * PER_PAGE, Math.max(0, near) * PER_PAGE + PER_PAGE)) ctx.images.prefetch(avatarUrl(avatar));
    }
    avatars.forEach((avatar, index) => {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const box = { x: INNER_X + 54 + column * (TILE + GAP), y: INNER_Y + 104 + row * (TILE + GAP), w: TILE, h: TILE };
      const current = avatar === this.current();
      const focused = ctx.focus.control({
        id: `avatar-${index}`,
        ...box,
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
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: current || focused ? p.select : p.bg, stroke: current ? p.accentText : p.outline, radius: 6, border: 2 });
      const sprite = ctx.images.pixelArt(avatarUrl(avatar));
      if (sprite) ctx.renderer.rect(box.x + 6, box.y + 6, 80, 80, { fill: [1, 1, 1, 1], texture: sprite });
      if (focused) focusRing(ctx, box);
    });
    const width = pill(ctx, 'L', x, INNER_Y + 522);
    label(ctx, `/ R turn pages · Page ${page + 1} of ${PAGE_COUNT} · A choose · B back to the card`, x + width + 8, INNER_Y + 522, { size: 20 }, p.muted, { fast: true });
  }
}

function sum(ratings: readonly LadderRating[], value: (rating: LadderRating) => number): number {
  return ratings.reduce((total, rating) => total + value(rating), 0);
}
