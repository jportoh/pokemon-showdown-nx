import { NgOptimizedImage } from '@angular/common';
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild, viewChildren } from '@angular/core';
import { KeyboardNavigation, PageStep } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { AVATAR_ALIASES } from '@features/trainer-card/data/avatar-aliases';
import { AVATAR_CHOICES } from '@features/trainer-card/data/avatar-choices';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

const COLUMNS = 10;
const ROWS = 4;
const PER_PAGE = COLUMNS * ROWS;
/** A tile (92px square) and the gap between tiles. */
const TILE = 92;
const GAP = 6;
/** The grid, centred in the card's inside (1082px wide). */
const GRID_LEFT = 54;
const GRID_TOP = 104;

/**
 * Chooses the player's avatar, over the Trainer Card's inside (1082x562): Showdown's avatars as a
 * grid of 10x4 sprites, a page at a time. The d-pad walks the grid and turns the page past its top
 * or bottom row; L/R turn pages too. A picks one, B goes back to the card. The current avatar is
 * marked. Brewser rules: the 40 tiles are always mounted (tracked by position, so they never move),
 * each with one new img per sprite; the last page's missing tiles are hidden; the picker itself is
 * hidden rather than removed (`active`). The pages next to the one shown are downloaded ahead.
 */
@Component({
  imports: [BackAction, NgOptimizedImage],
  selector: 'app-avatar-picker',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[556px] w-[1076px]' },
  template: `
    <div role="group" aria-labelledby="avatar-picker-title" (appBack)="closed.emit()">
      <h2 id="avatar-picker-title" class="absolute top-[28px] left-[48px] block h-12 w-[640px] text-[40px] leading-[48px] font-bold">Choose an avatar</h2>
      <button
        type="button"
        [class]="secondaryClass"
        class="absolute top-[28px] left-[876px] h-12 w-[158px] text-xl"
        aria-label="Back to the Trainer Card"
        (click)="closed.emit()"
      >
        <span aria-hidden="true" class="absolute top-[8px] left-[10px] block h-7 w-10 rounded-sm bg-retro-select text-center leading-7">B</span>
        <span aria-hidden="true" class="absolute top-0 left-[54px] block h-11 w-[90px] text-center leading-[44px]">Back</span>
      </button>

      <div #grid class="block">
        @for (slot of slots; track slot.index) {
          <div class="block" [class.hidden]="!pageAvatars()[slot.index]">
            <button
              #tile
              type="button"
              class="absolute block size-[92px] cursor-pointer rounded-md border-2 hover:bg-retro-select"
              [class]="pageAvatars()[slot.index] === current() ? 'border-retro-accent-text bg-retro-select' : 'border-retro-outline bg-retro-bg'"
              [style.left.px]="slot.left"
              [style.top.px]="slot.top"
              [disabled]="!pageAvatars()[slot.index]"
              [attr.data-avatar-slot]="slot.index"
              [attr.aria-label]="labelOf(pageAvatars()[slot.index])"
              [attr.aria-current]="pageAvatars()[slot.index] === current() ? 'true' : null"
              (click)="choose(slot.index)"
            >
              @for (src of srcOf(pageAvatars()[slot.index]); track src) {
                <img [ngSrc]="src" width="80" height="80" alt="" class="absolute top-[4px] left-[4px] block size-20 max-w-none" />
              }
            </button>
          </div>
        }
      </div>

      <p role="status" class="absolute top-[508px] left-[48px] block h-7 w-[986px] overflow-hidden text-xl leading-7 whitespace-nowrap text-retro-muted">
        {{ status() }}
      </p>
    </div>
  `,
})
export class AvatarPicker {
  private readonly navigation = inject(KeyboardNavigation);
  private readonly injector = inject(Injector);
  private readonly render = inject(RenderScheduler);
  private readonly grid = viewChild.required<ElementRef<HTMLElement>>('grid');
  private readonly tiles = viewChildren<ElementRef<HTMLButtonElement>>('tile');

  /** The avatar shown now (a sprite name, or an old number the client maps to one). */
  readonly avatar = input.required<string>();
  /**
   * Shown: the parent keeps the picker mounted once opened and hides it instead of removing it (on
   * Brewser a removed picker stayed painted over the card). Opening moves to the current avatar.
   */
  readonly active = input(false);
  readonly picked = output<string>();
  /** Back to the card (B), without choosing. */
  readonly closed = output<void>();

  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;
  protected readonly slots = Array.from({ length: PER_PAGE }, (_, index) => ({
    index,
    left: GRID_LEFT + (index % COLUMNS) * (TILE + GAP),
    top: GRID_TOP + Math.floor(index / COLUMNS) * (TILE + GAP),
  }));

  private readonly pageCount = Math.ceil(AVATAR_CHOICES.length / PER_PAGE);
  protected readonly current = computed(() => AVATAR_ALIASES[this.avatar()] ?? this.avatar());
  private readonly page = signal(0);
  /** Sprites already asked for ahead of time (see `prefetch`). */
  private readonly prefetched = new Set<string>();

  /** The page's avatars, one per tile (null for the last page's missing ones). */
  protected readonly pageAvatars = computed(() => {
    const start = this.page() * PER_PAGE;
    return this.slots.map((slot) => AVATAR_CHOICES[start + slot.index] ?? null);
  });

  protected readonly status = computed(
    () => `Page ${this.page() + 1} of ${this.pageCount} · L/R turn pages · A choose · B back to the card`,
  );

  constructor() {
    // Only while shown: hidden, L is the home screen's again (it closes the card).
    const unregister = [
      this.navigation.registerButton('buttonL', () => this.active() && this.turn(-1, null)),
      this.navigation.registerButton('buttonR', () => this.active() && this.turn(1, null)),
    ];
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => unregister.forEach((fn) => fn()));
    afterNextRender(() => {
      const unregisterPager = this.navigation.registerPager(this.grid().nativeElement, (step, focused) => this.onPage(step, focused));
      destroyRef.onDestroy(unregisterPager);
    });
    // Each opening (only `active` is tracked): the current avatar's page, focused on it.
    effect(() => {
      if (!this.active()) return;
      untracked(() => {
        const index = AVATAR_CHOICES.indexOf(this.current());
        this.page.set(Math.max(0, Math.floor(index / PER_PAGE)));
        this.focusSlot(index === -1 ? 0 : index % PER_PAGE);
      });
    });
  }

  protected labelOf(avatar: string | null): string | null {
    return avatar && `Avatar ${avatar}${avatar === this.current() ? ' (current)' : ''}`;
  }

  protected srcOf(avatar: string | null): string[] {
    return avatar ? [avatarUrl(avatar)] : [];
  }

  protected choose(index: number): void {
    const avatar = this.pageAvatars()[index];
    if (avatar) this.picked.emit(avatar);
  }

  /** Up past the top row or down past the bottom one turns the page, keeping the column. */
  private onPage(step: PageStep, focused: HTMLElement): boolean {
    const index = Number(focused.getAttribute('data-avatar-slot'));
    if (!focused.hasAttribute('data-avatar-slot') || Number.isNaN(index)) return false;
    const column = index % COLUMNS;
    switch (step) {
      case 'up':
        return index < COLUMNS && this.page() > 0 && this.turn(-1, (ROWS - 1) * COLUMNS + column);
      case 'down':
        return index >= (ROWS - 1) * COLUMNS && this.page() < this.pageCount - 1 && this.turn(1, column);
      case 'first':
        this.page.set(0);
        this.focusSlot(0);
        return true;
      case 'last':
        this.page.set(this.pageCount - 1);
        this.focusSlot(PER_PAGE - 1);
        return true;
    }
  }

  /**
   * Turns the page (L/R keep the focused tile's place, clamped to the page's last avatar). At either
   * end nothing happens, but the press is still used (L would close the card otherwise).
   */
  private turn(step: 1 | -1, slot: number | null): boolean {
    const page = this.page() + step;
    if (page < 0 || page >= this.pageCount) return true;
    const focused = this.navigation.focused()?.getAttribute('data-avatar-slot');
    this.page.set(page);
    this.focusSlot(slot ?? (focused ? Number(focused) : 0));
    return true;
  }

  /**
   * Starts downloading a page's sprites before it's shown (a page is 40 of them, slow on the
   * console), so turning to it only waits for what's left. Off the DOM: nothing is drawn.
   */
  private prefetch(page: number): void {
    if (page < 0) return;
    for (const avatar of AVATAR_CHOICES.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) {
      const src = avatarUrl(avatar);
      if (this.prefetched.has(src)) continue;
      this.prefetched.add(src);
      new Image().src = src;
    }
  }

  /**
   * Focuses the tile at a place (the page's last avatar past its end) once the page is rendered: the
   * tiles stay, only their sprites change, but a last page's hidden tile only shows then.
   */
  private focusSlot(index: number): void {
    const count = this.pageAvatars().filter((avatar) => avatar !== null).length;
    const target = Math.min(index, count - 1);
    this.prefetch(this.page() - 1);
    this.prefetch(this.page() + 1);
    // Presses come from the controller's polling, outside Angular's events: render explicitly.
    this.render.request();
    afterNextRender(
      () => {
        const tile = this.tiles()[target];
        if (tile) this.navigation.focus(tile.nativeElement);
      },
      { injector: this.injector },
    );
  }
}
