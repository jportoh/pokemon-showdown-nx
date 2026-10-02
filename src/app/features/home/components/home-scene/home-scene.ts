import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Rgba, Texture, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { TextStyle, iconTexture, maskTexture, pixelTexture } from '@core/gl/gl-textures';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { GlTheme, Palette } from '@core/gl/ui/gl-theme';
import { HOLD_FILL, HoldAction } from '@core/gl/ui/hold-action';
import { PageBar } from '@core/gl/ui/page-bar';
import { UiContext, label, pill } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ServerStats } from '@features/connection/server-stats';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { BALL } from '@features/home/gl/logo-ball';
import { LoginView, RegisterView } from '@features/home/gl/login-view';
import { TrainerCardView } from '@features/trainer-card/gl/trainer-card-view';
import { HOME_MENU_ITEMS, HomeMenu, HomeMenuItem } from '@features/home/state/home-menu';
import { HomeSummary } from '@features/home/state/home-summary';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { PixelIconName } from '@core/gl/ui/pixel-icons';
import { RANDOM_BATTLE_FORMAT } from '@shared/data/formats';
import { groupDigits } from '@shared/utils/group-digits';

/** Tiles slide in one after another on arrival, and the chosen one zooms out on leaving. */
const INTRO_MS = 450;
const LEAVE_MS = 260;
const TEAM_SLOTS = 6;
/** An icon plate's tint while its page needs a connection we don't have. */
const FADED_PLATE = rgba('#232a31');
const LOGO_YELLOW = rgba('#f2c14e');
/** The ▶ cursor: 4x7 pixels. */
const CURSOR_ROWS = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];

/** A tile's box on the stage (layout A: two big, four small). */
interface TileBox {
  item: HomeMenuItem;
  x: number;
  y: number;
  w: number;
  h: number;
  big: boolean;
}

const TILES: readonly TileBox[] = HOME_MENU_ITEMS.map((item, i) =>
  i < 2 ? { item, x: 48 + i * 600, y: 100, w: 584, h: 244, big: true } : { item, x: 48 + (i - 2) * 300, y: 360, w: 284, h: 236, big: false },
);

type LineTone = 'muted' | 'faded' | 'alert' | 'error';
interface MenuLine {
  text: string;
  tone: LineTone;
}

/**
 * The home screen, drawn on the stage: a bar with Showdown's logo and who we are (the connection, and
 * once named our name and avatar), the menu (Battle and Random Battle as two big tiles, the other
 * pages as four smaller ones, each with a live fact under its name, see HomeSummary), and a bar of the
 * controller's buttons with the players and battles on Showdown (or a challenge's notice). The tile
 * pointed at grows and glows, the ▶ glides to it, tiles slide in on arrival and the chosen one zooms
 * out on leaving; the backdrop drifts. ZR opens the login box (which also connects as a guest), or,
 * held down, disconnects or logs out; L opens the Trainer Card for a registered name (A on its
 * avatar picks another), or registering the player's own name. B closes whichever box is open. R3
 * opens the UI kit gallery (a developer's test page).
 */
@Component({
  selector: 'app-home-scene',
  template: '',
})
export class HomeScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly menu = inject(HomeMenu);
  private readonly login = inject(ShowdownLogin);
  private readonly search = inject(ShowdownSearch);
  private readonly summary = inject(HomeSummary);
  private readonly stats = inject(ServerStats);
  private readonly challenges = inject(ShowdownChallenges);
  private readonly bar = inject(PageBar);

  private readonly focus = new CanvasFocus();
  private readonly loginView = new LoginView(this.focus);
  private readonly registerView = new RegisterView(this.focus);
  private readonly cardView = new TrainerCardView(this.focus);

  private readonly loginOpen = signal(false);
  /** L's box is open: the Trainer Card, or registering the name (whichever the name allows). */
  private readonly lBoxOpen = signal(false);
  /** Disconnect (or Log out), filling while ZR is held. */
  private readonly disconnectHold = new HoldAction(inject(KeyboardNavigation), 'buttonZR');

  /** Nothing asked for yet, or a login that lost its name while its box is closed. */
  private readonly offline = computed(() => {
    const status = this.login.state().status;
    return status === 'offline' || (status === 'ready' && !this.loginOpen());
  });
  private readonly canShowCard = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && login.registered && !this.loginOpen();
  });
  private readonly canRegister = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && login.ownName && !login.registered && !this.loginOpen();
  });
  private readonly named = computed(() => this.login.state().status === 'named' && !this.loginOpen());
  /** The box shown over the menu, if any. */
  private readonly box = computed((): 'login' | 'card' | 'register' | null => {
    if (this.loginOpen()) return 'login';
    if (this.lBoxOpen() && this.canShowCard()) return 'card';
    if (this.lBoxOpen() && this.canRegister()) return 'register';
    return null;
  });
  private shownBox: 'login' | 'card' | 'register' | null = null;

  private readonly zrLabel = computed(() => {
    if (this.offline()) return 'Log in';
    return this.login.state().ownName ? 'Log out' : 'Disconnect';
  });
  private readonly lLabel = computed(() => (this.canShowCard() ? 'Card' : this.canRegister() ? 'Register' : null));

  private readonly lines = computed((): Record<PixelIconName, MenuLine> => {
    const offline = this.offline();
    const fact = (text: string): MenuLine => ({ text, tone: 'muted' });
    const online = (text: string): MenuLine => (offline ? { text: 'Needs connection', tone: 'faded' } : fact(text));
    return {
      battle: { text: this.summary.battle(), tone: this.summary.challenger() ? 'alert' : 'muted' },
      random: { text: 'Gen 9 · Ladder', tone: offline ? 'faded' : 'muted' },
      teambuilder: fact(this.summary.teambuilder()),
      chats: online(this.summary.chats),
      live: online(this.summary.live()),
      settings: fact(this.summary.settingsLine()),
      replays: fact(''),
    };
  });

  private readonly randomStatus = computed((): MenuLine => {
    const error = this.search.error();
    if (this.search.searching()) return { text: 'Searching for an opponent… A to cancel', tone: 'alert' };
    if (error) return { text: error, tone: 'error' };
    if (this.offline()) return { text: 'Log in first (ZR)', tone: 'faded' };
    if (this.login.state().status === 'unavailable') return { text: 'No name on Showdown: log out and try again', tone: 'error' };
    if (this.login.state().status !== 'named') return { text: 'Connecting…', tone: 'muted' };
    return { text: 'Find an opponent now', tone: 'muted' };
  });

  private readonly footerRight = computed((): { text: string; notice: boolean } | null => {
    const incoming = this.challenges.incoming();
    if (incoming.length > 0) {
      const more = incoming.length > 1 ? ` (+${incoming.length - 1})` : '';
      return { text: `${incoming[0].from} wants to battle!${more} Answer in Battle.`, notice: true };
    }
    const counts = this.stats.counts();
    if (this.offline() || !counts) return null;
    return { text: `${groupDigits(counts.users)} online · ${groupDigits(counts.battles)} battles`, notice: false };
  });

  // Drawing state, outside Angular.
  private icons = new Map<string, Texture>();
  private ball: Texture | null = null;
  private cursorTexture: Texture | null = null;
  private start = performance.now();
  private readonly anims = TILES.map(() => ({ focus: 0 }));
  private cursor = { x: 0, y: 0, ready: false };
  private leaving: { index: number; at: number; then: () => void } | null = null;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.stage.whenReady(({ renderer }) => {
      for (const tile of TILES) {
        this.icons.set(tile.item.id, iconTexture(renderer, tile.item.id, false));
        this.icons.set(`${tile.item.id}-muted`, iconTexture(renderer, tile.item.id, true));
      }
      this.ball = pixelTexture(renderer, BALL);
      this.cursorTexture = maskTexture(renderer, CURSOR_ROWS);
    });
    // Back from a page: the focus on the tile that opened it.
    this.focus.focus(`tile-${this.menu.lastItem()}`);
    const release = [
      this.navigation.registerButton('buttonZR', () => this.pressZR()),
      this.navigation.registerButton('buttonL', () => (this.box() === 'card' && this.cardView.picking() ? this.cardView.turn(-1) : this.toggleLBox())),
      this.navigation.registerButton('buttonR', () => this.box() === 'card' && this.cardView.picking() && this.cardView.turn(1)),
      this.navigation.registerButton('buttonR3', () => (void this.router.navigateByUrl('/gl-kit'), true)),
      this.stats.watch(),
    ];
    inject(DestroyRef).onDestroy(() => {
      hide();
      release.forEach((fn) => fn());
      this.stage.whenReady(({ renderer }) => {
        for (const texture of [...this.icons.values(), this.ball, this.cursorTexture]) if (texture) renderer.deleteTexture(texture);
      });
    });
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    if (action === 'back') {
      const box = this.box();
      if (box === 'login') this.closeLogin();
      else if (box === 'card' && this.cardView.picking()) this.cardView.stopPicking();
      else if (box) this.closeLBox();
      return true;
    }
    return focusInput(this.focus, action) ?? false;
  }

  private open(item: HomeMenuItem): void {
    if (this.leaving) return;
    this.menu.lastItem.set(item.id);
    if (!item.path) {
      this.randomBattle();
      return;
    }
    const path = item.path;
    const index = TILES.findIndex((tile) => tile.item.id === item.id);
    this.leaving = {
      index,
      at: performance.now(),
      then: () => {
        void this.router.navigateByUrl(path);
      },
    };
  }

  /** A: searches the Gen 9 Random Battle ladder, or cancels the search; offline, the login box first. */
  private randomBattle(): void {
    if (this.search.searching()) this.search.cancel();
    else if (this.offline()) this.openLogin();
    else if (this.login.state().status === 'named') this.search.search(RANDOM_BATTLE_FORMAT);
  }

  private pressZR(): boolean {
    return this.openLogin() || this.disconnect();
  }

  private openLogin(): boolean {
    if (!this.offline()) return false;
    this.login.startLogin();
    this.loginOpen.set(true);
    return true;
  }

  /** Connected (not while the login box is open): starts filling ZR's button; held to the end, disconnects. */
  private disconnect(): boolean {
    if (!this.canDisconnect()) return false;
    this.disconnectHold.press();
    return true;
  }

  private canDisconnect(): boolean {
    return !this.offline() && !this.loginOpen() && !this.leaving;
  }

  /** Every frame: the Disconnect hold; disconnects on the frame it fills up. */
  private stepDisconnect(now: number): void {
    if (!this.disconnectHold.step(now, this.canDisconnect())) return;
    this.lBoxOpen.set(false);
    this.login.disconnect();
  }

  /** Connected with a name, or backed out (which disconnects one that has no name yet). */
  private closeLogin(): void {
    this.loginOpen.set(false);
    this.login.cancelLogin();
  }

  private toggleLBox(): boolean {
    if (this.box() === 'card' || this.box() === 'register') {
      this.closeLBox();
      return true;
    }
    if (!this.lLabel()) return false;
    this.lBoxOpen.set(true);
    return true;
  }

  private closeLBox(): void {
    this.lBoxOpen.set(false);
  }

  /** A box just opened or closed: its first control, or the menu's tile again. */
  private followBox(): void {
    const box = this.box();
    if (box === this.shownBox) return;
    this.shownBox = box;
    if (box === 'login') {
      this.loginView.reset();
      this.focus.focus(this.loginView.firstId);
    } else if (box === 'register') {
      this.registerView.reset();
      this.focus.focus(this.registerView.firstId);
    } else if (box === 'card') {
      this.cardView.open();
    } else {
      this.focus.focus(`tile-${this.menu.lastItem()}`);
    }
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now, dt } = frame;
    if (this.loginOpen() && this.loginView.finished()) this.closeLogin();
    this.followBox();
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    this.stepDisconnect(now);
    this.drawHeader(ctx);

    const box = this.box();
    if (box === 'login') this.loginView.draw(ctx);
    else if (box === 'register') this.registerView.draw(ctx);
    else if (box === 'card') this.cardView.draw(ctx, () => this.closeLBox());
    else {
      const ease = 1 - Math.exp(-dt * 14);
      const offline = this.offline();
      const focusedId = this.focus.focused;
      TILES.forEach((tile, i) => {
        const anim = this.anims[i];
        anim.focus += ((focusedId === `tile-${tile.item.id}` ? 1 : 0) - anim.focus) * ease;
        const intro = clamp01((now - this.start - i * 55) / INTRO_MS);
        const arrive = 1 - Math.pow(1 - intro, 3);
        let zoom = 0;
        let fade = arrive;
        if (this.leaving) {
          const t = clamp01((now - this.leaving.at) / LEAVE_MS);
          if (i === this.leaving.index) zoom = t * t;
          else fade *= 1 - t;
        }
        this.focus.control({ id: `tile-${tile.item.id}`, x: tile.x, y: tile.y, w: tile.w, h: tile.h, accept: () => this.open(tile.item) });
        this.drawTile(ctx, tile, anim.focus, (1 - arrive) * 40, fade, zoom, offline && tile.item.needsConnection, now / 1000);
      });
      this.drawCursor(ctx, ease, now / 1000);
      this.drawFooter(ctx);
    }

    if (this.leaving) {
      const t = clamp01((now - this.leaving.at) / LEAVE_MS);
      renderer.rect(0, 0, STAGE_W, 720, { fill: withAlpha(p.bg, t) });
      if (t >= 1) {
        const then = this.leaving.then;
        this.leaving = null;
        then();
      }
    }
    this.focus.end();
    renderer.end();
  }

  /** The bar: the logo (the menu icons' Poké Ball, POKÉMON SHOWDOWN!) and who we are. */
  private drawHeader(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(0, 0, STAGE_W, 76, { fill: p.bar });
    if (this.ball) renderer.image(this.ball, 24, 14, 2);
    const width = label(ctx, 'POKÉMON', 84, 38, { size: 32, bold: true }, [1, 1, 1, 1]);
    label(ctx, 'SHOWDOWN!', 84 + width + 10, 38, { size: 32, bold: true }, LOGO_YELLOW);

    const named = this.named();
    this.bar.drawStatus(ctx, named ? 1176 : 1256, 38);
    if (named) {
      renderer.rect(1192, 6, 64, 64, { fill: p.select, radius: 8 });
      const avatar = ctx.images.pixelArt(avatarUrl(this.login.state().avatar));
      if (avatar) renderer.rect(1192, 6, 64, 64, { fill: [1, 1, 1, 1], texture: avatar });
    }
  }

  private drawTile(ctx: UiContext, tile: TileBox, f: number, slide: number, fade: number, zoom: number, faded: boolean, time: number): void {
    if (fade <= 0.001) return;
    const p = ctx.palette;
    const { renderer } = ctx;
    const s = 1 + 0.03 * f + zoom * 0.25;
    const cx = tile.x + tile.w / 2;
    const cy = tile.y + tile.h / 2 + slide;
    const w = tile.w * s;
    const h = tile.h * s;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const alpha = fade * (1 - zoom);

    if (f > 0.01) renderer.rect(x - 18, y - 18, w + 36, h + 36, { fill: withAlpha(p.accentText, 0.35 * f * alpha), radius: 34, softness: 22 });
    renderer.rect(x, y, w, h, { fill: withAlpha(mixRgba(p.panel, p.select, f), alpha), stroke: withAlpha(mixRgba(p.outline, p.accentText, f), alpha), radius: 16 * s, border: 4 * s });

    const plateSize = (tile.big ? 132 : 108) * s;
    const plateX = x + (tile.big ? 44 : 88) * s;
    const plateY = y + (tile.big ? 28 : 22) * s;
    renderer.rect(plateX, plateY, plateSize, plateSize, { fill: withAlpha(faded ? FADED_PLATE : rgba(tile.item.plate), alpha), radius: 12 * s });
    const icon = this.icons.get(faded ? `${tile.item.id}-muted` : tile.item.id);
    const bob = Math.sin(time * 5) * 4 * f;
    if (icon) renderer.image(icon, plateX + 6 * s, plateY + 6 * s + bob, (tile.big ? 5 : 4) * s, [1, 1, 1, alpha]);

    const line = this.lines()[tile.item.id];
    const nameColor = withAlpha(faded ? p.muted : p.ink, alpha);
    if (tile.big) {
      this.scaled(ctx, tile.item.label, x + 204 * s, y + 68 * s, { size: 44, bold: true }, nameColor, s, 'left', 364);
      this.scaled(ctx, line.text, x + 206 * s, y + 118 * s, { size: 20 }, withAlpha(this.tone(p, line.tone), alpha), s, 'left', 362);
      if (tile.item.id === 'battle') {
        const team = this.summary.team();
        if (team) {
          for (let i = 0; i < TEAM_SLOTS; i++) {
            const sx = x + (204 + i * 60) * s;
            const sy = y + 144 * s;
            renderer.rect(sx, sy, 52 * s, 52 * s, { fill: withAlpha(p.rim, alpha), radius: 8 * s });
            const sprite = ctx.images.sprite(team.sprites[i] ?? '', false, ImagePriority.Screen);
            if (sprite) renderer.rect(sx + 2 * s, sy + 2 * s, 48 * s, 48 * s, { fill: [1, 1, 1, alpha], texture: sprite });
          }
          this.scaled(ctx, team.name, x + 206 * s, y + 216 * s, { size: 16 }, withAlpha(p.muted, alpha), s, 'left', 362);
        }
        if (this.summary.challenger()) {
          const pulse = 0.85 + 0.15 * Math.sin(time * 6);
          renderer.rect(x + 418 * s, y + 16 * s, 150 * s, 36 * s, { fill: withAlpha(p.teal, alpha * pulse), radius: 6 * s });
          this.scaled(ctx, 'Challenge!', x + 493 * s, y + 34 * s, { size: 20, bold: true }, withAlpha(p.bar, alpha), s, 'center');
        }
      } else {
        const status = this.randomStatus();
        this.scaled(ctx, status.text, x + 206 * s, y + 158 * s, { size: 20 }, withAlpha(this.tone(p, status.tone), alpha), s, 'left', 362);
      }
    } else {
      this.scaled(ctx, tile.item.label, cx, y + 164 * s, { size: 30, bold: true }, nameColor, s, 'center', 260);
      this.scaled(ctx, line.text, cx, y + 202 * s, { size: 20 }, withAlpha(this.tone(p, line.tone), alpha), s, 'center', 260);
    }
  }

  private tone(p: Palette, tone: LineTone): Rgba {
    return tone === 'alert' ? p.teal : tone === 'error' ? p.danger : p.muted;
  }

  /** Text drawn `scale` times bigger (a growing tile's), cut to `maxWidth` at its own size. */
  private scaled(ctx: UiContext, value: string, x: number, cy: number, style: TextStyle, color: Rgba, scale: number, align: 'left' | 'center', maxWidth?: number): void {
    if (!value) return;
    const shown = maxWidth ? ctx.text.fit(value, style, maxWidth) : value;
    const texture = ctx.text.get(shown, style);
    if (!texture) return;
    const width = texture.width * scale;
    ctx.renderer.image(texture, align === 'left' ? x - 2 * scale : x - width / 2, cy - (texture.height * scale) / 2, scale, color);
  }

  /** The ▶ glides to the focused tile and nudges sideways. */
  private drawCursor(ctx: UiContext, ease: number, time: number): void {
    const tile = TILES.find((t) => this.focus.focused === `tile-${t.item.id}`);
    if (!tile || !this.cursorTexture || this.leaving) return;
    const targetX = tile.x + 14;
    const targetY = tile.y + (tile.big ? 80 : 62);
    if (!this.cursor.ready) this.cursor = { x: targetX, y: targetY, ready: true };
    const glide = 1 - Math.pow(1 - ease, 1.3);
    this.cursor.x += (targetX - this.cursor.x) * glide;
    this.cursor.y += (targetY - this.cursor.y) * glide;
    ctx.renderer.image(this.cursorTexture, this.cursor.x + Math.max(0, Math.sin(time * 7)) * 5 - 6, this.cursor.y, 4, ctx.palette.accentText);
  }

  /** The bar under the menu: the controller's buttons here, and Showdown's counts or a challenge. */
  private drawFooter(ctx: UiContext): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const x = 48;
    const y = 620;
    renderer.rect(x, y, 1184, 64, { fill: p.bar, radius: 16 });
    renderer.rect(x + 30, y + 27, 28, 10, { fill: p.select, radius: 2 });
    renderer.rect(x + 39, y + 18, 10, 28, { fill: p.select, radius: 2 });
    label(ctx, 'Move', x + 78, y + 32, { size: 20 }, p.ink);
    pill(ctx, 'A', x + 182, y + 32, 28);
    label(ctx, 'Select', x + 236, y + 32, { size: 20 }, p.ink);
    this.footerButton(ctx, 'footer-zr', x + 332, y + 12, 188, 'ZR', this.zrLabel(), () => this.pressZR(), this.disconnectHold.progress);
    const lLabel = this.lLabel();
    if (lLabel) this.footerButton(ctx, 'footer-l', x + 530, y + 12, 164, 'L', lLabel, () => this.toggleLBox());
    const right = this.footerRight();
    if (right?.notice) {
      renderer.rect(x + 780, y + 14, 380, 36, { fill: p.accent, radius: 6 });
      label(ctx, right.text, x + 792, y + 32, { size: 16, bold: true }, [1, 1, 1, 1], { maxWidth: 356 });
    } else if (right) {
      label(ctx, right.text, x + 1160, y + 32, { size: 20 }, p.muted, { align: 'right', fast: true });
    }
  }

  /**
   * A footer button: for clicks (the controller has the button itself), never on the d-pad's path;
   * `held` fills it in red from the left while its button is held down (Disconnect).
   */
  private footerButton(ctx: UiContext, id: string, x: number, y: number, w: number, key: string, text: string, accept: () => void, held = 0): void {
    ctx.focus.control({ id, x, y, w, h: 40, accept, skip: true });
    if (held > 0) ctx.renderer.rect(x, y, w * Math.min(1, held), 40, { fill: HOLD_FILL, radius: Math.min(6, (w * held) / 2) });
    const width = pill(ctx, key, x + 8, y + 20, 28);
    label(ctx, text, x + 16 + width, y + 20, { size: 20 }, held > 0.5 ? [1, 1, 1, 1] : ctx.palette.ink, { maxWidth: w - width - 20 });
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
