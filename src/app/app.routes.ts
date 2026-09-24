import { Routes } from '@angular/router';
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
    ],
  },
  { path: '**', redirectTo: '' },
];
