import { NgOptimizedImage } from '@angular/common';
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { ChallengeNotice } from '@features/home/components/challenge-notice/challenge-notice';
import { LoginForm } from '@features/home/components/login-form/login-form';
import { RegisterForm } from '@features/home/components/register-form/register-form';
import { TrainerStatus } from '@features/home/components/trainer-status/trainer-status';
import { HOME_MENU_ITEMS, HomeMenu, HomeMenuItem } from '@features/home/state/home-menu';
import { TrainerCard } from '@features/trainer-card/components/trainer-card/trainer-card';
import { PixelIconName, PixelIcon } from '@shared/components/pixel-icon';
import { RetroBox } from '@shared/components/retro-box';
import { RANDOM_BATTLE_FORMAT } from '@shared/data/formats';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/** How long a first ZR press to disconnect waits for the second one. */
const DISCONNECT_CONFIRM_MS = 4000;

/**
 * The home screen over the whole stage: a bar with Showdown's logo and the connection (ZR opens the
 * login box, which also connects as a guest; once connected, the name, and ZR twice to disconnect or
 * log out), and the menu as six big buttons, two per row: the pages, plus Random Battle (a ladder
 * search right here). The button pointed at is marked by CSS from the controller's focus attribute
 * (styles.css), so moving around doesn't even render. Logging in opens a box over the grid, and so
 * does L's: the Trainer Card for a registered name, or registering the player's own name.
 */
@Component({
  imports: [ChallengeNotice, LoginForm, NgOptimizedImage, PixelIcon, RegisterForm, RetroBox, TrainerCard, TrainerStatus],
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
  private readonly tiles = viewChildren<ElementRef<HTMLButtonElement>>('tile');

  protected readonly items = HOME_MENU_ITEMS;
  protected readonly Math = Math;
  protected readonly primaryClass = RETRO_PRIMARY_BUTTON;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;

  protected readonly loginOpen = signal(false);
  /** L's box is open: the Trainer Card, or registering the name (whichever the name allows). */
  protected readonly lBoxOpen = signal(false);
  /** A first press to disconnect is waiting for the second one. */
  protected readonly confirmingDisconnect = signal(false);
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly disconnectLabel = computed(() => {
    const action = this.login.state().ownName ? 'Log out' : 'Disconnect';
    return this.confirmingDisconnect() ? `${action}: press again to confirm` : action;
  });

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

  /**
   * The box shown while L's is open, as the name allows (logging out closes it). A name just
   * registered goes straight from the register box to its card.
   */
  protected readonly cardShown = computed(() => this.lBoxOpen() && this.canShowCard());
  protected readonly registerShown = computed(() => this.lBoxOpen() && this.canRegister());

  /** Random Battle's line: the search under way, why it was refused, or what A will do. */
  protected readonly randomLine = computed(() => {
    const error = this.search.error();
    if (this.search.searching()) return { text: 'Searching for an opponent… A to cancel', error: false };
    if (error) return { text: error, error: true };
    if (this.offline()) return { text: 'Gen 9 · log in first (ZR)', error: false };
    if (this.login.state().status === 'unavailable') return { text: 'No name on Showdown: log out and try again', error: true };
    if (this.login.state().status !== 'named') return { text: 'Gen 9 · connecting…', error: false };
    return { text: 'Gen 9 · find an opponent now', error: false };
  });

  constructor() {
    // Back from a page: focus on the button that opened it.
    afterNextRender(() => this.focusItem(this.menu.lastItem()));
    const unregister = [
      this.navigation.registerButton('buttonZR', () => this.openLogin() || this.disconnect()),
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
