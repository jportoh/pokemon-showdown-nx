import { NgOptimizedImage } from '@angular/common';
import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ShowdownFormats } from '@features/connection/showdown-formats';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { AvatarPicker } from '@features/trainer-card/components/avatar-picker/avatar-picker';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { LadderRating, LadderRatings } from '@features/trainer-card/state/ladder-ratings';
import { PlayerDetails } from '@features/trainer-card/state/player-details';
import { RetroBox } from '@shared/components/retro-box';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';
import { toId } from '@shared/utils/to-id';

/** Ladder rows the card has room for: the best ones. */
const SHOWN_RATINGS = 4;

/** A ladder row as shown: the format's name and the numbers as text. */
interface RatingRow {
  format: string;
  elo: string;
  gxe: string;
  record: string;
  label: string;
}

/**
 * A Trainer Card, Gen 3 style, 1088x568 (as the login box): the avatar in a frame, the name and
 * totals across every ladder (battles, wins and losses, win rate), and the best ladder ratings.
 * The player's own (the home screen's L, registered players only: guests have no ratings), where A
 * on the avatar opens the avatar picker over the card; or someone else's (`player`, e.g. whoever
 * challenges us), whose avatar comes from the server's user details. The data is loaded each time
 * it's shown. B or its Close button closes it (L too, from the home screen).
 * Brewser layout rules apply (see styles.css): fixed sizes, the rows always mounted as slots toggled
 * on normal-flow wrappers, text boxes at the text's natural line height.
 */
@Component({
  imports: [AvatarPicker, BackAction, NgOptimizedImage, RetroBox],
  selector: 'app-trainer-card',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-[568px] w-[1088px]' },
  template: `
    <app-retro-box [width]="1088" [height]="568">
      <section aria-labelledby="trainer-card-title" (appBack)="closed.emit()">
        <!-- The card, hidden (not removed) while the avatar is being chosen over it. -->
        <div class="block" [class.hidden]="picking()">
        <h2 id="trainer-card-title" class="absolute top-[28px] left-[48px] block h-12 w-[640px] text-[40px] leading-[48px] font-bold">Trainer Card</h2>
        <button
          #closeButton
          type="button"
          [class]="secondaryClass"
          class="absolute top-[28px] left-[876px] h-12 w-[158px] text-xl"
          aria-label="Close the Trainer Card"
          (click)="closed.emit()"
        >
          <span aria-hidden="true" class="absolute top-[8px] left-[10px] block h-7 w-10 rounded-sm bg-retro-select text-center leading-7">B</span>
          <span aria-hidden="true" class="absolute top-0 left-[54px] block h-11 w-[90px] text-center leading-[44px]">Close</span>
        </button>
        <div aria-hidden="true" class="absolute top-[92px] left-[48px] block h-[3px] w-[986px] bg-retro-outline"></div>

        <dl class="block">
          @for (row of details(); track $index; let i = $index) {
            <div class="block">
              <dt class="absolute left-[48px] block h-7 w-[248px] text-xl leading-7 text-retro-muted" [style.top.px]="126 + i * 52">{{ row.label }}</dt>
              <dd class="absolute left-[308px] block h-8 w-[480px] overflow-hidden text-2xl leading-8 font-bold whitespace-nowrap" [style.top.px]="124 + i * 52">{{ row.value }}</dd>
              <div aria-hidden="true" class="absolute left-[48px] block h-[2px] w-[740px] bg-retro-select" [style.top.px]="160 + i * 52"></div>
            </div>
          }
        </dl>

        <!--
          The avatar, twice its 80px size: one new img per sprite (Brewser doesn't repaint a changed src).
          The player's own is in a frame that's also the button to change it. Only one of the two frames
          exists (a card is either's for good): an img created inside a hidden frame was drawn anyway, at
          the card's top left, on the console (2026-09-28).
        -->
        @if (isSelf()) {
        <button
          #avatarButton
          type="button"
          class="absolute top-[112px] left-[826px] block size-[208px] cursor-pointer rounded-lg border-4 border-retro-outline bg-retro-bg hover:bg-retro-select"
          [attr.aria-label]="avatarLabel()"
          (click)="startPicking()"
        >
          @for (src of avatarSrc(); track src) {
            <img [ngSrc]="src" width="80" height="80" alt="" class="absolute top-[4px] left-[20px] block size-40 max-w-none [image-rendering:pixelated]" />
          }
          <span aria-hidden="true" class="absolute top-[168px] left-[8px] block h-7 w-[184px] rounded-sm bg-retro-select text-center text-lg leading-7 font-bold text-retro-ink">Change avatar</span>
        </button>
        } @else {
          <!-- Someone else's: only shown, centred, once the server has said which it is (one img, not two). -->
          <div class="absolute top-[112px] left-[826px] block size-[208px] rounded-lg border-4 border-retro-outline bg-retro-bg">
            @for (src of othersAvatarSrc(); track src) {
              <img [ngSrc]="src" width="80" height="80" [alt]="avatarAlt()" class="absolute top-[20px] left-[20px] block size-40 max-w-none [image-rendering:pixelated]" />
            }
          </div>
        }

        <div aria-hidden="true" class="absolute top-[336px] left-[48px] block h-[3px] w-[986px] bg-retro-outline"></div>
        <h3 id="trainer-card-ladder-title" class="absolute top-[352px] left-[48px] block h-7 w-[480px] text-xl leading-7 font-bold">{{ ladderTitle() }}</h3>
        <div aria-hidden="true" class="block" [class.hidden]="rows().length === 0">
          <span class="absolute top-[354px] left-[580px] block h-6 w-[120px] text-lg leading-6 text-retro-muted">Elo</span>
          <span class="absolute top-[354px] left-[720px] block h-6 w-[120px] text-lg leading-6 text-retro-muted">GXE</span>
          <span class="absolute top-[354px] left-[860px] block h-6 w-[174px] text-lg leading-6 text-retro-muted">W – L</span>
        </div>

        <ul aria-labelledby="trainer-card-ladder-title" class="block">
          @for (slot of slots; track $index) {
            <li class="block" [class.hidden]="!rows()[slot]" [attr.aria-label]="rows()[slot]?.label">
              <span aria-hidden="true" class="absolute left-[48px] block h-7 w-[516px] overflow-hidden text-xl leading-7 whitespace-nowrap" [style.top.px]="396 + slot * 40">{{ rows()[slot]?.format }}</span>
              <span aria-hidden="true" class="absolute left-[580px] block h-7 w-[120px] text-xl leading-7 font-bold" [style.top.px]="396 + slot * 40">{{ rows()[slot]?.elo }}</span>
              <span aria-hidden="true" class="absolute left-[720px] block h-7 w-[120px] text-xl leading-7" [style.top.px]="396 + slot * 40">{{ rows()[slot]?.gxe }}</span>
              <span aria-hidden="true" class="absolute left-[860px] block h-7 w-[174px] text-xl leading-7" [style.top.px]="396 + slot * 40">{{ rows()[slot]?.record }}</span>
            </li>
          }
        </ul>
        <p id="trainer-card-ladder" role="status" class="absolute top-[396px] left-[48px] block h-7 w-[986px] text-xl leading-7" [class]="ladderMessage().error ? 'text-retro-danger' : 'text-retro-muted'" [class.hidden]="!ladderMessage().text">
          {{ ladderMessage().text }}
        </p>
        </div>

        <!--
          Mounted the first time it opens, then only hidden: removed, it stayed painted over the card on
          Brewser (device, 2026-09-28).
        -->
        @if (pickerMounted()) {
          <div class="block" [class.hidden]="!picking()">
            <app-avatar-picker class="absolute top-0 left-0" [avatar]="login.state().avatar" [active]="picking()" (picked)="pick($event)" (closed)="stopPicking()" />
          </div>
        }
      </section>
    </app-retro-box>
  `,
})
export class TrainerCard {
  private readonly navigation = inject(KeyboardNavigation);
  protected readonly login = inject(ShowdownLogin);
  private readonly injector = inject(Injector);
  private readonly formats = inject(ShowdownFormats);
  private readonly ladder = inject(LadderRatings);
  private readonly playerDetails = inject(PlayerDetails);
  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly avatarButton = viewChild<ElementRef<HTMLButtonElement>>('avatarButton');

  /** Whose card: someone else's by name, or the player's own (null). */
  readonly player = input<string | null>(null);
  /**
   * Shown. A page that keeps the card mounted and hides it passes this (removed, it would stay painted
   * on Brewser): each showing loads the player's ratings again and focuses Close.
   */
  readonly active = input(true);
  readonly closed = output<void>();

  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;
  protected readonly slots = Array.from({ length: SHOWN_RATINGS }, (_, i) => i);

  private readonly userId = computed(() => toId(this.player() ?? '') || this.login.userId());
  protected readonly isSelf = computed(() => this.userId() === this.login.userId());
  /** The details loaded for someone else (none while another player's are still there). */
  private readonly others = computed(() => {
    const state = this.playerDetails.state();
    return state.userId === this.userId() ? state : null;
  });
  protected readonly name = computed(() => (this.isSelf() ? this.login.state().name : this.others()?.name || (this.player() ?? '')));
  private readonly avatar = computed(() => (this.isSelf() ? this.login.state().avatar : (this.others()?.avatar ?? '')));

  protected readonly avatarSrc = computed(() => [avatarUrl(this.avatar())]);
  protected readonly othersAvatarSrc = computed(() => (this.others()?.status === 'loaded' ? [avatarUrl(this.avatar())] : []));
  protected readonly avatarLabel = computed(() => `${this.name()}'s avatar: change it`);
  protected readonly avatarAlt = computed(() => `${this.name()}'s avatar`);
  /** The avatar picker is shown over the card. */
  protected readonly picking = signal(false);
  protected readonly pickerMounted = signal(false);

  /** The ratings loaded for the player shown (none while another player's are still there). */
  private readonly ratings = computed(() => {
    const state = this.ladder.state();
    return state.userId === this.userId() ? state.ratings : [];
  });

  private readonly loading = computed(() => this.ladder.state().status === 'loading' && this.ratings().length === 0);

  protected readonly details = computed(() => {
    const ratings = this.ratings();
    const pending = this.loading() ? '…' : null;
    const wins = sum(ratings, (rating) => rating.wins);
    const losses = sum(ratings, (rating) => rating.losses);
    const ties = sum(ratings, (rating) => rating.ties);
    return [
      { label: 'Name', value: this.name() },
      { label: 'Battles', value: pending ?? String(wins + losses + ties) },
      { label: 'Wins – Losses', value: pending ?? `${wins} – ${losses}` },
      { label: 'Win rate', value: pending ?? winRate(wins, losses) },
    ];
  });

  protected readonly rows = computed<RatingRow[]>(() =>
    this.ratings()
      .slice(0, SHOWN_RATINGS)
      .map((rating) => {
        const format = this.formats.name(rating.formatId);
        const gxe = `${rating.gxe.toFixed(1)}%`;
        return {
          format,
          elo: String(rating.elo),
          gxe,
          record: `${rating.wins} – ${rating.losses}`,
          label: `${format}: Elo ${rating.elo}, GXE ${gxe}, ${rating.wins} wins, ${rating.losses} losses`,
        };
      }),
  );

  protected readonly ladderTitle = computed(() => {
    const count = this.ratings().length;
    return count > SHOWN_RATINGS ? `Ladder · best ${SHOWN_RATINGS} of ${count}` : 'Ladder';
  });

  /** In place of the rows: loading, why they couldn't load, or that there are none yet. */
  protected readonly ladderMessage = computed(() => {
    const status = this.ladder.state().status;
    if (this.ratings().length > 0) return { text: '', error: false };
    if (status === 'error') return { text: "Couldn't load the ratings from Showdown.", error: true };
    if (status === 'loaded') return { text: 'No ladder battles yet.', error: false };
    return { text: 'Loading ratings…', error: false };
  });

  constructor() {
    // Each showing, and each other player shown (only these are tracked): their data, and Close focused.
    effect(() => {
      if (!this.active()) return;
      const userId = this.userId();
      untracked(() => {
        this.ladder.load(userId);
        if (!this.isSelf()) this.playerDetails.load(this.player() ?? userId);
        afterNextRender(() => this.navigation.focus(this.closeButton().nativeElement), { injector: this.injector });
      });
    });
  }

  protected startPicking(): void {
    this.pickerMounted.set(true);
    this.picking.set(true);
  }

  protected pick(avatar: string): void {
    this.login.setAvatar(avatar);
    this.stopPicking();
  }

  /** Back to the card, on its avatar. */
  protected stopPicking(): void {
    this.picking.set(false);
    afterNextRender(
      () => {
        const button = this.avatarButton();
        if (button) this.navigation.focus(button.nativeElement);
      },
      { injector: this.injector },
    );
  }
}

function sum(ratings: readonly LadderRating[], value: (rating: LadderRating) => number): number {
  return ratings.reduce((total, rating) => total + value(rating), 0);
}

/** "52%" of the games won (ties left out), or a dash before any. */
function winRate(wins: number, losses: number): string {
  return wins + losses === 0 ? '—' : `${Math.round((wins / (wins + losses)) * 100)}%`;
}
