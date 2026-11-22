import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Texture, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { TextStyle, iconTexture, pixelTexture } from '@core/gl/gl-textures';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { HOLD_FILL, HoldAction } from '@core/gl/ui/hold-action';
import { PixelIconName } from '@core/gl/ui/pixel-icons';
import { UiContext, label, pill } from '@core/gl/ui/retro-kit';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ServerStats } from '@features/connection/server-stats';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { BALL } from '@features/home/gl/logo-ball';
import { HOME_LOGO } from '@features/home/gl/logo-layout';
import { RegisterView } from '@features/home/gl/login-view';
import { HOME_MENU_ITEMS, HomeMenu, HomeMenuItem } from '@features/home/state/home-menu';
import { HomeSummary } from '@features/home/state/home-summary';
import { CARD_CLOSE_ID, CARD_HISTORY_ID, TrainerCardView } from '@features/trainer-card/gl/trainer-card-view';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { LadderRatings } from '@features/trainer-card/state/ladder-ratings';
import { RANDOM_BATTLE_FORMAT } from '@shared/data/formats';
import { groupDigits } from '@shared/utils/group-digits';
import { toId } from '@shared/utils/to-id';

/** The buttons slide in one after another on arrival; everything fades out on leaving. */
const INTRO_MS = 450;
const LEAVE_MS = 260;
/** The buttons' slant: tan(8°), the top edge to the right of the bottom one. */
const SLANT = 0.14;
/** Battle's Pokémon while there's no team yet. */
const NO_TEAM = ['garchomp', 'incineroar'];
const TRAINER_ID = 'trainer';
const SETTINGS_ID = 'tile-settings';
/** The trainer: an 80px sprite at 5x, standing on a platform, with its name plate under it. */
const TRAINER = { x: 40, y: 112, size: 400 };
const PLATE = { x: 48, y: 540, w: 400, h: 92 };
const SETTINGS = { x: 1082, y: 24, w: 150, h: 48 };

/** A slanted button's box on the stage: Battle wide on top, then two rows of two. */
interface ButtonBox {
  item: HomeMenuItem;
  x: number;
  y: number;
  w: number;
  h: number;
  big: boolean;
}

const BUTTON_IDS: readonly PixelIconName[] = ['battle', 'random', 'teambuilder', 'live', 'chats'];
const BUTTONS: readonly ButtonBox[] = BUTTON_IDS.map((id, i) => {
  const item = HOME_MENU_ITEMS.find((it) => it.id === id) as HomeMenuItem;
  if (i === 0) return { item, x: 520, y: 104, w: 700, h: 196, big: true };
  const column = (i - 1) % 2;
  const row = Math.floor((i - 1) / 2);
  return { item, x: 520 + column * 360, y: 318 + row * 170, w: 340, h: 152, big: false };
});
const SETTINGS_ITEM = HOME_MENU_ITEMS.find((it) => it.id === 'settings') as HomeMenuItem;

/** The Pokémon drawn on each button (Battle draws the player's own team instead). */
const ART: Partial<Record<PixelIconName, readonly { sprite: string; size: number; dx: number; flip?: boolean }[]>> = {
  random: [{ sprite: 'pikachu', size: 120, dx: 0 }],
  teambuilder: [{ sprite: 'primarina', size: 124, dx: 0 }],
  live: [
    { sprite: 'kingambit', size: 104, dx: 0 },
    { sprite: 'charizard', size: 104, dx: -92, flip: true },
  ],
  chats: [{ sprite: 'whimsicott', size: 120, dx: -6 }],
};

type Tone = 'muted' | 'faded' | 'alert' | 'error';
interface Chip {
  text: string;
  tone: Tone;
}

/**
 * The home screen, the player at its heart: their trainer large on the left on a platform, with a
 * name plate (name, connection, best ladder rating, win rate), and the menu as slanted buttons on the
 * right, each with Pokémon drawn on it (Battle with the player's own team) and a live fact in a chip;
 * Settings is a small button at the top, by Showdown's counts. The trainer is a button too: the
 * Trainer Card (or registering the player's name). Under the menu, what the focused button is for and
 * the controller's buttons. ZR held logs out (or disconnects) and goes back to the entry screen; offline,
 * ZR goes there to log in. L opens the Trainer Card too; B closes it. R3 opens the UI kit gallery.
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
  private readonly ladder = inject(LadderRatings);

  private readonly focus = new CanvasFocus();
  private readonly registerView = new RegisterView(this.focus);
  private readonly cardView = new TrainerCardView(this.focus);

  /** The Trainer Card (or registering the name, whichever the name allows) is open. */
  private readonly boxOpen = signal(false);
  /** Log out (or Disconnect), filling while ZR is held. */
  private readonly disconnectHold = new HoldAction(inject(KeyboardNavigation), 'buttonZR');

  private readonly named = computed(() => this.login.state().status === 'named');
  /** No name: offline by choice, or still connecting. */
  private readonly offline = computed(() => !this.named());
  private readonly canShowCard = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && login.registered;
  });
  private readonly canRegister = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && login.ownName && !login.registered;
  });
  private readonly box = computed((): 'card' | 'register' | null => {
    if (this.boxOpen() && this.canShowCard()) return 'card';
    if (this.boxOpen() && this.canRegister()) return 'register';
    return null;
  });
  private shownBox: 'card' | 'register' | null = null;
  /** The control the Trainer Card opens on. */
  private cardFocus = CARD_CLOSE_ID;

  private readonly zrLabel = computed(() => {
    if (this.login.state().mode === null) return 'Log in';
    return this.login.state().ownName ? 'Log out' : 'Disconnect';
  });

  /** Our own ladder ratings, loaded once we have a registered name. */
  private readonly ratings = computed(() => {
    const state = this.ladder.state();
    const login = this.login.state();
    return state.userId === toId(login.name) ? state : null;
  });

  /** The name plate: who we are, and how we're doing. */
  private readonly plate = computed((): { name: string; status: string; chips: Chip[] } => {
    const login = this.login.state();
    if (login.mode === null) return { name: 'Trainer', status: 'Offline', chips: [{ text: 'ZR to log in', tone: 'muted' }] };
    if (login.status !== 'named') return { name: login.name || 'Trainer', status: 'Connecting…', chips: [] };
    if (!login.registered) {
      const chips: Chip[] = [{ text: login.ownName ? 'Unregistered name' : 'Guest', tone: 'muted' }];
      if (login.ownName) chips.push({ text: 'L to register', tone: 'muted' });
      return { name: login.name, status: 'Online', chips };
    }
    const state = this.ratings();
    if (!state || (state.status === 'loading' && state.ratings.length === 0)) return { name: login.name, status: 'Online', chips: [{ text: 'Loading ratings…', tone: 'muted' }] };
    if (state.ratings.length === 0) return { name: login.name, status: 'Online', chips: [{ text: state.status === 'error' ? 'Ratings unavailable' : 'No ladder battles yet', tone: 'muted' }] };
    const wins = state.ratings.reduce((total, r) => total + r.wins, 0);
    const losses = state.ratings.reduce((total, r) => total + r.losses, 0);
    const chips: Chip[] = [{ text: `★ ${state.ratings[0].elo}`, tone: 'muted' }];
    if (wins + losses > 0) chips.push({ text: `${Math.round((wins / (wins + losses)) * 100)}% wins`, tone: 'muted' });
    chips.push({ text: `${groupDigits(wins + losses)} battles`, tone: 'muted' });
    return { name: login.name, status: 'Online', chips };
  });

  /** Each button's chips: its live fact, or why it's faded. */
  private readonly chips = computed((): Partial<Record<PixelIconName, Chip[]>> => {
    const offline = this.offline();
    const online = (text: string): Chip[] => [offline ? { text: 'Needs connection', tone: 'faded' } : { text, tone: 'muted' }];
    const challenger = this.summary.challenger();
    const team = this.summary.team();
    const battle: Chip[] = [];
    if (challenger) battle.push({ text: this.summary.battle(), tone: 'alert' });
    else battle.push({ text: this.summary.battle(), tone: 'muted' });
    if (team && !challenger) battle.push({ text: team.name, tone: 'muted' });
    return {
      battle,
      random: [this.randomStatus()],
      teambuilder: [{ text: this.summary.teambuilder(), tone: 'muted' }],
      live: online(this.summary.live()),
      chats: online(this.summary.chats),
    };
  });

  private readonly randomStatus = computed((): Chip => {
    const error = this.search.error();
    if (this.search.cancelling()) return { text: 'Cancelling…', tone: 'alert' };
    if (this.search.searching()) return { text: 'Searching… A to cancel', tone: 'alert' };
    if (error) return { text: error, tone: 'error' };
    if (this.login.state().status === 'unavailable') return { text: 'No name on Showdown', tone: 'error' };
    if (this.offline()) return { text: 'Needs connection', tone: 'faded' };
    return { text: 'Gen 9 · Ladder', tone: 'muted' };
  });

  private readonly counts = computed(() => {
    const counts = this.stats.counts();
    if (this.offline() || !counts) return null;
    return `${groupDigits(counts.users)} online · ${groupDigits(counts.battles)} battles`;
  });

  // Drawing state, outside Angular.
  private icons = new Map<string, Texture>();
  private ball: Texture | null = null;
  private readonly start = performance.now();
  /** Each button's focus (0-1, eased), the trainer's last. */
  private readonly anims = [...BUTTONS, null, null].map(() => ({ focus: 0 }));
  private leaving: { at: number; then: () => void } | null = null;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.stage.whenReady(({ renderer }) => {
      for (const item of HOME_MENU_ITEMS) {
        this.icons.set(item.id, iconTexture(renderer, item.id, false));
        this.icons.set(`${item.id}-muted`, iconTexture(renderer, item.id, true));
      }
      this.ball = pixelTexture(renderer, BALL);
    });
    // Back from a page: the focus on the button that opened it, or the Trainer Card open again on the button that left it.
    this.focus.focus(`tile-${this.menu.lastItem()}`);
    if (this.menu.openCard()) {
      this.menu.openCard.set(false);
      this.boxOpen.set(true);
      this.cardFocus = CARD_HISTORY_ID;
    }
    // Our ratings, for the name plate, whenever we get a registered name.
    effect(() => {
      const login = this.login.state();
      if (login.status === 'named' && login.registered && this.ladder.state().userId !== toId(login.name)) this.ladder.load(toId(login.name));
    });
    const release = [
      this.navigation.registerButton('buttonZR', () => this.pressZR()),
      this.navigation.registerButton('buttonL', () => (this.box() === 'card' && this.cardView.picking() ? this.cardView.turn(-1) : this.toggleBox())),
      this.navigation.registerButton('buttonR', () => this.box() === 'card' && this.cardView.picking() && this.cardView.turn(1)),
      this.navigation.registerButton('buttonR3', () => (void this.router.navigateByUrl('/gl-kit'), true)),
      this.stats.watch(),
    ];
    inject(DestroyRef).onDestroy(() => {
      hide();
      release.forEach((fn) => fn());
      this.stage.whenReady(({ renderer }) => {
        for (const texture of [...this.icons.values(), this.ball]) if (texture) renderer.deleteTexture(texture);
      });
    });
  }

  // ---------------------------------------------------------------- controls

  private onAction(action: CanvasAction): boolean {
    if (this.leaving) return true;
    if (action === 'back') {
      if (this.box() === 'card' && this.cardView.picking()) this.cardView.stopPicking();
      else if (this.box()) this.boxOpen.set(false);
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
    this.leave(() => void this.router.navigateByUrl(path));
  }

  private leave(then: () => void): void {
    this.leaving = { at: performance.now(), then };
  }

  /** A: searches the Gen 9 Random Battle ladder, or cancels the search; offline, the entry screen to log in. */
  private randomBattle(): void {
    if (this.search.searching()) this.search.cancel();
    else if (this.login.state().mode === null) this.toEntry();
    else if (this.named()) this.search.search(RANDOM_BATTLE_FORMAT);
  }

  /** The trainer: the Trainer Card, registering our name, or logging in while offline. */
  private pressTrainer(): void {
    if (this.login.state().mode === null) this.toEntry();
    else this.toggleBox();
  }

  private pressZR(): boolean {
    if (this.box()) return true;
    if (this.login.state().mode === null) {
      this.toEntry();
      return true;
    }
    if (this.leaving) return true;
    this.disconnectHold.press();
    return true;
  }

  private toEntry(): void {
    if (this.leaving) return;
    this.menu.offlineChosen.set(false);
    this.leave(() => void this.router.navigateByUrl('/start', { replaceUrl: true }));
  }

  private toggleBox(): boolean {
    if (this.box()) {
      this.boxOpen.set(false);
      return true;
    }
    if (!this.canShowCard() && !this.canRegister()) return false;
    this.boxOpen.set(true);
    return true;
  }

  /** A box just opened or closed: its first control, or the menu again. */
  private followBox(): void {
    const box = this.box();
    if (box === this.shownBox) return;
    const closing = this.shownBox !== null;
    this.shownBox = box;
    if (box === 'register') {
      this.registerView.reset();
      this.focus.focus(this.registerView.firstId);
    } else if (box === 'card') {
      this.cardView.open(null, this.cardFocus);
      this.cardFocus = CARD_CLOSE_ID;
    } else if (closing) {
      this.focus.focus(TRAINER_ID);
    }
  }

  /** Every frame: the Log out hold; logs out on the frame it fills up, and back to the entry screen. */
  private stepDisconnect(now: number): void {
    const can = this.login.state().mode !== null && !this.box() && !this.leaving;
    if (!this.disconnectHold.step(now, can)) return;
    this.login.disconnect();
    this.toEntry();
  }

  // ---------------------------------------------------------------- drawing

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now, dt } = frame;
    // The name went (the connection was closed elsewhere) and offline wasn't chosen: the entry screen.
    // So does a login left waiting for a password (the automatic one refused, or the name lost after a drop).
    const login = this.login.state();
    const nameless = login.mode === null ? !this.menu.offlineChosen() : login.mode === 'login' && login.status === 'ready' && !login.loggingIn;
    if (nameless && !this.leaving) this.toEntry();
    this.followBox();
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();
    this.stepDisconnect(now);

    const box = this.box();
    if (box === 'register') {
      this.drawLogo(ctx, 1);
      this.registerView.draw(ctx);
    } else if (box === 'card') {
      this.drawLogo(ctx, 1);
      this.cardView.draw(ctx, () => this.boxOpen.set(false), () => this.leave(() => void this.router.navigateByUrl('/history?from=card')));
    } else {
      this.drawMenu(ctx, now, dt);
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

  private drawMenu(ctx: UiContext, now: number, dt: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const ease = 1 - Math.exp(-dt * 14);
    const age = now - this.start;
    const time = now / 1000;
    const focused = this.focus.focused;
    const light = p.appearance === 'light';

    const intro = (delay: number): number => 1 - Math.pow(1 - clamp01((age - delay) / INTRO_MS), 3);
    // The trainer's side: a deeper tint fading out to the right, and a halo behind them (fading in, from the title's plain backdrop).
    const lit = intro(0);
    renderer.rect(0, 0, 600, 720, { fill: withAlpha(p.hero, lit), fillEnd: withAlpha(p.hero, 0) });
    renderer.rect(-100, 140, 640, 640, { fill: light ? [1, 1, 1, 0.55 * lit] : withAlpha(p.accentText, 0.22 * lit), radius: 320, softness: 220 });
    // The logo stays put: the title's lands exactly here.
    this.drawLogo(ctx, 1);
    this.drawTopRight(ctx, ease, intro(0));
    this.drawTrainer(ctx, ease, intro(60), time);

    const offline = this.offline();
    BUTTONS.forEach((button, i) => {
      const anim = this.anims[i];
      anim.focus += ((focused === `tile-${button.item.id}` ? 1 : 0) - anim.focus) * ease;
      const arrive = intro(80 + i * 55);
      this.focus.control({ id: `tile-${button.item.id}`, x: button.x, y: button.y, w: button.w, h: button.h, accept: () => this.open(button.item) });
      this.drawButton(ctx, button, anim.focus, (1 - arrive) * 60, arrive, offline && button.item.needsConnection);
    });
    this.drawFooter(ctx, intro(300));
  }

  /** The logo: the menu icons' Poké Ball and POKÉMON SHOWDOWN!. */
  private drawLogo(ctx: UiContext, alpha: number): void {
    const p = ctx.palette;
    const logo = HOME_LOGO;
    if (this.ball) ctx.renderer.image(this.ball, logo.ballX, logo.ballY, logo.ballScale, [1, 1, 1, alpha]);
    const width = label(ctx, 'POKÉMON', logo.textX, logo.textCy, logo.style, withAlpha(p.logoInk, alpha));
    label(ctx, 'SHOWDOWN!', logo.textX + width + logo.gap, logo.textCy, logo.style, withAlpha(p.logo, alpha));
  }

  /** Showdown's counts, and the Settings button. */
  private drawTopRight(ctx: UiContext, ease: number, alpha: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const counts = this.counts();
    if (counts) label(ctx, counts, SETTINGS.x - 18, 48, { size: 17 }, withAlpha(p.muted, alpha), { align: 'right', fast: true });
    const anim = this.anims[BUTTONS.length + 1];
    anim.focus += ((this.focus.focused === SETTINGS_ID ? 1 : 0) - anim.focus) * ease;
    const f = anim.focus;
    this.focus.control({ id: SETTINGS_ID, ...SETTINGS, accept: () => this.open(SETTINGS_ITEM) });
    const { x, y, w, h } = SETTINGS;
    renderer.rect(x, y, w, h, {
      fill: withAlpha(mixRgba(p.panel, p.select, f), alpha),
      stroke: withAlpha(mixRgba(p.rim, p.accentText, f), alpha),
      border: 1 + 2 * f,
      radius: h / 2,
    });
    const icon = this.icons.get('settings');
    if (icon) renderer.image(icon, x + 16, y + 12, 1, [1, 1, 1, alpha]);
    label(ctx, 'Settings', x + 50, y + h / 2, { size: 18, bold: true }, withAlpha(p.ink, alpha));
  }

  /** The trainer on their platform (a button: the Trainer Card), and the name plate. */
  private drawTrainer(ctx: UiContext, ease: number, arrive: number, time: number): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    const anim = this.anims[BUTTONS.length];
    anim.focus += ((this.focus.focused === TRAINER_ID ? 1 : 0) - anim.focus) * ease;
    const f = anim.focus;
    const slide = (1 - arrive) * -60;
    const { x, y, size } = TRAINER;
    this.focus.control({ id: TRAINER_ID, x: x + 40, y: y + 20, w: size - 80, h: size - 20, accept: () => this.pressTrainer() });

    // The platform: an ellipse with a lip, ringed while the trainer has the focus.
    const px = x + 40 + slide;
    const py = y + size - 52;
    if (f > 0.01) renderer.rect(px - 10, py - 10, size - 60, 90, { fill: withAlpha(p.accentText, 0.3 * f * arrive), radius: 45, softness: 24 });
    renderer.rect(px, py, size - 80, 70, { fill: withAlpha(p.rim, arrive), radius: 35 });
    renderer.rect(px, py, size - 80, 62, {
      fill: withAlpha(p.panel, arrive),
      stroke: withAlpha(p.accentText, f * arrive),
      border: 4 * f,
      radius: 31,
    });

    const login = this.login.state();
    const avatar = ctx.images.pixelArt(avatarUrl(login.mode === null ? '' : login.avatar));
    const bob = Math.sin(time * 4) * 3 * f;
    if (avatar) renderer.rect(x + slide, y - 8 * f + bob, size, size, { fill: [1, 1, 1, arrive], texture: avatar });
    // No trainer (offline, or still loading): a big faint Poké Ball on the platform.
    else if (this.ball) renderer.image(this.ball, x + slide + size / 2 - 96, py - 190 + bob, 8, [1, 1, 1, 0.35 * arrive]);

    // The name plate.
    const plate = this.plate();
    const { x: bx, y: by, w: bw, h: bh } = PLATE;
    renderer.rect(bx + slide, by + 10, bw, bh, { fill: withAlpha([0, 0, 0, 1], 0.22 * arrive), radius: 16, softness: 18 });
    renderer.rect(bx + slide, by, bw, bh, { fill: withAlpha(p.panel, arrive), stroke: withAlpha(p.rim, arrive), border: 1, radius: 16 });
    const width = label(ctx, plate.name, bx + 20 + slide, by + 28, { size: 28, bold: true }, withAlpha(p.ink, arrive), { maxWidth: 250 });
    label(ctx, plate.status, bx + 32 + width + slide, by + 30, { size: 15 }, withAlpha(p.muted, arrive), { maxWidth: bw - 52 - width });
    let cx = bx + 20 + slide;
    for (const chip of plate.chips) cx += this.drawChip(ctx, chip, cx, by + 66, arrive, 26) + 8;
  }

  /** A slanted button: its colour, its Pokémon, its icon and name, and its chips. */
  private drawButton(ctx: UiContext, button: ButtonBox, f: number, slide: number, alpha: number, faded: boolean): void {
    if (alpha <= 0.001) return;
    const p = ctx.palette;
    const { renderer } = ctx;
    const { item, w, h, big } = button;
    const x = button.x + slide;
    const y = button.y - 6 * f;
    // Faded (its page needs a connection we don't have): no colour, the panel into the rim.
    const plate = faded ? p.rim : rgba(item.plate[p.appearance]);
    /** Where the slanted left edge is at this height (the skew moves rows above the middle right). */
    const edge = (cy: number): number => x - (cy - (y + h / 2)) * SLANT;

    // The shadow, the body (fading into the button's colour), and the focus border.
    if (f > 0.01 || p.appearance === 'light') {
      renderer.rect(x, y + 12, w, h, { fill: withAlpha([0, 0, 0, 1], (0.12 + 0.2 * f) * alpha), radius: 14, softness: 22, skew: SLANT });
    }
    renderer.rect(x, y, w, h, {
      fill: withAlpha(mixRgba(p.panel, p.select, f), alpha),
      fillEnd: withAlpha(plate, alpha),
      stroke: withAlpha(mixRgba(p.rim, p.accentText, f), alpha),
      border: 1 + 3 * f,
      radius: 14,
      skew: SLANT,
    });

    // The Pokémon, at the right, cut off at the bottom by the button.
    renderer.clip({ x, y: y + 4, w: w - 6, h: h - 8 });
    const artAlpha = alpha * (faded ? 0.3 : (p.appearance === 'light' ? 0.8 : 0.55) + (1 - (p.appearance === 'light' ? 0.8 : 0.55)) * f);
    const grow = 1 + 0.05 * f;
    if (item.id === 'battle') {
      const team = this.summary.team();
      // The lead biggest, at the right; the next two smaller, overlapping to its left.
      const sprites = team?.sprites.slice(0, 3) ?? NO_TEAM;
      const placed: { sprite: string; x: number; size: number }[] = [];
      let right = x + w - 18;
      sprites.forEach((sprite, i) => {
        const size = [170, 150, 120][i] * grow;
        placed.push({ sprite, x: right - size, size });
        right -= size * 0.62;
      });
      for (const art of placed.reverse()) this.drawSprite(ctx, art.sprite, art.x, y + h - art.size + 18, art.size, artAlpha, false);
    } else {
      for (const art of ART[item.id] ?? []) {
        const size = art.size * grow;
        this.drawSprite(ctx, art.sprite, x + w - 22 - size + art.dx, y + h - size + 16, size, artAlpha, art.flip ?? false);
      }
    }
    renderer.clip(null);

    // The icon and the name, along the slanted edge.
    const titleY = y + (big ? 52 : 40);
    const icon = this.icons.get(faded ? `${item.id}-muted` : item.id);
    const left = edge(titleY) + 26;
    if (icon) renderer.image(icon, left, titleY - 24, 2, [1, 1, 1, alpha]);
    const nameStyle: TextStyle = { size: big ? 44 : 25, bold: true };
    label(ctx, item.label.toUpperCase(), left + 60, titleY, nameStyle, withAlpha(faded ? p.muted : p.ink, alpha), { maxWidth: w - 100 });

    // The chips, at the bottom.
    const chipY = y + h - (big ? 38 : 30);
    let cx = edge(chipY) + 24;
    for (const chip of this.chips()[item.id] ?? []) cx += this.drawChip(ctx, chip, cx, chipY, alpha, 30, w - 60) + 8;
  }

  private drawSprite(ctx: UiContext, sprite: string, x: number, y: number, size: number, alpha: number, flip: boolean): void {
    const texture = ctx.images.sprite(sprite, false, ImagePriority.Screen);
    if (!texture) return;
    const uv = texture.uv ?? [0, 0, 1, 1];
    ctx.renderer.rect(x, y, size, size, { fill: [1, 1, 1, alpha], texture, uv: flip ? [uv[2], uv[1], uv[0], uv[3]] : uv });
  }

  /** A rounded chip with a short text; its width. */
  private drawChip(ctx: UiContext, chip: Chip, x: number, cy: number, alpha: number, height: number, maxWidth = 360): number {
    const p = ctx.palette;
    const style: TextStyle = { size: height > 28 ? 16 : 15, bold: true };
    const text = ctx.text.fit(chip.text, style, maxWidth - 24);
    const width = ctx.text.measure(text, style) + 24;
    const fill = chip.tone === 'alert' ? p.teal : chip.tone === 'error' ? p.danger : p.rim;
    const ink = chip.tone === 'alert' || chip.tone === 'error' ? p.contrast : chip.tone === 'faded' ? p.muted : p.ink;
    ctx.renderer.rect(x, cy - height / 2, width, height, { fill: withAlpha(fill, alpha), radius: height / 2 });
    label(ctx, text, x + 12, cy, style, withAlpha(ink, alpha), { fast: true });
    return width;
  }

  /** Under the menu: what the focused button is for, what A does there, and ZR. */
  private drawFooter(ctx: UiContext, alpha: number): void {
    const p = ctx.palette;
    const focused = this.focus.focused;
    const item = HOME_MENU_ITEMS.find((it) => `tile-${it.id}` === focused);
    const onTrainer = focused === TRAINER_ID;
    const description = onTrainer ? this.trainerHint() : (item?.description ?? '');
    const y = 684;
    label(ctx, description, 520, y, { size: 15 }, withAlpha(p.muted, alpha), { maxWidth: 360 });
    const action = onTrainer ? this.trainerAction() : item ? (item.id === 'random' && this.search.searching() ? 'Cancel' : item.action) : null;
    if (action) {
      const width = pill(ctx, 'A', 892, y, 28);
      label(ctx, action, 892 + width + 8, y, { size: 18 }, withAlpha(p.ink, alpha), { maxWidth: 172 - width });
    }
    this.footerButton(ctx, 'footer-zr', 1072, y - 20, 160, 'ZR', this.zrLabel(), () => this.pressZR(), this.disconnectHold.progress);
  }

  private trainerHint(): string {
    if (this.login.state().mode === null) return 'Log in to battle, chat and get ratings.';
    if (this.canShowCard()) return 'Your card, ratings and battle history.';
    if (this.canRegister()) return 'Register your name to keep it and get ratings.';
    return 'Playing as a guest with a random name.';
  }

  private trainerAction(): string | null {
    if (this.login.state().mode === null) return 'Log in';
    if (this.canShowCard()) return 'Trainer Card';
    if (this.canRegister()) return 'Register';
    return null;
  }

  /**
   * A footer button: for clicks (the controller has the button itself), never on the d-pad's path;
   * `held` fills it in red from the left while its button is held down (Log out).
   */
  private footerButton(ctx: UiContext, id: string, x: number, y: number, w: number, key: string, text: string, accept: () => void, held = 0): void {
    ctx.focus.control({ id, x, y, w, h: 40, accept, skip: true });
    if (held > 0) ctx.renderer.rect(x, y, w * Math.min(1, held), 40, { fill: HOLD_FILL, radius: Math.min(6, (w * held) / 2) });
    const width = pill(ctx, key, x + 8, y + 20, 28);
    label(ctx, text, x + 16 + width, y + 20, { size: 18 }, held > 0.5 ? [1, 1, 1, 1] : ctx.palette.ink, { maxWidth: w - width - 20 });
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

