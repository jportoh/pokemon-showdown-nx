import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { GlStageHost } from '@core/gl/gl-stage-host';
import { AppSettings } from '@core/settings/app-settings';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleRooms } from '@features/connection/battle-rooms';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownFormats } from '@features/connection/showdown-formats';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { OnScreenKeyboardPanel } from '@shared/components/on-screen-keyboard/on-screen-keyboard-panel';

@Component({
  imports: [GlStageHost, OnScreenKeyboardPanel, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('pokemon-showdown-brewser');

  constructor() {
    const router = inject(Router);
    const session = inject(BattleSession);
    // The theme, before anything is shown.
    inject(AppSettings);
    // Nothing connects until the player asks (on the home screen), or asked in Settings to log in
    // when the app starts. From then on other players can challenge us whichever page is open: the
    // name and the challenges are tracked app-wide.
    inject(ShowdownChallenges);
    inject(ShowdownLogin).logInSaved();
    // The server lists its formats once, on connecting: their names, for ladder ratings.
    inject(ShowdownFormats);
    // An accepted challenge opens its battle, unless one is already open.
    inject(BattleRooms).started.subscribe((roomId) => {
      if (session.active()) return;
      session.requestLive(roomId);
      void router.navigateByUrl('/battle');
    });
  }
}
