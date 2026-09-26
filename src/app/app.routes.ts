import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { MainLayout } from '@core/layout/main-layout/main-layout';

export const routes: Routes = [
  {
    // The layout (header and tabs) stays mounted; navigation only swaps the child page.
    path: '',
    component: MainLayout,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('@features/lobby/components/lobby-screen/lobby-screen').then((c) => c.LobbyScreen),
      },
      {
        path: 'teambuilder',
        loadComponent: () =>
          import('@features/teambuilder/components/teambuilder-page/teambuilder-page').then(
            (c) => c.TeambuilderPage,
          ),
      },
      {
        path: 'replays',
        loadComponent: () =>
          import('@features/replays/components/replay-list/replay-list').then((c) => c.ReplayList),
      },
      {
        path: 'battle',
        // Only while there's a battle to show (a reload, or a battle closed, lands on home).
        canActivate: [() => inject(BattleSession).canOpen() || inject(Router).parseUrl('/')],
        loadComponent: () =>
          import('@features/battle/components/battle-screen/battle-screen').then(
            (c) => c.BattleScreen,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
