import { NgOptimizedImage } from '@angular/common';
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { HomeFooter } from '@features/home/components/home-footer/home-footer';
import { LoginForm } from '@features/home/components/login-form/login-form';
import { RegisterForm } from '@features/home/components/register-form/register-form';
import { ShowdownLogo } from '@features/home/components/showdown-logo/showdown-logo';
import { TrainerStatus } from '@features/home/components/trainer-status/trainer-status';
import { HOME_MENU_ITEMS, HomeMenu, HomeMenuItem } from '@features/home/state/home-menu';
import { HomeSummary } from '@features/home/state/home-summary';
import { TrainerCard } from '@features/trainer-card/components/trainer-card/trainer-card';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { PixelIconName, PixelIcon } from '@shared/components/pixel-icon';
import { PokemonSprite } from '@shared/components/pokemon-sprite';
import { RetroBox } from '@shared/components/retro-box';
import { RANDOM_BATTLE_FORMAT } from '@shared/data/formats';

/** How long a first ZR press to disconnect waits for the second one. */
const DISCONNECT_CONFIRM_MS = 4000;

/** How a button's line reads: a plain fact, a page that needs a connection, a challenge, or a refusal. */
type LineTone = 'muted' | 'faded' | 'alert' | 'error';

interface MenuLine {
  text: string;
  tone: LineTone;
}

const TEAM_SLOTS = 6;

/**
 * The home screen over the whole stage: a bar with Showdown's logo and who we are (the connection, and
 * once named our name and avatar), and the menu: Battle and Random Battle (a ladder search right here)
 * as two big buttons, the other pages as four smaller ones, each with a live fact under its name (see
 * HomeSummary). The button pointed at is marked by CSS from the controller's focus attribute
 * (styles.css), so moving around doesn't even render. ZR opens the login box (which also connects as a
 * guest), or, pressed twice, disconnects or logs out; L opens the Trainer Card for a registered name,
 * or registering the player's own name. Both boxes open over the menu, and both buttons are also in
 * the bar under it.
 */
@Component({
  imports: [HomeFooter, LoginForm, NgOptimizedImage, PixelIcon, PokemonSprite, RegisterForm, RetroBox, ShowdownLogo, TrainerCard, TrainerStatus],
  selector: 'app-home-screen',
  host: { class: 'bg-retro-bg relative block h-[720px] w-[1280px] text-retro-ink' },
  templateUrl: './home-screen.html',
})
export class HomeScreen {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly menu = inject(HomeMenu);
  private readonly render = inject(RenderScheduler);
  protected readonly login = inject(ShowdownLogin);
  private readonly search = inject(ShowdownSearch);
  protected readonly summary = inject(HomeSummary);
  private readonly tiles = viewChildren<ElementRef<HTMLButtonElement>>('tile');

  protected readonly items = HOME_MENU_ITEMS;
  protected readonly toneClass: Record<LineTone, string> = {
    muted: 'text-retro-muted',
    faded: 'text-retro-muted',
    alert: 'text-retro-teal font-bold',
    error: 'text-retro-danger',
  };

  protected readonly loginOpen = signal(false);
  /** L's box is open: the Trainer Card, or registering the name (whichever the name allows). */
  protected readonly lBoxOpen = signal(false);
  /** A first press to disconnect is waiting for the second one. */
  protected readonly confirmingDisconnect = signal(false);
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The bar offers connecting: nothing asked for yet, or a login that lost its name (a failed login
   * on reconnection) while its form is closed.
   */
  protected readonly offline = computed(() => {
    const status = this.login.state().status;
    return status === 'offline' || (status === 'ready' && !this.loginOpen());
  });

  /** The Trainer Card is for registered players, logged in (guests have no ratings to show). */
  protected readonly canShowCard = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && login.registered && !this.loginOpen();
  });

  /** The player's own name, not registered: L offers registering it. */
  protected readonly canRegister = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && login.ownName && !login.registered && !this.loginOpen();
  });

  protected readonly hasLButton = computed(() => this.canShowCard() || this.canRegister());

  /** The button the controller points at, for its ▶. */
  protected readonly focusedItem = computed(() => this.navigation.lastFocusedControl()?.getAttribute('data-menu-item') ?? null);
  /** An icon plate's tint while its page needs a connection we don't have: a plain dark grey. */
  protected readonly fadedPlate = '#232a31';

  /** We have a name on Showdown: the bar shows our avatar next to it. */
  protected readonly named = computed(() => this.login.state().status === 'named' && !this.loginOpen());
  protected readonly avatarSrc = computed(() => [avatarUrl(this.login.state().avatar)]);

  /** ZR's and L's actions, for the bar under the menu. */
  protected readonly zrLabel = computed(() => {
    if (this.offline()) return 'Log in';
    if (this.confirmingDisconnect()) return 'Press again';
    return this.login.state().ownName ? 'Log out' : 'Disconnect';
  });
  protected readonly lLabel = computed(() => (this.canShowCard() ? 'Card' : this.canRegister() ? 'Register' : null));

  /**
   * The box shown while L's is open, as the name allows (logging out closes it). A name just
   * registered goes straight from the register box to its card.
   */
  protected readonly cardShown = computed(() => this.lBoxOpen() && this.canShowCard());
  protected readonly registerShown = computed(() => this.lBoxOpen() && this.canRegister());

  /** Each button's line under its name; pages that need a connection say so while offline. */
  protected readonly lines = computed((): Record<PixelIconName, MenuLine> => {
    const offline = this.offline();
    const fact = (text: string): MenuLine => ({ text, tone: 'muted' });
    const online = (text: string): MenuLine => (offline ? { text: 'Needs connection', tone: 'faded' } : fact(text));
    return {
      battle: { text: this.summary.battle(), tone: this.summary.challenger() ? 'alert' : 'muted' },
      // Its second line already says to log in.
      random: { text: 'Gen 9 · Ladder', tone: offline ? 'faded' : 'muted' },
      teambuilder: fact(this.summary.teambuilder()),
      chats: online(this.summary.chats),
      live: online(this.summary.live()),
      settings: fact(this.summary.settingsLine()),
      replays: fact(''),
    };
  });

  /** Random Battle's second line: the search under way, why it was refused, or what A will do. */
  protected readonly randomStatus = computed((): MenuLine => {
    const error = this.search.error();
    if (this.search.searching()) return { text: 'Searching for an opponent… A to cancel', tone: 'alert' };
    if (error) return { text: error, tone: 'error' };
    if (this.offline()) return { text: 'Log in first (ZR)', tone: 'faded' };
    if (this.login.state().status === 'unavailable') return { text: 'No name on Showdown: log out and try again', tone: 'error' };
    if (this.login.state().status !== 'named') return { text: 'Connecting…', tone: 'muted' };
    return { text: 'Find an opponent now', tone: 'muted' };
  });

  /** The Battle page's team in six fixed slots (empty ones have no sprite). */
  protected readonly teamSprites = computed(() => {
    const sprites = this.summary.team()?.sprites ?? [];
    return Array.from({ length: TEAM_SLOTS }, (_, i) => sprites[i] ?? '');
  });

  constructor() {
    // Back from a page: focus on the button that opened it.
    afterNextRender(() => this.focusItem(this.menu.lastItem()));
    const unregister = [
      this.navigation.registerButton('buttonZR', () => this.pressZR()),
      this.navigation.registerButton('buttonL', () => this.toggleLBox()),
    ];
    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      this.cancelDisconnect();
    });
  }

  protected open(item: HomeMenuItem): void {
    this.menu.lastItem.set(item.id);
    if (!item.path) {
      this.randomBattle();
      return;
    }
    this.navigation.focusPageAfterNavigation();
    void this.router.navigateByUrl(item.path);
  }

  /**
   * A: searches the Gen 9 Random Battle ladder (a match opens the battle, see App), or cancels the
   * search under way. Offline, it opens the login box first (which can connect as a guest too).
   */
  private randomBattle(): void {
    if (this.search.searching()) this.search.cancel();
    else if (this.offline()) this.openLogin();
    else if (this.login.state().status === 'named') this.search.search(RANDOM_BATTLE_FORMAT);
  }

  /** ZR or its button: logs in while offline, disconnects (in two presses) while connected. */
  protected pressZR(): boolean {
    return this.openLogin() || this.disconnect();
  }

  /** ZR or its button, while offline: connects and shows the login box (its guest button takes the focus). */
  protected openLogin(): boolean {
    if (!this.offline()) return false;
    this.login.startLogin();
    this.loginOpen.set(true);
    return true;
  }

  /** ZR or its button while connected (not while the login box is open): asks first, then disconnects. */
  protected disconnect(): boolean {
    if (this.offline() || this.loginOpen()) return false;
    if (!this.confirmingDisconnect()) {
      this.confirmingDisconnect.set(true);
      this.confirmTimer = setTimeout(() => {
        this.cancelDisconnect();
        this.render.request();
      }, DISCONNECT_CONFIRM_MS);
      return true;
    }
    this.cancelDisconnect();
    if (this.lBoxOpen()) this.closeLBox();
    this.login.disconnect();
    return true;
  }

  private cancelDisconnect(): void {
    if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.confirmingDisconnect.set(false);
  }

  /** Connected with a name (a guest's or the player's), or backed out (which disconnects one that has no name yet). */
  protected closeLogin(): void {
    this.loginOpen.set(false);
    this.login.cancelLogin();
    afterNextRender(() => this.focusItem(this.menu.lastItem()), { injector: this.injector });
  }

  /** L or its button: opens the Trainer Card (or registering the name) over the menu, or closes it. */
  protected toggleLBox(): boolean {
    if (this.cardShown() || this.registerShown()) {
      this.closeLBox();
      return true;
    }
    if (!this.hasLButton()) return false;
    this.lBoxOpen.set(true);
    return true;
  }

  protected closeLBox(): void {
    this.lBoxOpen.set(false);
    afterNextRender(() => this.focusItem(this.menu.lastItem()), { injector: this.injector });
  }

  private focusItem(id: PixelIconName): void {
    this.tiles()
      .find((tile) => tile.nativeElement.getAttribute('data-menu-item') === id)
      ?.nativeElement.focus();
  }
}
