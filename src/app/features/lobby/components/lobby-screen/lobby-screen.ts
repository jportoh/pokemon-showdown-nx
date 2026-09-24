import { Component } from '@angular/core';
import { BattleFinder } from '@features/lobby/components/battle-finder/battle-finder';
import { LobbyChat } from '@features/lobby/components/lobby-chat/lobby-chat';

@Component({
  imports: [BattleFinder, LobbyChat],
  selector: 'app-lobby-screen',
  host: { class: 'flex h-[644px] w-[1280px] flex-row' },
  templateUrl: './lobby-screen.html',
})
export class LobbyScreen {}
