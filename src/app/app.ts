import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { GlStageHost } from '@core/gl/gl-stage-host';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleRooms } from '@features/connection/battle-rooms';
import { ReplayAutoSave } from '@features/connection/replay-auto-save';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownFormats } from '@features/connection/showdown-formats';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { UpdatePrompt } from '@core/update/update-prompt';

@Component({
  imports: [GlStageHost, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('pokemon-showdown-nx');

  constructor() {
    const router = inject(Router);
    const session = inject(BattleSession);
    // Nothing connects until the player asks (on the home screen), or asked in Settings to log in
    // when the app starts. From then on other players can challenge us whichever page is open: the
    // name and the challenges are tracked app-wide.
    inject(ShowdownChallenges);
    inject(ShowdownLogin).logInSaved();
    // The server lists its formats once, on connecting: their names, for ladder ratings.
    inject(ShowdownFormats);
    // Our battles' replays are saved as they end, for the battle history.
    inject(ReplayAutoSave);
    // On the console, newer code is looked for once per start; the player is told when it's ready (docs/updates.md).
    inject(UpdatePrompt);
    // An accepted challenge opens its battle, unless one is already open.
    inject(BattleRooms).started.subscribe((roomId) => {
      if (session.active()) return;
      session.requestLive(roomId);
      void router.navigateByUrl('/battle');
    });
  }
}
