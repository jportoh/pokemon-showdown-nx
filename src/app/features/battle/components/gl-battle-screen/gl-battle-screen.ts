import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, output, signal, viewChild } from '@angular/core';
import { CanvasAction, KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleFieldScene } from '@features/battle/gl/battle-field-scene';
import { GRAPH_COLORS, GlDiagnostics, LONG_FRAME_MS } from '@features/battle/gl/gl-diagnostics';
import { GlSprites } from '@features/battle/gl/gl-sprites';
import { HeaderView } from '@features/battle/gl/screen/header-view';
import { LogView, TeamSheetView, TeamsOverviewView } from '@features/battle/gl/screen/overlay-views';
import { INK, ScreenContext } from '@features/battle/gl/screen/screen-context';
import { SideColumnView } from '@features/battle/gl/screen/side-column-view';
import { PANEL_IDS, WatchPanelView } from '@features/battle/gl/screen/watch-panel-view';
import { SpriteBitmaps } from '@features/battle/gl/sprite-bitmaps';
import { BattleStore } from '@features/battle/state/battle-store';
import { PokemonInspection } from '@features/battle/state/pokemon-inspection';
import { CanvasFocus, isDirection } from '@features/gl-home/gl/canvas-ui';
import { GlRenderer, rgba } from '@features/gl-home/gl/gl-renderer';
import { TextTextures, discTexture } from '@features/gl-home/gl/gl-textures';

const STAGE_W = 1280;
const STAGE_H = 720;
const FIELD = { x: 12, y: 48, w: 985, h: 500 };

/**
 * The battle screen while watching (replays and live battles), all of it on one 1280x720 canvas:
 * the match header, the field (BattleFieldScene), the right column (teams and conditions), the
 * command panel (a replay's controls, or a spectator's with the card of the Pokémon pointed at), and
 * over them the battle log (ZR), the opponent's open team sheet (ZL) and a spectator's team preview.
 * Nothing else is in the DOM: the focus lives in the canvas (CanvasFocus), the controller's d-pad, A
 * and B come straight here (KeyboardNavigation.captureInput), and the mouse clicks what's under it.
 * R3 shows the frame-time diagnostics.
 */
@Component({
  selector: 'app-gl-battle-screen',
  host: { class: 'block h-[720px] w-[1280px]' },
  template: `
    <canvas #canvas aria-hidden="true" class="block h-[720px] w-[1280px]" [attr.width]="width" [attr.height]="height"></canvas>
    @if (failure(); as message) {
      <p role="alert" class="absolute top-[320px] left-[240px] block h-[60px] w-[800px] rounded-md border-2 border-white bg-[#1f2937] text-center text-lg leading-[56px] text-white">WebGL failed: {{ message }}</p>
    }
  `,
})
export class GlBattleScreen {
  readonly again = output<void>();
  readonly leaveReplay = output<void>();
  readonly leaveLive = output<void>();

  private readonly store = inject(BattleStore);
  private readonly inspection = inject(PokemonInspection);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly diagnostics = inject(GlDiagnostics);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private readonly scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  protected readonly width = Math.round(STAGE_W * this.scale);
  protected readonly height = Math.round(STAGE_H * this.scale);
  protected readonly failure = signal<string | null>(null);

  private readonly field = new BattleFieldScene();
  private readonly header = new HeaderView();
  private readonly side = new SideColumnView();
  private readonly panel = new WatchPanelView();
  private readonly log = new LogView();
  private readonly overview = new TeamsOverviewView();
  private readonly sheet = new TeamSheetView();
  private readonly focus = new CanvasFocus();

  private logOpen = false;
  private sheetOpen = false;
  private diagnosticsShown = false;
  private ctx: ScreenContext | null = null;

  /** The opponent's open team sheet can be shown: ZL. */
  private readonly hasSheet = computed(() => !!this.store.teamSheets().p2);

  constructor() {
    const unregister = [
      this.navigation.captureInput((action) => this.onAction(action)),
      this.navigation.registerButton('buttonZR', () => this.toggleLog()),
      this.navigation.registerButton('buttonZL', () => this.toggleSheet()),
      this.navigation.registerButton('buttonR3', () => {
        this.diagnosticsShown = !this.diagnosticsShown;
        return true;
      }),
    ];

    let renderer: GlRenderer | null = null;
    let text: TextTextures | null = null;
    let hudText: TextTextures | null = null;
    let sprites: GlSprites | null = null;
    let frame = 0;
    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      try {
        renderer = new GlRenderer(canvas, STAGE_W, STAGE_H);
      } catch (error) {
        this.failure.set(String(error));
        return;
      }
      const ready = renderer;
      const family = getComputedStyle(document.body).fontFamily || 'Roboto, sans-serif';
      text = new TextTextures(ready, this.scale, family);
      hudText = new TextTextures(ready, this.scale, family);
      sprites = new GlSprites(ready, this.bitmaps);
      text.onUpload = (ms) => this.diagnostics.record('text', ms);
      sprites.onUpload = (ms) => this.diagnostics.record('sprite', ms);
      this.bitmaps.onArrival = () => this.diagnostics.record('arrival', 0);
      this.diagnostics.clearFrames();
      const disc = discTexture(ready);
      this.field.attach(ready, text, sprites, disc);
      this.ctx = { renderer: ready, text, images: sprites, focus: this.focus, disc, now: 0 };

      // Browsers: the mouse points and clicks (the console has only the controller).
      canvas.addEventListener('click', (event) => this.focus.click(event.offsetX, event.offsetY));
      canvas.addEventListener('mousemove', (event) => this.focus.hover(event.offsetX, event.offsetY));

      let last = performance.now();
      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const started = performance.now();
        const interval = now - last;
        last = now;
        this.draw(ready, sprites!, hudText!, now, Math.min(0.1, interval / 1000));
        this.diagnostics.frame(interval, performance.now() - started);
      };
      frame = requestAnimationFrame(loop);
    });

    inject(DestroyRef).onDestroy(() => {
      unregister.forEach((fn) => fn());
      cancelAnimationFrame(frame);
      this.inspection.canvasPointed.set(null);
      sprites?.dispose();
      text?.dispose();
      hudText?.dispose();
      renderer?.dispose();
    });
  }

  private draw(renderer: GlRenderer, sprites: GlSprites, hudText: TextTextures, now: number, dt: number): void {
    const ctx = this.ctx!;
    ctx.now = now;
    sprites.startFrame();
    renderer.beginPlain(INK.header);
    this.focus.begin();

    this.header.draw(ctx, this.logOpen, () => this.toggleLog());
    renderer.setView(1, FIELD.x, FIELD.y);
    renderer.clip(FIELD);
    this.field.draw(renderer, now, dt);
    renderer.clip(null);
    renderer.setView(1, 0, 0);
    this.side.draw(ctx, this.hasSheet() ? { label: 'Sheet', open: this.sheetOpen, press: () => this.toggleSheet() } : null);
    this.panel.draw(ctx, {
      again: () => this.again.emit(),
      leaveReplay: () => this.leaveReplay.emit(),
      leaveLive: () => this.leaveLive.emit(),
    });
    if (this.overview.shown()) this.overview.draw(ctx);
    if (this.sheetOpen) this.sheet.draw(ctx);
    if (this.logOpen) this.log.draw(ctx);
    if (this.diagnosticsShown) this.drawDiagnostics(renderer, hudText, now);

    this.focus.end();
    // The panel's first control to start with: Pause in a replay, the way out of a live battle.
    if (this.focus.focused === null) {
      const first = this.store.replay() ? PANEL_IDS.play : PANEL_IDS.leaveLive;
      if (this.focus.has(first)) this.focus.focus(first);
    }
    const pointed = this.focus.focused ? this.side.inspectKeyOf(this.focus.focused) : null;
    if (this.inspection.canvasPointed() !== pointed) this.inspection.canvasPointed.set(pointed);
    renderer.end();
  }

  /** The controller's d-pad, A and B (everything else comes as page buttons). */
  private onAction(action: CanvasAction): boolean {
    if (this.logOpen) {
      if (action === 'back') this.toggleLog();
      else if (action === 'up' || action === 'down' || action === 'first' || action === 'last') this.log.page(action, this.ctx);
      return true;
    }
    if (this.sheetOpen) {
      if (action === 'back') this.toggleSheet();
      return true;
    }
    if (isDirection(action)) {
      this.focus.move(action);
      return true;
    }
    if (action === 'accept') return this.focus.accept();
    if (action === 'back') {
      if (this.store.replay()) {
        this.leaveReplay.emit();
      } else if (this.focus.focused && this.side.inspectKeyOf(this.focus.focused)) {
        // From the team tiles, back to the way out.
        this.focus.focus(PANEL_IDS.leaveLive);
      } else {
        this.leaveLive.emit();
      }
      return true;
    }
    return false;
  }

  private toggleLog(): boolean {
    this.logOpen = !this.logOpen;
    if (this.logOpen) {
      this.sheetOpen = false;
      this.log.reset();
    }
    return true;
  }

  private toggleSheet(): boolean {
    if (!this.hasSheet()) return false;
    this.sheetOpen = !this.sheetOpen;
    if (this.sheetOpen) this.logOpen = false;
    return true;
  }

  private hudLines: string[] = [];
  private hudUpdated = 0;

  /** R3: frame rate, stutters and what came before them (Angular renders, uploads, images arriving). */
  private drawDiagnostics(renderer: GlRenderer, text: TextTextures, now: number): void {
    if (now - this.hudUpdated > 500) {
      this.hudUpdated = now;
      const frames = this.diagnostics.frameSummary();
      const render = this.diagnostics.summary('render');
      const uploads = this.diagnostics.summary('text');
      const arrivals = this.diagnostics.summary('arrival');
      const fps = frames.worst > 0 ? Math.round(1000 / Math.max(1, this.diagnostics.frames.slice(-60).reduce((s, f) => s + f.interval, 0) / Math.max(1, Math.min(60, this.diagnostics.frames.length)))) : 0;
      this.hudLines = [
        `Full canvas · ${fps} fps · ${frames.long} stutters (> ${LONG_FRAME_MS} ms) · worst ${Math.round(frames.worst)} ms`,
        `Angular renders: ${render.count}/s · longest ${render.max.toFixed(1)} ms`,
        `Text uploads: ${uploads.count}/s · longest ${uploads.max.toFixed(1)} ms`,
        `Images: ${this.bitmaps.queued} to load · ${arrivals.count}/s · our frame ${frames.ownAvg.toFixed(1)} ms (max ${frames.ownMax.toFixed(1)})`,
        `${this.field.particleCount} sparks · R3 hides this`,
      ];
    }
    const width = 380;
    const x = STAGE_W - width - 8;
    const y = 54;
    const graphTop = y + 6 + this.hudLines.length * 17;
    renderer.rect(x, y, width, graphTop - y + 80, { fill: [0, 0, 0, 0.7], radius: 8 });
    this.hudLines.forEach((line, i) => {
      const texture = text.get(line, { size: 12, bold: i === 0 });
      if (texture) renderer.image(texture, x + 8, y + 6 + i * 17, Math.min(1, (width - 16) / texture.width), i === 0 ? rgba('#a7f3d0') : INK.white);
    });
    const base = graphTop + 64;
    renderer.rect(x + 8, base - 16.7, 300, 1, { fill: [1, 1, 1, 0.3] });
    renderer.rect(x + 8, base - 33.3, 300, 1, { fill: [1, 0.4, 0.4, 0.4] });
    this.diagnostics.frames.forEach((f, i) => {
      const h = Math.min(60, f.interval);
      const color = f.interval <= 20 ? GRAPH_COLORS.good : f.interval <= LONG_FRAME_MS ? GRAPH_COLORS.slow : GRAPH_COLORS.long;
      renderer.rect(x + 8 + i * 2, base - h, 2, h, { fill: color });
      if (f.render) renderer.rect(x + 8 + i * 2, base + 2, 2, 3, { fill: GRAPH_COLORS.render });
      if (f.upload) renderer.rect(x + 8 + i * 2, base + 5, 2, 3, { fill: GRAPH_COLORS.upload });
      if (f.arrival) renderer.rect(x + 8 + i * 2, base + 8, 2, 3, { fill: GRAPH_COLORS.arrival });
    });
  }
}
