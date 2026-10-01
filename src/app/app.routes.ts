import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { MainLayout, PageInfo } from '@core/layout/main-layout/main-layout';

export const routes: Routes = [
  {
    // The home menu, drawn on the stage (its own bar, no page frame).
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('@features/home/components/home-scene/home-scene').then((c) => c.HomeScene),
  },
  {
    // The pages drawn on the stage, each with its own bar (PageBar).
    path: 'settings',
    loadComponent: () =>
      import('@features/settings/components/settings-scene/settings-scene').then((c) => c.SettingsScene),
  },
  {
    path: 'play',
    loadComponent: () => import('@features/play/components/play-scene/play-scene').then((c) => c.PlayScene),
  },
  {
    path: 'chats',
    loadComponent: () => import('@features/lobby/components/chats-scene/chats-scene').then((c) => c.ChatsScene),
  },
  {
    // Opened from Settings, so B goes back there.
    path: 'replays',
    loadComponent: () => import('@features/replays/components/replays-scene/replays-scene').then((c) => c.ReplaysScene),
  },
  {
    path: 'live',
    loadComponent: () => import('@features/live/components/live-scene/live-scene').then((c) => c.LiveScene),
  },
  {
    // A developer's test page: the canvas UI kit on show, opened with R3 from the menu.
    path: 'gl-kit',
    loadComponent: () => import('@features/gl-home/components/gl-kit-screen/gl-kit-screen').then((c) => c.GlKitScreen),
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
        path: 'teambuilder',
        data: { page: { title: 'Teambuilder', icon: 'teambuilder' } satisfies PageInfo },
        loadComponent: () =>
          import('@features/teambuilder/components/teambuilder-page/teambuilder-page').then(
            (c) => c.TeambuilderPage,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
