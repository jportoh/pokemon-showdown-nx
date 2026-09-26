import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleRooms } from '@features/connection/battle-rooms';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ShowdownLogin } from '@features/connection/showdown-login';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('pokemon-showdown-brewser');

  constructor() {
    const router = inject(Router);
    const session = inject(BattleSession);
    // Other players can challenge us from the start, whichever page is open: connect and take a name,
    // and keep track of challenges.
    inject(ShowdownChallenges);
    inject(ShowdownLogin).start();
    // An accepted challenge opens its battle, unless one is already open.
    inject(BattleRooms).started.subscribe((roomId) => {
      if (session.active()) return;
      session.requestLive(roomId);
      void router.navigateByUrl('/battle');
    });
  }
}
