import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { MainLayout, PageInfo } from '@core/layout/main-layout/main-layout';

export const routes: Routes = [
  {
    // The home menu takes the whole stage: its own trainer bar, no page frame.
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('@features/home/components/home-screen/home-screen').then((c) => c.HomeScreen),
  },
  {
    // A battle takes the whole stage, without the frame: once it starts there's no leaving it until
    // it's over (the screen closes it before navigating away, as the replay controls do).
    path: 'battle',
    // Only while there's a battle to show (a reload, or a battle closed, lands on home).
    canActivate: [() => inject(BattleSession).canOpen() || inject(Router).parseUrl('/')],
    canDeactivate: [() => !inject(BattleSession).active()],
    loadComponent: () =>
      import('@features/battle/components/battle-screen/battle-screen').then((c) => c.BattleScreen),
  },
  {
    // The pages the home menu opens, in the frame (title bar, B back to the menu), which stays mounted
    // while they swap.
    path: '',
    component: MainLayout,
    children: [
      {
        path: 'play',
        data: { page: { title: 'Battle', icon: 'battle' } satisfies PageInfo },
        loadComponent: () => import('@features/play/components/play-page/play-page').then((c) => c.PlayPage),
      },
      {
        path: 'teambuilder',
        data: { page: { title: 'Teambuilder', icon: 'teambuilder' } satisfies PageInfo },
        loadComponent: () =>
          import('@features/teambuilder/components/teambuilder-page/teambuilder-page').then(
            (c) => c.TeambuilderPage,
          ),
      },
      {
        path: 'replays',
        data: { page: { title: 'Replays', icon: 'replays' } satisfies PageInfo },
        loadComponent: () =>
          import('@features/replays/components/replay-list/replay-list').then((c) => c.ReplayList),
      },
      {
        path: 'chats',
        data: { page: { title: 'Chats', icon: 'chats' } satisfies PageInfo },
        loadComponent: () => import('@features/lobby/components/chats-page/chats-page').then((c) => c.ChatsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
