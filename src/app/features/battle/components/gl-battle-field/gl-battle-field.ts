import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { movePattern } from '@features/battle/animation/move-patterns';
import { outAndBack } from '@features/battle/animation/step-animation';
import {
  DEFAULT_GROUND,
  DEFAULT_SKY,
  DOUBLES,
  FieldLayout,
  OWN_PLATFORM_HEIGHT,
  OWN_PLATFORM_TOP,
  SINGLES,
  STAT_NAMES,
  TERRAIN_COLORS,
  TERRAIN_SKY,
  WEATHER_SKY,
  spriteBox,
} from '@features/battle/components/battle-field/battle-field';
import { BattleHpBox, HpBoxEmphasis } from '@features/battle/components/battle-hp-box/battle-hp-box';
import { BattleResult } from '@features/battle/components/battle-result/battle-result';
import { EffectPoint, EffectTarget } from '@features/battle/components/move-effects/move-effects';
import { GRAPH_COLORS, GlDiagnostics, LONG_FRAME_MS } from '@features/battle/gl/gl-diagnostics';
import { GlEffects, easeOut, glowDot } from '@features/battle/gl/gl-effects';
import { GlFieldLayout } from '@features/battle/gl/gl-experiment';
import { GlSprites } from '@features/battle/gl/gl-sprites';
import { SpriteBitmaps } from '@features/battle/gl/sprite-bitmaps';
import { BattlePokemon, EffectPopup, FieldEvent, HpChange, MoveAction, SlotKey, StatChange, StatusChange } from '@features/battle/models/battle';
import { BattleStore } from '@features/battle/state/battle-store';
import { STATUS } from '@features/battle/state/status-conditions';
import { GlRenderer, Rgba, Texture, rgba, withAlpha } from '@features/gl-home/gl/gl-renderer';
import { TextStyle, TextTextures, discTexture } from '@features/gl-home/gl/gl-textures';
import { typeColor } from '@shared/data/type-colors';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';

const FIELD_W = 985;
const FIELD_H = 500;
const STAGE_W = 1280;
const STAGE_H = 720;
/** The full layout draws the field this much bigger, centred on the stage. */
const FULL_SCALE = STAGE_W / FIELD_W;
const FULL_TOP = (STAGE_H - FIELD_H * FULL_SCALE) / 2;

// The same lengths as the DOM field's, at normal speed (the replay speed divides them).
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
const MEGA_MS = 900;
const POPUP_MS = 1400;
const HP_LABEL_MS = 1100;
/** Labels and banners pop in over this long. */
const POP_MS = 180;

const BANNER_WIDTH = 240;
const OWN_BANNER_MAX_LEFT = 595 - BANNER_WIDTH;
const FOE_BANNER_MAX_LEFT = 985 - 8 - BANNER_WIDTH;
const HP_LABEL_WIDTH = 76;
const CRIT_LABEL_WIDTH = 128;
const CRIT_LABEL_GAP = 6;
const STATUS_LABEL_WIDTH = 150;
const STATUS_LABEL_DROP = 36;

const PANEL: Rgba = rgba('#1f2937');
const WHITE: Rgba = [1, 1, 1, 1];
const HP_LOST: Rgba = rgba('#b91c1c');
const HP_RESTORED: Rgba = rgba('#15803d');
const CRIT: Rgba = rgba('#b45309');
const STAT_UP: Rgba = rgba('#15803d');
const STAT_DOWN: Rgba = rgba('#b91c1c');
const TRICK_ROOM: Rgba = rgba('#a855f7');

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

interface Slot {
  key: SlotKey;
  own: boolean;
  pokemon: BattlePokemon | null;
  left: number;
  top: number;
  size: number;
  boxLeft: number;
  boxTop: number;
}

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
 * EXPERIMENT (feat/webgl-probe): the battle field drawn with WebGL, in place of BattleField. Same
 * layout, the same store events and the same animations, but every sprite, platform, effect and
 * label on one canvas: moves get real light (additive glows, many more sparks), the weather falls
 * across the field (rain, snow, sand, sun rays, wind), terrains send motes up, clouds drift, labels
 * and banners pop in, send-outs and Mega Evolutions burst with light. The status boxes and the
 * result stay in the DOM over the canvas (they are text that changes, and accessible as they are).
 * Watching (replays, live), R switches between this field and the DOM one.
 */
@Component({
  selector: 'app-gl-battle-field',
  imports: [BattleHpBox, BattleResult],
  host: { class: 'block', '[style.width.px]': 'size().w', '[style.height.px]': 'size().h' },
  template: `
    <div class="relative block overflow-hidden" [style.width.px]="size().w" [style.height.px]="size().h">
      <canvas
        #canvas
        aria-hidden="true"
        class="absolute top-0 left-0 block"
        [style.width.px]="size().w"
        [style.height.px]="size().h"
        [attr.width]="size().w * scale"
        [attr.height]="size().h * scale"
      ></canvas>
      @for (slot of slots(); track slot.key) {
        @if (mode() === 'normal' && slot.pokemon && !slot.pokemon.fainted) {
          @if (slot.own) {
            <app-battle-hp-box
              class="absolute"
              [style.left.px]="slot.boxLeft"
              [style.top.px]="slot.boxTop"
              [pokemon]="slot.pokemon"
              [own]="true"
              [exact]="!store.watching()"
              [emphasis]="emphasis()[slot.key] ?? null"
            />
          } @else {
            <app-battle-hp-box class="absolute" [style.left.px]="slot.boxLeft" [style.top.px]="slot.boxTop" [pokemon]="slot.pokemon" [emphasis]="emphasis()[slot.key] ?? null" />
          }
        }
      }
      <app-battle-result />
      @if (failure(); as message) {
        <p role="alert" class="absolute top-[220px] left-[150px] block h-[60px] w-[685px] rounded-md border-2 border-white bg-[#1f2937] text-center text-lg leading-[56px] text-white">WebGL failed: {{ message }}</p>
      }
    </div>
  `,
})
export class GlBattleField {
  protected readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private readonly diagnostics = inject(GlDiagnostics);
  /** EXPERIMENT: the test layout (see GlFieldLayout); the DOM status boxes only show in `normal`. */
  readonly mode = input<GlFieldLayout>('normal');
  private readonly bitmaps = inject(SpriteBitmaps);
  protected readonly scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  protected readonly size = computed(() => (this.mode() === 'full' ? { w: STAGE_W, h: STAGE_H } : { w: FIELD_W, h: FIELD_H }));
  protected readonly failure = signal<string | null>(null);

  private readonly layout = computed<FieldLayout>(() => (this.store.gameType() === 'singles' ? SINGLES : DOUBLES));

  /** Every stand of the layout with whoever is on it: the opponent's first (drawn behind), then the player's. */
  protected readonly slots = computed((): Slot[] => {
    const { spriteSize, stands } = this.layout();
    const sides = this.store.sides();
    const entries = Object.entries(stands);
    return [...entries.filter(([key]) => key.startsWith('p2')), ...entries.filter(([key]) => key.startsWith('p1'))].map(([key, stand]) => ({
      key,
      own: key.startsWith('p1'),
      pokemon: sides[key.slice(0, 2) as 'p1' | 'p2'].active[key[2] === 'b' ? 1 : 0] ?? null,
      ...spriteBox(stand, spriteSize),
      size: spriteSize,
      boxLeft: stand.boxLeft,
      boxTop: stand.boxTop,
    }));
  });

  protected readonly emphasis = computed(() => {
    const action = this.store.action();
    const emphasis: Record<SlotKey, HpBoxEmphasis> = {};
    if (!action) return emphasis;
    for (const target of action.targets) emphasis[target] = 'target';
    emphasis[action.attacker] = 'attacker';
    return emphasis;
  });

  // Drawing state, outside Angular: the frame loop never renders the component.
  private renderer: GlRenderer | null = null;
  private text: TextTextures | null = null;
  private sprites: GlSprites | null = null;
  private disc: Texture | null = null;
  private readonly effects = new GlEffects();
  private frameHandle = 0;
  private last = 0;
  private readonly anims = new Map<SlotKey, SlotAnim>();
  private readonly shownIdents = new Map<SlotKey, string>();
  private readonly fainting = new Set<SlotKey>();
  private shake: { start: number; duration: number } | null = null;
  private banner: { id: number; born: number } | null = null;
  private popups: Shown<EffectPopup>[] = [];
  private hpLabels: Shown<HpChange>[] = [];
  private statusLabels: Shown<StatusChange>[] = [];
  private statLabels: Shown<StatChange>[] = [];
  private introBorn = 0;
  private weatherKind: WeatherKind = null;
  private weather: Mote[] = [];
  private terrain: string | null = null;
  private motes: Mote[] = [];
  private readonly preloaded = new Set<string>();
  private fps = { frames: 0, since: 0, value: 0, worst: 0, shownWorst: 0 };
  /** The diagnostics' own text, kept apart so its uploads don't count. */
  private hudText: TextTextures | null = null;
  private hudLines: string[] = [];
  private hudUpdated = 0;

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
    this.follow(this.store.statChanges, (list) => (this.statLabels = list), () => this.statLabels, POPUP_MS, (change) => {
      const at = this.effectPoint(change.slot);
      if (at) this.effects.statChange(at, change.amount > 0, this.layout().spriteSize);
    });
    effect(() => {
      if (this.store.intro()) this.introBorn = performance.now();
    });
    // Team preview's Pokémon (and their Megas) are fetched ahead, as the DOM field does.
    effect(() => {
      const { p1, p2 } = this.store.sides();
      untracked(() => {
        p1.preview.forEach((species) => this.preloadWithMegas(species, true));
        p2.preview.forEach((species) => this.preloadWithMegas(species, false));
      });
    });

    afterNextRender(() => this.startGl());
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frameHandle);
      this.sprites?.dispose();
      this.text?.dispose();
      this.hudText?.dispose();
      this.renderer?.dispose();
    });
  }

  private startGl(): void {
    try {
      const { w, h } = this.size();
      this.renderer = new GlRenderer(this.canvasRef().nativeElement, w, h);
    } catch (error) {
      this.failure.set(String(error));
      return;
    }
    this.text = new TextTextures(this.renderer, this.scale, getComputedStyle(document.body).fontFamily || 'Roboto, sans-serif');
    this.sprites = new GlSprites(this.renderer, this.bitmaps);
    this.text.onUpload = (ms) => this.diagnostics.record('text', ms);
    this.sprites.onUpload = (ms) => this.diagnostics.record('sprite', ms);
    this.bitmaps.onArrival = () => this.diagnostics.record('arrival', 0);
    this.hudText = new TextTextures(this.renderer, this.scale, getComputedStyle(document.body).fontFamily || 'Roboto, sans-serif');
    this.diagnostics.clearFrames();
    this.disc = discTexture(this.renderer);
    for (const url of this.preloaded) {
      const [sprite, back] = url.split('|');
      this.sprites.preload(sprite, back === 'back');
    }
    this.last = performance.now();
    this.fps.since = this.last;
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  private preloadWithMegas(species: string, back: boolean): void {
    const sprite = this.dex.species(species)?.sprite ?? spriteId(species);
    const sprites = [sprite, ...this.dex.allMegas.filter((m) => m.base === toId(species)).map((m) => m.sprite)];
    for (const s of sprites) {
      for (const b of back ? [false, true] : [false]) {
        const key = `${s}|${b ? 'back' : 'front'}`;
        if (this.preloaded.has(key)) continue;
        this.preloaded.add(key);
        this.sprites?.preload(s, b);
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
    const size = this.layout().spriteSize;
    const slot = this.slotData(event.slot);
    switch (event.kind) {
      case 'hit':
        this.blink(event.slot);
        return;
      case 'faint':
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
            // Coming out: a flash of light where it lands, as a Poké Ball opening.
            if (!leaving && !burst && p > 0.6) {
              burst = true;
              const at = this.effectPoint(event.slot);
              if (at) {
                this.effects.burst(at, WHITE, 18, 260 * (size / 240), 8 * (size / 240), 500);
                this.effects.tween(300, (r, q) => glowDot(r, at.x, at.y, (40 + 120 * q) * (size / 240), WHITE, 0.6 * (1 - q), true));
              }
            }
            if (!leaving) v.bright = 1 + 1.5 * (1 - p);
          },
          { waitFor: leaving ? undefined : () => !this.sprites?.pending(sprite, own) },
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
    }
  }

  /** The same choreography as the DOM field's playMove, drawn with the WebGL effects. */
  private playMove(action: MoveAction): void {
    const effects = this.effects;
    effects.speed = this.store.speed();
    const size = this.layout().spriteSize;
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
            if (at) effects.aura(at, action.type, size);
          }
        }
        if (pattern === 'quake') {
          this.shake = { start: performance.now(), duration: QUAKE_MS / this.store.speed() };
          const shaken = [...new Set([...action.targets, ...action.hits])].filter((slot) => slot !== action.attacker);
          effects.dust(shaken.map((slot) => this.effectPoint(slot)).filter((p): p is EffectPoint => !!p), size);
          for (const slot of action.hits) {
            this.blink(slot);
            const at = this.effectPoint(slot);
            if (at) effects.impact(at, action.type, size, true);
          }
          return;
        }
        if (pattern === 'rocks') {
          for (const slot of new Set([...action.targets.filter((t) => t !== action.attacker), ...action.hits])) {
            const at = this.effectPoint(slot);
            const hit = action.hits.includes(slot);
            if (at) effects.rocks(at, hit, size, () => this.blink(slot));
            else if (hit) this.blink(slot);
          }
          return;
        }
        for (const slot of action.hits) {
          const at = this.effectPoint(slot);
          if (!at) this.blink(slot);
          else if (pattern === 'flurry') effects.flurry(at, action.type, size, () => this.blink(slot));
          else if (pattern === 'clap') effects.clap(at, action.type, size, () => this.blink(slot, true));
          else {
            this.blink(slot);
            effects.impact(at, action.type, size);
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
      if (at) this.effects.trail((p) => ({ x: at.x + dx * outAndBack(p), y: at.y + dy * outAndBack(p) }), action.type, this.layout().spriteSize, ms);
    }
    let struck = false;
    this.animate(action.attacker, ms, (v, p) => {
      // Eased out and back: a quicker strike than the DOM's linear one.
      const amount = easeOut(outAndBack(p));
      v.dx = dx * amount;
      v.dy = dy * amount;
      if (!struck && p >= 0.5) {
        struck = true;
        contact();
      }
    });
  }

  private blink(slot: SlotKey, shake = false): void {
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

  private frame(now: number): void {
    const started = performance.now();
    const renderer = this.renderer!;
    const interval = now - this.last;
    const dt = Math.min(0.1, interval / 1000);
    this.last = now;
    this.measure(now, dt * 1000);
    this.effects.update(now, dt);
    this.sprites?.startFrame();
    this.syncIdents();

    const { weather, terrain, rooms } = this.store.field();
    const ground = (terrain && TERRAIN_COLORS[terrain.id]) || DEFAULT_GROUND;
    const sky = rgba((weather && WEATHER_SKY[weather.id]) || (terrain && TERRAIN_SKY[terrain.id]) || DEFAULT_SKY);

    if (this.shake) {
      const p = (now - this.shake.start) / this.shake.duration;
      if (p >= 1) this.shake = null;
      renderer.originX = p >= 1 ? 0 : Math.sin(p * QUAKE_SHAKES * 2 * Math.PI) * QUAKE_PX * (1 - p);
    } else {
      renderer.originX = 0;
    }

    renderer.beginPlain(sky);
    const full = this.mode() === 'full';
    renderer.setView(full ? FULL_SCALE : 1, 0, full ? FULL_TOP : 0);
    this.drawScenery(renderer, now, ground);
    this.drawMotes(renderer, dt, terrain?.id ?? null, now);
    for (const slot of this.slots()) this.drawPokemon(renderer, slot, now);
    this.effects.draw(renderer);
    this.drawWeather(renderer, dt, weather ? (WEATHER_KIND[weather.id] ?? null) : null, now);
    if (rooms.some((room) => room.id === 'Trick Room')) {
      const pulse = 0.75 + 0.25 * Math.sin(now / 300);
      renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [0, 0, 0, 0], stroke: withAlpha(TRICK_ROOM, pulse), border: 6 });
    }
    if (this.mode() !== 'normal') this.drawHpBars(renderer);
    this.drawLabels(renderer, now);
    this.drawIntro(renderer, now);
    if (full) {
      // Bars above and below the field, as the stage is wider than it.
      const bar = FULL_TOP / FULL_SCALE + 2;
      renderer.rect(-10, -bar, FIELD_W + 20, bar, { fill: [0.08, 0.1, 0.14, 1] });
      renderer.rect(-10, FIELD_H, FIELD_W + 20, bar, { fill: [0.08, 0.1, 0.14, 1] });
    }
    renderer.originX = 0;
    renderer.setView(1, 0, 0);
    this.drawHud(renderer, now);
    renderer.end();
    this.diagnostics.frame(interval, performance.now() - started);
  }

  /** Without the DOM status boxes (test layouts): each Pokémon's name and HP bar, drawn here. */
  private drawHpBars(renderer: GlRenderer): void {
    for (const slot of this.slots()) {
      const pokemon = slot.pokemon;
      if (!pokemon || pokemon.fainted) continue;
      const share = pokemon.maxHp > 0 ? Math.max(0, Math.min(1, pokemon.hp / pokemon.maxHp)) : 0;
      renderer.rect(slot.boxLeft, slot.boxTop, 300, 54, { fill: rgba('#fdf6d8'), stroke: rgba('#374151'), radius: 8, border: 3 });
      const name = this.label(pokemon.name, { size: 18, bold: true });
      if (name) renderer.image(name, slot.boxLeft + 14, slot.boxTop + 16 - name.height / 2, 1, rgba('#1f2937'));
      renderer.rect(slot.boxLeft + 14, slot.boxTop + 32, 272, 10, { fill: rgba('#4b5563'), radius: 5 });
      const color = share > 0.5 ? rgba('#22c55e') : share > 0.2 ? rgba('#eab308') : rgba('#ef4444');
      if (share > 0) renderer.rect(slot.boxLeft + 14, slot.boxTop + 32, 272 * share, 10, { fill: color, radius: 5 });
    }
  }

  private measure(now: number, frameMs: number): void {
    const fps = this.fps;
    fps.frames++;
    fps.worst = Math.max(fps.worst, frameMs);
    if (now - fps.since >= 500) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.since));
      fps.shownWorst = fps.worst;
      fps.frames = 0;
      fps.worst = 0;
      fps.since = now;
    }
  }

  /** Sky, drifting clouds, the light on the horizon, the ground and the platforms. */
  private drawScenery(renderer: GlRenderer, now: number, ground: typeof DEFAULT_GROUND): void {
    const disc = this.disc!;
    const t = now / 1000;
    for (let i = 0; i < 4; i++) {
      const w = 220 + i * 50;
      const x = ((t * (8 + i * 4) + i * 300) % (FIELD_W + w)) - w;
      const y = 30 + ((i * 53) % 140);
      renderer.rect(x, y, w, w * 0.32, { fill: [1, 1, 1, 0.35], texture: disc });
      renderer.rect(x + w * 0.25, y - w * 0.08, w * 0.5, w * 0.3, { fill: [1, 1, 1, 0.3], texture: disc });
    }
    // A soft light along the horizon.
    renderer.rect(-100, 262, FIELD_W + 200, 76, { fill: [1, 1, 1, 0.1], texture: disc, additive: true });
    renderer.rect(0, 300, FIELD_W, 200, { fill: rgba(ground.ground) });
    renderer.rect(0, 300, FIELD_W, 6, { fill: withAlpha(rgba(ground.edge), 0.35) });
    const { spriteSize, stands } = this.layout();
    for (const [key, stand] of Object.entries(stands)) {
      const own = key.startsWith('p1');
      const width = Math.round(own ? spriteSize * 1.25 : spriteSize);
      const height = own ? OWN_PLATFORM_HEIGHT : Math.round(spriteSize * 0.27);
      const top = own ? OWN_PLATFORM_TOP : Math.round(stand.y - height / 2);
      const left = Math.round(stand.x - width / 2);
      renderer.rect(left, top, width, height, { fill: rgba(ground.edge), texture: disc });
      renderer.rect(left + 3, top + 3, width - 6, height - 6, { fill: rgba(ground.platform), texture: disc });
      renderer.rect(left + width * 0.15, top + height * 0.12, width * 0.5, height * 0.35, { fill: [1, 1, 1, 0.12], texture: disc, additive: true });
    }
  }

  private drawPokemon(renderer: GlRenderer, slot: Slot, now: number): void {
    const pokemon = slot.pokemon;
    if (!pokemon || (pokemon.fainted && !this.fainting.has(slot.key))) return;
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
    const texture = this.sprites?.get(pokemon.sprite, slot.own) ?? null;
    if (!texture || visual.alpha <= 0.01) return;
    const x = slot.left + visual.dx;
    const y = slot.top + visual.dy;
    // A shadow at its feet, under the sprite.
    renderer.rect(x + slot.size * 0.22, y + slot.size * 0.86, slot.size * 0.56, slot.size * 0.1, { fill: [0, 0, 0, 0.18 * visual.alpha], texture: this.disc });
    renderer.rect(x, y, slot.size, slot.size, { fill: [1, 1, 1, visual.alpha], texture });
    if (visual.bright > 1.01) {
      const extra = visual.bright - 1;
      renderer.rect(x, y, slot.size, slot.size, { fill: [extra, extra, extra, visual.alpha], texture, additive: true });
    }
  }

  /** Terrain motes floating up from the ground. */
  private drawMotes(renderer: GlRenderer, dt: number, terrain: string | null, now: number): void {
    if (terrain !== this.terrain) {
      this.terrain = terrain;
      this.motes = terrain && TERRAIN_MOTES[terrain] ? Array.from({ length: 40 }, () => this.newMote(true)) : [];
    }
    const color = terrain ? TERRAIN_MOTES[terrain] : null;
    if (!color) return;
    for (const mote of this.motes) {
      mote.y -= mote.speed * dt;
      if (mote.y < 260) Object.assign(mote, this.newMote(false));
      const sway = Math.sin(now / 600 + mote.phase) * 8;
      const fade = Math.min(1, (mote.y - 260) / 60);
      glowDot(renderer, mote.x + sway, mote.y, mote.size, color, 0.8 * fade, true);
    }
  }

  private newMote(anywhere: boolean): Mote {
    return {
      x: Math.random() * FIELD_W,
      y: anywhere ? 300 + Math.random() * 200 : FIELD_H + 10,
      speed: 20 + Math.random() * 30,
      phase: Math.random() * 10,
      size: 3 + Math.random() * 4,
    };
  }

  /** Rain, snow, sand, sun rays or wind, across the whole field. */
  private drawWeather(renderer: GlRenderer, dt: number, kind: WeatherKind, now: number): void {
    if (kind !== this.weatherKind) {
      this.weatherKind = kind;
      const count = kind === 'rain' ? 160 : kind === 'snow' ? 130 : kind === 'sand' ? 180 : kind === 'wind' ? 14 : 0;
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
        for (let i = 0; i < 6; i++) {
          const sway = Math.sin(t * 0.6 + i * 1.7);
          const x = 80 + i * 170 + sway * 30;
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
      const { left, top } = this.bannerPosition(item.slot, 46);
      const border = item.kind === 'item' ? rgba('#2dd4bf') : item.kind === 'notice' ? rgba('#9ca3af') : rgba('#facc15');
      const nameColor = item.kind === 'item' ? rgba('#99f6e4') : item.kind === 'notice' ? WHITE : rgba('#fde68a');
      this.card(renderer, now - born, left, top, BANNER_WIDTH, 42, PANEL, border, [
        { text: item.name, size: 16, bold: true, color: nameColor, y: 11 },
        { text: this.pokemonAt(item.slot)?.name ?? '', size: 12, color: WHITE, y: 29 },
      ]);
    }
    for (const { item, born } of this.hpLabels) {
      const top = this.hpLabelPosition(item.slot);
      const left = item.crit ? this.centredOver(item.slot, HP_LABEL_WIDTH + CRIT_LABEL_GAP + CRIT_LABEL_WIDTH) : this.centredOver(item.slot, HP_LABEL_WIDTH);
      const rise = Math.min(1, (now - born) / 600) * -10;
      this.card(renderer, now - born, left, top + rise, HP_LABEL_WIDTH, 32, item.change < 0 ? HP_LOST : HP_RESTORED, WHITE, [
        { text: `${item.change > 0 ? '+' : ''}${item.change}%`, size: 18, bold: true, color: WHITE, y: 16 },
      ]);
      if (item.crit) {
        this.card(renderer, now - born, left + HP_LABEL_WIDTH + CRIT_LABEL_GAP, top + rise, CRIT_LABEL_WIDTH, 32, CRIT, WHITE, [
          { text: 'Critical hit!', size: 16, bold: true, color: WHITE, y: 16 },
        ]);
      }
    }
    for (const { item, born } of this.statusLabels) {
      const info = STATUS[item.status];
      const name = info?.name ?? item.status;
      this.card(renderer, now - born, this.centredOver(item.slot, STATUS_LABEL_WIDTH), this.hpLabelPosition(item.slot) + STATUS_LABEL_DROP, STATUS_LABEL_WIDTH, 32, rgba(info?.color ?? '#374151'), WHITE, [
        { text: `${name[0].toUpperCase()}${name.slice(1)}!`, size: 16, bold: true, color: WHITE, y: 16 },
      ]);
    }
    for (const { item, born } of this.statLabels) {
      this.card(renderer, now - born, this.centredOver(item.slot, STATUS_LABEL_WIDTH), this.hpLabelPosition(item.slot) + STATUS_LABEL_DROP, STATUS_LABEL_WIDTH, 32, item.amount > 0 ? STAT_UP : STAT_DOWN, WHITE, [
        { text: `${STAT_NAMES[item.stat] ?? item.stat} ${item.amount > 0 ? '+' : ''}${item.amount}`, size: 16, bold: true, color: WHITE, y: 16 },
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
      this.card(renderer, age, left, top, BANNER_WIDTH, 42, color, WHITE, [
        { text: action.move, size: 16, bold: true, color: WHITE, y: 11 },
        { text: detail, size: 12, color: WHITE, y: 29 },
      ]);
      // A shine sweeping across the banner as it appears.
      if (age < 500) {
        const sweep = left - 40 + (BANNER_WIDTH + 80) * (age / 500);
        renderer.rect(sweep, top + 2, 24, 38, { fill: [1, 1, 1, 0.35 * (1 - age / 500)], radius: 8, softness: 10, angle: 0.3, additive: true });
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
    const cx = 232 + 260;
    const cy = 184 + 66;
    renderer.rect(0, 0, FIELD_W, FIELD_H, { fill: [0, 0, 0, 0.25 * e] });
    renderer.rect(cx - 260 * s, cy - 66 * s, 520 * s, 132 * s, { fill: withAlpha(PANEL, e), stroke: withAlpha(WHITE, e), radius: 8, border: 2 });
    const p1 = this.label(intro.p1, { size: 24, bold: true });
    const vs = this.label('vs', { size: 18, bold: true });
    const p2 = this.label(intro.p2, { size: 24, bold: true });
    if (p1) renderer.image(p1, cx - p1.width / 2 - 200 * (1 - e), cy - 34 - p1.height / 2, 1, withAlpha(WHITE, e));
    if (vs) {
      const pulse = 1 + 0.08 * Math.sin(age / 150);
      renderer.image(vs, cx - (vs.width * pulse) / 2, cy - (vs.height * pulse) / 2, pulse, withAlpha(rgba('#fde68a'), e));
    }
    if (p2) renderer.image(p2, cx - p2.width / 2 + 200 * (1 - e), cy + 34 - p2.height / 2, 1, withAlpha(WHITE, e));
  }

  /**
   * EXPERIMENT: the diagnostics panel, top right: frame rate, stutters, and what the main thread did
   * (Angular renders, textures uploaded, our own drawing), with a graph of the last 150 frames, each
   * bar marked when a render (blue) or an upload (pink) came before it.
   */
  private drawHud(renderer: GlRenderer, now: number): void {
    const text = this.hudText;
    if (!text) return;
    if (now - this.hudUpdated > 500) {
      this.hudUpdated = now;
      const frames = this.diagnostics.frameSummary();
      const render = this.diagnostics.summary('render');
      const uploads = this.diagnostics.summary('text');
      const sprites = this.diagnostics.summary('sprite');
      const arrivals = this.diagnostics.summary('arrival');
      const layout = { normal: 'Normal', canvas: 'Canvas only', full: 'Full screen' }[this.mode()];
      this.hudLines = [
        `${layout} · ${this.fps.value} fps · ${frames.long} stutters (> ${LONG_FRAME_MS} ms) · worst ${Math.round(frames.worst)} ms`,
        `Angular renders: ${render.count}/s · longest ${render.max.toFixed(1)} ms · total ${render.total.toFixed(0)} ms`,
        `Text uploads: ${uploads.count}/s · longest ${uploads.max.toFixed(1)} ms`,
        `Images (shared with the DOM): ${this.bitmaps.queued} to load · ${arrivals.count}/s · upload ${sprites.max.toFixed(1)} ms`,
        `Our frame: avg ${frames.ownAvg.toFixed(1)} ms · max ${frames.ownMax.toFixed(1)} ms · ${this.effects.particleCount} sparks`,
        ...(this.store.watching() ? ['L: layout · R: DOM field'] : []),
      ];
    }
    const width = 360;
    const x = this.size().w - width - 8;
    const y = 6;
    const graphTop = y + 6 + this.hudLines.length * 17;
    renderer.rect(x, y, width, graphTop - y + 80, { fill: [0, 0, 0, 0.6], radius: 8 });
    this.hudLines.forEach((line, i) => {
      const texture = text.get(line, { size: 12, bold: i === 0 });
      if (texture) renderer.image(texture, x + 8, y + 6 + i * 17, Math.min(1, (width - 16) / texture.width), i === 0 ? rgba('#a7f3d0') : WHITE);
    });
    // The graph: 2px a frame, 1px a ms up to 60; lines at 16.7 and 33.3 ms.
    const base = graphTop + 64;
    renderer.rect(x + 8, base - 16.7, 300, 1, { fill: [1, 1, 1, 0.3] });
    renderer.rect(x + 8, base - 33.3, 300, 1, { fill: [1, 0.4, 0.4, 0.4] });
    this.diagnostics.frames.forEach((frame, i) => {
      const h = Math.min(60, frame.interval);
      const color = frame.interval <= 20 ? GRAPH_COLORS.good : frame.interval <= LONG_FRAME_MS ? GRAPH_COLORS.slow : GRAPH_COLORS.long;
      renderer.rect(x + 8 + i * 2, base - h, 2, h, { fill: color });
      if (frame.render) renderer.rect(x + 8 + i * 2, base + 2, 2, 3, { fill: GRAPH_COLORS.render });
      if (frame.upload) renderer.rect(x + 8 + i * 2, base + 5, 2, 3, { fill: GRAPH_COLORS.upload });
      if (frame.arrival) renderer.rect(x + 8 + i * 2, base + 8, 2, 3, { fill: GRAPH_COLORS.arrival });
    });
  }

  // ---------------------------------------------------------------- positions (as the DOM field's)

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
    return { left, top: (own ? top - 34 : Math.max(4, top - 18)) + drop };
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
