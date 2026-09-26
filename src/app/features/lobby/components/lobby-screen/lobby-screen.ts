import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { ChallengePanel } from '@features/lobby/components/challenge-panel/challenge-panel';
import { BattleFinder, BattleRequest } from '@features/lobby/components/battle-finder/battle-finder';
import { LobbyChat } from '@features/lobby/components/lobby-chat/lobby-chat';

@Component({
  imports: [BattleFinder, ChallengePanel, LobbyChat],
  selector: 'app-lobby-screen',
  host: { class: 'flex h-[644px] w-[1280px] flex-row' },
  templateUrl: './lobby-screen.html',
})
export class LobbyScreen {
  private readonly router = inject(Router);
  private readonly battle = inject(BattleSession);

  /** Battles run against the mock server for now, in the format picked (VGC with the first team, or Random Battle). */
  protected startBattle(request: BattleRequest): void {
    if (!this.battle.active()) this.battle.requestStart(request.format);
    void this.router.navigateByUrl('/battle');
  }

  /** Showdown's saved battles, played back on the battle screen. */
  protected watchReplays(): void {
    void this.router.navigateByUrl('/replays');
  }
}
