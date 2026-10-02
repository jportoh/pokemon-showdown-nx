import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AssetPreload } from '@core/gl/asset-preload';
import { Rgba, Texture, rgba, withAlpha } from '@core/gl/gl-renderer';
import { UPLOADS_PER_FRAME } from '@core/gl/gl-sprites';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { TEXT_PAD, TextStyle, pixelTexture } from '@core/gl/gl-textures';
import { ImagePriority, SpriteBitmaps } from '@core/gl/sprite-bitmaps';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { BALL } from '@features/home/gl/logo-ball';
import { PreloadAsset, preloadList } from '@features/loading/data/preload-list';

/** Textures made per frame while loading (the menu's screens make 2: nothing else is drawn here). */
const LOADING_UPLOADS = 8;
const LOGO_YELLOW = rgba('#f2c14e');
const WHITE: Rgba = [1, 1, 1, 1];
const BAR = { x: 320, y: 392, w: 640, h: 28 };
/** The logo here, big, and where the home screen's header draws it (HomeScene.drawHeader). */
const BIG = { ballX: (STAGE_W - 120) / 2, ballY: 116, ballScale: 5, textCy: 310, gap: 16, style: { size: 64, bold: true } };
const HEADER = { ballX: 24, ballY: 14, ballScale: 2, textX: 84, textCy: 38, gap: 10, style: { size: 32, bold: true }, height: 76 };
/** The logo's flight into the header, once everything is loaded. */
const OUTRO_MS = 700;

/**
 * The first screen of a launch: the logo, a bar and "Loading assets…" while every image the app
 * shows (preloadList: the item sheet, the move categories and the bundled sheets of Champions sprites)
 * downloads, decodes and becomes a texture, so no screen waits for one later (3.7 s on the console,
 * test p4). A stutter costs nothing here, so decoding runs back to back (SpriteBitmaps.rush) and more
 * textures are made per frame. Once done, the logo shrinks and flies to its place in the home
 * screen's header, the header's bar fading in behind it, and the menu takes over from there.
 */
@Component({
  selector: 'app-loading-scene',
  template: '',
})
export class LoadingScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly preload = inject(AssetPreload);

  private readonly assets: readonly PreloadAsset[] = preloadList();
  /** Not a texture yet (nor failed). */
  private waiting: PreloadAsset[] = [...this.assets];
  /** The bar's fill, easing towards the share loaded (it moves in a few big steps). */
  private shown = 0;
  /** When the logo began its flight to the header. */
  private outroAt = 0;
  private leaving = false;
  private ball: Texture | null = null;

  constructor() {
    if (this.preload.finished()) {
      void this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    this.bitmaps.rush = true;
    for (const asset of this.assets) this.bitmaps.request(asset.url, ImagePriority.Screen);
    // The controller does nothing here: the menu comes by itself.
    const hide = this.stage.show({ draw: (frame) => this.draw(frame), input: () => true });
    this.stage.whenReady(({ renderer, images }) => {
      this.ball = pixelTexture(renderer, BALL);
      images.uploadsPerFrame = LOADING_UPLOADS;
    });
    inject(DestroyRef).onDestroy(() => {
      hide();
      this.restore();
      this.stage.whenReady(({ renderer }) => this.ball && renderer.deleteTexture(this.ball));
    });
  }

  /** Back to the menu's pace. */
  private restore(): void {
    this.bitmaps.rush = false;
    this.stage.whenReady(({ images }) => (images.uploadsPerFrame = UPLOADS_PER_FRAME));
  }

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const { renderer, now, dt } = frame;
    if (this.waiting.length > 0) this.load(frame);
    const loaded = (this.assets.length - this.waiting.length) / Math.max(1, this.assets.length);
    this.shown += (loaded - this.shown) * (1 - Math.exp(-dt * 10));
    if (!this.outroAt && this.waiting.length === 0 && this.shown > 0.98) {
      this.outroAt = now;
      this.restore();
      this.preload.finished.set(true);
    }
    const t = this.outroAt ? Math.min(1, (now - this.outroAt) / OUTRO_MS) : 0;
    const fly = easeInOut(t);
    const fade = 1 - Math.min(1, t / 0.4);

    renderer.begin(now / 1000, p.bg, p.rim);
    if (fly > 0) renderer.rect(0, 0, STAGE_W, HEADER.height, { fill: withAlpha(p.bar, fly) });

    // The ball bobs and rocks while loading, and settles as it flies.
    const time = now / 1000;
    const settle = 1 - fly;
    if (this.ball) {
      const scale = lerp(BIG.ballScale, HEADER.ballScale, fly);
      const size = this.ball.width * scale;
      const x = lerp(BIG.ballX, HEADER.ballX, fly);
      const y = lerp(BIG.ballY, HEADER.ballY, fly) + Math.sin(time * 3) * 6 * settle;
      renderer.rect(x, y, size, size, { fill: WHITE, texture: this.ball, angle: Math.sin(time * 2.4) * 0.12 * settle });
    }
    this.drawWordmark(frame, fly);

    if (fade > 0) {
      renderer.rect(BAR.x, BAR.y, BAR.w, BAR.h, { fill: withAlpha(p.input, fade), stroke: withAlpha(p.outline, fade), radius: 8, border: 3 });
      const filled = Math.round((BAR.w - 12) * Math.min(1, this.shown));
      if (filled > 0) renderer.rect(BAR.x + 6, BAR.y + 6, filled, BAR.h - 12, { fill: withAlpha(p.accentText, fade), radius: 4 });
      const label = frame.text.get('Loading assets…', { size: 24 });
      if (label) renderer.image(label, BAR.x - TEXT_PAD, BAR.y + 60 - label.height / 2, 1, withAlpha(p.ink, fade));
    }
    renderer.end();

    if (t >= 1 && !this.leaving) {
      this.leaving = true;
      void this.router.navigateByUrl('/', { replaceUrl: true });
    }
  }

  /**
   * POKÉMON SHOWDOWN!, each word gliding from its place here to its place in the header. In flight
   * the big text is drawn smaller; landed, it's the header's own size, as the home screen draws it.
   */
  private drawWordmark({ renderer, text }: StageFrame, fly: number): void {
    const landed = fly >= 1;
    const style: TextStyle = landed ? HEADER.style : BIG.style;
    const first = text.get('POKÉMON', style);
    const second = text.get('SHOWDOWN!', style);
    const bigFirst = text.get('POKÉMON', BIG.style);
    const smallFirst = text.get('POKÉMON', HEADER.style);
    if (!first || !second || !bigFirst || !smallFirst) return;
    const width = (texture: Texture) => texture.width - TEXT_PAD * 2;
    const bigSecond = text.measure('SHOWDOWN!', BIG.style);
    const bigLeft = (STAGE_W - (width(bigFirst) + BIG.gap + bigSecond)) / 2;
    const from = [bigLeft, bigLeft + width(bigFirst) + BIG.gap];
    const to = [HEADER.textX, HEADER.textX + width(smallFirst) + HEADER.gap];
    const scale = landed ? 1 : lerp(1, HEADER.style.size / BIG.style.size, fly);
    const cy = lerp(BIG.textCy, HEADER.textCy, fly);
    [first, second].forEach((texture, i) => {
      const x = lerp(from[i], to[i], fly);
      renderer.image(texture, x - TEXT_PAD * scale, cy - (texture.height * scale) / 2, scale, i === 0 ? WHITE : LOGO_YELLOW);
    });
  }

  /** Makes the textures this frame has room for. */
  private load({ images }: StageFrame): void {
    this.waiting = this.waiting.filter((asset) => !images.canUpload || !images.warm(asset.url, asset.smooth));
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
