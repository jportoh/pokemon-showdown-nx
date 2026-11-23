import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AudioEngine } from '@core/audio/audio-engine';
import { BattleMusic } from '@core/audio/battle-music';
import { AssetPreload } from '@core/gl/asset-preload';
import { GlRenderer, Rgba, Texture, withAlpha } from '@core/gl/gl-renderer';
import { UPLOADS_PER_FRAME } from '@core/gl/gl-sprites';
import { GlDiagnostics } from '@core/gl/gl-diagnostics';
import { GlStage, STAGE_H, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { TEXT_PAD, TextStyle, TextTextures, pixelTexture } from '@core/gl/gl-textures';
import { ImagePriority, SpriteBitmaps } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { categoryIcon } from '@core/gl/ui/category-icons';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { BALL } from '@features/home/gl/logo-ball';
import { HOME_LOGO } from '@features/home/gl/logo-layout';
import { PreloadAsset, preloadList } from '@features/loading/data/preload-list';

/** Textures made per frame while loading (the menu's screens make 2: nothing else is drawn here). */
const LOADING_UPLOADS = 8;
/** Textures drawn with for the first time per frame (each may be a sheet the GPU takes in then). */
const PRIMES_PER_FRAME = 2;
/** Time per frame for synthesizing the sounds and the menu theme (AudioEngine.prepare). */
const AUDIO_BUDGET_MS = 12;
/** The longest the title waits for the battle music (offline, or a slow connection): the rest loads when a battle needs it. */
const MUSIC_WAIT_MS = 20000;
const WHITE: Rgba = [1, 1, 1, 1];
const STUDIO_INK: Rgba = [0.07, 0.07, 0.09, 1];

/** The studio's card, the first thing a launch shows, as a game shows its studio: its logo (bundled, a
 * small PNG asked for before anything else) and name, on white. */
const STUDIO = 'WANDA PRODUCTIONS';
const STUDIO_LINE = 'presents';
const STUDIO_LOGO = 'studio/wanda.png';
const STUDIO_LOGO_W = 320;
const STUDIO_LOGO_H = 285;
/** The glasses' blue, for the line under the name. */
const STUDIO_BLUE: Rgba = [0.11, 0.3, 0.85, 1];
/** The card waits this long at most for its logo (it starts as soon as the logo is in). */
const LOGO_WAIT_MS = 1200;
/** The card: fading in, held, fading out; then the title. A or START skips it. */
const INTRO_MS = 2600;
const INTRO_FADE_MS = 500;
/** The title's arrival: a white flash, the Poké Ball dropping in with a bounce, the logo fading up. */
const FLASH_MS = 600;
const DROP_MS = 900;
/** START pressed: a quick flash, then the logo flies to where the next screen draws it. */
const PRESS_FLASH_MS = 250;
const OUTRO_MS = 700;

/** The logo on the title, big; START sends it to the next screen's (see logo-layout). */
const BIG = { ballX: (STAGE_W - 120) / 2, ballY: 96, ballScale: 5, textCy: 290, gap: 16, style: { size: 64, bold: true } };
const PROMPT_CY = 420;
const PROMPT_STYLE: TextStyle = { size: 26, bold: true };
/** The edition: a red sticker, tilted, under SHOWDOWN!'s end; it pops in after the logo. */
const EDITION = 'NINTENDO SWITCH EDITION';
const EDITION_STYLE: TextStyle = { size: 17, bold: true };
const EDITION_RED: Rgba = [0.9, 0, 0.07, 1];
const EDITION_CY = 350;
const PROMPT = 'PRESS START';
const LEGAL = 'A fan project, not affiliated with Nintendo, Creatures or GAME FREAK. Pokémon © Nintendo / Creatures / GAME FREAK.';

/** The Pokémon walking along the bottom of the title, from the bundled sheets (each shows once its sheet is in). */
const PARADE = [
  'pikachu', 'charizard', 'gengar', 'garchomp', 'lucario', 'sylveon', 'dragonite', 'greninja',
  'snorlax', 'gardevoir', 'tyranitar', 'mimikyu', 'umbreon', 'metagross', 'arcanine', 'incineroar',
];
const PARADE_GROUND = 676;
const PARADE_STEP = 220;
const PARADE_SPEED = 80;
/** Drawn twice their size (192 px), whole pixels so they stay crisp. */
const PARADE_SCALE = 2;

/**
 * The first screen of a launch, as a Pokémon game opens: the studio's card (Wanda Productions), then the title (a flash,
 * the Poké Ball dropping in, POKÉMON SHOWDOWN!, Pokémon walking past) waiting for START (+ on the
 * native build) or A. Behind it every image the app shows loads (preloadList: the item sheet, the move
 * categories and the bundled sheets of Champions sprites), downloading, decoding and becoming a
 * texture, so no screen waits for one later; a stutter costs nothing here, so decoding runs back to
 * back (SpriteBitmaps.rush) and more textures are made per frame. Meanwhile the interface's sounds and
 * the menu theme are synthesized, a slice each frame (AudioEngine.prepare), and the battle music
 * (bundled) decodes (BattleMusic.preload, up to MUSIC_WAIT_MS). Until all of that is done a small ball
 * spins in a corner; then the menu theme starts and PRESS START breathes in its capsule. Pressed, the
 * logo flies to its corner, where the entry screen and the menu both draw it, and that screen takes over.
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
  private readonly audio = inject(AudioEngine);
  private readonly music = inject(BattleMusic);
  private readonly diagnostics = inject(GlDiagnostics);
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly connection = inject(ShowdownConnection);
  private readonly navigation = inject(KeyboardNavigation);
  /** Where the logo lands: the entry screen's and the menu's corner. */
  private readonly target = HOME_LOGO;
  /** The teambuilder's code is set up (see warmTeambuilder). */
  private teambuilderWarm = false;
  private teambuilderWarming = false;
  /** The on-screen keyboard's texts are made (see CanvasKeyboard.warm). */
  private keyboardWarm = false;

  private readonly assets: readonly PreloadAsset[] = preloadList();
  /** Not a texture yet (nor failed). */
  private waiting: PreloadAsset[] = [...this.assets];
  /** Made into textures, not drawn with yet. */
  private readonly priming: PreloadAsset[] = [];
  /** The first frame's time: the card starts there, and MUSIC_WAIT_MS counts from it. */
  private startedAt = 0;
  /** When the card began (its logo in, or LOGO_WAIT_MS gone); 0 before. */
  private cardAt = 0;
  /** When the title arrives (after the card, or when it's skipped). */
  private titleAt = 0;
  /** Everything is loaded: START works. */
  private ready = false;
  /** The last frame's time: presses are timed on the frames' clock. */
  private lastNow = 0;
  /** When START was pressed (the logo's flight to the header begins). */
  private outroAt = 0;
  /** When the loading began and when its images were done (performance.now), for the diagnostics. */
  private readonly launchedAt = performance.now();
  private imagesAt = 0;
  private leaving = false;
  private ball: Texture | null = null;

  constructor() {
    if (this.preload.finished()) {
      void this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    // The teambuilder's code waits for the connection to open (or for the rest to load).
    if (this.connection.state().status === 'connected') this.warmTeambuilder();
    else this.connection.opened.pipe(takeUntilDestroyed()).subscribe(() => this.warmTeambuilder());
    this.bitmaps.rush = true;
    // All at once from the start: waiting for the images first was no faster (test-m2/m3).
    this.music.preload();
    // The studio's logo first: the card waits for it.
    this.bitmaps.request(STUDIO_LOGO, ImagePriority.Screen);
    for (const asset of this.assets) this.bitmaps.request(asset.url, ImagePriority.Screen);
    // A tap anywhere (the console's touch screen, a mouse) presses it too.
    const hide = this.stage.show({ draw: (frame) => this.draw(frame), input: (action) => action === 'accept' && this.press(), click: () => this.press() });
    const releasePlus = this.navigation.registerButton('buttonPlus', () => this.press());
    this.stage.whenReady(({ renderer, images }) => {
      this.ball = pixelTexture(renderer, BALL);
      images.uploadsPerFrame = LOADING_UPLOADS;
      // The move categories' icons are painted pixel by pixel: here, not on the teambuilder's first frames.
      for (const category of ['Physical', 'Special', 'Status']) categoryIcon(renderer, category);
    });
    inject(DestroyRef).onDestroy(() => {
      hide();
      releasePlus();
      this.restore();
      this.stage.whenReady(({ renderer }) => this.ball && renderer.deleteTexture(this.ball));
    });
  }

  /** START or A: on the card, skips to the title; on the title, once loaded, goes on to the menu. */
  private press(): boolean {
    const now = this.lastNow;
    if (!this.startedAt || this.outroAt) return false;
    if (now < this.titleAt) {
      this.titleAt = now;
      return true;
    }
    if (!this.ready || now - this.titleAt < DROP_MS) return false;
    this.outroAt = now;
    return true;
  }

  /**
   * Sets up the teambuilder's code (and @smogon/calc's data tables) while this screen shows, not on
   * its first visit, where it stalled the first frame (test-w2). It holds the main thread a while
   * (~0.7 s on the console), and nx.js runs the connection's TLS handshake there: so it waits for the
   * connection to open, or for everything else to load, whichever comes first (test x12).
   */
  private warmTeambuilder(): void {
    if (this.teambuilderWarming) return;
    this.teambuilderWarming = true;
    const done = () => (this.teambuilderWarm = true);
    void import('@features/teambuilder/components/teambuilder-scene/teambuilder-scene').then(done, done);
  }

  /** Back to the menu's pace. */
  private restore(): void {
    this.bitmaps.rush = false;
    this.stage.whenReady(({ images }) => (images.uploadsPerFrame = UPLOADS_PER_FRAME));
  }

  private draw(frame: StageFrame): void {
    const { renderer, now } = frame;
    this.lastNow = now;
    if (!this.startedAt) {
      this.startedAt = now;
      this.titleAt = Infinity;
    }
    this.loadStep(frame);
    if (!this.cardAt && (frame.images.image(STUDIO_LOGO, ImagePriority.Screen) || now - this.startedAt > LOGO_WAIT_MS)) {
      this.cardAt = now;
      this.titleAt = Math.min(this.titleAt, now + INTRO_MS);
    }

    if (now < this.titleAt) {
      renderer.beginPlain(WHITE);
      this.prime(frame);
      this.drawCard(frame);
      this.warmKeyboard(frame);
      renderer.end();
      return;
    }

    const p = this.theme.palette();
    const age = now - this.titleAt;
    const t = this.outroAt ? Math.min(1, (now - this.outroAt) / OUTRO_MS) : 0;
    const fly = easeInOut(t);
    const fade = 1 - Math.min(1, t / 0.4);

    renderer.begin(now / 1000, p.bg, p.rim);
    this.prime(frame);
    if (fade > 0) this.drawParade(frame, Math.min(1, age / 1200) * fade);
    this.drawBall(frame, age, fly);
    this.drawWordmark(frame, fly, Math.min(1, age / 500));
    if (fade > 0) this.drawEdition(frame, age, fade);

    if (fade > 0) {
      if (this.ready && age >= DROP_MS) {
        this.drawPrompt(frame, Math.min(1, (age - DROP_MS) / 400) * fade);
      } else if (!this.ready) {
        this.drawSpinner(frame, Math.min(1, age / 400));
      }
      say(renderer, frame.text, LEGAL, STAGE_W / 2, STAGE_H - 16, { size: 14 }, withAlpha(p.muted, fade));
    }

    // The flashes: white over everything as the title arrives and as START is pressed.
    const flash = Math.max(1 - age / FLASH_MS, this.outroAt ? 0.7 * (1 - (now - this.outroAt) / PRESS_FLASH_MS) : 0);
    if (flash > 0) renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: [1, 1, 1, flash] });
    this.warmKeyboard(frame);
    renderer.end();

    if (t >= 1 && !this.leaving) {
      this.leaving = true;
      void this.router.navigateByUrl('/', { replaceUrl: true });
    }
  }

  /** One frame of loading: textures, sounds, music, the teambuilder's code; `ready` once all are in. */
  private loadStep(frame: StageFrame): void {
    if (this.waiting.length > 0) this.load(frame);
    const soundsReady = this.audio.prepare(AUDIO_BUDGET_MS);
    const tracks = this.music.trackCount;
    const tracksDone = frame.now - this.startedAt > MUSIC_WAIT_MS ? tracks : this.music.preloaded();
    const pending = this.waiting.length + this.priming.length;
    if (pending === 0 && !this.imagesAt) this.imagesAt = performance.now();
    const loaded = pending === 0 && soundsReady && tracksDone === tracks;
    if (loaded) this.warmTeambuilder();
    if (!this.ready && loaded && this.teambuilderWarm) {
      this.ready = true;
      this.restore();
      this.preload.finished.set(true);
      this.audio.playMenuTheme();
      this.diagnostics.loading = this.timings();
    }
  }

  /**
   * The studio's card on white: its logo, the name with a blue line beneath and "presents", all
   * fading in together and out to white, where the title's flash takes over. Nothing moves: the
   * loading runs flat out meanwhile, and a stutter shows far less in a fade than in motion.
   */
  private drawCard({ renderer, text, images, now }: StageFrame): void {
    if (!this.cardAt) return;
    const age = now - this.cardAt;
    const out = this.titleAt - now;
    const alpha = Math.min(1, age / INTRO_FADE_MS, out / INTRO_FADE_MS);
    if (alpha <= 0) return;
    const logo = images.image(STUDIO_LOGO, ImagePriority.Screen);
    if (logo) renderer.rect((STAGE_W - STUDIO_LOGO_W) / 2, 120, STUDIO_LOGO_W, STUDIO_LOGO_H, { fill: withAlpha(WHITE, alpha), texture: logo });
    const cy = 468;
    say(renderer, text, STUDIO, STAGE_W / 2, cy, { size: 40, bold: true }, withAlpha(STUDIO_INK, alpha));
    renderer.rect(STAGE_W / 2 - 210, cy + 32, 420, 3, { fill: withAlpha(STUDIO_BLUE, alpha) });
    say(renderer, text, STUDIO_LINE, STAGE_W / 2, cy + 64, { size: 22 }, withAlpha(STUDIO_INK, alpha * 0.6));
  }

  /** NINTENDO SWITCH EDITION on a red sticker, tilted, under SHOWDOWN!'s end: it pops in after the logo. */
  private drawEdition({ renderer, text }: StageFrame, age: number, fade: number): void {
    const label = text.get(EDITION, EDITION_STYLE);
    if (!label) return;
    const pop = Math.min(1, Math.max(0, (age - DROP_MS) / 350));
    if (pop <= 0) return;
    const scale = backOut(pop);
    const logoW = text.measure('POKÉMON', BIG.style) + BIG.gap + text.measure('SHOWDOWN!', BIG.style);
    const right = (STAGE_W + logoW) / 2;
    const w = (label.width - TEXT_PAD * 2 + 36) * scale;
    const h = 36 * scale;
    const cx = right - 150;
    const angle = -0.06;
    const alpha = Math.min(1, pop * 2) * fade;
    renderer.rect(cx - w / 2 + 3, EDITION_CY - h / 2 + 4, w, h, { fill: [0, 0, 0, 0.18 * alpha], radius: h / 2, angle });
    renderer.rect(cx - w / 2, EDITION_CY - h / 2, w, h, { fill: withAlpha(EDITION_RED, alpha), stroke: withAlpha(WHITE, alpha), border: 3, radius: h / 2, angle });
    const tw = label.width * scale;
    const th = label.height * scale;
    renderer.rect(cx - tw / 2, EDITION_CY - th / 2, tw, th, { fill: withAlpha(WHITE, alpha), texture: label, angle });
  }

  /** The Poké Ball: dropping in with a bounce, then bobbing and rocking; it settles as it flies. */
  private drawBall({ renderer, now }: StageFrame, age: number, fly: number): void {
    if (!this.ball) return;
    const time = now / 1000;
    const settle = 1 - fly;
    const drop = Math.min(1, age / DROP_MS);
    const fall = (1 - bounceOut(drop)) * -(BIG.ballY + 140);
    const spin = (1 - drop) * Math.PI * 4;
    const scale = lerp(BIG.ballScale, this.target.ballScale, fly);
    const size = this.ball.width * scale;
    const x = lerp(BIG.ballX, this.target.ballX, fly);
    const bob = drop >= 1 ? Math.sin(time * 3) * 6 * settle : 0;
    const y = lerp(BIG.ballY + fall, this.target.ballY, fly) + bob;
    renderer.rect(x, y, size, size, { fill: WHITE, texture: this.ball, angle: spin + Math.sin(time * 2.4) * 0.12 * settle });
  }

  /** The Pokémon walking right to left along the bottom, each hopping a little, a shadow under it. */
  private drawParade({ renderer, images, disc, now }: StageFrame, alpha: number): void {
    if (alpha <= 0) return;
    const time = now / 1000;
    const loop = PARADE.length * PARADE_STEP;
    PARADE.forEach((species, i) => {
      const x = STAGE_W + 40 - ((time * PARADE_SPEED + i * PARADE_STEP) % loop);
      if (x < -200 || x > STAGE_W + 20) return;
      const sprite = images.sprite(species, false, ImagePriority.Screen);
      if (!sprite) return;
      const hop = Math.abs(Math.sin(time * 5 + i * 1.3)) * 12;
      const size = 96 * PARADE_SCALE;
      renderer.rect(x + 36, PARADE_GROUND - 12, size - 72, 22, { fill: [0, 0, 0, 0.22 * alpha], texture: disc });
      renderer.rect(x, PARADE_GROUND - size + 8 - hop, size, size, { fill: [1, 1, 1, alpha], texture: sprite });
    });
  }

  /**
   * PRESS START in a capsule, a Poké Ball at each end: it breathes (its glow and ink) while waiting, and
   * flashes in the accent colour once pressed.
   */
  private drawPrompt({ renderer, text, now }: StageFrame, alpha: number): void {
    if (alpha <= 0) return;
    const p = this.theme.palette();
    const label = text.get(PROMPT, PROMPT_STYLE);
    if (!label) return;
    const textW = label.width - TEXT_PAD * 2;
    const w = textW + 140;
    const h = 60;
    const x = (STAGE_W - w) / 2;
    const y = PROMPT_CY - h / 2;
    const pressed = this.outroAt > 0;
    const breath = pressed ? ((now - this.outroAt) % 120 < 60 ? 1 : 0) : 0.5 + 0.5 * Math.sin((now / 1000) * 3);
    renderer.rect(x - 14, y - 10, w + 28, h + 20, { fill: withAlpha(p.accentText, (0.12 + 0.22 * breath) * alpha), radius: h, softness: 18 });
    renderer.rect(x, y + 5, w, h, { fill: [0, 0, 0, 0.16 * alpha], radius: h / 2, softness: 8 });
    renderer.rect(x, y, w, h, {
      fill: withAlpha(pressed && breath > 0 ? p.accent : p.panel, alpha),
      stroke: withAlpha(p.accentText, alpha),
      border: 3,
      radius: h / 2,
    });
    if (this.ball) {
      const spin = Math.sin((now / 1000) * 2) * 0.25;
      renderer.rect(x + 20, PROMPT_CY - 12, 24, 24, { fill: withAlpha(WHITE, alpha), texture: this.ball, angle: spin });
      renderer.rect(x + w - 44, PROMPT_CY - 12, 24, 24, { fill: withAlpha(WHITE, alpha), texture: this.ball, angle: -spin });
    }
    const ink = pressed && breath > 0 ? WHITE : withAlpha(p.ink, 0.7 + 0.3 * breath);
    renderer.image(label, (STAGE_W - textW) / 2 - TEXT_PAD, PROMPT_CY - label.height / 2, 1, withAlpha(ink, alpha));
  }

  /** While loading: a small spinning Poké Ball and "Loading…" where PRESS START comes. */
  private drawSpinner({ renderer, text, now }: StageFrame, alpha: number): void {
    const p = this.theme.palette();
    if (this.ball) renderer.rect(STAGE_W / 2 - 84, PROMPT_CY - 16, 32, 32, { fill: withAlpha(WHITE, alpha), texture: this.ball, angle: (now / 1000) * 6 });
    say(renderer, text, 'Loading…', STAGE_W / 2 - 40, PROMPT_CY, { size: 22 }, withAlpha(p.muted, alpha), 'left');
  }

  /**
   * The on-screen keyboard's texts, made while there's time (CanvasKeyboard.warm): after this
   * screen's own, so they never hold the card's back.
   */
  private warmKeyboard(frame: StageFrame): void {
    if (!this.keyboardWarm) this.keyboardWarm = this.keyboard.warm(frame.text);
  }

  /**
   * POKÉMON SHOWDOWN!, each word gliding from its place here to its place in the header. In flight
   * the big text is drawn smaller; landed, it's the header's own size, as the home screen draws it.
   */
  private drawWordmark({ renderer, text }: StageFrame, fly: number, alpha: number): void {
    const landed = fly >= 1;
    const { logo, logoInk } = this.theme.palette();
    const style: TextStyle = landed ? this.target.style : BIG.style;
    const first = text.get('POKÉMON', style);
    const second = text.get('SHOWDOWN!', style);
    const bigFirst = text.get('POKÉMON', BIG.style);
    const smallFirst = text.get('POKÉMON', this.target.style);
    if (!first || !second || !bigFirst || !smallFirst) return;
    const width = (texture: Texture) => texture.width - TEXT_PAD * 2;
    const bigSecond = text.measure('SHOWDOWN!', BIG.style);
    const bigLeft = (STAGE_W - (width(bigFirst) + BIG.gap + bigSecond)) / 2;
    const from = [bigLeft, bigLeft + width(bigFirst) + BIG.gap];
    const to = [this.target.textX, this.target.textX + width(smallFirst) + this.target.gap];
    const scale = landed ? 1 : lerp(1, (this.target.style.size ?? BIG.style.size) / BIG.style.size, fly);
    const cy = lerp(BIG.textCy, this.target.textCy, fly);
    [first, second].forEach((texture, i) => {
      const x = lerp(from[i], to[i], fly);
      renderer.image(texture, x - TEXT_PAD * scale, cy - (texture.height * scale) / 2, scale, withAlpha(i === 0 ? logoInk : logo, alpha));
    });
  }

  /** How long the loading took: the images, and each battle track's download and decode (seconds from the start). */
  private timings(): string[] {
    const at = (time: number) => (time ? ((time - this.launchedAt) / 1000).toFixed(1) : '–');
    const times = this.music.preloadTimes;
    return [
      `Loading ${at(performance.now())} s (${this.music.preloadMode}) · images ${at(this.imagesAt)} s`,
      `Music read ${times.map((t) => at(t.downloaded)).join(' / ')} · decoded ${times.map((t) => at(t.decoded)).join(' / ')} s`,
    ];
  }

  /** Makes the textures this frame has room for. */
  private load({ images }: StageFrame): void {
    this.waiting = this.waiting.filter((asset) => {
      if (!images.canUpload || !images.warm(asset.url, asset.smooth)) return true;
      this.priming.push(asset);
      return false;
    });
  }

  /** Draws the textures made a frame or more ago, a few a frame (see GlSprites.prime). */
  private prime({ images }: StageFrame): void {
    this.priming.splice(0, PRIMES_PER_FRAME).forEach((asset) => images.prime(asset.url));
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A ball dropped on the floor: falls, then two smaller bounces. */
function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/**
 * A text of this screen, made at once (not within the frame's budget for new text, as drawText makes
 * them): they're few, and the card's would otherwise wait behind the on-screen keyboard's (test x19).
 */
function say(renderer: GlRenderer, text: TextTextures, value: string, x: number, cy: number, style: TextStyle, color: Rgba, align: 'left' | 'center' = 'center'): void {
  const texture = text.get(value, style);
  if (!texture) return;
  const width = texture.width - TEXT_PAD * 2;
  const left = align === 'center' ? x - width / 2 : x;
  renderer.image(texture, left - TEXT_PAD, cy - texture.height / 2, 1, color);
}

/** Overshoots a little, then settles: a sticker slapped on. */
function backOut(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}
