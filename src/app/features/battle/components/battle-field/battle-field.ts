import { Component, DestroyRef, ElementRef, WritableSignal, afterRenderEffect, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { nextFrame, outAndBack, stepAnimation } from '@features/battle/animation/step-animation';
import { BattleHpBox, HpBoxEmphasis } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { BattleResult } from '@features/battle/components/battle-result/battle-result';
import { EffectPoint, EffectTarget, MoveEffects } from '@features/battle/components/move-effects/move-effects';
import { BattlePokemon, EffectPopup, FieldEvent, HpChange, MoveAction, SlotKey, StatChange, StatusChange } from '@features/battle/models/battle';
import { ChampionsDex } from '@core/dex/champions-dex';
import { BattleStore } from '@features/battle/state/battle-store';
import { STATUS } from '@features/battle/state/status-conditions';
import { ItemIcon } from '@shared/components/item-icon';
import { PokemonSprite, spriteUrl } from '@shared/components/pokemon-sprite';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

// Animation lengths at normal speed; the replay speed divides them, as it does the log's steps
// (a move's step lasts 1100 ms, an HP change 600 ms).
const LUNGE_MS = 600;
/**
 * How far the attacker lunges: a share of the way to its target, within bounds (a foe across the
 * field is ~750px away in doubles, an ally beside it ~270px).
 */
const LUNGE_SHARE = 0.25;
const LUNGE_MIN_PX = 72;
const LUNGE_MAX_PX = 180;
/** A move with no target (or aimed at itself): a hop in place. */
const HOP_PX = 24;
/** A special move's user glows while its attack gathers. */
const GLOW_MS = 420;
const GLOW_BRIGHTNESS = 1.8;
const BLINK_MS = 540;
const BLINKS = 6;
/** Blinks dim the sprite: Brewser ignores visibility changes, but opacity works (probe N1). */
const BLINK_OPACITY = '0.2';
const FAINT_MS = 500;
const FAINT_DROP_PX = 64;
/** Withdrawals and send-outs: sideways towards (or from) the trainer's side, fading. */
const SWITCH_MS = 450;
const SWITCH_PX = 140;
/** Longest wait for a sprite that's still downloading before it animates in anyway. */
const IMAGE_WAIT_MS = 1500;
/** Mega Evolution: the new sprite starts white and pulses back to its colours. */
const MEGA_MS = 900;
const MEGA_BRIGHTNESS = 4;
/** Protect: a shield pulses around the Pokémon, three times. */
const SHIELD_MS = 900;
const SHIELD_PULSES = 3;
const SHIELD_OPACITY = 0.55;
/** The move banner, placed over its user. */
const BANNER_WIDTH = 240;
/** The player's banners stop short of their status boxes (x ≥ 600). */
const OWN_BANNER_MAX_LEFT = 595 - BANNER_WIDTH;
const FOE_BANNER_MAX_LEFT = 985 - 8 - BANNER_WIDTH;
/** How long an ability's or item's pop-up stays at normal speed (a log step lasts 1100 ms). */
const POPUP_MS = 1400;
/** The "-45%" / "+12%" label over a Pokémon: about the length of the HP step it comes with. */
const HP_LABEL_MS = 1100;
const HP_LABEL_WIDTH = 76;
const HP_LOST_COLOR = '#b91c1c';
const HP_RESTORED_COLOR = '#15803d';
/** "Critical hit!" beside the HP label, the pair centred over the Pokémon. */
const CRIT_LABEL_WIDTH = 128;
const CRIT_LABEL_GAP = 6;
const CRIT_COLOR = '#b45309';
/** "Burned!", "Badly poisoned!": this far under the HP label, stays as long as an ability pop-up. */
const STATUS_LABEL_WIDTH = 150;
const STATUS_LABEL_DROP = 36;
/** "Attack +1" in the same place (a status and a stat change rarely come together), coloured as the status boxes' stage chips. */
const STAT_LABEL_WIDTH = 150;
const STAT_UP_COLOR = '#15803d';
const STAT_DOWN_COLOR = '#b91c1c';
const STAT_NAMES: Record<string, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
};

/**
 * Where each Pokémon stands: its platform's centre (x) and its feet (y), and where its status box
 * goes. The player's stand below the bottom edge, seen from behind and cut off as in Gen 3.
 */
interface Stand {
  x: number;
  y: number;
  boxLeft: number;
  boxTop: number;
}

/**
 * A field layout: the sprites' size (a multiple of Showdown's 96px; Gen 3 doubled its own) and where
 * each Pokémon stands. Platforms, shields, labels and banners follow from them.
 */
interface FieldLayout {
  spriteSize: number;
  stands: Record<SlotKey, Stand>;
}

/**
 * Doubles at 2.5x (3x doesn't fit: the opponent's two would overlap and run off the field). The
 * opponent's first slot is on the right, as it faces the player. Their status boxes top left, the
 * player's bottom right.
 */
const DOUBLES: FieldLayout = {
  spriteSize: Math.round(96 * 2.5),
  stands: {
    p2a: { x: 850, y: 228, boxLeft: 20, boxTop: 30 },
    p2b: { x: 600, y: 228, boxLeft: 44, boxTop: 126 },
    p1a: { x: 150, y: 494, boxLeft: 600, boxTop: 310 },
    p1b: { x: 420, y: 494, boxLeft: 616, boxTop: 404 },
  },
};

/**
 * Singles at 3x, as the third-generation games lay them out: the opponent's Pokémon back right, the
 * player's front left, each status box on the other side of the field from its Pokémon. The
 * opponent stands a little lower than in doubles, so its bigger sprite isn't cut by the top edge.
 */
const SINGLES: FieldLayout = {
  spriteSize: 96 * 3,
  stands: {
    p2a: { x: 720, y: 250, boxLeft: 40, boxTop: 60 },
    p1a: { x: 260, y: 494, boxLeft: 608, boxTop: 356 },
  },
};

/** The player's platforms are cut off by the bottom edge: this tall, from here. */
const OWN_PLATFORM_HEIGHT = 96;
const OWN_PLATFORM_TOP = 452;

/** The sprite box of a Pokémon standing there. */
function spriteBox(stand: Stand, size: number): { left: number; top: number } {
  // Showdown's sprites have the feet about 10px (of 96) above the bottom of their box.
  const feetGap = Math.round((10 * size) / 96);
  return { left: stand.x - size / 2, top: stand.y + feetGap - size };
}

const DEFAULT_SKY = '#d8ecc0';
const DEFAULT_GROUND = { ground: '#b0d890', platform: '#90c070', edge: '#6a9a50' };

/** Terrains colour the ground and the platforms. */
const TERRAIN_COLORS: Record<string, typeof DEFAULT_GROUND> = {
  'Grassy Terrain': { ground: '#7cc860', platform: '#58a838', edge: '#3c7a22' },
  'Psychic Terrain': { ground: '#d8a0d8', platform: '#c078c0', edge: '#8c4c8c' },
  'Electric Terrain': { ground: '#f0d860', platform: '#e0c040', edge: '#a88c20' },
  'Misty Terrain': { ground: '#f4c0dc', platform: '#e8a0c8', edge: '#b06890' },
};

/** A terrain tints the sky too, unless there's weather. */
const TERRAIN_SKY: Record<string, string> = {
  'Grassy Terrain': '#d0f0b8',
  'Psychic Terrain': '#f0d8f0',
  'Electric Terrain': '#fbf4c8',
  'Misty Terrain': '#fbe4f0',
};

const WEATHER_SKY: Record<string, string> = {
  SunnyDay: '#fbe6a8',
  DesolateLand: '#f8c888',
  RainDance: '#a8bccc',
  PrimordialSea: '#8ca0b4',
  Sandstorm: '#e2cc98',
  Snowscape: '#e6eef6',
  Snow: '#e6eef6',
  Hail: '#e6eef6',
  DeltaStream: '#c8dce0',
};

interface FieldSlot {
  key: string;
  pokemon: BattlePokemon | null;
  /** Sprite position and size (px). */
  left: number;
  top: number;
  size: number;
  /** Status box position (px). */
  boxLeft: number;
  boxTop: number;
}

/**
 * The battlefield, laid out like the third-generation games' double battles: the opponent's two
 * Pokémon on platforms at the back right, with their status boxes top left; the player's two seen
 * from behind at the front left, with their status boxes on the right. The opponent's side faces the
 * player, so its first slot stands on the right. A single battle has one Pokémon a side, in the
 * same places as the games' single battles, with everything else as in doubles. Fixed 985x500 (most of the stage, with the teams and
 * conditions in a column on the right), all positions absolute. The terrain colours the ground and the
 * platforms, the weather the sky, and Trick Room frames the field.
 *
 * Moves animate so it's clear who hit whom without reading the log: a physical move's user lunges at
 * its target (a hop when it has none), a special move's glows and sends an orb flying, a status
 * move's spreads rings around the Pokémon it affects (see MoveEffects); a banner names the move on
 * its type's colour, the status boxes of the attacker (yellow) and its targets (red) stand out, each
 * target it damages blinks under a burst as the hit lands (its HP drops a step later), and a fainted
 * Pokémon sinks and fades out. A stat stage raised sends green streaks rising over the Pokémon with an
 * "Attack +1" label; one lowered, red streaks falling and "Speed -1". A withdrawn Pokémon slides away towards its trainer's side
 * (left for the player's, right for the opponent's) and fades; the next one slides in from there,
 * once its sprite has loaded (preloaded from team preview). Mega Evolution flashes the new sprite
 * white, and Protect pulses a shield around the Pokémon. Abilities (Intimidate, Drizzle, Stamina…)
 * and held items (Sitrus Berry, Leftovers, Eject Button…) taking effect pop up over their Pokémon a
 * little below where moves show: gold-edged for abilities, teal with the item's icon for items.
 * Notices show the same way, grey-edged: "Missed!" or "No effect!" over the Pokémon a move didn't
 * touch, "Taunted!" over one that couldn't use its move, "Perish in 2 turns" over each Pokémon
 * counting down. Frames step on requestAnimationFrame over the sprites' inline
 * styles (see stepAnimation).
 */
@Component({
  selector: 'app-battle-field',
  imports: [BattleHpBox, BattleResult, ItemIcon, MoveEffects, PokemonSprite],
  host: { class: 'block h-[500px] w-[985px]' },
  template: `
    <div class="relative h-[500px] w-[985px] overflow-hidden" [style.background-color]="palette().sky">
      <div class="absolute top-[300px] left-0 h-[200px] w-[985px]" [style.background-color]="palette().ground"></div>
      <!-- Platforms: the opponent's at the back, the player's cut off by the bottom edge. -->
      @for (platform of platforms(); track platform.key) {
        <div
          class="absolute rounded-[50%] border-[3px]"
          [style.left.px]="platform.left"
          [style.top.px]="platform.top"
          [style.width.px]="platform.width"
          [style.height.px]="platform.height"
          [style.background-color]="palette().platform"
          [style.border-color]="palette().edge"
        ></div>
      }

      @for (slot of foeSlots(); track slot.key) {
        @if (slot.pokemon && (!slot.pokemon.fainted || fainting() === slot.key)) {
          <app-pokemon-sprite
            class="absolute [image-rendering:pixelated]"
            [attr.data-slot]="slot.key"
            [style.left.px]="slot.left"
            [style.top.px]="slot.top"
            [sprite]="slot.pokemon.sprite"
            [size]="slot.size"
          />
        }
        @if (slot.pokemon && !slot.pokemon.fainted) {
          <app-battle-hp-box
            class="absolute"
            [style.left.px]="slot.boxLeft"
            [style.top.px]="slot.boxTop"
            [pokemon]="slot.pokemon"
            [emphasis]="emphasis()[slot.key] ?? null"
          />
        }
      }
      @for (slot of ownSlots(); track slot.key) {
        @if (slot.pokemon && (!slot.pokemon.fainted || fainting() === slot.key)) {
          <app-pokemon-sprite
            class="absolute [image-rendering:pixelated]"
            [attr.data-slot]="slot.key"
            [style.left.px]="slot.left"
            [style.top.px]="slot.top"
            [sprite]="slot.pokemon.sprite"
            [size]="slot.size"
            [back]="true"
          />
        }
        @if (slot.pokemon && !slot.pokemon.fainted) {
          <app-battle-hp-box
            class="absolute"
            [style.left.px]="slot.boxLeft"
            [style.top.px]="slot.boxTop"
            [pokemon]="slot.pokemon"
            [own]="true"
            [exact]="!store.watching()"
            [emphasis]="emphasis()[slot.key] ?? null"
          />
        }
      }
      <!-- The move's effect (bursts, orbs, rings), over the sprites. -->
      <app-move-effects />
      @for (shield of shields(); track shield.key) {
        <!-- Shown (display) only while its pulse plays. -->
        <div
          aria-hidden="true"
          class="absolute hidden rounded-full border-4 border-[#67e8f9] bg-[#a5f3fc]"
          [attr.data-shield]="shield.key"
          [style.left.px]="shield.left"
          [style.top.px]="shield.top"
          [style.width.px]="shield.size"
          [style.height.px]="shield.size"
        ></div>
      }
      @for (popup of popupBanners(); track popup.slot) {
        <div
          role="status"
          class="absolute block h-[42px] w-[240px] rounded-md border-2 bg-[#1f2937] text-white"
          [class]="popup.kind === 'item' ? 'border-[#2dd4bf]' : popup.kind === 'notice' ? 'border-[#9ca3af]' : 'border-[#facc15]'"
          [style.left.px]="popup.left"
          [style.top.px]="popup.top"
        >
          @if (popup.kind === 'item') {
            <app-item-icon class="absolute top-[3px] left-[4px]" [item]="popup.itemId" [size]="32" />
            <span class="absolute top-[1px] left-[40px] block h-5 w-[192px] overflow-hidden text-center text-base leading-5 font-bold whitespace-nowrap text-[#99f6e4]">{{ popup.name }}</span>
            <span class="absolute top-[21px] left-[40px] block h-4 w-[192px] overflow-hidden text-center text-xs leading-4 whitespace-nowrap">{{ popup.owner }}</span>
          } @else {
            <span
              class="absolute top-[1px] left-0 block h-5 w-[236px] overflow-hidden text-center text-base leading-5 font-bold whitespace-nowrap"
              [class]="popup.kind === 'notice' ? 'text-white' : 'text-[#fde68a]'"
              >{{ popup.name }}</span
            >
            <span class="absolute top-[21px] left-0 block h-4 w-[236px] overflow-hidden text-center text-xs leading-4 whitespace-nowrap">{{ popup.owner }}</span>
          }
        </div>
      }
      <!-- HP lost or restored, over the Pokémon while its bar moves; the log says the same. -->
      @for (label of hpLabels(); track label.slot) {
        <span
          aria-hidden="true"
          class="absolute block h-[32px] w-[76px] rounded-md border-2 border-white text-center text-lg leading-7 font-bold text-white"
          [style.left.px]="label.left"
          [style.top.px]="label.top"
          [style.background-color]="label.color"
          >{{ label.text }}</span
        >
        @if (label.crit) {
          <span
            aria-hidden="true"
            class="absolute block h-[32px] w-[128px] rounded-md border-2 border-white text-center text-base leading-7 font-bold text-white"
            [style.left.px]="label.critLeft"
            [style.top.px]="label.top"
            [style.background-color]="critColor"
            >Critical hit!</span
          >
        }
      }
      <!-- A status just inflicted ("Burned!"), in its colour, under the HP label; the log says it too. -->
      @for (label of statusLabels(); track label.slot) {
        <span
          aria-hidden="true"
          class="absolute block h-[32px] w-[150px] rounded-md border-2 border-white text-center text-base leading-7 font-bold text-white"
          [style.left.px]="label.left"
          [style.top.px]="label.top"
          [style.background-color]="label.color"
          >{{ label.text }}</span
        >
      }
      <!-- A stat stage raised or lowered ("Attack +1"), where status labels go; the log says it too. -->
      @for (label of statLabels(); track label.slot) {
        <span
          aria-hidden="true"
          class="absolute block h-[32px] w-[150px] rounded-md border-2 border-white text-center text-base leading-7 font-bold text-white"
          [style.left.px]="label.left"
          [style.top.px]="label.top"
          [style.background-color]="label.color"
          >{{ label.text }}</span
        >
      }
      @if (banner(); as b) {
        <div
          role="status"
          class="absolute block h-[42px] w-[240px] rounded-md border-2 border-white text-white"
          [style.left.px]="b.left"
          [style.top.px]="b.top"
          [style.background-color]="b.color"
        >
          <span class="absolute top-[1px] left-0 block h-5 w-[236px] overflow-hidden text-center text-base leading-5 font-bold whitespace-nowrap">{{ b.move }}</span>
          <span class="absolute top-[21px] left-0 block h-4 w-[236px] overflow-hidden text-center text-xs leading-4 whitespace-nowrap">{{ b.detail }}</span>
        </div>
      }
      @if (store.intro(); as intro) {
        <!-- The battle's title, before the first Pokémon come out (their sprites download meanwhile). -->
        <div role="status" class="absolute top-[184px] left-[232px] block h-[132px] w-[520px] rounded-md border-2 border-white bg-[#1f2937] text-white">
          <span class="absolute top-[14px] left-0 block h-9 w-[516px] overflow-hidden text-center text-2xl leading-9 font-bold whitespace-nowrap">{{ intro.p1 }}</span>
          <span class="absolute top-[50px] left-0 block h-7 w-[516px] text-center text-lg leading-7 font-bold text-[#fde68a]">vs</span>
          <span class="absolute top-[78px] left-0 block h-9 w-[516px] overflow-hidden text-center text-2xl leading-9 font-bold whitespace-nowrap">{{ intro.p2 }}</span>
        </div>
      }
      @if (trickRoom()) {
        <!-- Trick Room: the field framed in violet, as the move's twisted dimensions. -->
        <div aria-hidden="true" class="absolute top-0 left-0 h-[500px] w-[985px] border-[6px] border-[#a855f7]"></div>
      }
      <!-- Who won, once the battle is over (and the ratings, in a rated battle). -->
      <app-battle-result />
    </div>
  `,
})
export class BattleField {
  protected readonly store = inject(BattleStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dex = inject(ChampionsDex);
  private readonly effects = viewChild(MoveEffects);
  /** Sprites already asked for, so team preview's are fetched once. */
  private readonly preloaded = new Set<string>();

  /** Running animations by slot, so a new one on the same sprite replaces the old. */
  private readonly running = new Map<SlotKey, () => void>();
  /** The last faint whose animation has finished (its sprite can go). */
  private readonly faintDone = signal(-1);
  /** The Pokémon each slot's sprite showed at the last render. */
  private readonly shownIdents = new Map<SlotKey, string>();

  /** The slot whose Pokémon is fainting right now: its sprite stays until it has dropped out. */
  protected readonly fainting = computed(() => {
    const event = this.store.fieldEvent();
    return event?.kind === 'faint' && event.id !== this.faintDone() ? event.slot : null;
  });

  /** The move's attacker (yellow) and targets (red), for their status boxes. */
  protected readonly emphasis = computed(() => {
    const action = this.store.action();
    const emphasis: Record<SlotKey, HpBoxEmphasis> = {};
    if (!action) return emphasis;
    for (const target of action.targets) emphasis[target] = 'target';
    emphasis[action.attacker] = 'attacker';
    return emphasis;
  });

  /** "Heat Wave" on Fire's colour, "Charizard → Farigiraf & Sylveon". */
  protected readonly banner = computed(() => {
    const action = this.store.action();
    if (!action) return null;
    const name = (slot: SlotKey) => this.pokemonAt(slot)?.name ?? '';
    const targets = action.targets.filter((t) => t !== action.attacker).map(name).filter(Boolean);
    const detail = targets.length > 0 ? `${name(action.attacker)} → ${targets.join(' & ')}` : name(action.attacker);
    return { move: action.move, detail, color: typeColor(action.type) || '#374151', ...this.bannerPosition(action.attacker, 0) };
  });

  /** The pop-ups being shown, one per slot at most; each goes after POPUP_MS (see showBySlot). */
  private readonly shownPopups = signal<readonly EffectPopup[]>([]);

  protected readonly popupBanners = computed(() =>
    this.shownPopups().map((popup) => ({
      ...popup,
      itemId: toId(popup.name),
      owner: this.pokemonAt(popup.slot)?.name ?? '',
      ...this.bannerPosition(popup.slot, 46),
    })),
  );

  protected readonly critColor = CRIT_COLOR;

  /** The HP labels being shown, one per slot at most; each goes after HP_LABEL_MS. */
  private readonly shownHpChanges = signal<readonly HpChange[]>([]);

  protected readonly hpLabels = computed(() =>
    this.shownHpChanges().map(({ slot, change, crit }) => {
      const { top } = this.hpLabelPosition(slot);
      const left = crit ? this.centredOver(slot, HP_LABEL_WIDTH + CRIT_LABEL_GAP + CRIT_LABEL_WIDTH) : this.centredOver(slot, HP_LABEL_WIDTH);
      return {
        slot,
        text: `${change > 0 ? '+' : ''}${change}%`,
        color: change < 0 ? HP_LOST_COLOR : HP_RESTORED_COLOR,
        crit: !!crit,
        left,
        top,
        critLeft: left + HP_LABEL_WIDTH + CRIT_LABEL_GAP,
      };
    }),
  );

  /** The status labels being shown, one per slot at most; each goes after POPUP_MS. */
  private readonly shownStatusChanges = signal<readonly StatusChange[]>([]);

  protected readonly statusLabels = computed(() =>
    this.shownStatusChanges().map(({ slot, status }) => {
      const info = STATUS[status];
      const name = info?.name ?? status;
      return {
        slot,
        text: `${name[0].toUpperCase()}${name.slice(1)}!`,
        color: info?.color ?? '#374151',
        left: this.centredOver(slot, STATUS_LABEL_WIDTH),
        top: this.hpLabelPosition(slot).top + STATUS_LABEL_DROP,
      };
    }),
  );

  /** The stat labels being shown, one per slot at most; each goes after POPUP_MS. */
  private readonly shownStatChanges = signal<readonly StatChange[]>([]);

  protected readonly statLabels = computed(() =>
    this.shownStatChanges().map(({ slot, stat, amount }) => ({
      slot,
      text: `${STAT_NAMES[stat] ?? stat} ${amount > 0 ? '+' : ''}${amount}`,
      color: amount > 0 ? STAT_UP_COLOR : STAT_DOWN_COLOR,
      left: this.centredOver(slot, STAT_LABEL_WIDTH),
      top: this.hpLabelPosition(slot).top + STATUS_LABEL_DROP,
    })),
  );

  /** One Pokémon per side in singles (bigger), two in doubles. */
  private readonly layout = computed(() => (this.store.gameType() === 'singles' ? SINGLES : DOUBLES));

  /** The opponent's as wide as a sprite, the player's wider (nearer) and cut off. */
  protected readonly platforms = computed(() => {
    const { spriteSize, stands } = this.layout();
    return Object.entries(stands).map(([key, stand]) => {
      const own = key.startsWith('p1');
      const width = Math.round(own ? spriteSize * 1.25 : spriteSize);
      const height = own ? OWN_PLATFORM_HEIGHT : Math.round(spriteSize * 0.27);
      const top = own ? OWN_PLATFORM_TOP : Math.round(stand.y - height / 2);
      return { key, left: Math.round(stand.x - width / 2), top, width, height };
    });
  });

  /** Protect's shields, centred on the sprite's body (a little below its middle). */
  protected readonly shields = computed(() => {
    const { spriteSize, stands } = this.layout();
    const size = Math.round(spriteSize * 0.83);
    return Object.entries(stands).map(([key, stand]) => {
      const { top } = spriteBox(stand, spriteSize);
      return { key, size, left: Math.round(stand.x - size / 2), top: Math.round(top + spriteSize * 0.55 - size / 2) };
    });
  });

  protected readonly palette = computed(() => {
    const { weather, terrain } = this.store.field();
    const ground = (terrain && TERRAIN_COLORS[terrain.id]) || DEFAULT_GROUND;
    const sky = (weather && WEATHER_SKY[weather.id]) || (terrain && TERRAIN_SKY[terrain.id]) || DEFAULT_SKY;
    return { sky, ...ground };
  });

  protected readonly trickRoom = computed(() => this.store.field().rooms.some((room) => room.id === 'Trick Room'));

  // Front and back sprites are the same size, as in Gen 3.
  protected readonly foeSlots = computed(() => this.slotsOf('p2'));
  protected readonly ownSlots = computed(() => this.slotsOf('p1'));

  constructor() {
    // A new Pokémon in a slot starts from its place, fully shown, whatever the one before was doing:
    // Next turn plays a whole turn at once, so a withdrawal may still be running (or have left the
    // sprite hidden, off to the side) with no send-out to follow, as only the turn's last event
    // renders. First, so a send-out in the same render animates from there.
    afterRenderEffect(() => {
      const slots = [...this.foeSlots(), ...this.ownSlots()];
      untracked(() => {
        for (const slot of slots) {
          const ident = slot.pokemon?.ident ?? '';
          if (this.shownIdents.get(slot.key) === ident) continue;
          this.shownIdents.set(slot.key, ident);
          this.running.get(slot.key)?.();
          const el = this.sprite(slot.key);
          if (el) resetSprite(el, slot);
        }
      });
    });
    // After rendering, so the sprites the animations move are in place.
    afterRenderEffect(() => {
      const action = this.store.action();
      if (action) untracked(() => this.playMove(action));
    });
    afterRenderEffect(() => {
      const event = this.store.fieldEvent();
      if (!event) return;
      untracked(() => {
        if (event.kind === 'hit') this.blink(event.slot);
        else if (event.kind === 'faint') this.faint(event);
        else if (event.kind === 'mega' || event.kind === 'tera') this.megaFlash(event);
        else if (event.kind === 'protect') this.shieldPulse(event);
        else this.slide(event);
      });
    });
    this.showBySlot(this.store.popups, this.shownPopups, POPUP_MS);
    this.showBySlot(this.store.hpChanges, this.shownHpChanges, HP_LABEL_MS);
    this.showBySlot(this.store.statusChanges, this.shownStatusChanges, POPUP_MS);
    // Each stat change also sends streaks of light up (raised) or down (lowered) over the Pokémon.
    this.showBySlot(this.store.statChanges, this.shownStatChanges, POPUP_MS, ({ slot, amount }) => {
      const at = this.effectPoint(slot);
      if (at) this.effects()?.statChange(at, amount > 0, this.layout().spriteSize, this.store.speed());
    });

    // Team preview lists every Pokémon that may come out: their sprites are fetched ahead, so a
    // send-out doesn't wait for the download (the player's side is seen from behind). So are their
    // Megas', since it isn't known which one holds its stone: a Mega Evolution flashes the new
    // sprite straight away. Front sprites are fetched for both sides: the teams at a glance show them,
    // and some Megas have no back sprite and show the front one instead.
    afterRenderEffect(() => {
      const { p1, p2 } = this.store.sides();
      untracked(() => {
        p1.preview.forEach((species) => this.preloadWithMegas(species, true));
        p2.preview.forEach((species) => this.preloadWithMegas(species, false));
      });
    });
    this.destroyRef.onDestroy(() => this.running.forEach((stop) => stop()));
  }

  private preloadWithMegas(species: string, back: boolean): void {
    const sprite = this.dex.species(species)?.sprite ?? spriteId(species);
    this.preload(sprite, false);
    if (back) this.preload(sprite, true);
    const id = toId(species);
    for (const mega of this.dex.allMegas.filter((m) => m.base === id)) {
      this.preload(mega.sprite, false);
      if (back) this.preload(mega.sprite, true);
    }
  }

  private preload(sprite: string, back: boolean): void {
    const url = spriteUrl(sprite, back);
    if (this.preloaded.has(url)) return;
    this.preloaded.add(url);
    new Image().src = url;
  }

  /**
   * Where a banner goes over a slot's Pokémon: above the opponent's heads, or just over the
   * player's own (short of their status boxes). `drop` lowers it, so an ability's pop-up clears
   * the move banner.
   */
  /**
   * Shows the store's latest pop-ups (or HP labels), one per slot: each new one replaces its slot's
   * current one, stays for `ms` (at normal speed), then goes. A new battle empties the list, and its
   * pop-ups go with it. `onShown` runs for each new one as it shows.
   */
  private showBySlot<T extends { id: number; slot: SlotKey }>(
    source: () => readonly T[],
    shown: WritableSignal<readonly T[]>,
    ms: number,
    onShown?: (item: T) => void,
  ): void {
    let lastSeen = -1;
    const timers = new Map<SlotKey, ReturnType<typeof setTimeout>>();
    effect(() => {
      const items = source();
      untracked(() => {
        if (items.length === 0) {
          timers.forEach((timer) => clearTimeout(timer));
          timers.clear();
          shown.set([]);
          return;
        }
        for (const item of items.filter((i) => i.id > lastSeen)) {
          lastSeen = item.id;
          clearTimeout(timers.get(item.slot));
          shown.update((current) => [...current.filter((i) => i.slot !== item.slot), item]);
          onShown?.(item);
          timers.set(
            item.slot,
            setTimeout(() => {
              timers.delete(item.slot);
              shown.update((current) => current.filter((i) => i.id !== item.id));
              this.renderScheduler.request();
            }, ms / this.store.speed()),
          );
        }
      });
    });
    this.destroyRef.onDestroy(() => timers.forEach((timer) => clearTimeout(timer)));
  }

  /** Over the Pokémon, centred on its sprite. */
  private hpLabelPosition(slot: SlotKey): { left: number; top: number } {
    // The body's middle for the opponent's, higher on the player's (cut off by the bottom edge); below
    // the ability and item pop-ups either way.
    const share = slot.startsWith('p1') ? 0.36 : 0.43;
    const from = this.slotData(slot);
    return { left: this.centredOver(slot, HP_LABEL_WIDTH), top: Math.round((from?.top ?? 0) + (from?.size ?? 0) * share) };
  }

  /** The left of a label `width` wide centred on the slot's sprite. */
  private centredOver(slot: SlotKey, width: number): number {
    const from = this.slotData(slot);
    return Math.round((from?.left ?? 0) + (from?.size ?? 0) / 2 - width / 2);
  }

  private bannerPosition(slot: SlotKey, drop: number): { left: number; top: number } {
    const from = this.slotData(slot);
    const own = slot.startsWith('p1');
    const centred = (from?.left ?? 0) + (from?.size ?? 0) / 2 - BANNER_WIDTH / 2;
    const left = Math.max(8, Math.min(own ? OWN_BANNER_MAX_LEFT : FOE_BANNER_MAX_LEFT, Math.round(centred)));
    // Just above the opponent's heads (or the field's top edge), and over the player's own.
    const top = from?.top ?? 0;
    return { left, top: (own ? top - 34 : Math.max(4, top - 18)) + drop };
  }

  private pokemonAt(slot: SlotKey): BattlePokemon | null {
    const side = this.store.sides()[slot.slice(0, 2) as 'p1' | 'p2'];
    return side?.active[slot[2] === 'b' ? 1 : 0] ?? null;
  }

  /** A side's slots in the current game type, in its stands' order. */
  private slotsOf(side: 'p1' | 'p2'): FieldSlot[] {
    const active = this.store.sides()[side].active;
    const { spriteSize, stands } = this.layout();
    return Object.entries(stands)
      .filter(([key]) => key.startsWith(side))
      .map(([key, stand]) => ({
        key,
        pokemon: active[key[2] === 'b' ? 1 : 0] ?? null,
        ...spriteBox(stand, spriteSize),
        size: spriteSize,
        boxLeft: stand.boxLeft,
        boxTop: stand.boxTop,
      }));
  }

  private slotData(slot: SlotKey): FieldSlot | undefined {
    return [...this.foeSlots(), ...this.ownSlots()].find((s) => s.key === slot);
  }

  private sprite(slot: SlotKey): HTMLElement | null {
    return this.host.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  }

  /**
   * Runs one animation on a slot's sprite, first putting back whatever an unfinished one left. With
   * `waitForImage`, it starts once the sprite's new image has loaded and is shown: a sprite still
   * downloading when its animation ran popped in at the end on the console. Meanwhile it holds the
   * first frame (a send-out stays hidden).
   */
  private animate(
    slot: SlotKey,
    durationMs: number,
    frame: (el: HTMLElement, base: FieldSlot, progress: number) => void,
    options: { done?: () => void; waitForImage?: boolean } = {},
  ): void {
    this.running.get(slot)?.();
    const el = this.sprite(slot);
    const base = this.slotData(slot);
    if (!el || !base) return;
    const reset = () => resetSprite(el, base);
    reset();
    let stopWaiting: () => void = () => undefined;
    let stopAnimation: () => void = () => undefined;
    const run = () => {
      stopAnimation = stepAnimation(
        durationMs / this.store.speed(),
        (progress) => frame(el, base, progress),
        () => {
          this.running.delete(slot);
          options.done?.();
        },
      );
    };
    this.running.set(slot, () => {
      stopWaiting();
      stopAnimation();
      reset();
      this.running.delete(slot);
    });
    if (options.waitForImage) {
      frame(el, base, 0);
      stopWaiting = whenSpriteShown(el, run);
    } else {
      run();
    }
  }

  /**
   * A move's animation, by its category, in its type's colour. Physical (or unknown): the attacker
   * lunges at its targets and each one it damages blinks under a burst as the lunge reaches it.
   * Special: the attacker glows while an orb gathers on it and flies to each target, which blinks
   * under a burst as the orb lands (a missed one sees it fade). Status: the attacker lunges (hops,
   * with no target) and rings spread around the Pokémon it affects (itself, with no target).
   */
  private playMove(action: MoveAction): void {
    const effects = this.effects();
    if (!effects) return;
    effects.stop();
    const size = this.layout().spriteSize;
    const speed = this.store.speed();
    if (action.category === 'Special') {
      this.glow(action.attacker);
      const from = this.effectPoint(action.attacker);
      const slots = new Set([...action.targets.filter((t) => t !== action.attacker), ...action.hits]);
      const targets: EffectTarget[] = [...slots].flatMap((slot) => {
        const at = this.effectPoint(slot);
        return at ? [{ slot, at, hit: action.hits.includes(slot) }] : [];
      });
      if (from) effects.projectiles(from, targets, action.type, size, speed, (target) => {
        if (target.hit) this.blink(target.slot);
      });
      else action.hits.forEach((slot) => this.blink(slot));
      return;
    }
    this.lunge(action, () => {
      if (action.category === 'Status') {
        for (const slot of action.targets.length > 0 ? action.targets : [action.attacker]) {
          const at = this.effectPoint(slot);
          if (at) effects.aura(at, action.type, size, speed);
        }
      }
      for (const slot of action.hits) {
        this.blink(slot);
        const at = this.effectPoint(slot);
        if (at) effects.impact(at, action.type, size, speed);
      }
    });
  }

  /** Where a move's effect centres on a slot's Pokémon (its body, a little below the sprite's middle); null for an empty slot. */
  private effectPoint(slot: SlotKey): EffectPoint | null {
    const data = this.slotData(slot);
    if (!data?.pokemon || data.pokemon.fainted) return null;
    return { x: Math.round(data.left + data.size / 2), y: Math.round(data.top + data.size * 0.55) };
  }

  /** A special move's user glows as it gathers the attack. */
  private glow(slot: SlotKey): void {
    this.animate(slot, GLOW_MS, (el, _base, progress) => {
      el.style.filter = progress < 1 ? `brightness(${Math.round((1 + (GLOW_BRIGHTNESS - 1) * outAndBack(progress)) * 100) / 100})` : '';
    });
  }

  /**
   * The attacker lunges at its targets (their middle, for a spread move) and comes back; `contact`
   * runs as it reaches them.
   */
  private lunge(action: MoveAction, contact: () => void): void {
    const from = this.slotData(action.attacker);
    if (!from) return;
    const targets = action.targets.filter((t) => t !== action.attacker).map((t) => this.slotData(t)).filter((t): t is FieldSlot => !!t);
    let dx = 0;
    let dy = -HOP_PX;
    if (targets.length > 0) {
      const x = targets.reduce((sum, t) => sum + t.left, 0) / targets.length - from.left;
      const y = targets.reduce((sum, t) => sum + t.top, 0) / targets.length - from.top;
      const length = Math.hypot(x, y) || 1;
      const distance = Math.max(LUNGE_MIN_PX, Math.min(LUNGE_MAX_PX, length * LUNGE_SHARE));
      dx = (x / length) * distance;
      dy = (y / length) * distance;
    }
    // Whoever the move damages blinks as the lunge reaches them, not a log step later with their HP.
    let struck = false;
    this.animate(action.attacker, LUNGE_MS, (el, base, progress) => {
      const amount = outAndBack(progress);
      el.style.left = `${Math.round(base.left + dx * amount)}px`;
      el.style.top = `${Math.round(base.top + dy * amount)}px`;
      if (!struck && progress >= 0.5) {
        struck = true;
        contact();
      }
    });
  }

  /** The target blinks as it takes the hit. */
  private blink(slot: SlotKey): void {
    this.animate(slot, BLINK_MS, (el, _base, progress) => {
      const phase = Math.min(BLINKS - 1, Math.floor(progress * BLINKS));
      el.style.opacity = progress < 1 && phase % 2 === 0 ? BLINK_OPACITY : '1';
    });
  }

  /**
   * Withdrawn: slides towards its trainer's side and fades out, staying hidden until the next one
   * replaces it. Sent out: slides in from there, fading in.
   */
  private slide(event: FieldEvent): void {
    const away = event.slot.startsWith('p1') ? -SWITCH_PX : SWITCH_PX;
    const leaving = event.kind === 'withdraw';
    this.animate(
      event.slot,
      SWITCH_MS,
      (el, base, progress) => {
        const out = leaving ? progress : 1 - progress;
        el.style.left = `${Math.round(base.left + away * out)}px`;
        el.style.opacity = String(Math.round((1 - out) * 100) / 100);
      },
      { waitForImage: !leaving },
    );
  }

  /** The Mega Evolved (or Terastallized) sprite starts white and pulses back to its colours. */
  private megaFlash(event: FieldEvent): void {
    this.animate(
      event.slot,
      MEGA_MS,
      (el, _base, progress) => {
        const glow = (1 - progress) * (0.5 + 0.5 * Math.cos(progress * 4 * Math.PI));
        const brightness = Math.round((1 + (MEGA_BRIGHTNESS - 1) * glow) * 100) / 100;
        el.style.filter = progress < 1 ? `brightness(${brightness})` : '';
      },
      { waitForImage: true },
    );
  }

  /** A shield pulses around the Pokémon, then hides again. */
  private shieldPulse(event: FieldEvent): void {
    const key = `shield-${event.slot}`;
    this.running.get(key)?.();
    const el = this.host.querySelector<HTMLElement>(`[data-shield="${event.slot}"]`);
    if (!el) return;
    const hide = () => {
      el.style.display = '';
      el.style.opacity = '';
    };
    el.style.display = 'block';
    const stop = stepAnimation(
      SHIELD_MS / this.store.speed(),
      (progress) => {
        const pulse = Math.sin(progress * SHIELD_PULSES * Math.PI);
        el.style.opacity = String(Math.round(Math.abs(pulse) * SHIELD_OPACITY * 100) / 100);
      },
      () => {
        hide();
        this.running.delete(key);
      },
    );
    this.running.set(key, () => {
      stop();
      hide();
      this.running.delete(key);
    });
  }

  /** The fainted Pokémon sinks and disappears; then its sprite is removed. */
  private faint(event: FieldEvent): void {
    this.animate(
      event.slot,
      FAINT_MS,
      (el, base, progress) => {
        el.style.top = `${Math.round(base.top + FAINT_DROP_PX * progress)}px`;
        // Fading as it sinks (visibility doesn't take effect on Brewser; opacity does).
        el.style.opacity = String(Math.round((1 - progress) * 100) / 100);
      },
      {
        done: () => {
          this.faintDone.set(event.id);
          this.renderScheduler.request();
        },
      },
    );
  }
}

/** Puts a sprite back in its place, fully shown, as no animation has touched it. */
function resetSprite(el: HTMLElement, base: FieldSlot): void {
  el.style.left = `${base.left}px`;
  el.style.top = `${base.top}px`;
  el.style.opacity = '1';
  el.style.filter = '';
}

/**
 * Calls `ready` once the sprite shows its new image, or after IMAGE_WAIT_MS at most. PokemonSprite
 * marks its box `data-pending` while the new image downloads and drops the mark once it has loaded,
 * so checking every frame starts the animation exactly on the new image (a missing back sprite
 * stays pending while its front one loads). Returns a function that cancels the wait.
 */
function whenSpriteShown(el: HTMLElement, ready: () => void): () => void {
  const start = Date.now();
  let cancel: () => void = () => undefined;
  const check = () => {
    if (!el.querySelector('[data-pending]') || Date.now() - start >= IMAGE_WAIT_MS) ready();
    else cancel = nextFrame(check);
  };
  check();
  return () => cancel();
}
