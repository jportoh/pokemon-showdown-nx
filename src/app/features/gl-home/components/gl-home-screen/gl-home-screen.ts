import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { ShowdownSearch } from '@features/connection/showdown-search';
import { HOME_MENU_ITEMS, HomeMenu, HomeMenuItem } from '@features/home/state/home-menu';
import { HomeSummary } from '@features/home/state/home-summary';
import { PixelIconName } from '@shared/components/pixel-icon';
import { RANDOM_BATTLE_FORMAT } from '@shared/data/formats';
import { probeCanvasText, probeContext, probeRemoteSprite } from '../../gl/gl-probe';
import { GlRenderer, Rgba, Texture, mixRgba, rgba, withAlpha } from '../../gl/gl-renderer';
import { TextStyle, TextTextures, iconTexture } from '../../gl/gl-textures';

const STAGE_W = 1280;
const STAGE_H = 720;
/** Particle counts L steps through. The DOM draws at most DOM_PARTICLE_CAP (more would freeze it). */
const PARTICLE_LEVELS = [0, 100, 1000, 5000, 15000] as const;
const DOM_PARTICLE_CAP = 1000;
const INTRO_MS = 450;
const LEAVE_MS = 260;

/** A tile's box on the stage, as the DOM menu lays them out. */
interface TileBox {
  item: HomeMenuItem;
  x: number;
  y: number;
  w: number;
  h: number;
  big: boolean;
}

const TILES: readonly TileBox[] = HOME_MENU_ITEMS.map((item, i) =>
  i < 2
    ? { item, x: 48 + i * 600, y: 100, w: 584, h: 244, big: true }
    : { item, x: 48 + (i - 2) * 300, y: 360, w: 284, h: 236, big: false },
);

/** The palette, read from the theme's CSS variables on <body> (Brewser may not report them: defaults). */
interface Palette {
  bg: Rgba;
  bar: Rgba;
  panel: Rgba;
  outline: Rgba;
  rim: Rgba;
  select: Rgba;
  ink: Rgba;
  muted: Rgba;
  accentText: Rgba;
  danger: Rgba;
  teal: Rgba;
}

const DEFAULT_PALETTE: Record<keyof Palette, string> = {
  bg: '#0a1620',
  bar: '#050e16',
  panel: '#102332',
  outline: '#3f88ad',
  rim: '#1b3a50',
  select: '#1a4562',
  ink: '#e3f2fa',
  muted: '#9ec3d5',
  accentText: '#6fd3ff',
  danger: '#ff8a80',
  teal: '#ffc46b',
};

const CSS_NAMES: Record<keyof Palette, string> = {
  bg: '--retro-bg',
  bar: '--retro-bar',
  panel: '--retro-panel',
  outline: '--retro-outline',
  rim: '--retro-rim',
  select: '--retro-select',
  ink: '--retro-ink',
  muted: '--retro-muted',
  accentText: '--retro-accent-text',
  danger: '--retro-danger',
  teal: '--retro-teal',
};

/** The ▶ cursor: 4x7 pixels, as the DOM menu's SVG. */
const CURSOR_ROWS = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];

/** Per tile, the animated values eased towards their targets every frame. */
interface TileAnim {
  focus: number;
  shake: number;
}

/**
 * EXPERIMENT (feat/webgl-probe): the home menu drawn with WebGL on one canvas, to compare its
 * smoothness with the DOM menu on the Brewser console. The look follows the DOM menu; the motion is
 * what the DOM can't do there: the focused tile grows and glows, the ▶ glides between tiles, the
 * backdrop drifts, tiles slide in on arrival and zoom out on leaving, and L adds particles (drawn by
 * WebGL, or by R3 as DOM elements for comparison) with an FPS meter. ZL shows the probe's report.
 *
 * Navigation stays the app's own: six transparent buttons over the tiles take the controller's
 * focus (and A), and carry the labels for assistive tech; the canvas reads which one is focused.
 */
@Component({
  selector: 'app-gl-home-screen',
  host: { class: 'relative block h-[720px] w-[1280px] bg-retro-bg' },
  template: `
    <canvas #canvas aria-hidden="true" class="absolute top-0 left-0 block h-[720px] w-[1280px]" [attr.width]="canvasWidth" [attr.height]="canvasHeight"></canvas>
    <div #domLayer aria-hidden="true" class="absolute top-0 left-0 block"></div>
    <nav aria-label="Main menu" class="block">
      @for (tile of tiles; track tile.item.id) {
        <button
          #tile
          type="button"
          class="absolute block cursor-pointer border-0 bg-transparent p-0"
          [style.left.px]="tile.x"
          [style.top.px]="tile.y"
          [style.width.px]="tile.w"
          [style.height.px]="tile.h"
          [attr.data-gl-item]="tile.item.id"
          [attr.aria-label]="tile.item.label"
          (click)="open(tile.item)"
        ></button>
      }
    </nav>
    @if (failure(); as message) {
      <div role="alert" class="absolute top-[260px] left-[240px] block h-[200px] w-[800px] rounded-2xl border-4 border-retro-danger bg-retro-panel p-6 text-xl leading-8 text-retro-ink">
        <p class="block font-bold">WebGL failed</p>
        <p class="block">{{ message }}</p>
        <p class="block text-retro-muted">R goes back to the normal menu.</p>
      </div>
    }
  `,
})
export class GlHomeScreen {
  private readonly router = inject(Router);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly menu = inject(HomeMenu);
  private readonly render = inject(RenderScheduler);
  private readonly login = inject(ShowdownLogin);
  private readonly search = inject(ShowdownSearch);
  private readonly summary = inject(HomeSummary);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly domLayer = viewChild.required<ElementRef<HTMLDivElement>>('domLayer');
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tile');

  protected readonly tiles = TILES;
  private readonly scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  protected readonly canvasWidth = Math.round(STAGE_W * this.scale);
  protected readonly canvasHeight = Math.round(STAGE_H * this.scale);
  protected readonly failure = signal<string | null>(null);

  private readonly offline = computed(() => {
    const status = this.login.state().status;
    return status === 'offline' || status === 'ready';
  });

  /** Each tile's line under its name, as the DOM menu's. */
  private readonly lines = computed((): Record<PixelIconName, { text: string; color: keyof Palette }> => {
    const offline = this.offline();
    const online = (text: string) => (offline ? { text: 'Needs connection', color: 'muted' as const } : { text, color: 'muted' as const });
    return {
      battle: { text: this.summary.battle(), color: this.summary.challenger() ? 'teal' : 'muted' },
      random: { text: 'Gen 9 · Ladder', color: 'muted' },
      teambuilder: { text: this.summary.teambuilder(), color: 'muted' },
      chats: online(this.summary.chats),
      live: online(this.summary.live()),
      settings: { text: this.summary.settingsLine(), color: 'muted' },
      replays: { text: '', color: 'muted' },
    };
  });

  private readonly randomLine = computed((): { text: string; color: keyof Palette } => {
    const error = this.search.error();
    if (this.search.searching()) return { text: 'Searching for an opponent… A to cancel', color: 'teal' };
    if (error) return { text: error, color: 'danger' };
    if (this.offline()) return { text: 'Log in from the DOM menu (R, then ZR)', color: 'muted' };
    if (this.login.state().status !== 'named') return { text: 'Connecting…', color: 'muted' };
    return { text: 'Find an opponent now', color: 'muted' };
  });

  private readonly status = computed(() => {
    const login = this.login.state();
    if (login.status === 'named') return login.name;
    if (login.status === 'offline') return 'Offline';
    return 'Connecting…';
  });

  // Drawing state, outside Angular: the frame loop never renders the component.
  private renderer: GlRenderer | null = null;
  private text: TextTextures | null = null;
  private palette: Palette = paletteFrom(DEFAULT_PALETTE);
  private icons = new Map<string, Texture>();
  private cursorTexture: Texture | null = null;
  private frame = 0;
  private start = 0;
  private last = 0;
  private readonly anims: TileAnim[] = TILES.map(() => ({ focus: 0, shake: 0 }));
  private cursor = { x: 0, y: 0, ready: false };
  private leaving: { index: number; at: number; then: () => void } | null = null;
  private report = 0;
  private reportOpen = false;
  private reportLines: string[] = [];
  private spriteTextures: Texture[] = [];

  private particleLevel = 2;
  private particlesInDom = false;
  private particles = new Float32Array(0);
  private domParticles: HTMLDivElement[] = [];

  private fps = { frames: 0, since: 0, value: 0, avgMs: 0, worstMs: 0, sumMs: 0, worst: 0 };

  constructor() {
    this.menu.glHome.set(true);
    afterNextRender(() => {
      this.focusItem(this.menu.lastItem());
      this.startGl();
    });
    const unregister = [
      this.navigation.registerButton('buttonR', () => this.toDomMenu()),
      this.navigation.registerButton('buttonL', () => this.nextParticleLevel()),
      this.navigation.registerButton('buttonR3', () => this.toggleDomParticles()),
      this.navigation.registerButton('buttonZL', () => this.toggleReport()),
    ];
    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      cancelAnimationFrame(this.frame);
      this.clearDomParticles();
      this.text?.dispose();
      this.renderer?.dispose();
    });
  }

  protected open(item: HomeMenuItem): void {
    if (this.leaving) return;
    const index = TILES.findIndex((tile) => tile.item.id === item.id);
    this.menu.lastItem.set(item.id);
    if (!item.path) {
      if (this.search.searching()) this.search.cancel();
      else if (this.login.state().status === 'named') this.search.search(RANDOM_BATTLE_FORMAT);
      else this.anims[index].shake = 1;
      return;
    }
    const path = item.path;
    const go = () => {
      this.navigation.focusPageAfterNavigation();
      void this.router.navigateByUrl(path);
    };
    // Without WebGL there's no zoom to wait for.
    if (!this.renderer) go();
    else this.leaving = { index, at: performance.now(), then: go };
  }

  private toDomMenu(): boolean {
    this.menu.glHome.set(false);
    void this.router.navigateByUrl('/');
    return true;
  }

  private nextParticleLevel(): boolean {
    this.particleLevel = (this.particleLevel + 1) % PARTICLE_LEVELS.length;
    this.resetParticles();
    return true;
  }

  private toggleDomParticles(): boolean {
    this.particlesInDom = !this.particlesInDom;
    this.resetParticles();
    return true;
  }

  private toggleReport(): boolean {
    this.reportOpen = !this.reportOpen;
    return true;
  }

  private focusItem(id: PixelIconName): void {
    this.buttons()
      .find((button) => button.nativeElement.getAttribute('data-gl-item') === id)
      ?.nativeElement.focus();
  }

  private startGl(): void {
    const canvas = this.canvasRef().nativeElement;
    try {
      this.renderer = new GlRenderer(canvas, STAGE_W, STAGE_H);
    } catch (error) {
      this.failure.set(String(error));
      this.render.request();
      return;
    }
    const renderer = this.renderer;
    this.palette = readPalette();
    this.text = new TextTextures(renderer, this.scale, getComputedStyle(document.body).fontFamily || 'Roboto, sans-serif');
    for (const tile of TILES) {
      this.icons.set(`${tile.item.id}`, iconTexture(renderer, tile.item.id, false));
      this.icons.set(`${tile.item.id}-muted`, iconTexture(renderer, tile.item.id, true));
    }
    this.cursorTexture = renderer.textureFromPixels(pixelMask(CURSOR_ROWS), 4, 7, false);
    this.reportLines = [...probeContext(renderer), probeCanvasText(), 'Remote sprite: loading…'];
    void probeRemoteSprite(renderer, this.domLayer().nativeElement).then(({ lines, textures }) => {
      this.reportLines = [...this.reportLines.slice(0, -1), `Remote sprite → ${lines.join(' · ')}`];
      this.spriteTextures = textures;
    });
    this.resetParticles();
    this.start = performance.now();
    this.last = this.start;
    this.fps.since = this.start;
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.frame = requestAnimationFrame(loop);
  }

  private resetParticles(): void {
    this.clearDomParticles();
    const count = PARTICLE_LEVELS[this.particleLevel];
    const shown = this.particlesInDom ? Math.min(count, DOM_PARTICLE_CAP) : count;
    // x, y, vx, vy, radius, hue (0..1 between accent and amber).
    this.particles = new Float32Array(shown * 6);
    for (let i = 0; i < shown; i++) {
      const p = i * 6;
      this.particles[p] = Math.random() * STAGE_W;
      this.particles[p + 1] = Math.random() * STAGE_H;
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 60;
      this.particles[p + 2] = Math.cos(angle) * speed;
      this.particles[p + 3] = Math.sin(angle) * speed;
      this.particles[p + 4] = 2 + Math.random() * 4;
      this.particles[p + 5] = Math.random();
    }
    if (this.particlesInDom) {
      const layer = this.domLayer().nativeElement;
      for (let i = 0; i < shown; i++) {
        const dot = document.createElement('div');
        const size = Math.round(this.particles[i * 6 + 4] * 2);
        dot.style.position = 'absolute';
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
        dot.style.background = this.particles[i * 6 + 5] < 0.5 ? '#6fd3ff' : '#ffc46b';
        layer.appendChild(dot);
        this.domParticles.push(dot);
      }
    }
  }

  private clearDomParticles(): void {
    for (const dot of this.domParticles) dot.remove();
    this.domParticles = [];
  }

  /** One frame: ease the animated values, move the particles, draw everything. */
  private tick(now: number): void {
    const renderer = this.renderer!;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.measure(now, now - this.last);
    this.last = now;
    const time = (now - this.start) / 1000;
    const pal = this.palette;
    const focusedId = this.navigation.lastFocusedControl()?.getAttribute('data-gl-item') ?? null;
    const offline = this.offline();

    renderer.begin(time, pal.bg, pal.rim);

    this.drawParticles(renderer, dt, pal);
    this.drawHeader(renderer, pal);

    const ease = 1 - Math.exp(-dt * 14);
    TILES.forEach((tile, i) => {
      const anim = this.anims[i];
      anim.focus += ((tile.item.id === focusedId ? 1 : 0) - anim.focus) * ease;
      anim.shake = Math.max(0, anim.shake - dt * 2.2);
      // Arrival: each tile slides up and fades in, one after another.
      const intro = clamp01((now - this.start - i * 55) / INTRO_MS);
      const arrive = 1 - Math.pow(1 - intro, 3);
      let zoom = 0;
      let fade = arrive;
      if (this.leaving) {
        const t = clamp01((now - this.leaving.at) / LEAVE_MS);
        if (i === this.leaving.index) zoom = t * t;
        else fade *= 1 - t;
      }
      this.drawTile(renderer, tile, anim, (1 - arrive) * 40, fade, zoom, offline && tile.item.needsConnection, time, pal);
    });

    this.drawCursor(renderer, focusedId, ease, time, pal);
    this.drawFooter(renderer, pal);
    this.drawReport(renderer, dt, pal);

    if (this.leaving) {
      const t = clamp01((now - this.leaving.at) / LEAVE_MS);
      renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: withAlpha(pal.bg, t) });
      if (t >= 1) {
        const then = this.leaving.then;
        this.leaving = null;
        then();
      }
    }
    renderer.end();
  }

  private measure(now: number, frameMs: number): void {
    const fps = this.fps;
    fps.frames++;
    fps.sumMs += frameMs;
    fps.worst = Math.max(fps.worst, frameMs);
    if (now - fps.since >= 500) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.since));
      fps.avgMs = fps.sumMs / fps.frames;
      fps.worstMs = fps.worst;
      fps.frames = 0;
      fps.sumMs = 0;
      fps.worst = 0;
      fps.since = now;
    }
  }

  private drawParticles(renderer: GlRenderer, dt: number, pal: Palette): void {
    const p = this.particles;
    const count = p.length / 6;
    const blue = withAlpha(pal.accentText, 0.55);
    const amber = withAlpha(pal.teal, 0.55);
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      let x = p[o] + p[o + 2] * dt;
      let y = p[o + 1] + p[o + 3] * dt;
      if (x < 0) x += STAGE_W;
      else if (x > STAGE_W) x -= STAGE_W;
      if (y < 0) y += STAGE_H;
      else if (y > STAGE_H) y -= STAGE_H;
      p[o] = x;
      p[o + 1] = y;
      if (this.particlesInDom) {
        const style = this.domParticles[i].style;
        style.left = `${Math.round(x)}px`;
        style.top = `${Math.round(y)}px`;
      } else {
        renderer.circle(x, y, p[o + 4], p[o + 5] < 0.5 ? blue : amber);
      }
    }
  }

  private drawHeader(renderer: GlRenderer, pal: Palette): void {
    renderer.rect(0, 0, STAGE_W, 76, { fill: pal.bar });
    const first = this.label('POKÉMON', { size: 32, bold: true });
    const second = this.label('SHOWDOWN!', { size: 32, bold: true });
    if (first) renderer.image(first, 24, 38 - first.height / 2);
    if (second && first) renderer.image(second, 24 + first.width + 8, 38 - second.height / 2, 1, rgba('#f2c14e'));
    const badge = this.label('WebGL', { size: 16, bold: true });
    if (badge && second && first) {
      const x = 24 + first.width + second.width + 24;
      renderer.rect(x, 26, badge.width + 12, 24, { fill: pal.select, radius: 6 });
      renderer.image(badge, x + 6, 38 - badge.height / 2, 1, pal.accentText);
    }
    const status = this.label(this.status(), { size: 20 });
    if (status) renderer.image(status, STAGE_W - 24 - status.width, 38 - status.height / 2, 1, pal.muted);
  }

  private drawTile(renderer: GlRenderer, tile: TileBox, anim: TileAnim, slide: number, fade: number, zoom: number, faded: boolean, time: number, pal: Palette): void {
    if (fade <= 0.001) return;
    const f = anim.focus;
    const grow = 1 + 0.03 * f + zoom * 0.25;
    const shake = Math.sin(anim.shake * 40) * 10 * anim.shake;
    const cx = tile.x + tile.w / 2 + shake;
    const cy = tile.y + tile.h / 2 + slide;
    const w = tile.w * grow;
    const h = tile.h * grow;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const s = grow;
    const alpha = fade * (1 - zoom);

    // Glow behind the focused tile.
    if (f > 0.01) {
      renderer.rect(x - 18, y - 18, w + 36, h + 36, { fill: withAlpha(pal.accentText, 0.35 * f * alpha), radius: 34, softness: 22 });
    }
    renderer.rect(x, y, w, h, {
      fill: withAlpha(mixRgba(pal.panel, pal.select, f), alpha),
      stroke: withAlpha(mixRgba(pal.outline, pal.accentText, f), alpha),
      radius: 16 * s,
      border: 4 * s,
    });

    const plateSize = (tile.big ? 132 : 108) * s;
    const plateX = x + (tile.big ? 44 : 88) * s;
    const plateY = y + (tile.big ? 28 : 22) * s;
    renderer.rect(plateX, plateY, plateSize, plateSize, { fill: withAlpha(rgba(faded ? '#232a31' : tile.item.plate), alpha), radius: 12 * s });
    const icon = this.icons.get(faded ? `${tile.item.id}-muted` : tile.item.id);
    const iconScale = (tile.big ? 5 : 4) * s;
    const bob = Math.sin(time * 5) * 4 * f;
    if (icon) renderer.image(icon, plateX + 6 * s, plateY + 6 * s + bob, iconScale, [1, 1, 1, alpha]);

    const line = this.lines()[tile.item.id];
    const labelColor = withAlpha(faded ? pal.muted : pal.ink, alpha);
    if (tile.big) {
      const label = this.label(tile.item.label, { size: 44, bold: true });
      if (label) renderer.image(label, x + 204 * s, y + 68 * s - (label.height * s) / 2, s, labelColor);
      const sub = this.label(line.text, { size: 20 });
      if (sub) renderer.image(sub, x + 206 * s, y + 118 * s - (sub.height * s) / 2, s, withAlpha(pal[line.color], alpha));
      const third = tile.item.id === 'battle' ? { text: this.summary.team()?.name ?? '', color: 'muted' as const } : this.randomLine();
      const thirdLabel = this.label(third.text, { size: 20 });
      if (thirdLabel) renderer.image(thirdLabel, x + 206 * s, y + 158 * s - (thirdLabel.height * s) / 2, s, withAlpha(pal[third.color], alpha));
      if (tile.item.id === 'battle' && this.summary.challenger()) {
        const badge = this.label('Challenge!', { size: 20, bold: true });
        const pulse = 0.85 + 0.15 * Math.sin(time * 6);
        renderer.rect(x + 418 * s, y + 16 * s, 150 * s, 36 * s, { fill: withAlpha(pal.teal, alpha * pulse), radius: 6 * s });
        if (badge) renderer.image(badge, x + (418 + 75) * s - (badge.width * s) / 2, y + 34 * s - (badge.height * s) / 2, s, withAlpha(pal.bar, alpha));
      }
    } else {
      const label = this.label(tile.item.label, { size: 30, bold: true });
      if (label) renderer.image(label, cx - (label.width * s) / 2, y + 164 * s - (label.height * s) / 2, s, labelColor);
      const sub = this.label(line.text, { size: 20 });
      if (sub) renderer.image(sub, cx - (sub.width * s) / 2, y + 202 * s - (sub.height * s) / 2, s, withAlpha(pal[line.color], alpha));
    }
  }

  /** The ▶ glides to the focused tile and nudges sideways. */
  private drawCursor(renderer: GlRenderer, focusedId: string | null, ease: number, time: number, pal: Palette): void {
    const index = TILES.findIndex((tile) => tile.item.id === focusedId);
    if (index < 0 || !this.cursorTexture || this.leaving) return;
    const tile = TILES[index];
    const targetX = tile.x + 14;
    const targetY = tile.y + (tile.big ? 80 : 62);
    if (!this.cursor.ready) this.cursor = { x: targetX, y: targetY, ready: true };
    const glide = 1 - Math.pow(1 - ease, 1.3);
    this.cursor.x += (targetX - this.cursor.x) * glide;
    this.cursor.y += (targetY - this.cursor.y) * glide;
    const nudge = Math.max(0, Math.sin(time * 7)) * 5;
    renderer.image(this.cursorTexture, this.cursor.x + nudge - 6, this.cursor.y, 4, pal.accentText);
  }

  private drawFooter(renderer: GlRenderer, pal: Palette): void {
    const count = PARTICLE_LEVELS[this.particleLevel];
    const shown = this.particles.length / 6;
    renderer.rect(32, 606, STAGE_W - 64, 92, { fill: withAlpha(pal.bar, 0.9), radius: 12 });
    const where = this.particlesInDom ? `DOM${shown < count ? ` (capped at ${shown})` : ''}` : 'WebGL';
    const legend = this.label(`A Select · R Normal menu · L Particles · R3 Particles in WebGL/DOM · ZL Report`, { size: 18 });
    if (legend) renderer.image(legend, 48, 628 - legend.height / 2, 1, pal.muted);
    const fps = this.fps;
    const color = fps.value >= 55 ? pal.accentText : fps.value >= 30 ? pal.teal : pal.danger;
    const hud = this.label(
      `${fps.value} fps · ${fps.avgMs.toFixed(1)} ms/frame (worst ${fps.worstMs.toFixed(0)}) · ${count} particles in ${where} · ${this.renderer!.drawCalls} draw calls`,
      { size: 22, bold: true },
    );
    if (hud) renderer.image(hud, 48, 668 - hud.height / 2, 1, color);
  }

  /** ZL's panel with the probe's lines and the remote sprites WebGL accepted. */
  private drawReport(renderer: GlRenderer, dt: number, pal: Palette): void {
    this.report += ((this.reportOpen ? 1 : 0) - this.report) * (1 - Math.exp(-dt * 16));
    if (this.report < 0.01) return;
    const t = this.report;
    const w = 1088;
    const h = 420;
    const x = (STAGE_W - w) / 2;
    const y = 150 + (1 - t) * 30;
    renderer.rect(0, 0, STAGE_W, STAGE_H, { fill: withAlpha(pal.bar, 0.6 * t) });
    renderer.rect(x, y, w, h, { fill: withAlpha(pal.panel, t), stroke: withAlpha(pal.outline, t), radius: 16, border: 4 });
    const title = this.label('WebGL probe report', { size: 30, bold: true });
    if (title) renderer.image(title, x + 32, y + 24, 1, withAlpha(pal.ink, t));
    this.reportLines.forEach((line, i) => {
      const texture = this.label(line, { size: 20 });
      if (texture) renderer.image(texture, x + 32, y + 80 + i * 34, 1, withAlpha(pal.muted, t));
    });
    this.spriteTextures.forEach((sprite, i) => renderer.image(sprite, x + 32 + i * 110, y + h - 120, 1, [1, 1, 1, t]));
  }

  private label(text: string, style: TextStyle): Texture | null {
    return this.text?.get(text, style) ?? null;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function paletteFrom(hexes: Record<keyof Palette, string>): Palette {
  const result = {} as Record<keyof Palette, Rgba>;
  for (const key of Object.keys(hexes) as (keyof Palette)[]) result[key] = rgba(hexes[key]);
  return result;
}

/** The theme's colours from <body>'s variables, each falling back to the default theme's. */
function readPalette(): Palette {
  const style = getComputedStyle(document.body);
  const hexes = { ...DEFAULT_PALETTE };
  for (const key of Object.keys(CSS_NAMES) as (keyof Palette)[]) {
    const value = style.getPropertyValue(CSS_NAMES[key]).trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) hexes[key] = value;
  }
  return paletteFrom(hexes);
}

/** White pixels where a row has an x. */
function pixelMask(rows: readonly string[]): Uint8Array {
  const width = rows[0].length;
  const pixels = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) if (row[x] === 'x') pixels.set([255, 255, 255, 255], (y * width + x) * 4);
  });
  return pixels;
}
