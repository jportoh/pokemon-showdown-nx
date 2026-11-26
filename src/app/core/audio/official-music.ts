// Made by scripts/update-soundtracks.mjs (npm run update:soundtracks): change its TRACKS and run it again.

/** An official track the app bundles (public/audio/music): its file, its name, and where its loop starts and ends (seconds). */
export interface OfficialTrack {
  url: string;
  title: string;
  loopStart: number;
  loopEnd: number;
  /** A jingle: played through once, then the soundtrack's menu track goes on. */
  once?: boolean;
}

/** A soundtrack's music: the title screen's (before START), the menus' (taking turns), team preview's and a battle's end, won or lost. */
export interface OfficialSoundtrack {
  titleScreen: OfficialTrack | null;
  menu: readonly OfficialTrack[];
  preview: OfficialTrack | null;
  victory: OfficialTrack | null;
  defeat: OfficialTrack | null;
}

/** The soundtracks of official tracks (Settings > Sound > Soundtrack), besides the app's own themes. */
export type OfficialSoundtrackId = 'champions' | 'classic';

/** Each soundtrack's tracks: one is offered once it has a menu track. */
export const OFFICIAL_SOUNDTRACKS: Record<OfficialSoundtrackId, OfficialSoundtrack> = {
  champions: {
    titleScreen: { url: 'audio/music/champions-main-theme.ogg', title: 'Main Theme (Champions)', loopStart: 15.829333, loopEnd: 107.989333 },
    menu: [
      { url: 'audio/music/champions-main-lobby.ogg', title: 'Main Lobby (Champions)', loopStart: 10.453333, loopEnd: 82.906125 },
    ],
    preview: { url: 'audio/music/champions-team-select.ogg', title: 'Team Select (Champions)', loopStart: 5.376, loopEnd: 26.868042 },
    victory: { url: 'audio/music/champions-match-results.ogg', title: 'Match Results (Champions)', loopStart: 9.557333, loopEnd: 64.414458 },
    defeat: { url: 'audio/music/champions-match-results.ogg', title: 'Match Results (Champions)', loopStart: 9.557333, loopEnd: 64.414458 },
  },
  classic: {
    titleScreen: { url: 'audio/music/emerald-battle-frontier.ogg', title: 'Battle Frontier (Emerald)', loopStart: 4.876208, loopEnd: 44.434292 },
    menu: [
      { url: 'audio/music/emerald-battle-tower.ogg', title: 'Battle Tower (Emerald)', loopStart: 5.526333, loopEnd: 52.802167 },
    ],
    preview: { url: 'audio/music/emerald-battle-dome.ogg', title: 'Battle Dome (Emerald)', loopStart: 7.15175, loopEnd: 47.151 },
    victory: { url: 'audio/music/emerald-battle-symbol-get.ogg', title: 'Battle Symbol Get! (Emerald)', loopStart: 0, loopEnd: 4.9415, once: true },
    defeat: { url: 'audio/music/emerald-battle-pyramid-1.ogg', title: 'Battle Pyramid 1 (Emerald)', loopStart: 11.702875, loopEnd: 77.728083 },
  },
};

/** The official battle tracks: battles pick among them and Showdown's (BattleMusic), whatever the soundtrack. */
export const OFFICIAL_BATTLE_TRACKS: readonly OfficialTrack[] = [
  { url: 'audio/music/champions-battle-arena.ogg', title: 'Battle Arena (Champions)', loopStart: 18.218667, loopEnd: 104.678292 },
  { url: 'audio/music/champions-gym-court.ogg', title: 'Gym Court (Champions)', loopStart: 17.322667, loopEnd: 107.322667 },
];
