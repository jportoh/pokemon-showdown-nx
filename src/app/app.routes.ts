import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { HomeMenu } from '@features/home/state/home-menu';
import { MainLayout, PageInfo } from '@core/layout/main-layout/main-layout';

export const routes: Routes = [
  {
    // The home menu takes the whole stage: its own trainer bar, no page frame.
    path: '',
    pathMatch: 'full',
    // EXPERIMENT (feat/webgl-probe): the WebGL menu while it's the one chosen (R switches).
    canActivate: [() => !inject(HomeMenu).glHome() || inject(Router).parseUrl('/gl')],
    loadComponent: () => import('@features/home/components/home-screen/home-screen').then((c) => c.HomeScreen),
  },
  {
    // EXPERIMENT (feat/webgl-probe): the home menu drawn with WebGL.
    path: 'gl',
    loadComponent: () =>
      import('@features/gl-home/components/gl-home-screen/gl-home-screen').then((c) => c.GlHomeScreen),
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
        path: 'settings',
        data: { page: { title: 'Settings', icon: 'settings' } satisfies PageInfo },
        loadComponent: () =>
          import('@features/settings/components/settings-page/settings-page').then((c) => c.SettingsPage),
      },
      {
        // Opened from Settings, so B goes back there.
        path: 'replays',
        data: { page: { title: 'Replays', icon: 'replays', back: '/settings' } satisfies PageInfo },
        loadComponent: () =>
          import('@features/replays/components/replay-list/replay-list').then((c) => c.ReplayList),
      },
      {
        path: 'live',
        data: { page: { title: 'Watch Live', icon: 'live' } satisfies PageInfo },
        loadComponent: () => import('@features/live/components/live-page/live-page').then((c) => c.LivePage),
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
