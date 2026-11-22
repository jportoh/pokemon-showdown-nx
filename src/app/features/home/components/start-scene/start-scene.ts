import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { Texture } from '@core/gl/gl-renderer';
import { GlStage, StageFrame } from '@core/gl/gl-stage';
import { TEXT_PAD, pixelTexture } from '@core/gl/gl-textures';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { UiContext, label } from '@core/gl/ui/retro-kit';
import { CanvasAction } from '@core/input/keyboard-navigation';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { BALL } from '@features/home/gl/logo-ball';
import { LoginView } from '@features/home/gl/login-view';
import { HOME_LOGO, LogoPlace, entryLogo } from '@features/home/gl/logo-layout';
import { HomeMenu } from '@features/home/state/home-menu';

/** The box rises in under the logo, which arrives from the title already in place. */
const INTRO_MS = 420;
/** Leaving for the menu: the box drops away and the logo glides to the menu's corner. */
const OUTRO_MS = 380;

/**
 * The entry screen, between the title and the menu: the menu is the player's (their trainer, their
 * ratings), so it needs to know who they are first. Connect as a guest, log in with a name, or play
 * offline (the Teambuilder and Settings work without a connection); the menu opens once the server
 * calls us by a name. Logging out of the menu comes back here. B does nothing: there's no menu yet.
 */
@Component({
  selector: 'app-start-scene',
  template: '',
})
export class StartScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly login = inject(ShowdownLogin);
  private readonly menu = inject(HomeMenu);

  private readonly focus = new CanvasFocus();
  private readonly view = new LoginView(this.focus, () => this.playOffline());
  private ball: Texture | null = null;
  /** When the glide to the menu began; 0 before. */
  private leavingAt = 0;
  private readonly start = performance.now();
  private leaving = false;

  constructor() {
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
    this.stage.whenReady(({ renderer }) => (this.ball = pixelTexture(renderer, BALL)));
    // The connection starts now, so the server's challenge is here by the time a name is typed.
    if (this.login.state().status !== 'named') this.login.startLogin();
    this.view.reset();
    this.focus.focus(this.view.firstId);
    inject(DestroyRef).onDestroy(() => {
      hide();
      this.stage.whenReady(({ renderer }) => this.ball && renderer.deleteTexture(this.ball));
    });
  }

  private onAction(action: CanvasAction): boolean {
    if (this.leavingAt || action === 'back') return true;
    return focusInput(this.focus, action) ?? false;
  }

  private playOffline(): void {
    this.login.cancelLogin();
    this.menu.offlineChosen.set(true);
    this.enter();
  }

  private enter(): void {
    if (!this.leavingAt) this.leavingAt = performance.now();
  }

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer } = frame;
    if (this.view.finished() || this.login.state().status === 'named') {
      this.menu.offlineChosen.set(false);
      this.enter();
    }
    renderer.begin(frame.now / 1000, p.bg, p.rim);
    this.focus.begin();
    const time = performance.now();
    const out = this.leavingAt ? Math.min(1, (time - this.leavingAt) / OUTRO_MS) : 0;
    // The box rising in on arrival, dropping away on leaving.
    const rise = 1 - Math.pow(1 - Math.min(1, (time - this.start) / INTRO_MS), 3);
    const drop = this.leavingAt ? out * out : 0;
    const offset = (1 - rise) * 640 + drop * 640;
    if (offset < 640) {
      renderer.setView(1, 0, offset);
      this.view.draw(ctx);
      renderer.setView(1, 0, 0);
    }
    if (this.leavingAt) this.focus.trap();
    // The logo, centred over the box where the title's lands; leaving, it glides to the menu's.
    const entry = entryLogo((value, style) => ctx.text.measure(value, style));
    this.drawLogo(ctx, entry, ease(out));
    if (out >= 1 && !this.leaving) {
      this.leaving = true;
      void this.router.navigateByUrl('/', { replaceUrl: true });
    }
    this.focus.end();
    renderer.end();
  }

  /** The logo between the entry screen's place and the menu's (`t` 0 to 1), its words scaled between their sizes. */
  private drawLogo(ctx: UiContext, from: LogoPlace, t: number): void {
    const p = ctx.palette;
    const to = HOME_LOGO;
    const lerp = (a: number, b: number) => a + (b - a) * t;
    if (this.ball) ctx.renderer.image(this.ball, lerp(from.ballX, to.ballX), lerp(from.ballY, to.ballY), lerp(from.ballScale, to.ballScale));
    if (t <= 0 || t >= 1) {
      const logo = t >= 1 ? to : from;
      const first = label(ctx, 'POKÉMON', logo.textX, logo.textCy, logo.style, p.logoInk);
      label(ctx, 'SHOWDOWN!', logo.textX + first + logo.gap, logo.textCy, logo.style, p.logo);
      return;
    }
    const first = ctx.text.get('POKÉMON', from.style);
    const second = ctx.text.get('SHOWDOWN!', from.style);
    if (!first || !second) return;
    const scale = lerp(1, (to.style.size ?? 1) / (from.style.size ?? 1));
    const toFirst = ctx.text.measure('POKÉMON', to.style);
    const x = [lerp(from.textX, to.textX), 0];
    x[1] = lerp(from.textX + (first.width - TEXT_PAD * 2) + from.gap, to.textX + toFirst + to.gap);
    const cy = lerp(from.textCy, to.textCy);
    [first, second].forEach((texture, i) => {
      ctx.renderer.image(texture, x[i] - TEXT_PAD * scale, cy - (texture.height * scale) / 2, scale, i === 0 ? p.logoInk : p.logo);
    });
  }
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
