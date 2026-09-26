import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { MainLayout } from '@core/layout/main-layout/main-layout';

export const routes: Routes = [
  {
    // A battle takes the whole stage, without the header: once it starts there's no leaving it until
    // it's over (the screen closes it before navigating away, as the replay controls do).
    path: 'battle',
    // Only while there's a battle to show (a reload, or a battle closed, lands on home).
    canActivate: [() => inject(BattleSession).canOpen() || inject(Router).parseUrl('/')],
    canDeactivate: [() => !inject(BattleSession).active()],
    loadComponent: () =>
      import('@features/battle/components/battle-screen/battle-screen').then((c) => c.BattleScreen),
  },
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
    ],
  },
  { path: '**', redirectTo: '' },
];
