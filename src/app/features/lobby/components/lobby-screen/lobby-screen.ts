import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { BattleFinder } from '@features/lobby/components/battle-finder/battle-finder';
import { LobbyChat } from '@features/lobby/components/lobby-chat/lobby-chat';

@Component({
  imports: [BattleFinder, LobbyChat],
  selector: 'app-lobby-screen',
  host: { class: 'flex h-[644px] w-[1280px] flex-row' },
  templateUrl: './lobby-screen.html',
})
export class LobbyScreen {
  private readonly router = inject(Router);
  private readonly battle = inject(BattleSession);

  /**
   * Battles run against the mock server for now, with the first team. One battle at a time: with one
   * open, this goes back to it.
   */
  protected startBattle(): void {
    if (!this.battle.active()) this.battle.requestStart();
    void this.router.navigateByUrl('/battle');
  }
}
