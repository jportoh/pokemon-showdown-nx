import { computed, inject, signal } from '@angular/core';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { PageOverlay } from '@core/gl/ui/format-list-screen';
import { UiContext } from '@core/gl/ui/retro-kit';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { LoginView } from './login-view';

/**
 * The menu's login box on another page (Chats, Watch Live): offline, ZR opens it over the page (and
 * starts connecting), B closes it (backing out of a connection that has no name yet), and it closes
 * itself once the server calls us by a name; the focus goes back where it was.
 * Must be made in an injection context.
 */
export class LoginOverlay implements PageOverlay {
  private readonly login = inject(ShowdownLogin);
  private readonly view: LoginView;
  private readonly openSignal = signal(false);
  private returnFocus: string | null = null;

  /** Nothing asked for yet, or a login that lost its name while the box is closed. */
  readonly offline = computed(() => {
    const status = this.login.state().status;
    return status === 'offline' || (status === 'ready' && !this.openSignal());
  });

  constructor(private readonly focus: CanvasFocus) {
    this.view = new LoginView(focus);
  }

  /** ZR: offline, opens the box; false otherwise (the page's own ZR then). */
  pressZR(): boolean {
    if (this.openSignal()) return true;
    if (!this.offline()) return false;
    this.returnFocus = this.focus.focused;
    this.login.startLogin();
    this.view.reset();
    this.openSignal.set(true);
    this.focus.focus(this.view.firstId);
    return true;
  }

  isOpen(): boolean {
    return this.openSignal();
  }

  /** B: closes the box while it's open. */
  back(): boolean {
    if (!this.openSignal()) return false;
    this.close();
    return true;
  }

  /** Last, over the page: only the box's controls take the d-pad. */
  draw(ctx: UiContext): void {
    if (!this.openSignal()) return;
    if (this.view.finished()) {
      this.close();
      return;
    }
    ctx.focus.trap();
    ctx.renderer.rect(0, 0, 1280, 720, { fill: [0, 0, 0, 0.45] });
    this.view.draw(ctx);
  }

  private close(): void {
    this.openSignal.set(false);
    this.login.cancelLogin();
    this.focus.focus(this.returnFocus);
  }
}
