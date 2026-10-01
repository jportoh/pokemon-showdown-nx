import { Service, inject, signal } from '@angular/core';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { GlDiagnostics } from './gl-diagnostics';
import { GlRenderer, Texture } from './gl-renderer';
import { GlSprites } from './gl-sprites';
import { TextTextures, discTexture } from './gl-textures';
import { SpriteBitmaps } from './sprite-bitmaps';

export const STAGE_W = 1280;
export const STAGE_H = 720;

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
  click?(x: number, y: number): void;
  hover?(x: number, y: number): void;
}

/**
 * The app's one canvas (1280x720, GlStageHost at the root, there from start to end): one WebGL
 * renderer, one text cache, one image cache, one frame loop for every screen. A screen shows itself
 * as a scene (`show`); its resources (`whenReady`) outlive it, so the next screen finds the
 * textures already made (a battle's sprites in the next one, the menu's text when coming back).
 * While no scene is shown (a page still in the DOM), the canvas hides and the loop stops.
 */
@Service()
export class GlStage {
  private readonly navigation = inject(KeyboardNavigation);
  private readonly diagnostics = inject(GlDiagnostics);
  private readonly bitmaps = inject(SpriteBitmaps);

  /** A scene is shown: the host shows the canvas. */
  readonly active = signal(false);
  /** Why WebGL couldn't start, for the host to say. */
  readonly failure = signal<string | null>(null);

  private resources: StageResources | null = null;
  private readonly waiting: ((resources: StageResources) => void)[] = [];
  private readonly scenes: GlScene[] = [];
  private frame = 0;
  private last = 0;
  private releaseInput: (() => void) | null = null;

  /** The canvas's device pixel ratio (text is drawn this much denser). */
  readonly scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

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
    const images = new GlSprites(renderer, this.bitmaps);
    text.onUpload = (ms) => this.diagnostics.record('text', ms);
    images.onUpload = (ms) => this.diagnostics.record('sprite', ms);
    this.bitmaps.onArrival = () => this.diagnostics.record('arrival', 0);
    this.resources = { renderer, text, overlayText: new TextTextures(renderer, this.scale, family), images, disc: discTexture(renderer) };
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
    // A scene without input of its own (the menu, still on DOM buttons) leaves the d-pad to the DOM.
    this.releaseInput ??= this.navigation.captureInput((action) => {
      const scene = this.top();
      return scene?.input ? scene.input(action) : null;
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

  /** The mouse (browsers): the top scene's. */
  click(x: number, y: number): void {
    this.top()?.click?.(x, y);
  }

  hover(x: number, y: number): void {
    this.top()?.hover?.(x, y);
  }

  private top(): GlScene | undefined {
    return this.scenes[this.scenes.length - 1];
  }

  private start(): void {
    if (this.frame || !this.resources || this.scenes.length === 0) return;
    this.diagnostics.clearFrames();
    this.last = performance.now();
    const resources = this.resources;
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
      resources.images.startFrame();
      scene.draw({ ...resources, now, dt: Math.min(0.1, interval / 1000) });
      this.diagnostics.frame(interval, performance.now() - started);
    };
    this.frame = requestAnimationFrame(loop);
  }
}
