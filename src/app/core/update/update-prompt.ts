import { Service, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus, focusInput } from '@core/gl/canvas-ui';
import { GlStage, StageFrame } from '@core/gl/gl-stage';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { UiContext, button, label, modal, paragraph } from '@core/gl/ui/retro-kit';
import { readJson, writeJson } from '@core/persistence/device-storage';
import { AppUpdater, UpdateStatus } from './app-updater';
import { RELEASES_PAGE } from './update-config';

/** Screens where a prompt may open: the entry screen and the home menu (never a battle or an editor). */
const QUIET_ROUTES = new Set(['/', '/start']);
/** How often a waiting prompt looks again whether it can open. */
const RETRY_MS = 1000;
/** The last version whose "needs a new .nro" prompt was shown: once per version. */
const NRO_NOTICE_KEY = 'psb.update.nroNotice.v1';

const BOX = { x: 340, y: 230, w: 600, h: 260 };
const BUTTON_W = 250;

interface Prompt {
  title: string;
  body: string;
  /** A first; B the second (or closes when there is none). */
  actions: { id: string; text: string; key: string; primary?: boolean; run: () => void }[];
}

/**
 * Tells the player what the updater found (docs/updates.md), in a box over the entry screen or the
 * home menu: a downloaded update (A closes the app so it starts with it, B keeps playing: it runs at
 * the next start), or a newer version that needs a new .nro (once per version).
 */
@Service()
export class UpdatePrompt {
  private readonly updater = inject(AppUpdater);
  private readonly stage = inject(GlStage);
  private readonly router = inject(Router);
  private readonly theme = inject(GlTheme);
  private readonly focus = new CanvasFocus();
  private pending: Prompt | null = null;
  private shownFor: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => this.offer(this.updater.status()));
  }

  private offer(status: UpdateStatus): void {
    if (status.kind === 'ready' && this.shownFor !== status.version) {
      this.shownFor = status.version;
      this.queue({
        title: `Update ready: version ${status.version}`,
        body: 'It starts the next time you open the app. Close the app now and open it again to use it straight away.',
        actions: [
          { id: 'update-close', text: 'Close now', key: 'A', primary: true, run: () => closeApp() },
          { id: 'update-later', text: 'Later', key: 'B', run: () => undefined },
        ],
      });
    } else if (status.kind === 'needs-nro' && readJson<string | null>(NRO_NOTICE_KEY, null) !== status.version) {
      writeJson(NRO_NOTICE_KEY, status.version);
      this.queue({
        title: `Version ${status.version} is out`,
        body: `It needs a new .nro: download it from ${RELEASES_PAGE} and copy it to the SD card's switch folder.`,
        actions: [{ id: 'update-ok', text: 'OK', key: 'A', primary: true, run: () => undefined }],
      });
    }
  }

  private queue(prompt: Prompt): void {
    this.pending = prompt;
    this.tryOpen();
  }

  /** Opens the waiting prompt once a quiet screen shows with nothing over it; else looks again soon. */
  private tryOpen(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const prompt = this.pending;
    if (!prompt) return;
    const path = this.router.url.split(/[?#]/)[0];
    if (!QUIET_ROUTES.has(path) || this.stage.hasOverlay) {
      this.timer = setTimeout(() => this.tryOpen(), RETRY_MS);
      return;
    }
    this.pending = null;
    this.focus.focus(prompt.actions[0].id);
    this.stage.setOverlay({
      draw: (frame) => this.draw(frame, prompt),
      input: (action) => {
        if (action === 'back') {
          this.choose(prompt, prompt.actions[1] ?? prompt.actions[0]);
          return true;
        }
        return focusInput(this.focus, action) ?? true;
      },
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
  }

  private choose(prompt: Prompt, action: Prompt['actions'][number]): void {
    this.stage.setOverlay(null);
    action.run();
  }

  private draw(frame: StageFrame, prompt: Prompt): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    this.focus.begin();
    modal(ctx, BOX);
    label(ctx, prompt.title, BOX.x + 32, BOX.y + 48, { size: 26, bold: true }, p.ink, { maxWidth: BOX.w - 64 });
    paragraph(ctx, prompt.body, BOX.x + 32, BOX.y + 80, BOX.w - 64, 28, { size: 19 }, p.muted, 3);
    const count = prompt.actions.length;
    const gap = 20;
    const left = BOX.x + BOX.w - 32 - count * BUTTON_W - (count - 1) * gap;
    prompt.actions.forEach((action, i) => {
      const box = { x: left + i * (BUTTON_W + gap), y: BOX.y + BOX.h - 32 - 56, w: BUTTON_W, h: 56 };
      button(ctx, action.id, box, action.text, { primary: action.primary, shortcut: action.key, accept: () => this.choose(prompt, action) });
    });
    this.focus.end();
    frame.renderer.end();
  }
}

/** Closes the app (the console's Switch.exit): it starts with the update when opened again. */
function closeApp(): void {
  (globalThis as { Switch?: { exit(): void } }).Switch?.exit();
}
