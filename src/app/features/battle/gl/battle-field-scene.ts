import { DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { AudioEngine } from '@core/audio/audio-engine';
import { ChampionsDex } from '@core/dex/champions-dex';
import { BattleCries } from '@features/battle/audio/battle-cries';
import { movePattern } from '@features/battle/gl/move-patterns';
import { BattleCamera, CameraFocus, REST_FOCUS, depthOf } from '@features/battle/gl/battle-camera';
import { CAMERA_DEPTHS, CAMERA_TUNING } from '@features/battle/gl/camera-tuning';
import {
  DEFAULT_GROUND,
  DEFAULT_SKY,
  BOX_H,
  BOX_W,
  DOUBLES,
  FIELD_H,
  FIELD_W,
  FieldLayout,
  GROUND_Y,
  OWN_BOX_LEFT,
  SINGLES,
  STAT_NAMES,
  Stand,
  TERRAIN_COLORS,
  TERRAIN_SKY,
  WEATHER_SKY,
  feetGap,
} from '@features/battle/gl/field-layout';
import { HpBoxEmphasis, barColor } from '@features/battle/gl/hp-bar';
import { EffectPoint, EffectTarget, GlEffects, easeOut, glowDot, outAndBack } from '@features/battle/gl/gl-effects';
import { GlSprites } from '@core/gl/gl-sprites';
import { ImagePriority, SpriteBitmaps } from '@core/gl/sprite-bitmaps';
import { BattlePokemon, EffectPopup, FieldEvent, HpChange, MoveAction, SideId, SlotKey, StatChange, StatusChange } from '@features/battle/models/battle';
import { BattleStore, signed } from '@features/battle/state/battle-store';
import { STATUS } from '@features/battle/state/status-conditions';
import { Align, drawText } from '@core/gl/canvas-ui';
import { GlRenderer, Rgba, Texture, rgba, withAlpha } from '@core/gl/gl-renderer';
import { TextStyle, TextTextures } from '@core/gl/gl-textures';
import { typeColor } from '@shared/data/type-colors';
import { spriteSource } from '@core/gl/sprite-sheets';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

/** The status boxes' HP bar: 282px wide at most, sliding over 500 ms. */
const BAR_WIDTH = 282;
const BAR_MS = 500;
const BOX_BORDER: Record<HpBoxEmphasis | 'none', Rgba> = { attacker: rgba('#eab308'), target: rgba('#dc2626'), none: rgba('#404040') };
const BOX_FILL = rgba('#f8f8d8');
const BOX_INK = rgba('#303030');
const CHIP_W = 60;
const BOX_STATS: [string, string][] = [
  ['atk', 'Atk'],
  ['def', 'Def'],
  ['spa', 'SpA'],
  ['spd', 'SpD'],
  ['spe', 'Spe'],
  ['accuracy', 'Acc'],
  ['evasion', 'Eva'],
];
/** The result card, as BattleResult. */
const RESULT_W = 640;
/** The field, where the result card goes. */
const RESULT_AREA_H = FIELD_H;
const SIDE_INK: Record<SideId, Rgba> = { p1: rgba('#7dd3fc'), p2: rgba('#fca5a5') };

// Lengths at normal speed (the replay speed divides them).
const LUNGE_MS = 600;
const RUSH_MS = 400;
const LUNGE_SHARE = 0.25;
const LUNGE_MIN_PX = 72;
const LUNGE_MAX_PX = 180;
const HOP_PX = 24;
const GLOW_MS = 420;
const BLINK_MS = 540;
const BLINKS = 6;
const QUAKE_MS = 520;
const QUAKE_PX = 10;
const QUAKE_SHAKES = 5;
const SHAKE_PX = 10;
const SHAKES = 3;
const FAINT_MS = 500;
const FAINT_DROP_PX = 64;
const SWITCH_MS = 450;
const SWITCH_PX = 140;
const IMAGE_WAIT_MS = 1500;
/** How long a new Pokémon waits hidden for its send-out before it just appears. */
const ENTRY_WAIT_MS = 250;
const MEGA_MS = 900;
/** Confused: it totters side to side (dipping at each end) while the stars circle. */
const CONFUSED_MS = 1000;
const CONFUSED_SWAYS = 2;
const CONFUSED_SWAY_PX = 14;
const CONFUSED_DIP_PX = 5;
/** Behind a substitute, the Pokémon shows itself only while it uses a move: this long from the move's start. */
const SUBSTITUTE_ACT_MS = 950;
/** The substitute doll (Showdown's, bundled), drawn in its Pokémon's place. */
const SUBSTITUTE_FRONT = 'sprites/substitute.png';
const SUBSTITUTE_BACK = 'sprites/substitute-back.png';
const POPUP_MS = 1400;
/** Stat changes closer together than this sound once. */
const STAT_SOUND_GAP_MS = 400;
const HP_LABEL_MS = 1100;
/** Labels and banners pop in over this long. */
const POP_MS = 180;

const BANNER_WIDTH = 300;
const BANNER_HEIGHT = 52;
/** The player's banners stay clear of their status boxes; the opponent's, of the right edge. */
const OWN_BANNER_MAX_LEFT = OWN_BOX_LEFT - 8 - BANNER_WIDTH;
const FOE_BANNER_MAX_LEFT = FIELD_W - 8 - BANNER_WIDTH;
const LABEL_HEIGHT = 40;
const HP_LABEL_WIDTH = 96;
const CRIT_LABEL_WIDTH = 160;
const CRIT_LABEL_GAP = 6;
const STATUS_LABEL_WIDTH = 190;
const STATUS_LABEL_DROP = 46;

const PANEL: Rgba = rgba('#1f2937');
const WHITE: Rgba = [1, 1, 1, 1];
const HP_LOST: Rgba = rgba('#b91c1c');
const HP_RESTORED: Rgba = rgba('#15803d');
const CRIT: Rgba = rgba('#b45309');
const STAT_UP: Rgba = rgba('#15803d');
const STAT_DOWN: Rgba = rgba('#b91c1c');
const TRICK_ROOM: Rgba = rgba('#a855f7');
/** Trick Room's grid squares on the wall over the horizon. */
const TRICK_ROOM_CELL = 64;

/** Motes floating up from a terrain, in a brighter shade of its colour. */
const TERRAIN_MOTES: Record<string, Rgba> = {
  'Grassy Terrain': rgba('#8ce060'),
  'Psychic Terrain': rgba('#f080e0'),
  'Electric Terrain': rgba('#ffe650'),
  'Misty Terrain': rgba('#ffc0e6'),
};

type WeatherKind = 'rain' | 'snow' | 'sand' | 'sun' | 'wind' | null;

const WEATHER_KIND: Record<string, WeatherKind> = {
  RainDance: 'rain',
  PrimordialSea: 'rain',
  Snowscape: 'snow',
  Snow: 'snow',
  Hail: 'snow',
  Sandstorm: 'sand',
  SunnyDay: 'sun',
  DesolateLand: 'sun',
  DeltaStream: 'wind',
};

/** A stand with whoever is on it. */
interface Occupant {
  key: SlotKey;
  own: boolean;
  pokemon: BattlePokemon | null;
  stand: Stand;
}

/** An occupied stand where the camera shows it this frame: its sprite's box and its feet. */
interface Slot extends Occupant {
  left: number;
  top: number;
  size: number;
  feetX: number;
  feetY: number;
}

/** The one choosing (or the target) is lifted, with a ring on its platform; the target, a light behind it too. */
const CHOOSER_LIFT_PX = 10;
const CHOOSER_LIGHT: Rgba = rgba('#fde047');

/** How a sprite is drawn this frame: moved, faded, brightened. */
interface Visual {
  dx: number;
  dy: number;
  alpha: number;
  /** 1 is its own colours; more adds its light again (a glow, Mega Evolution's flash). */
  bright: number;
}

interface SlotAnim {
  /** When it started; null while it waits for its sprite to download. */
  start: number | null;
  /** Asked at, for the longest wait. */
  asked: number;
  duration: number;
  frame: (visual: Visual, progress: number) => void;
  waitFor?: () => boolean;
  done?: () => void;
}

/** A label over a Pokémon for a while: an HP change, a status, a stat stage, a pop-up. */
interface Shown<T> {
  item: T;
  born: number;
  until: number;
}

interface Mote {
  x: number;
  y: number;
  speed: number;
  phase: number;
  size: number;
}

/**
 * The battle field drawn with WebGL, for the battle screen: every sprite, platform, effect, status box
 * and label, following the store's events: moves get
 * real light (additive glows, many more sparks), the weather falls across the field (rain, snow, sand,
 * sun rays, wind), terrains send motes up, clouds drift, labels and banners pop in, send-outs and Mega
 * Evolutions burst with light, HP bars slide. Made in an injection context (a component's field); the
 * host gives it its renderer (`attach`), then places, clips and draws it every frame (`draw`) in
 * field coordinates, 1280x676.
 */
export class BattleFieldScene {
  readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly cries = inject(BattleCries);
  private readonly audio = inject(AudioEngine);
  /** The last move's effectiveness on each slot: its hits sound by it (a multi-hit's later ones too). */
  private hitEffectiveness: MoveAction['effectiveness'] = {};

  private readonly layout = computed<FieldLayout>(() => (this.store.gameType() === 'singles' ? SINGLES : DOUBLES));

  /** Every stand of the layout with whoever is on it: the opponent's first (drawn behind), then the player's. */
  private readonly occupants = computed((): Occupant[] => {
    const { stands } = this.layout();
    const sides = this.store.sides();
    const entries = Object.entries(stands);
    return [...entries.filter(([key]) => key.startsWith('p2')), ...entries.filter(([key]) => key.startsWith('p1'))].map(([key, stand]) => ({
      key,
      own: key.startsWith('p1'),
      pokemon: sides[key.slice(0, 2) as 'p1' | 'p2'].active[key[2] === 'b' ? 1 : 0] ?? null,
      stand,
    }));
  });

  private readonly camera = new BattleCamera();
  private cameraFocus: CameraFocus = REST_FOCUS;
  /** Where the ground meets the sky this frame. */
  private groundY = GROUND_Y;

  private readonly emphasis = computed(() => {
    const action = this.store.action();
    const emphasis: Record<SlotKey, HpBoxEmphasis> = {};
    if (!action) return emphasis;
    for (const target of action.targets) emphasis[target] = 'target';
    emphasis[action.attacker] = 'attacker';
    return emphasis;
  });

  private renderer: GlRenderer | null = null;
  private text: TextTextures | null = null;
  private sprites: GlSprites | null = null;
  private disc: Texture | null = null;
  private readonly effects = new GlEffects();
  private readonly anims = new Map<SlotKey, SlotAnim>();
  private readonly shownIdents = new Map<SlotKey, string>();
  private readonly fainting = new Set<SlotKey>();
  /** Pokémon behind a substitute using a move: shown themselves until then (performance.now()). */
  private readonly acting = new Map<SlotKey, number>();
  /** Slots whose Pokémon went back to its ball: empty until the next one comes in. */
  private readonly withdrawn = new Set<SlotKey>();
  /**
   * When a new Pokémon showed up in a slot before its send-out did (the store changes first, the event
   * is seen a frame later): it stays hidden till then, rather than standing in place before it slides in.
   */
  private readonly entering = new Map<SlotKey, number>();
  /** Each status box's bar: the width shown, and its slide when the HP changes. */
  private readonly bars = new Map<SlotKey, { ident: string; width: number; from: number; to: number; start: number; duration: number }>();
  private shake: { start: number; duration: number } | null = null;
  private banner: { id: number; born: number } | null = null;
  private popups: Shown<EffectPopup>[] = [];
  private hpLabels: Shown<HpChange>[] = [];
  private statusLabels: Shown<StatusChange>[] = [];
  private statLabels: Shown<StatChange>[] = [];
  private introBorn = 0;
  private resultBorn = 0;
  private weatherKind: WeatherKind = null;
  private weather: Mote[] = [];
  private terrain: string | null = null;
  private motes: Mote[] = [];
  private readonly preloaded = new Set<string>();

  /** Sparks alive, for the diagnostics. */
  get particleCount(): number {
    return this.effects.particleCount;
  }

  constructor() {
    let lastAction = -1;
    effect(() => {
      const action = this.store.action();
      if (!action || action.id === lastAction) return;
      lastAction = action.id;
      untracked(() => {
        this.syncIdents();
        this.banner = { id: action.id, born: performance.now() };
        if (this.renderer) this.playMove(action);
      });
    });
    let lastEvent = -1;
    effect(() => {
      const event = this.store.fieldEvent();
      if (!event || event.id === lastEvent) return;
      lastEvent = event.id;
      untracked(() => {
        this.syncIdents();
        if (this.renderer) this.playEvent(event);
      });
    });
    this.follow(this.store.popups, (list) => (this.popups = list), () => this.popups, POPUP_MS);
    this.follow(this.store.hpChanges, (list) => (this.hpLabels = list), () => this.hpLabels, HP_LABEL_MS);
    this.follow(this.store.statusChanges, (list) => (this.statusLabels = list), () => this.statusLabels, POPUP_MS);
    let lastStatSound = 0;
    this.follow(this.store.statChanges, (list) => (this.statLabels = list), () => this.statLabels, POPUP_MS, (change) => {
      const at = this.effectPoint(change.slot);
      if (at) this.effects.statChange(at, change.amount > 0, this.sizeOf(change.slot));
      // Several stats changing at once (Dragon Dance, Intimidate on both) sound once.
      const now = performance.now();
      if (now - lastStatSound > STAT_SOUND_GAP_MS) this.audio.play(change.amount > 0 ? 'statUp' : 'statDown');
      lastStatSound = now;
    });
    effect(() => {
      if (this.store.intro()) this.introBorn = performance.now();
    });
    // Team preview's Pokémon (and their Megas) are fetched ahead, and their cries.
    effect(() => {
      const { p1, p2 } = this.store.sides();
      untracked(() => {
        p1.preview.forEach((species) => this.preloadWithMegas(species, true));
        p2.preview.forEach((species) => this.preloadWithMegas(species, false));
        [...p1.preview, ...p2.preview].forEach((species) => this.cries.preload(species));
      });
    });

    effect(() => {
      if (this.store.result()) this.resultBorn = performance.now();
    });
    inject(DestroyRef).onDestroy(() => {
      this.effects.stop();
      this.cries.clear();
    });
  }

  /** The host's renderer and textures, once its canvas is ready. */
  attach(renderer: GlRenderer, text: TextTextures, sprites: GlSprites, disc: Texture): void {
    this.renderer = renderer;
    this.text = text;
    this.sprites = sprites;
    this.disc = disc;
    sprites.prefetch(SUBSTITUTE_FRONT);
    sprites.prefetch(SUBSTITUTE_BACK);
  }

  private preloadWithMegas(species: string, back: boolean): void {
    const sprite = this.dex.species(species)?.sprite ?? spriteId(species);
    const sprites = [sprite, ...this.dex.allMegas.filter((m) => m.base === toId(species)).map((m) => m.sprite)];
    for (const s of sprites) {
      for (const b of back ? [false, true] : [false]) {
        const url = spriteSource(s, b);
        if (this.preloaded.has(url)) continue;
        this.preloaded.add(url);
        // The team tiles show each species' front sprite straight away; backs and Megas may come later.
        this.bitmaps.request(url, s === sprite && !b ? ImagePriority.Screen : ImagePriority.Ahead);
      }
    }
  }

  /**
   * Shows a store list's new items (one per slot, the newest replacing its slot's) until each one's
   * time is up; an emptied list (a new battle) clears them.
   */
  private follow<T extends { id: number; slot: SlotKey }>(
    source: () => readonly T[],
    set: (list: Shown<T>[]) => void,
    get: () => Shown<T>[],
    ms: number,
    onShown?: (item: T) => void,
  ): void {
    let lastSeen = -1;
    effect(() => {
      const items = source();
      untracked(() => {
        if (items.length === 0) {
          set([]);
          return;
        }
        const now = performance.now();
        for (const item of items.filter((i) => i.id > lastSeen)) {
          lastSeen = item.id;
          set([...get().filter((s) => s.item.slot !== item.slot), { item, born: now, until: now + ms / this.store.speed() }]);
          if (this.renderer) onShown?.(item);
        }
      });
    });
  }

  // ---------------------------------------------------------------- events

  /** A new Pokémon in a slot starts from its place, whatever the one before was doing. */
  private syncIdents(): void {
    for (const slot of this.slots()) {
      const ident = slot.pokemon?.ident ?? '';
      if (this.shownIdents.get(slot.key) === ident) continue;
      this.shownIdents.set(slot.key, ident);
      this.anims.delete(slot.key);
      this.fainting.delete(slot.key);
      this.withdrawn.delete(slot.key);
      this.acting.delete(slot.key);
      if (ident) this.entering.set(slot.key, performance.now());
      else this.entering.delete(slot.key);
    }
  }

  private animate(slot: SlotKey, ms: number, frame: SlotAnim['frame'], options: { waitFor?: () => boolean; done?: () => void } = {}): void {
    const now = performance.now();
    this.anims.set(slot, {
      start: options.waitFor ? null : now,
      asked: now,
      duration: ms / this.store.speed(),
      frame,
      waitFor: options.waitFor,
      done: options.done,
    });
  }

  private playEvent(event: FieldEvent): void {
    this.effects.speed = this.store.speed();
    const size = this.sizeOf(event.slot);
    const slot = this.slotData(event.slot);
    switch (event.kind) {
      case 'hit':
        this.blink(event.slot);
        return;
      case 'faint':
        this.cries.play(slot?.pokemon?.species ?? '', true);
        this.fainting.add(event.slot);
        this.animate(
          event.slot,
          FAINT_MS,
          (v, p) => {
            v.dy = FAINT_DROP_PX * p;
            v.alpha = 1 - p;
          },
          { done: () => this.fainting.delete(event.slot) },
        );
        return;
      case 'withdraw':
      case 'send-out': {
        const leaving = event.kind === 'withdraw';
        this.entering.delete(event.slot);
        const away = event.slot.startsWith('p1') ? -SWITCH_PX : SWITCH_PX;
        const sprite = slot?.pokemon?.sprite ?? '';
        const own = event.slot.startsWith('p1');
        let burst = false;
        this.animate(
          event.slot,
          SWITCH_MS,
          (v, p) => {
            const out = leaving ? p : 1 - easeOut(p);
            v.dx = away * out;
            v.alpha = 1 - out;
            // Coming out: a flash of light where it lands, as a Poké Ball opening, and its cry.
            if (!leaving && !burst && p > 0.6) {
              burst = true;
              this.cries.play(slot?.pokemon?.species ?? '');
              const at = this.effectPoint(event.slot);
              if (at) {
                this.effects.burst(at, WHITE, 18, 260 * (size / 240), 8 * (size / 240), 500);
                this.effects.tween(300, (r, q) => glowDot(r, at.x, at.y, (40 + 120 * q) * (size / 240), WHITE, 0.6 * (1 - q), true));
              }
            }
            if (!leaving) v.bright = 1 + 1.5 * (1 - p);
          },
          leaving ? { done: () => this.withdrawn.add(event.slot) } : { waitFor: () => !this.sprites?.pending(sprite, own) },
        );
        return;
      }
      case 'mega':
      case 'tera': {
        const sprite = slot?.pokemon?.sprite ?? '';
        const own = event.slot.startsWith('p1');
        let started = false;
        this.animate(
          event.slot,
          MEGA_MS,
          (v, p) => {
            if (!started) {
              started = true;
              // A Mega's own cry, as it appears.
              if (event.kind === 'mega') this.cries.play(slot?.pokemon?.species ?? '');
              const at = this.effectPoint(event.slot);
              if (at) {
                const k = size / 240;
                this.effects.burst(at, event.kind === 'tera' ? rgba('#7dd3fc') : rgba('#f0abfc'), 40, 420 * k, 9 * k, 700);
                this.effects.tween(600, (r, q) => glowDot(r, at.x, at.y, (60 + 200 * q) * k, WHITE, 0.8 * (1 - q), true));
              }
            }
            const glow = (1 - p) * (0.5 + 0.5 * Math.cos(p * 4 * Math.PI));
            v.bright = 1 + 3 * glow;
          },
          { waitFor: () => !this.sprites?.pending(sprite, own) },
        );
        return;
      }
      case 'protect': {
        const at = this.effectPoint(event.slot);
        if (at) this.effects.shield(at, size);
        return;
      }
      case 'side-guard': {
        const side = event.slot.slice(0, 2);
        const points = this.slots()
          .filter((s) => s.key.startsWith(side))
          .map((s) => this.effectPoint(s.key))
          .filter((p): p is EffectPoint => !!p);
        this.effects.wall(points, size);
        return;
      }
      case 'confused': {
        const head = this.headPoint(event.slot);
        if (head) this.effects.confusion(head, size);
        // It totters from side to side under the stars.
        this.animate(event.slot, CONFUSED_MS, (v, p) => {
          const sway = Math.sin(p * CONFUSED_SWAYS * 2 * Math.PI) * (1 - p * 0.6);
          v.dx = sway * CONFUSED_SWAY_PX;
          v.dy = Math.abs(sway) * CONFUSED_DIP_PX;
        });
        return;
      }
      case 'confusion-hit': {
        // It hits itself: a blow lands on it and it shakes.
        const at = this.effectPoint(event.slot);
        if (at) this.effects.impact(at, 'normal', size);
        this.blink(event.slot, true);
        return;
      }
      case 'substitute':
      case 'substitute-end': {
        // The doll takes its place (or vanishes) in a puff of smoke.
        this.acting.delete(event.slot);
        const at = this.effectPoint(event.slot);
        if (at) this.effects.puff(at, size);
        return;
      }
      case 'confusion-end': {
        const head = this.headPoint(event.slot);
        if (head) this.effects.confusionEnd(head, size);
        return;
      }
    }
  }

  /** A move's choreography: the user's lunge or rush, its effect, the targets' reactions. */
  private playMove(action: MoveAction): void {
    const effects = this.effects;
    effects.speed = this.store.speed();
    this.hitEffectiveness = action.effectiveness;
    this.audio.play(action.category === 'Physical' ? 'physical' : action.category === 'Special' ? 'special' : 'status');
    // Effects take the size of the Pokémon they're on: ours are drawn bigger than the opponent's.
    const size = this.sizeOf(action.attacker);
    const sizeAt = (slot: SlotKey) => this.sizeOf(slot);
    // Behind a substitute, it comes out to use its move and hides again after.
    if (this.slotData(action.attacker)?.pokemon?.substitute) {
      const at = this.effectPoint(action.attacker);
      if (at) {
        effects.puff(at, size);
        effects.later(SUBSTITUTE_ACT_MS, () => {
          if (this.slotData(action.attacker)?.pokemon?.substitute) effects.puff(at, size);
        });
      }
      this.acting.set(action.attacker, performance.now() + SUBSTITUTE_ACT_MS / this.store.speed());
    }
    const pattern = movePattern(action.move);
    const aimed = pattern === 'beam' || pattern === 'wave' || pattern === 'erupt' || pattern === 'psywave' ? pattern : null;
    if (action.category === 'Special' || aimed) {
      this.glow(action.attacker);
      const from = this.effectPoint(action.attacker);
      const slots = new Set([...action.targets.filter((t) => t !== action.attacker), ...action.hits]);
      const targets: EffectTarget[] = [...slots].flatMap((slot) => {
        const at = this.effectPoint(slot);
        return at ? [{ slot, at, hit: action.hits.includes(slot) }] : [];
      });
      if (from) {
        effects.projectiles(from, targets, action.type, size, (target) => {
          if (target.hit) this.blink(target.slot, pattern === 'psywave');
        }, aimed ?? 'orb');
      } else {
        action.hits.forEach((slot) => this.blink(slot));
      }
      return;
    }
    if (pattern === 'room') effects.roomPulse(action.move, action.type);
    if (pattern === 'tailwind') {
      const side = action.attacker.slice(0, 2);
      const ys = this.slots()
        .filter((s) => s.key.startsWith(side))
        .map((s) => this.effectPoint(s.key)?.y)
        .filter((y): y is number => y !== undefined);
      if (ys.length > 0) effects.gusts(side === 'p1', Math.min(...ys) - size * 0.3, Math.max(...ys) + size * 0.2, size);
    }
    this.lunge(
      action,
      () => {
        if (action.category === 'Status' && pattern !== 'guard' && pattern !== 'room' && pattern !== 'tailwind') {
          for (const slot of action.targets.length > 0 ? action.targets : [action.attacker]) {
            const at = this.effectPoint(slot);
            if (at) effects.aura(at, action.type, sizeAt(slot));
          }
        }
        if (pattern === 'quake') {
          this.shake = { start: performance.now(), duration: QUAKE_MS / this.store.speed() };
          const shaken = [...new Set([...action.targets, ...action.hits])].filter((slot) => slot !== action.attacker);
          effects.dust(shaken.map((slot) => this.effectPoint(slot)).filter((p): p is EffectPoint => !!p), size);
          for (const slot of action.hits) {
            this.blink(slot);
            const at = this.effectPoint(slot);
            if (at) effects.impact(at, action.type, sizeAt(slot), true);
          }
          return;
        }
        if (pattern === 'rocks') {
          for (const slot of new Set([...action.targets.filter((t) => t !== action.attacker), ...action.hits])) {
            const at = this.effectPoint(slot);
            const hit = action.hits.includes(slot);
            if (at) effects.rocks(at, hit, sizeAt(slot), () => this.blink(slot));
            else if (hit) this.blink(slot);
          }
          return;
        }
        for (const slot of action.hits) {
          const at = this.effectPoint(slot);
          if (!at) this.blink(slot);
          else if (pattern === 'flurry') effects.flurry(at, action.type, sizeAt(slot), () => this.blink(slot));
          else if (pattern === 'clap') effects.clap(at, action.type, sizeAt(slot), () => this.blink(slot, true));
          else {
            this.blink(slot);
            effects.impact(at, action.type, sizeAt(slot));
          }
        }
      },
      pattern === 'rush',
      pattern === 'quake',
    );
  }

  private lunge(action: MoveAction, contact: () => void, rush: boolean, hop: boolean): void {
    const from = this.slotData(action.attacker);
    if (!from) return;
    const targets = action.targets
      .filter((t) => t !== action.attacker)
      .map((t) => this.slotData(t))
      .filter((t): t is Slot => !!t);
    let dx = 0;
    let dy = -HOP_PX;
    if (targets.length > 0 && !hop) {
      const x = targets.reduce((sum, t) => sum + t.left, 0) / targets.length - from.left;
      const y = targets.reduce((sum, t) => sum + t.top, 0) / targets.length - from.top;
      const length = Math.hypot(x, y) || 1;
      const distance = Math.max(LUNGE_MIN_PX, Math.min(LUNGE_MAX_PX, length * LUNGE_SHARE));
      dx = (x / length) * distance;
      dy = (y / length) * distance;
    }
    const ms = rush ? RUSH_MS : LUNGE_MS;
    if (rush) {
      const at = this.effectPoint(action.attacker);
      if (at) this.effects.trail((p) => ({ x: at.x + dx * outAndBack(p), y: at.y + dy * outAndBack(p) }), action.type, from.size, ms);
    }
    let struck = false;
    this.animate(action.attacker, ms, (v, p) => {
      // Eased out and back: a quick strike.
      const amount = easeOut(outAndBack(p));
      v.dx = dx * amount;
      v.dy = dy * amount;
      if (!struck && p >= 0.5) {
        struck = true;
        contact();
      }
    });
  }

  /** A hit: the Pokémon blinks, and the hit sounds as effective as it was. */
  private blink(slot: SlotKey, shake = false): void {
    const effectiveness = this.hitEffectiveness[slot];
    this.audio.play(effectiveness === 'super' ? 'hitSuper' : effectiveness === 'resisted' ? 'hitWeak' : 'hit');
    this.animate(slot, BLINK_MS, (v, p) => {
      const phase = Math.min(BLINKS - 1, Math.floor(p * BLINKS));
      v.alpha = p < 1 && phase % 2 === 0 ? 0.2 : 1;
      v.bright = 1 + 1.2 * (1 - p) * (p < 0.15 ? 1 : 0);
      if (shake) v.dx = Math.sin(p * SHAKES * 2 * Math.PI) * SHAKE_PX * (1 - p);
    });
  }

  private glow(slot: SlotKey): void {
    this.animate(slot, GLOW_MS, (v, p) => (v.bright = 1 + 0.9 * outAndBack(p)));
  }

  // ---------------------------------------------------------------- drawing

  /** Draws the field in field coordinates (0..1280, 0..676); the host has started the frame, placed and clipped it. */
  draw(renderer: GlRenderer, now: number, dt: number): void {
    this.camera.aim(this.cameraFocus, this.layout().stands, now);
    this.camera.update(now);
    this.effects.update(now, dt);
    this.syncIdents();

    const { weather, terrain, rooms } = this.store.field();
    const ground = (terrain && TERRAIN_COLORS[terrain.id]) || DEFAULT_GROUND;
    const sky = rgba((weather && WEATHER_SKY[weather.id]) || (terrain && TERRAIN_SKY[terrain.id]) || DEFAULT_SKY);

    const baseX = renderer.originX;
    let shakeX = 0;
    if (this.shake) {
      const p = (now - this.shake.start) / this.shake.duration;
      if (p >= 1) this.shake = null;
      else shakeX = Math.sin(p * QUAKE_SHAKES * 2 * Math.PI) * QUAKE_PX * (1 - p);
    }
    renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: sky });
    renderer.originX = baseX + shakeX;
    this.drawScenery(renderer, now, ground, rooms.some((room) => room.id === 'Trick Room'));
    this.drawMotes(renderer, dt, terrain?.id ?? null, now);
    for (const slot of this.slots()) this.drawPokemon(renderer, slot, now);
    this.effects.draw(renderer);
    renderer.originX = baseX;
    this.drawWeather(renderer, dt, weather ? (WEATHER_KIND[weather.id] ?? null) : null, now);
    if (rooms.some((room) => room.id === 'Trick Room')) {
      const pulse = 0.75 + 0.25 * Math.sin(now / 300);
      renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [0, 0, 0, 0], stroke: withAlpha(TRICK_ROOM, pulse), border: 6 });
    }
    for (const slot of this.slots()) this.drawHpBox(renderer, slot, now);
  }

  /**
   * What goes over everything on the field, the host's strips (balls, side conditions) too: the
   * move and ability labels, the intro and the result. Placed and clipped as `draw`.
   */
  drawOver(renderer: GlRenderer, now: number): void {
    this.drawLabels(renderer, now);
    this.drawIntro(renderer, now);
    this.drawResult(renderer, now);
  }

  /**
   * A Pokémon's status box, as BattleHpBox: name, MEGA or TERA and its type, level or HP percentage,
   * the HP bar sliding to its new width, status and stat stage chips, the HP under the bar where it's
   * shown; the border yellow on a move's user and red on its targets.
   */
  private drawHpBox(renderer: GlRenderer, slot: Slot, now: number): void {
    const p = slot.pokemon;
    if (!p || p.fainted) {
      this.bars.delete(slot.key);
      return;
    }
    const x = slot.stand.boxLeft;
    const y = slot.stand.boxTop;
    const own = slot.own;
    const exact = own && !this.store.watching();
    const fraction = p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;
    const percent = `${p.hp > 0 ? Math.max(1, Math.round(fraction * 100)) : 0}%`;
    const showLevel = own || p.level !== 50;
    const hpText = own ? (exact ? `${p.hp}/${p.maxHp}` : percent) : showLevel ? percent : null;
    const mega = /-Mega/.test(p.species);

    renderer.rect(x + 2, y + 4, BOX_W, BOX_H, { fill: [0, 0, 0, 0.22], radius: 12, softness: 3 });
    renderer.rect(x, y, BOX_W, BOX_H, { fill: BOX_FILL, stroke: BOX_BORDER[this.emphasis()[slot.key] ?? (this.isPicked(slot.key) ? 'attacker' : 'none')], radius: 12, border: 3 });
    this.write(renderer, p.name, x + 14, y + 19, { size: 22, bold: true }, BOX_INK, 'left', p.tera && !mega ? 146 : 220);
    if (mega) {
      renderer.rect(x + 240, y + 9, 50, 20, { fill: rgba('#6b2a73'), radius: 2 });
      this.write(renderer, 'MEGA', x + 265, y + 19, { size: 13, bold: true }, [1, 1, 1, 1], 'center');
    } else if (p.tera) {
      renderer.rect(x + 164, y + 9, 48, 20, { fill: rgba('#1e293b'), radius: 2 });
      this.write(renderer, 'TERA', x + 188, y + 19, { size: 13, bold: true }, rgba('#a5f3fc'), 'center');
      renderer.rect(x + 216, y + 9, 72, 20, { fill: rgba(typeColor(p.tera) || '#374151'), radius: 10 });
      this.write(renderer, p.tera, x + 252, y + 19, { size: 13, bold: true }, [1, 1, 1, 1], 'center', 68);
    }
    this.write(renderer, showLevel ? `Lv${p.level}` : percent, x + BOX_W - 14, y + 19, { size: 20, bold: true }, BOX_INK, 'right');
    renderer.rect(x + 14, y + 38, 34, 18, { fill: rgba('#e8a020'), radius: 2 });
    this.write(renderer, 'HP', x + 31, y + 47, { size: 13, bold: true }, BOX_INK, 'center');
    renderer.rect(x + 54, y + 40, BAR_WIDTH + 4, 14, { fill: rgba('#506858'), radius: 2 });
    const width = this.barWidth(slot.key, p.ident, Math.round(BAR_WIDTH * fraction), now);
    if (width > 0) renderer.rect(x + 56, y + 42, width, 10, { fill: rgba(barColor(width / BAR_WIDTH)), radius: 2 });

    const status = STATUS[p.status];
    const all = [
      ...(status ? [{ text: status.text, color: status.color }] : []),
      ...BOX_STATS.filter(([stat]) => p.boosts[stat]).map(([stat, short]) => ({
        text: `${short} ${p.boosts[stat] > 0 ? '+' : ''}${p.boosts[stat]}`,
        color: p.boosts[stat] > 0 ? '#15803d' : '#b91c1c',
      })),
    ];
    const max = hpText !== null ? 3 : 5;
    const chips = all.length > max ? [...all.slice(0, max - 1), { text: `+${all.length - max + 1}`, color: '#4b5563' }] : all;
    chips.forEach((chip, i) => {
      const left = x + 14 + i * (CHIP_W + 4);
      renderer.rect(left, y + 61, CHIP_W, 22, { fill: rgba(chip.color), radius: 2 });
      this.write(renderer, chip.text, left + CHIP_W / 2, y + 72, { size: 14, bold: true }, [1, 1, 1, 1], 'center', CHIP_W - 2);
    });
    if (hpText) this.write(renderer, hpText, x + BOX_W - 14, y + 72, { size: 20, bold: true }, BOX_INK, 'right');
  }

  /** The bar's width now: sliding to a new HP over BAR_MS; at once for a new Pokémon. */
  private barWidth(slot: SlotKey, ident: string, target: number, now: number): number {
    const bar = this.bars.get(slot);
    if (!bar || bar.ident !== ident) {
      this.bars.set(slot, { ident, width: target, from: target, to: target, start: now, duration: 1 });
      return target;
    }
    if (bar.to !== target) {
      bar.from = bar.width;
      bar.to = target;
      bar.start = now;
      bar.duration = BAR_MS / this.store.speed();
    }
    const t = Math.min(1, (now - bar.start) / bar.duration);
    bar.width = Math.round(bar.from + (bar.to - bar.from) * t);
    return bar.width;
  }

  /**
   * The end of the battle, centred on the field, as BattleResult: who won (or a tie), a best-of set's
   * score, each player's rating before and after in a rated battle ("Updating ratings…" meanwhile).
   * It drops in.
   */
  private drawResult(renderer: GlRenderer, now: number): void {
    const result = this.store.result();
    if (!result) return;
    const watching = this.store.watching();
    const series = this.store.series();
    const setOver = series?.over && !watching ? (series.wins.p1 === series.wins.p2 ? 'Set tied' : series.wins.p1 > series.wins.p2 ? 'Set won' : 'Set lost') : null;
    const kicker = setOver ?? (watching ? 'Battle over' : result === 'win' ? 'Victory' : result === 'loss' ? 'Defeat' : 'Draw');
    const accent = rgba(result === 'tie' ? '#9ca3af' : watching || result === 'win' ? '#fbbf24' : '#f87171');
    const title = result === 'tie' ? 'The battle ended in a tie!' : `${this.store.winner()} won!`;
    const ratings = this.store.ratings();
    const rows = (['p1', 'p2'] as const).flatMap((side) => (ratings[side] ? [{ side, rating: ratings[side]! }] : []));
    const updating = this.store.rated() && rows.length === 0;
    const extra = rows.length > 0 ? rows.length : updating ? 1 : 0;
    const head = 108 + (series ? 36 : 0);
    const height = head + extra * 36 + (extra > 0 ? 14 : 0);
    const left = Math.round((FIELD_W - RESULT_W) / 2);
    const t = Math.min(1, (now - this.resultBorn) / 350);
    // Over the field's upper part: the command panel holds the way on below.
    const top = Math.round((RESULT_AREA_H - height) / 2) - (1 - easeOut(t)) * 40;
    const alpha = t;

    renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [0, 0, 0, 0.25 * alpha] });
    renderer.rect(left, top, RESULT_W, height, { fill: withAlpha(PANEL, alpha), stroke: withAlpha(accent, alpha), radius: 8, border: 4 });
    this.write(renderer, kicker.toUpperCase().split('').join(' '), left + RESULT_W / 2, top + 28, { size: 18, bold: true }, withAlpha(accent, alpha), 'center');
    this.write(renderer, title, left + RESULT_W / 2, top + 68, { size: 34, bold: true }, withAlpha(WHITE, alpha), 'center', RESULT_W - 16);
    if (series) {
      const sides = this.store.sides();
      const line = `Game ${series.game} of ${series.bestOf} · ${sides.p1.name} ${series.wins.p1} – ${series.wins.p2} ${sides.p2.name}`;
      this.write(renderer, line, left + RESULT_W / 2, top + 114, { size: 20 }, withAlpha(rgba('#e5e7eb'), alpha), 'center', RESULT_W - 16);
    }
    rows.forEach(({ side, rating }, i) => {
      const rowY = top + head + i * 36 + 16;
      this.write(renderer, rating.name, left + 32, rowY, { size: 20, bold: true }, withAlpha(SIDE_INK[side], alpha), 'left', 260);
      this.write(renderer, `${rating.before} → ${rating.after}`, left + 488, rowY, { size: 20 }, withAlpha(rgba('#e5e7eb'), alpha), 'right');
      const changeColor = rating.change > 0 ? '#15803d' : rating.change < 0 ? '#b91c1c' : '#4b5563';
      renderer.rect(left + 504, rowY - 15, 100, 30, { fill: withAlpha(rgba(changeColor), alpha), radius: 6 });
      this.write(renderer, signed(rating.change), left + 554, rowY, { size: 20, bold: true }, withAlpha(WHITE, alpha), 'center');
    });
    if (updating) this.write(renderer, 'Updating ratings…', left + RESULT_W / 2, top + head + 16, { size: 18 }, withAlpha(rgba('#d1d5db'), alpha), 'center');
  }

  /** Text with its middle at `cy` (see drawText). */
  private write(renderer: GlRenderer, value: string, x: number, cy: number, style: TextStyle, color: Rgba, align: Align = 'left', maxWidth?: number): void {
    if (this.text) drawText(renderer, this.text, value, x, cy, style, color, { align, maxWidth });
  }

  /**
   * Sky, drifting clouds, the light on the horizon, the ground and the platforms, each where the camera
   * shows it: the clouds far off barely move, the platforms go with their Pokémon. The one choosing (or
   * the target) has a ring of light around its platform.
   */
  private drawScenery(renderer: GlRenderer, now: number, ground: typeof DEFAULT_GROUND, trickRoom: boolean): void {
    const disc = this.disc!;
    const t = now / 1000;
    for (let i = 0; i < 4; i++) {
      const restW = 260 + i * 60;
      const restX = ((t * (8 + i * 4) + i * 300) % (FIELD_W + restW)) - restW;
      const at = this.camera.place(restX + restW / 2, 40 + ((i * 67) % 180), CAMERA_DEPTHS.clouds);
      const w = restW * at.scale;
      const x = at.x - w / 2;
      const y = at.y;
      renderer.rect(x, y, w, w * 0.32, { fill: [1, 1, 1, 0.35], texture: disc });
      renderer.rect(x + w * 0.25, y - w * 0.08, w * 0.5, w * 0.3, { fill: [1, 1, 1, 0.3], texture: disc });
    }
    const groundY = this.camera.place(FIELD_W / 2, GROUND_Y, CAMERA_DEPTHS.groundEdge).y;
    this.groundY = groundY;
    // A soft light along the horizon.
    renderer.rect(-100, groundY - 40, FIELD_W + 200, 80, { fill: [1, 1, 1, 0.1], texture: disc, additive: true });
    renderer.rect(0, groundY, FIELD_W, Math.max(0, FIELD_H - groundY), { fill: rgba(ground.ground) });
    renderer.rect(0, groundY, FIELD_W, 6, { fill: withAlpha(rgba(ground.edge), 0.35) });
    if (trickRoom) this.drawTrickRoomGrid(renderer, now);
    for (const slot of this.slots()) {
      const width = Math.round(slot.own ? slot.size * 1.25 : slot.size);
      const height = Math.round(slot.size * (slot.own ? 0.32 : 0.27));
      const top = Math.round(slot.feetY - height / 2);
      const left = Math.round(slot.feetX - width / 2);
      const glow = this.camera.look(slot.key).glow;
      if (glow > 0.01) renderer.rect(left - 6, top - 4, width + 12, height + 8, { fill: withAlpha(CHOOSER_LIGHT, glow), texture: disc });
      renderer.rect(left, top, width, height, { fill: rgba(ground.edge), texture: disc });
      renderer.rect(left + 3, top + 3, width - 6, height - 6, { fill: rgba(ground.platform), texture: disc });
      renderer.rect(left + width * 0.15, top + height * 0.12, width * 0.5, height * 0.35, { fill: [1, 1, 1, 0.12], texture: disc, additive: true });
    }
  }

  /**
   * Trick Room's twisted space, behind the Pokémon (as Showdown and the games show it): a violet grid,
   * a wall over the horizon and a floor in perspective under it, its lines breathing slowly.
   */
  private drawTrickRoomGrid(renderer: GlRenderer, now: number): void {
    const groundY = this.groundY;
    const alpha = 0.28 + 0.08 * Math.sin(now / 600);
    const color = withAlpha(TRICK_ROOM, alpha);
    renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: withAlpha(TRICK_ROOM, 0.1) });
    // The wall: squares from the horizon up.
    for (let x = (FIELD_W / 2) % TRICK_ROOM_CELL; x < FIELD_W; x += TRICK_ROOM_CELL) renderer.rect(x - 1, 0, 2, groundY, { fill: color });
    for (let y = groundY - TRICK_ROOM_CELL; y > -TRICK_ROOM_CELL; y -= TRICK_ROOM_CELL) renderer.rect(0, y - 1, FIELD_W, 2, { fill: color });
    // The floor: rows closer together towards the horizon, columns running to a point above it.
    const depth = FIELD_H - groundY;
    for (let i = 1; i <= 8; i++) {
      const y = groundY + depth * (i / 8) * (i / 8);
      renderer.rect(0, y - 1, FIELD_W, 2, { fill: color });
    }
    const vanishY = groundY - depth * 1.5;
    const narrowing = (groundY - vanishY) / (FIELD_H - vanishY);
    for (let i = -12; i <= 12; i++) {
      const bottomX = FIELD_W / 2 + i * TRICK_ROOM_CELL * 2;
      const topX = FIELD_W / 2 + (bottomX - FIELD_W / 2) * narrowing;
      line(renderer, topX, groundY, bottomX, FIELD_H, 2, color);
    }
  }

  private drawPokemon(renderer: GlRenderer, slot: Slot, now: number): void {
    const pokemon = slot.pokemon;
    if (!pokemon || (pokemon.fainted && !this.fainting.has(slot.key)) || this.withdrawn.has(slot.key)) return;
    const entering = this.entering.get(slot.key);
    if (entering !== undefined) {
      // No send-out coming (a spectator catching up, Illusion's reveal): it just appears.
      if (now - entering < ENTRY_WAIT_MS) return;
      this.entering.delete(slot.key);
    }
    const visual: Visual = { dx: 0, dy: 0, alpha: 1, bright: 1 };
    const anim = this.anims.get(slot.key);
    if (anim) {
      if (anim.start === null && (!anim.waitFor || anim.waitFor() || now - anim.asked >= IMAGE_WAIT_MS)) anim.start = now;
      const p = anim.start === null ? 0 : Math.min(1, (now - anim.start) / anim.duration);
      anim.frame(visual, p);
      if (p >= 1) {
        this.anims.delete(slot.key);
        anim.done?.();
        if (pokemon.fainted && !this.fainting.has(slot.key)) return;
        Object.assign(visual, { dx: 0, dy: 0, alpha: 1, bright: 1 });
      }
    }
    const texture = this.spriteOf(slot, now);
    if (!texture || visual.alpha <= 0.01) return;
    const { glow, dim } = this.camera.look(slot.key);
    const x = slot.left + visual.dx;
    const y = slot.top + visual.dy - CHOOSER_LIFT_PX * glow;
    // A shadow at its feet, under the sprite.
    renderer.rect(x + slot.size * 0.22, slot.top + visual.dy + slot.size * 0.86, slot.size * 0.56, slot.size * 0.1, { fill: [0, 0, 0, 0.18 * visual.alpha], texture: this.disc });
    // The target being picked: a soft light behind it, breathing (the one choosing a move needs none).
    if (glow > 0.01 && this.cameraFocus.kind === 'target') {
      const breath = 0.8 + 0.2 * Math.sin(now / 260);
      renderer.rect(x + slot.size * 0.08, y + slot.size * 0.12, slot.size * 0.84, slot.size * 0.8, { fill: withAlpha(CHOOSER_LIGHT, 0.4 * glow * breath), texture: this.disc });
    }
    const shade = 1 - CAMERA_TUNING.dimAmount * dim;
    renderer.rect(x, y, slot.size, slot.size, { fill: [shade, shade, shade, visual.alpha], texture });
    if (visual.bright > 1.01) {
      const extra = visual.bright - 1;
      renderer.rect(x, y, slot.size, slot.size, { fill: [extra, extra, extra, visual.alpha], texture, additive: true });
    }
  }

  /** Its sprite, or its substitute doll while it's behind one (not while it uses a move). */
  private spriteOf(slot: Slot, now: number): Texture | null {
    const pokemon = slot.pokemon;
    if (!pokemon) return null;
    const acting = this.acting.get(slot.key);
    if (acting !== undefined && now >= acting) this.acting.delete(slot.key);
    if (pokemon.substitute && !this.acting.has(slot.key)) {
      const doll = this.sprites?.pixelArt(slot.own ? SUBSTITUTE_BACK : SUBSTITUTE_FRONT) ?? null;
      if (doll) return doll;
    }
    return this.sprites?.get(pokemon.sprite, slot.own) ?? null;
  }

  /** Terrain motes floating up from the ground. */
  private drawMotes(renderer: GlRenderer, dt: number, terrain: string | null, now: number): void {
    if (terrain !== this.terrain) {
      this.terrain = terrain;
      this.motes = terrain && TERRAIN_MOTES[terrain] ? Array.from({ length: 56 }, () => this.newMote(true)) : [];
    }
    const color = terrain ? TERRAIN_MOTES[terrain] : null;
    if (!color) return;
    for (const mote of this.motes) {
      mote.y -= mote.speed * dt;
      if (mote.y < this.groundY - 40) Object.assign(mote, this.newMote(false));
      const sway = Math.sin(now / 600 + mote.phase) * 8;
      const fade = Math.min(1, (mote.y - (this.groundY - 40)) / 60);
      glowDot(renderer, mote.x + sway, mote.y, mote.size, color, 0.8 * fade, true);
    }
  }

  private newMote(anywhere: boolean): Mote {
    return {
      x: Math.random() * FIELD_W,
      y: anywhere ? this.groundY + Math.random() * Math.max(0, FIELD_H - this.groundY) : FIELD_H + 10,
      speed: 20 + Math.random() * 30,
      phase: Math.random() * 10,
      size: 3 + Math.random() * 4,
    };
  }

  /** Rain, snow, sand, sun rays or wind, across the whole field. */
  private drawWeather(renderer: GlRenderer, dt: number, kind: WeatherKind, now: number): void {
    if (kind !== this.weatherKind) {
      this.weatherKind = kind;
      const count = kind === 'rain' ? 260 : kind === 'snow' ? 210 : kind === 'sand' ? 290 : kind === 'wind' ? 22 : 0;
      this.weather = Array.from({ length: count }, () => ({
        x: Math.random() * FIELD_W,
        y: Math.random() * FIELD_H,
        speed: 0.6 + Math.random() * 0.6,
        phase: Math.random() * 10,
        size: 1 + Math.random(),
      }));
    }
    const t = now / 1000;
    switch (kind) {
      case 'rain':
        renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [0.1, 0.15, 0.25, 0.12] });
        for (const drop of this.weather) {
          drop.y += 900 * drop.speed * dt;
          drop.x -= 240 * drop.speed * dt;
          if (drop.y > FIELD_H + 20) {
            drop.y = -20;
            drop.x = Math.random() * (FIELD_W + 200);
          }
          if (drop.x < -20) drop.x += FIELD_W + 40;
          renderer.rect(drop.x - 1, drop.y - 12, 2.5, 24 * drop.speed, { fill: [0.85, 0.9, 1, 0.55], radius: 1.2, angle: 0.26 });
        }
        return;
      case 'snow':
        for (const flake of this.weather) {
          flake.y += 70 * flake.speed * dt;
          if (flake.y > FIELD_H + 10) {
            flake.y = -10;
            flake.x = Math.random() * FIELD_W;
          }
          const x = flake.x + Math.sin(t * 1.5 + flake.phase) * 18;
          glowDot(renderer, x, flake.y, 2.5 * flake.size + 1, WHITE, 0.9, false);
        }
        return;
      case 'sand':
        renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [0.85, 0.7, 0.4, 0.14] });
        for (const grain of this.weather) {
          grain.x += 520 * grain.speed * dt;
          grain.y += Math.sin(t * 3 + grain.phase) * 30 * dt;
          if (grain.x > FIELD_W + 10) {
            grain.x = -10;
            grain.y = Math.random() * FIELD_H;
          }
          renderer.rect(grain.x, grain.y, 6 * grain.size, 2 * grain.size, { fill: [0.7, 0.55, 0.3, 0.7], radius: grain.size });
        }
        return;
      case 'sun':
        renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [1, 0.8, 0.4, 0.05], additive: true });
        for (let i = 0; i < 7; i++) {
          const sway = Math.sin(t * 0.6 + i * 1.7);
          const x = 80 + i * 190 + sway * 30;
          const alpha = 0.1 + 0.06 * Math.sin(t * 1.3 + i);
          renderer.rect(x - 40, -120, 80, FIELD_H + 240, { fill: [1, 0.95, 0.75, alpha], radius: 40, softness: 40, angle: 0.35, additive: true });
        }
        glowDot(renderer, 60, 30, 120, [1, 0.95, 0.7, 1], 0.5, true);
        return;
      case 'wind':
        for (const gust of this.weather) {
          gust.x += 700 * gust.speed * dt;
          if (gust.x > FIELD_W + 200) {
            gust.x = -200;
            gust.y = Math.random() * FIELD_H;
          }
          renderer.rect(gust.x, gust.y, 160, 4, { fill: [0.85, 0.92, 1, 0.45], radius: 2, softness: 2, additive: true });
        }
        return;
      default:
        return;
    }
  }

  private drawLabels(renderer: GlRenderer, now: number): void {
    this.popups = this.popups.filter((s) => s.until > now);
    this.hpLabels = this.hpLabels.filter((s) => s.until > now);
    this.statusLabels = this.statusLabels.filter((s) => s.until > now);
    this.statLabels = this.statLabels.filter((s) => s.until > now);

    for (const { item, born } of this.popups) {
      const { left, top } = this.bannerPosition(item.slot, BANNER_HEIGHT + 4);
      const border = item.kind === 'item' ? rgba('#2dd4bf') : item.kind === 'notice' ? rgba('#9ca3af') : rgba('#facc15');
      const nameColor = item.kind === 'item' ? rgba('#99f6e4') : item.kind === 'notice' ? WHITE : rgba('#fde68a');
      this.card(renderer, now - born, left, top, BANNER_WIDTH, BANNER_HEIGHT, PANEL, border, [
        { text: item.name, size: 20, bold: true, color: nameColor, y: 16 },
        { text: this.pokemonAt(item.slot)?.name ?? '', size: 15, color: WHITE, y: 37 },
      ]);
    }
    for (const { item, born } of this.hpLabels) {
      const top = this.hpLabelPosition(item.slot);
      const left = item.crit ? this.centredOver(item.slot, HP_LABEL_WIDTH + CRIT_LABEL_GAP + CRIT_LABEL_WIDTH) : this.centredOver(item.slot, HP_LABEL_WIDTH);
      const rise = Math.min(1, (now - born) / 600) * -10;
      this.card(renderer, now - born, left, top + rise, HP_LABEL_WIDTH, LABEL_HEIGHT, item.change < 0 ? HP_LOST : HP_RESTORED, WHITE, [
        { text: `${item.change > 0 ? '+' : ''}${item.change}%`, size: 22, bold: true, color: WHITE, y: 20 },
      ]);
      if (item.crit) {
        this.card(renderer, now - born, left + HP_LABEL_WIDTH + CRIT_LABEL_GAP, top + rise, CRIT_LABEL_WIDTH, LABEL_HEIGHT, CRIT, WHITE, [
          { text: 'Critical hit!', size: 20, bold: true, color: WHITE, y: 20 },
        ]);
      }
    }
    for (const { item, born } of this.statusLabels) {
      const info = STATUS[item.status];
      const name = info?.name ?? item.status;
      this.card(renderer, now - born, this.centredOver(item.slot, STATUS_LABEL_WIDTH), this.hpLabelPosition(item.slot) + STATUS_LABEL_DROP, STATUS_LABEL_WIDTH, LABEL_HEIGHT, rgba(info?.color ?? '#374151'), WHITE, [
        { text: `${name[0].toUpperCase()}${name.slice(1)}!`, size: 20, bold: true, color: WHITE, y: 20 },
      ]);
    }
    for (const { item, born } of this.statLabels) {
      this.card(renderer, now - born, this.centredOver(item.slot, STATUS_LABEL_WIDTH), this.hpLabelPosition(item.slot) + STATUS_LABEL_DROP, STATUS_LABEL_WIDTH, LABEL_HEIGHT, item.amount > 0 ? STAT_UP : STAT_DOWN, WHITE, [
        { text: `${STAT_NAMES[item.stat] ?? item.stat} ${item.amount > 0 ? '+' : ''}${item.amount}`, size: 20, bold: true, color: WHITE, y: 20 },
      ]);
    }

    const action = this.store.action();
    if (action && this.banner?.id === action.id) {
      const name = (slot: SlotKey) => this.pokemonAt(slot)?.name ?? '';
      const targets = action.targets.filter((t) => t !== action.attacker).map(name).filter(Boolean);
      const detail = targets.length > 0 ? `${name(action.attacker)} → ${targets.join(' & ')}` : name(action.attacker);
      const { left, top } = this.bannerPosition(action.attacker, 0);
      const color = rgba(typeColor(action.type) || '#374151');
      const age = now - this.banner.born;
      this.card(renderer, age, left, top, BANNER_WIDTH, BANNER_HEIGHT, color, WHITE, [
        { text: action.move, size: 20, bold: true, color: WHITE, y: 16 },
        { text: detail, size: 15, color: WHITE, y: 37 },
      ]);
      // A shine sweeping across the banner as it appears.
      if (age < 500) {
        const sweep = left - 40 + (BANNER_WIDTH + 80) * (age / 500);
        renderer.rect(sweep, top + 2, 28, BANNER_HEIGHT - 4, { fill: [1, 1, 1, 0.35 * (1 - age / 500)], radius: 8, softness: 10, angle: 0.3, additive: true });
      }
    }
  }

  /** A label box popping in (a quick overshoot), with lines of centred text. */
  private card(
    renderer: GlRenderer,
    age: number,
    left: number,
    top: number,
    width: number,
    height: number,
    fill: Rgba,
    border: Rgba,
    lines: { text: string; size: number; bold?: boolean; color: Rgba; y: number }[],
  ): void {
    const t = Math.min(1, age / (POP_MS / this.store.speed()));
    const s = t >= 1 ? 1 : 0.6 + 0.4 * backOut(t);
    const alpha = Math.min(1, t * 2);
    const cx = left + width / 2;
    const cy = top + height / 2;
    const w = width * s;
    const h = height * s;
    renderer.rect(cx - w / 2 + 2, cy - h / 2 + 3, w, h, { fill: [0, 0, 0, 0.25 * alpha], radius: 7 * s, softness: 4 });
    renderer.rect(cx - w / 2, cy - h / 2, w, h, { fill: withAlpha(fill, alpha), stroke: withAlpha(border, alpha), radius: 6 * s, border: 2 });
    for (const line of lines) {
      const texture = this.label(line.text, { size: line.size, bold: line.bold });
      if (!texture) continue;
      const scale = Math.min(s, ((width - 8) * s) / texture.width);
      renderer.image(texture, cx - (texture.width * scale) / 2, cy + (line.y - height / 2) * s - (texture.height * scale) / 2, scale, withAlpha(line.color, alpha));
    }
  }

  /** The battle's title before the first Pokémon come out: the names slide in from either side. */
  private drawIntro(renderer: GlRenderer, now: number): void {
    const intro = this.store.intro();
    if (!intro) return;
    const age = now - this.introBorn;
    const t = Math.min(1, age / 450);
    const e = easeOut(t);
    const s = 0.85 + 0.15 * backOut(t);
    const cx = FIELD_W / 2;
    const cy = RESULT_AREA_H / 2;
    renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [0, 0, 0, 0.25 * e] });
    renderer.rect(cx - 320 * s, cy - 84 * s, 640 * s, 168 * s, { fill: withAlpha(PANEL, e), stroke: withAlpha(WHITE, e), radius: 10, border: 2 });
    const p1 = this.label(intro.p1, { size: 30, bold: true });
    const vs = this.label('vs', { size: 22, bold: true });
    const p2 = this.label(intro.p2, { size: 30, bold: true });
    if (p1) renderer.image(p1, cx - p1.width / 2 - 200 * (1 - e), cy - 44 - p1.height / 2, 1, withAlpha(WHITE, e));
    if (vs) {
      const pulse = 1 + 0.08 * Math.sin(age / 150);
      renderer.image(vs, cx - (vs.width * pulse) / 2, cy - (vs.height * pulse) / 2, pulse, withAlpha(rgba('#fde68a'), e));
    }
    if (p2) renderer.image(p2, cx - p2.width / 2 + 200 * (1 - e), cy + 44 - p2.height / 2, 1, withAlpha(WHITE, e));
  }

  // ---------------------------------------------------------------- positions

  /** What the camera looks at; the screen says so every frame. */
  focusOn(focus: CameraFocus): void {
    this.cameraFocus = focus;
  }

  /** Every stand where the camera shows it now. */
  private slots(): Slot[] {
    const { scale } = this.layout();
    return this.occupants().map((occupant) => {
      const at = this.camera.project(occupant.stand.x, occupant.stand.y, depthOf(occupant.key));
      const size = Math.round(96 * at.k * scale);
      return { ...occupant, size, feetX: at.x, feetY: at.y, left: Math.round(at.x - size / 2), top: Math.round(at.y + feetGap(size) - size) };
    });
  }

  /** The target being picked: its status box lights up too. */
  private isPicked(slot: SlotKey): boolean {
    return this.cameraFocus.kind === 'target' && this.cameraFocus.slot === slot;
  }

  /** A slot's sprite size now (for effects on it). */
  private sizeOf(slot: SlotKey): number {
    return this.slotData(slot)?.size ?? 96 * CAMERA_TUNING.rest.own;
  }

  private slotData(slot: SlotKey): Slot | undefined {
    return this.slots().find((s) => s.key === slot);
  }

  private pokemonAt(slot: SlotKey): BattlePokemon | null {
    return this.slotData(slot)?.pokemon ?? null;
  }

  private effectPoint(slot: SlotKey): EffectPoint | null {
    const data = this.slotData(slot);
    if (!data?.pokemon || data.pokemon.fainted) return null;
    return { x: Math.round(data.left + data.size / 2), y: Math.round(data.top + data.size * 0.55) };
  }

  /** Over a Pokémon's head (its sprite's top middle), where confusion's stars circle. */
  private headPoint(slot: SlotKey): EffectPoint | null {
    const data = this.slotData(slot);
    if (!data?.pokemon || data.pokemon.fainted) return null;
    return { x: Math.round(data.left + data.size / 2), y: Math.round(data.top + data.size * 0.24) };
  }

  /** Where a Pokémon on the field is drawn (field coordinates), for the screen's marks over it; null for an empty slot. */
  spriteArea(slot: SlotKey): { left: number; top: number; size: number } | null {
    const data = this.slotData(slot);
    if (!data?.pokemon || data.pokemon.fainted) return null;
    return { left: data.left, top: data.top, size: data.size };
  }

  private hpLabelPosition(slot: SlotKey): number {
    const share = slot.startsWith('p1') ? 0.36 : 0.43;
    const from = this.slotData(slot);
    return Math.round((from?.top ?? 0) + (from?.size ?? 0) * share);
  }

  private centredOver(slot: SlotKey, width: number): number {
    const from = this.slotData(slot);
    return Math.round((from?.left ?? 0) + (from?.size ?? 0) / 2 - width / 2);
  }

  private bannerPosition(slot: SlotKey, drop: number): { left: number; top: number } {
    const from = this.slotData(slot);
    const own = slot.startsWith('p1');
    const centred = (from?.left ?? 0) + (from?.size ?? 0) / 2 - BANNER_WIDTH / 2;
    const left = Math.max(8, Math.min(own ? OWN_BANNER_MAX_LEFT : FOE_BANNER_MAX_LEFT, Math.round(centred)));
    const top = from?.top ?? 0;
    return { left, top: (own ? top - 40 : Math.max(4, top - 18)) + drop };
  }

  private label(text: string, style: TextStyle): Texture | null {
    return this.text?.get(text, style) ?? null;
  }
}

/** Overshoots a little before settling (a pop). */
function backOut(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/** A straight line from (x1, y1) to (x2, y2), `width` thick. */
function line(renderer: GlRenderer, x1: number, y1: number, x2: number, y2: number, width: number, color: Rgba): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  renderer.rect((x1 + x2) / 2 - length / 2, (y1 + y2) / 2 - width / 2, length, width, { fill: color, angle: Math.atan2(y2 - y1, x2 - x1) });
}
