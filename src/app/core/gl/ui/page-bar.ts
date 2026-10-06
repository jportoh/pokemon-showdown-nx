import { Service, computed, inject } from '@angular/core';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { PixelIconName } from '@core/gl/ui/pixel-icons';
import { Texture, rgba } from '../gl-renderer';
import { STAGE_W } from '../gl-stage';
import { iconTexture } from '../gl-textures';
import { UiContext, focusRing, label, pill } from './retro-kit';

/** The bar over every page, 76px high. */
export const PAGE_BAR_H = 76;

type StatusKey = 'offline' | 'connecting' | 'reconnecting' | 'noNetwork' | 'unreachable' | 'loggingIn' | 'online' | 'noName';

/** The connection as the bars say it: its words and dot. */
const STATUS: Record<StatusKey, { text: string; dot: string }> = {
  offline: { text: 'Offline', dot: '#9ca3af' },
  connecting: { text: 'Connecting…', dot: '#fcd34d' },
  reconnecting: { text: 'Reconnecting…', dot: '#fcd34d' },
  noNetwork: { text: 'No network', dot: '#f87171' },
  unreachable: { text: "Can't reach Showdown", dot: '#f87171' },
  loggingIn: { text: 'Logging in…', dot: '#fcd34d' },
  online: { text: 'Online', dot: '#34d399' },
  noName: { text: 'Online', dot: '#f87171' },
};

/** What a canvas page shows in its bar. */
export interface PageBarInfo {
  title: string;
  icon: PixelIconName;
  /** B's way back (the bar's Back button does the same). */
  back: () => void;
  /**
   * Where the page is ("Rain Doubles", "Garchomp"), after the title; the last one stands out. Given
   * (even empty), the bar has no Back button: the page's legend says what B does.
   */
  crumbs?: readonly string[];
  /** Drawn on the right instead of the trainer's status, ending at `right`; returns where it starts. */
  trailing?: (ctx: UiContext, right: number, cy: number) => number;
}

/**
 * The bar of the pages drawn on the stage: the page's icon and title,
 * a Back button (for clicks: B is the controller's), a challenge's notice (but on the Battle page,
 * which shows the challenge itself) and the trainer's status. The home menu's bar draws the status too.
 */
@Service()
export class PageBar {
  private readonly login = inject(ShowdownLogin);
  private readonly connection = inject(ShowdownConnection);
  private readonly challenges = inject(ShowdownChallenges);

  /** The menu icons as textures, made once for the app's one renderer. */
  private readonly icons = new Map<PixelIconName, Texture>();

  private readonly statusKey = computed((): StatusKey => {
    const login = this.login.state();
    const status = this.connection.state().status;
    // Connected to log in, without a name yet: still offline as far as the player is concerned.
    if (!login.mode || status === 'offline' || (login.status === 'ready' && !login.loggingIn)) return 'offline';
    const { trouble } = this.connection.state();
    if (status !== 'connected' && trouble) return trouble === 'no-network' ? 'noNetwork' : 'unreachable';
    if (status !== 'connected') return status === 'connecting' ? 'connecting' : 'reconnecting';
    if (login.reclaiming) return 'reconnecting';
    if (login.status === 'named') return 'online';
    if (login.status === 'unavailable') return 'noName';
    if (login.loggingIn) return 'loggingIn';
    return 'connecting';
  });

  /** "ffenrix wants to battle! (+1) Answer in Battle.", while someone challenges us. */
  readonly challengeNotice = computed(() => {
    const incoming = this.challenges.incoming();
    if (incoming.length === 0) return null;
    const more = incoming.length > 1 ? ` (+${incoming.length - 1})` : '';
    return `${incoming[0].from} wants to battle!${more} Answer in Battle.`;
  });

  draw(ctx: UiContext, page: PageBarInfo): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(0, 0, STAGE_W, PAGE_BAR_H, { fill: p.bar });
    let icon = this.icons.get(page.icon);
    if (!icon) {
      icon = iconTexture(renderer, page.icon, false);
      this.icons.set(page.icon, icon);
    }
    // The icons are 24x24 pixel art, drawn at 2x (48px).
    renderer.image(icon, 24, 14, 2);
    const titleW = label(ctx, page.title, 88, 38, { size: 36, bold: true }, p.ink, { maxWidth: 260 });

    // With crumbs the legend at the bottom already says what B does, so there's no Back button.
    const crumbs = page.crumbs ?? null;
    if (!crumbs) {
      const back = { x: 360, y: 20, w: 112, h: 36 };
      const focused = ctx.focus.control({ id: 'bar-back', ...back, accept: page.back, skip: true });
      renderer.rect(back.x, back.y, back.w, back.h, { fill: focused ? p.select : p.button, stroke: p.outline, radius: 6, border: 2 });
      const width = pill(ctx, 'B', back.x + 8, back.y + back.h / 2);
      label(ctx, 'Back', back.x + 8 + width + (back.w - 16 - width) / 2, back.y + back.h / 2, { size: 18, bold: true }, p.ink, { align: 'center' });
      if (focused) focusRing(ctx, back);
    }

    const right = page.trailing ? page.trailing(ctx, 1256, 38) : this.drawStatus(ctx, 1256, 38);
    const notice = page.icon === 'battle' ? null : this.challengeNotice();
    if (notice) {
      const left = crumbs ? 360 : 496;
      renderer.rect(left, 20, 380, 36, { fill: p.accent, radius: 6 });
      label(ctx, notice, left + 12, 38, { size: 16, bold: true }, [1, 1, 1, 1], { maxWidth: 356 });
    } else if (crumbs) {
      this.drawCrumbs(ctx, crumbs, 88 + titleW + 16, right - 24);
    }
  }

  /** The crumbs from `left` (after the title), "▶" before each, cut to end before `right`. */
  private drawCrumbs(ctx: UiContext, crumbs: readonly string[], left: number, right: number): void {
    const p = ctx.palette;
    let x = left;
    crumbs.forEach((crumb, i) => {
      const last = i === crumbs.length - 1;
      x += label(ctx, '▶', x, 38, { size: 14 }, p.outline) + 12;
      const room = right - x;
      if (room < 40) return;
      x += label(ctx, crumb, x, 38, { size: last ? 22 : 20, bold: last }, last ? p.ink : p.muted, { maxWidth: Math.min(room, last ? 300 : 220) }) + 12;
    });
  }

  /** The trainer's line (our name, the dot, the connection), ending at `right`; returns where it starts. */
  drawStatus(ctx: UiContext, right: number, cy: number): number {
    const key = this.statusKey();
    const state = STATUS[key];
    const textWidth = label(ctx, state.text, right, cy, { size: 20 }, ctx.palette.ink, { align: 'right' });
    const dotX = right - textWidth - 18;
    ctx.renderer.rect(dotX, cy - 6, 12, 12, { fill: rgba(state.dot), radius: 6 });
    if (key !== 'online' && key !== 'noName') return dotX;
    const name = key === 'online' ? this.login.state().name : 'No name';
    return dotX - 8 - label(ctx, name, dotX - 8, cy, { size: 20, bold: true }, ctx.palette.ink, { align: 'right', maxWidth: 360 });
  }
}
