import { Service, inject, signal } from '@angular/core';
import { AudioEngine } from '@core/audio/audio-engine';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { GlDiagnostics } from './gl-diagnostics';
import { GlRenderer, Texture } from './gl-renderer';
import { GlSprites } from './gl-sprites';
import { TEXT_BUDGET_MS, TextPages, TextTextures, discTexture } from './gl-textures';
import { GlyphAtlas } from './glyph-atlas';
import { PerfHud } from './perf-hud';
import type { PointerInput } from './pointer-input';
import { SpriteBitmaps } from './sprite-bitmaps';

export const STAGE_W = 1280;
export const STAGE_H = 720;
/** The diagnostics' few lines of text (new ones every half second): two small pages, one cleared while the other shows. */
const OVERLAY_PAGES: TextPages = { height: 256, count: 2 };

/** What the stage's canvas draws with: the same for every scene, for as long as the app runs. */
export interface StageResources {
  renderer: GlRenderer;
  /** Text as textures, shared by every scene (an LRU cache). */
  text: TextTextures;
  /** Text for overlays that change every half second (diagnostics), kept apart from the scenes' cache. */
  overlayText: TextTextures;
  /** Sprites and other images as textures, decoded once (SpriteBitmaps) and uploaded once. */
  images: GlSprites;
  /** A soft white disc: ellipses, shadows. */
  disc: Texture;
}

/** One frame of a scene. */
export interface StageFrame extends StageResources {
  /** requestAnimationFrame's time (ms). */
  now: number;
  /** Seconds since the last frame, at most 0.1. */
  dt: number;
}

/**
 * A screen drawn on the stage: the newest one shown draws every frame (it starts the frame itself,
 * `renderer.begin` or `beginPlain`, and ends it) and gets the controller's d-pad, A and B and the
 * mouse.
 */
export interface GlScene {
  draw(frame: StageFrame): void;
  input?(action: CanvasAction): boolean;
  /** A tap or a click; true when it pressed a control (it then sounds like A). */
  click?(x: number, y: number): boolean | void;
  hover?(x: number, y: number): void;
  /** The scene's own lines in the diagnostics (L3 + R3), worked out every half second. */
  diagnostics?(): string[];
}

/**
 * The app's one canvas (1280x720, GlStageHost at the root, there from start to end): one WebGL
 * renderer, one text cache, one image cache, one frame loop for every screen. A screen shows itself
 * as a scene (`show`); its resources (`whenReady`) outlive it, so the next screen finds the
 * textures already made (a battle's sprites in the next one, the menu's text when coming back).
 * While no scene is shown (between routes), the canvas hides and the loop stops.
 */
@Service()
export class GlStage {
  private readonly navigation = inject(KeyboardNavigation);
  private readonly diagnostics = inject(GlDiagnostics);
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly audio = inject(AudioEngine);
  private readonly renderScheduler = inject(RenderScheduler);

  /** A scene is shown: the host shows the canvas. */
  readonly active = signal(false);
  /** Why WebGL couldn't start, for the host to say. */
  readonly failure = signal<string | null>(null);

  private resources: StageResources | null = null;
  private readonly waiting: ((resources: StageResources) => void)[] = [];
  private readonly scenes: GlScene[] = [];
  /** Drawn over the top scene and given the controller first (the on-screen keyboard). */
  private overlay: GlScene | null = null;
  private frame = 0;
  private last = 0;
  private releaseInput: (() => void) | null = null;
  /** The touchscreen and the mouse (set by the host): its last raw events show in the diagnostics. */
  pointer: PointerInput | null = null;
  /** L3 + R3, on any screen: the frame-time diagnostics, with the shown scene's own lines and the last touches. */
  private readonly hud = new PerfHud(() => [...(this.top()?.diagnostics?.() ?? []), ...(this.pointer?.log ?? [])]);

  constructor() {
    // The stage lasts as long as the app: the chord is never let go. Both sticks pressed together, so a
    // player doesn't open it by accident (L3 alone did).
    this.navigation.registerChord(['buttonL3', 'buttonR3'], () => this.hud.toggle());
  }

  /**
   * How many canvas pixels a stage pixel takes (text is drawn this much denser): the host sets it
   * from the screen's size and device pixel ratio (1.5 at 1920x1080).
   */
  private scale = 1;

  /** The canvas changed size (the host's `layout`): text is redrawn `scale` times denser. */
  setScale(scale: number): void {
    this.scale = scale;
    const resources = this.resources;
    if (!resources) return;
    resources.text.setScale(scale);
    resources.text.glyphs?.setScale(scale);
    resources.overlayText.setScale(scale);
  }

  /** Called once by the host with its canvas. */
  attach(canvas: HTMLCanvasElement): void {
    let renderer: GlRenderer;
    try {
      renderer = new GlRenderer(canvas, STAGE_W, STAGE_H);
    } catch (error) {
      this.failure.set(String(error));
      return;
    }
    const family = getComputedStyle(document.body).fontFamily || 'Roboto, sans-serif';
    const text = new TextTextures(renderer, this.scale, family);
    text.glyphs = new GlyphAtlas(renderer, this.scale, family);
    text.budgetMs = TEXT_BUDGET_MS;
    text.glyphs.onMake = (ms) => text.spend(ms);
    const images = new GlSprites(renderer, this.bitmaps);
    text.onUpload = (ms) => this.diagnostics.record('text', ms);
    images.onUpload = (ms) => this.diagnostics.record('sprite', ms);
    this.bitmaps.onArrival = () => this.diagnostics.record('arrival', 0);
    this.resources = { renderer, text, overlayText: new TextTextures(renderer, this.scale, family, OVERLAY_PAGES), images, disc: discTexture(renderer) };
    this.waiting.splice(0).forEach((ready) => ready(this.resources!));
    if (this.scenes.length > 0) this.start();
  }

  /** Runs `ready` with the stage's resources, now or once the canvas is there. */
  whenReady(ready: (resources: StageResources) => void): void {
    if (this.resources) ready(this.resources);
    else this.waiting.push(ready);
  }

  /** Shows a scene over the others; returns the function that takes it away (on the screen's destroy). */
  show(scene: GlScene): () => void {
    this.scenes.push(scene);
    this.active.set(true);
    this.releaseInput ??= this.navigation.captureInput((action) => {
      const scene = this.overlay ?? this.top();
      return scene?.input?.(action) ?? false;
    });
    this.start();
    return () => {
      const index = this.scenes.indexOf(scene);
      if (index >= 0) this.scenes.splice(index, 1);
      if (this.scenes.length > 0) return;
      this.active.set(false);
      this.releaseInput?.();
      this.releaseInput = null;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    };
  }

  /** Shows a view over whatever scene is shown (the on-screen keyboard), or takes it away (null). */
  setOverlay(overlay: GlScene | null): void {
    this.overlay = overlay;
  }

  /** An overlay is shown (another one waits for it to go). */
  get hasOverlay(): boolean {
    return this.overlay !== null;
  }

  /** A tap or a click: the overlay's, else the top scene's. */
  click(x: number, y: number): void {
    // The controller's presses sound in KeyboardNavigation; a tap that presses a control sounds the same.
    if ((this.overlay ?? this.top())?.click?.(x, y)) {
      this.audio.play('accept');
      this.renderScheduler.request();
    }
  }

  hover(x: number, y: number): void {
    (this.overlay ?? this.top())?.hover?.(x, y);
  }

  private top(): GlScene | undefined {
    return this.scenes[this.scenes.length - 1];
  }

  private start(): void {
    if (this.frame || !this.resources || this.scenes.length === 0) return;
    this.diagnostics.clearFrames();
    this.last = performance.now();
    const resources = this.resources;
    // One frame object for the whole loop: nothing new to collect every frame.
    const frame: StageFrame = { ...resources, now: 0, dt: 0 };
    const loop = (now: number) => {
      const scene = this.top();
      if (!scene) {
        this.frame = 0;
        return;
      }
      this.frame = requestAnimationFrame(loop);
      const started = performance.now();
      const interval = now - this.last;
      this.last = now;
      resources.images.startFrame(now);
      resources.text.startFrame(now);
      resources.overlayText.startFrame(now);
      frame.now = now;
      frame.dt = Math.min(0.1, interval / 1000);
      scene.draw(frame);
      // The overlay draws over the finished scene (end() only flushes, nothing is cleared) and ends its own drawing.
      this.overlay?.draw(frame);
      if (this.hud.shown) {
        this.hud.draw(frame, STAGE_W);
        // Where the last tap landed, to check the touchscreen's coordinates.
        const tap = this.pointer?.lastTap;
        if (tap) resources.renderer.rect(tap.x - 6, tap.y - 6, 12, 12, { fill: [1, 0.2, 0.4, 0.9], radius: 6 });
        resources.renderer.end();
      }
      this.diagnostics.frame(interval, performance.now() - started);
    };
    this.frame = requestAnimationFrame(loop);
  }
}
