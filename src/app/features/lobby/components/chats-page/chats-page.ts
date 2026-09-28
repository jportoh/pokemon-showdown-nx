import { Component } from '@angular/core';
import { LobbyChat } from '@features/lobby/components/lobby-chat/lobby-chat';

/** The Chats page: for now the lobby's 427x644 chat panel as it was, centred on the mint backdrop. */
@Component({
  imports: [LobbyChat],
  selector: 'app-chats-page',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px]' },
  template: `<app-lobby-chat class="absolute top-0 left-[426px] h-[644px] w-[427px]" />`,
})
export class ChatsPage {}
