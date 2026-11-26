# Audio

`core/audio/`, `features/battle/audio/`

All sound goes through **Web Audio**: the console's engine has no `<audio>` elements, while an
`AudioContext` runs from launch and decodes ogg and mp3 ([native.md](../native.md#phase-0-probe-test-x1-2026-11-21)).

## `AudioEngine`

`core/audio/audio-engine.ts` is the one audio service: two buses, **music** and **sound effects**,
following the volumes in Settings.

| Call | Use |
| --- | --- |
| `play(id)` | A sound effect by id (`SoundId` in `sfx.ts`) |
| `playBuffer(buffer, rate?)` | A decoded buffer on the sound bus (cries) |
| `playMenuTheme()` | The app's own menu theme, looped (`Soundtrack` decides when it plays) |
| `playBattleTheme('preview' \| 'victory' \| 'defeat')` | Team preview's and the end's themes |
| `playMusic(track)`, `stopMusic()` | Any music track |
| `decode(bytes)` | Decode audio data |
| `prepare(budgetMs)` | Synthesize the sounds and themes, a slice per call (the loading screen) |

UI sounds play by themselves: `KeyboardNavigation` plays `move`, `accept`, `back` or `page` for every
press a screen used, and `hold` when a hold-to-confirm completes ([input.md](../input.md)).

In a desktop browser the context starts suspended until the first key or click, so anything before
that is silent.

## What's synthesized, what's recorded

| Sound | Source | File |
| --- | --- | --- |
| UI sounds (cursor, accept, back, page, hold, challenge…) | Synthesized | `sfx.ts` (note lists), `chip-synth.ts` |
| Menu theme (Custom) | Synthesized: an original 16-bar loop | `menu-theme.ts` |
| Official soundtracks (Champions…) and two more battle tracks | Official tracks from the games, bundled as mono 24 kHz ogg | `soundtrack.ts`, `official-music.ts` |
| Team preview, victory and defeat themes | Synthesized: original loops | `battle-themes.ts` |
| Battle hits and stat changes | Recorded, bundled in `public/audio/` | `SOUND_FILES` in `sfx.ts` |
| Battle music | Showdown's tracks, bundled as mono 24 kHz ogg | `battle-music.ts` |
| Cries | Showdown's server, at runtime | `features/battle/audio/battle-cries.ts` |

`chip-synth.ts` is a tiny synth in the style of the Game Boy Advance's sound chip (pulse, triangle and
noise channels). Sounds and themes are lists of notes, rendered to buffers during the loading screen,
so playing them later costs nothing.

## Battle music

`BattleMusic` decodes the bundled tracks on the loading screen and keeps them decoded, so a battle's
music starts instantly. A track the loading screen didn't wait for is loaded when a battle needs it
(at the search or the challenge, with `prepareNext`). A battle picks among Showdown's tracks, which
loop at the same points as in Showdown's client, and the official ones in `OFFICIAL_BATTLE_TRACKS`
(Pokémon Champions' Battle Arena and Gym Court, see [Soundtracks](#soundtracks)), whatever the
soundtrack.

To change Showdown's tracks, edit `scripts/update-battle-music.mjs` and run
`npm run update:battle-music` (needs ffmpeg with libvorbis), then update the track list in
`battle-music.ts`.

## Soundtracks

Settings > Sound > Soundtrack (`soundtrack`) picks the music of the title screen (before START),
the menus, team preview and a battle's end, won or lost:

| Soundtrack | Title screen | Menus | Team preview | Victory | Defeat |
| --- | --- | --- | --- | --- | --- |
| **Custom** | The app's own menu theme | The same | The app's own themes (synthesized) | ″ | ″ |
| **Champions** (Pokémon Champions) | Main Theme | Main Lobby | Team Select | Match Results | Match Results |
| **Classic** (Pokémon Emerald's Battle Frontier) | Battle Frontier | Battle Tower | Battle Dome | Battle Symbol Get!, then Battle Tower | Battle Pyramid 1 |

`Soundtrack` plays them. The loading screen decodes the soundtrack's tracks with the battle music
(`preload`), plays the title screen's once it's done (`playTitle`), and START the menus'
(`playMenu`). Battles take the music (`BattleMusic`): `leave()` as one opens, `playTheme` for
team preview and the end, `playMenu(true)` as it closes. Where a soundtrack has no track, or it
isn't decoded yet, the app's own theme plays. A soundtrack's menu tracks take turns (with more than
one): a random one first, then the next each time a battle closes, decoded while the battle's end
shows (`prepareNext`). An end that's a jingle (`once`, like Battle Symbol Get!) is joined to the
menu track in one buffer under that track's name, so the menu music keeps going as the battle
closes. A soundtrack picked in Settings plays at once.

Battles pick among Showdown's tracks and the official ones in `OFFICIAL_BATTLE_TRACKS` (Pokémon
Champions' Battle Arena and Gym Court), whatever the soundtrack.

The tracks are made by `npm run update:soundtracks` (needs ffmpeg with libvorbis, on the PATH or in
`FFMPEG`). Its `TRACKS` lists every track: its game and title, its soundtrack and roles
(`titleScreen`, `menu`, `preview`, `victory`, `defeat`), or `battle` for the battle tracks,
and its source. The sources stay out of git, in `references/music/`:

1. The BRSTMs from Smash Custom Music (Pokémon Champions'
   [page](https://smashcustommusic.net/game/5776), Pokémon Emerald's
   [page](https://smashcustommusic.net/game/785)): download each one from its song's page by hand
   (the site doesn't let scripts download them) into `references/music/`. The script finds each file
   by the song's id, or its game and title, in its name, and reads the loop from the BRSTM's header
   (one marked as not looping is a jingle).
2. Other sources are `file`s there, in any format ffmpeg reads (mp3, flac, ogg, wav…). Their loop is
   `loop` (seconds from the file's start) or, without it, found where the music repeats
   (`scripts/find-loop.mjs`: rips usually play the loop twice and fade out). Check what it prints: a
   file that doesn't repeat is looped whole, and a doubtful loop is marked DOUBTFUL.
3. The script cuts each track just past its loop's end, levels it to the battle music's loudness
   (a look-ahead limiter takes up to 4 dB off its peaks, under 0.8 so Vorbis doesn't overshoot 1;
   the loop is limited as it plays after the first time round, so it joins with no jump), and writes
   `public/audio/music/<game>-<title>.ogg` and `src/app/core/audio/official-music.ts` (the list
   with the loop points; don't edit it by hand).

Each run makes every track again, so keep the sources. The `.nro` stores each track decoded, as it
does Showdown's battle tracks: 48 KB a second, ~33 MiB for the eleven.

## Cries

`BattleCries` plays a Pokémon's cry when it comes out and when it faints. Team preview preloads both
teams' cries. A Mega or forme without its own cry file uses its species'.

## Adding a sound

- **A UI sound**: add its id to `SoundId` and its notes to `SOUNDS` in `sfx.ts`, then call
  `audio.play(id)`. Keep it short and quiet next to the existing ones.
- **A recorded sound**: put the file in `public/audio/`, add it to `SOUND_FILES`, and make sure you
  have the right to ship it ([data.md](../data.md#licensing-of-data-and-assets)).
