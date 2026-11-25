import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Texture, mixRgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { iconTexture, pixelTexture } from '@core/gl/gl-textures';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { HOLD_FILL, HoldAction } from '@core/gl/ui/hold-action';
import { PixelIconName } from '@core/gl/ui/pixel-icons';
import { UiContext, label, pill } from '@core/gl/ui/retro-kit';
import { HOME_SETTINGS_KEY, ROLE_KEYS } from '@core/input/console-keys';
import { codeSource } from '@core/runtime/code-source';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ServerStats } from '@features/connection/server-stats';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { BALL } from '@features/home/gl/logo-ball';
import { HOME_LOGO, logoMark } from '@features/home/gl/logo-layout';
import { Chip, NamePlate, TRAINER, drawGround, drawNamePlate, drawPlatformTrainer, drawSlantedButton, drawSprite } from '@core/gl/ui/menu-kit';
import { RegisterView } from '@features/home/gl/login-view';
import { HOME_MENU_ITEMS, HomeMenu, HomeMenuItem } from '@features/home/state/home-menu';
import { HomeSummary } from '@features/home/state/home-summary';
import { PlaySelection } from '@features/play/state/play-selection';
import { PLAYABLE_FORMATS, formatLabel } from '@shared/data/formats';
import { CARD_CLOSE_ID, CARD_HISTORY_ID, TrainerCardView } from '@features/trainer-card/gl/trainer-card-view';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { LadderRatings } from '@features/trainer-card/state/ladder-ratings';
import { groupDigits } from '@shared/utils/group-digits';
import { toId } from '@shared/utils/to-id';

/** The buttons slide in one after another on arrival; everything fades out on leaving. */
const INTRO_MS = 450;
const LEAVE_MS = 260;
/** Battle's Pokémon while there's no team yet. */
const NO_TEAM = ['garchomp', 'incineroar'];
const TRAINER_ID = 'trainer';
const SETTINGS_ID = 'tile-settings';
/** Settings, top right, with X's chip. */
const SETTINGS = { x: 1046, y: 24, w: 186, h: 48 };

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


/**
 * The home screen, the player at its heart: their trainer large on the left on a platform, with a
 * name plate (name, connection, best ladder rating, win rate), and the menu as slanted buttons on the
 * right, each with Pokémon drawn on it (Battle with the player's own team) and a live fact in a chip;
 * Settings is a small button at the top, by Showdown's counts. The trainer is a button too: the
 * Trainer Card (or registering the player's name). Under the menu, what the focused button is for and
 * the controller's buttons. ZR held logs out (or disconnects) and goes back to the entry screen; offline,
 * ZR goes there to log in. L opens the Trainer Card too; B closes it. X opens Settings.
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
  private readonly connection = inject(ShowdownConnection);
  private readonly search = inject(ShowdownSearch);
  private readonly selection = inject(PlaySelection);
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

  /** The update gate started the app offline: no logging in until it's opened again. */
  private readonly offlineMode = codeSource()?.offline === true;

  private readonly zrLabel = computed(() => {
    if (this.offlineMode) return 'Offline';
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
  private readonly plate = computed((): NamePlate & { chips: Chip[] } => {
    const login = this.login.state();
    if (this.offlineMode) return { name: 'Trainer', status: 'Offline mode', chips: [{ text: 'Open the app again to go online', tone: 'muted' }] };
    if (login.mode === null) return { name: 'Trainer', status: 'Offline', chips: [{ text: 'ZR to log in', tone: 'muted' }] };
    // No name to be had (Showdown's login server out of reach, say): why, in red.
    if (login.status === 'unavailable') return { name: login.name || 'Trainer', status: 'No name', chips: [{ text: login.error ?? "Couldn't get a name", tone: 'error' }] };
    if (login.status !== 'named') {
      // Connected, the name is being claimed from the login server (it can be slow to answer).
      const naming = this.connection.state().status === 'connected' && (login.status === 'naming' || login.loggingIn || login.reclaiming);
      return { name: login.name || 'Trainer', status: naming ? 'Getting a name…' : 'Connecting…', chips: [] };
    }
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
    const searched = this.search.searching();
    // Under Random Battle, a random format by its short name ("Gen 9"): the button says the rest.
    if (searched) return { text: `Searching… ${PLAYABLE_FORMATS.find((f) => f.id === searched)?.short ?? formatLabel(searched)}`, tone: 'alert' };
    if (error) return { text: error, tone: 'error' };
    if (this.login.state().status === 'unavailable') return { text: 'No name on Showdown', tone: 'error' };
    if (this.offline()) return { text: 'Needs connection', tone: 'faded' };
    const format = this.selection.randomPlayFormat();
    return { text: `${format.short ?? format.label} · Ladder`, tone: 'muted' };
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
  /** Arrived from the entry screen, whose trainer and lit side are already where the menu's are: they don't come in again. */
  private readonly fromEntry = this.menu.fromEntry();

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
    this.menu.fromEntry.set(false);
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
      // X: Settings, but for the Trainer Card's history (registered after, so it's asked first).
      this.navigation.registerButton(HOME_SETTINGS_KEY.button, () => this.box() === null && (this.open(SETTINGS_ITEM), true)),
      this.navigation.registerButton(ROLE_KEYS.cardHistory.button, () => this.box() === 'card' && !this.cardView.picking() && (this.openHistory(), true)),
      this.navigation.registerButton(ROLE_KEYS.randomAvatar.button, () => this.box() === 'card' && this.cardView.randomize()),
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
    // Random Battle is only for playing online: offline, the entry screen to connect first.
    if (item.id === 'random' && this.login.state().mode === null) {
      this.toEntry();
      return;
    }
    const path = item.path;
    this.leave(() => void this.router.navigateByUrl(path));
  }

  private leave(then: () => void): void {
    this.leaving = { at: performance.now(), then };
  }

  /** Our battle history, from the Trainer Card (its B comes back to the card). */
  private openHistory(): void {
    this.leave(() => void this.router.navigateByUrl('/history?from=card'));
  }

  /** The trainer: the Trainer Card, registering our name, or logging in while offline. */
  private pressTrainer(): void {
    if (this.offlineMode) return;
    if (this.login.state().mode === null) this.toEntry();
    else this.toggleBox();
  }

  private pressZR(): boolean {
    if (this.box() || this.offlineMode) return true;
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
      // Our card beside our trainer, who stays where the menu has them.
      drawGround(ctx, 1);
      this.drawLogo(ctx, 1);
      this.cardView.draw(ctx, () => this.boxOpen.set(false), () => this.openHistory(), this.ball);
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
    const ease = 1 - Math.exp(-dt * 14);
    const age = now - this.start;
    const time = now / 1000;
    const focused = this.focus.focused;

    const intro = (delay: number): number => 1 - Math.pow(1 - clamp01((age - delay) / INTRO_MS), 3);
    // The trainer's side, lit (fading in from the title's plain backdrop; already lit coming from the entry screen).
    drawGround(ctx, this.fromEntry ? 1 : intro(0));
    // The logo stays put: the title's lands exactly here.
    this.drawLogo(ctx, 1);
    this.drawTopRight(ctx, ease, intro(0));
    this.drawTrainer(ctx, ease, this.fromEntry ? 1 : intro(60), time);

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

  /** The logo: the gold "o!" (the app icon's) and POKÉMON SHOWDOWN!. */
  private drawLogo(ctx: UiContext, alpha: number): void {
    const p = ctx.palette;
    const logo = HOME_LOGO;
    const mark = logoMark(ctx.images, logo.markSize);
    if (mark) ctx.renderer.rect(logo.markX, logo.markY, logo.markSize, logo.markSize, { fill: [1, 1, 1, alpha], texture: mark });
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
    const keyX = x + w - 14 - 28;
    renderer.rect(keyX, y + h / 2 - 14, 28, 28, { fill: withAlpha(p.select, alpha), stroke: withAlpha(p.rim, alpha), border: 1, radius: 14 });
    label(ctx, HOME_SETTINGS_KEY.label, keyX + 14, y + h / 2, { size: 14, bold: true }, withAlpha(p.ink, alpha), { align: 'center' });
  }

  /** The trainer on their platform (a button: the Trainer Card), and the name plate. */
  private drawTrainer(ctx: UiContext, ease: number, arrive: number, time: number): void {
    const anim = this.anims[BUTTONS.length];
    anim.focus += ((this.focus.focused === TRAINER_ID ? 1 : 0) - anim.focus) * ease;
    const { x, y, size } = TRAINER;
    this.focus.control({ id: TRAINER_ID, x: x + 40, y: y + 20, w: size - 80, h: size - 20, accept: () => this.pressTrainer() });
    const login = this.login.state();
    const avatar = ctx.images.pixelArt(avatarUrl(login.mode === null ? '' : login.avatar));
    drawPlatformTrainer(ctx, { avatar, ball: this.ball, f: anim.focus, arrive, time });
    drawNamePlate(ctx, this.plate(), arrive);
  }

  /** A slanted button: its colour, its Pokémon (Battle's: the player's team), its icon and name, and its chips. */
  private drawButton(ctx: UiContext, button: ButtonBox, f: number, slide: number, alpha: number, faded: boolean): void {
    const { item, big } = button;
    drawSlantedButton(ctx, {
      x: button.x + slide,
      y: button.y,
      w: button.w,
      h: button.h,
      f,
      alpha,
      title: item.label.toUpperCase(),
      titleSize: big ? 44 : 25,
      titleY: big ? 52 : 40,
      icon: this.icons.get(faded ? `${item.id}-muted` : item.id),
      // Faded (its page needs a connection we don't have): no colour, the panel into the rim.
      plate: faded ? ctx.palette.rim : rgba(item.plate[ctx.palette.appearance]),
      chips: this.chips()[item.id] ?? [],
      faded,
      art: (box, artAlpha, grow) => this.drawArt(ctx, item.id, box, artAlpha, grow),
    });
  }

  private drawArt(ctx: UiContext, id: PixelIconName, box: { x: number; y: number; w: number; h: number }, alpha: number, grow: number): void {
    const { x, y, w, h } = box;
    if (id === 'battle') {
      // The lead biggest, at the right; the next two smaller, overlapping to its left.
      const sprites = this.summary.team()?.sprites.slice(0, 3) ?? NO_TEAM;
      const placed: { sprite: string; x: number; size: number }[] = [];
      let right = x + w - 18;
      sprites.forEach((sprite, i) => {
        const size = [170, 150, 120][i] * grow;
        placed.push({ sprite, x: right - size, size });
        right -= size * 0.62;
      });
      for (const art of placed.reverse()) drawSprite(ctx, art.sprite, art.x, y + h - art.size + 18, art.size, alpha);
      return;
    }
    for (const art of ART[id] ?? []) {
      const size = art.size * grow;
      drawSprite(ctx, art.sprite, x + w - 22 - size + art.dx, y + h - size + 16, size, alpha, art.flip ?? false);
    }
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
    const action = onTrainer ? this.trainerAction() : item ? item.action : null;
    if (action) {
      const width = pill(ctx, 'A', 892, y, 28);
      label(ctx, action, 892 + width + 8, y, { size: 18 }, withAlpha(p.ink, alpha), { maxWidth: 172 - width });
    }
    this.footerButton(ctx, 'footer-zr', 1072, y - 20, 160, 'ZR', this.zrLabel(), () => this.pressZR(), this.disconnectHold.progress);
  }

  private trainerHint(): string {
    if (this.offlineMode) return `Offline: ${codeSource()?.offlineReason ?? 'no update check'}.`;
    if (this.login.state().mode === null) return 'Log in to battle, chat and get ratings.';
    if (this.canShowCard()) return 'Your card, ratings and battle history.';
    if (this.canRegister()) return 'Register your name to keep it and get ratings.';
    return 'Playing as a guest with a random name.';
  }

  private trainerAction(): string | null {
    if (this.offlineMode) return null;
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

