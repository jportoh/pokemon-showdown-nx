# Audio

`core/audio/`, `features/battle/audio/`

All sound goes through **Web Audio**: on the console `<audio>` elements never play, while an
`AudioContext` runs from launch and decodes ogg, mp3 and wav ([brewser.md](../brewser.md#audio)).

## `AudioEngine`

`core/audio/audio-engine.ts` is the one audio service: two buses, **music** and **sound effects**,
following the volumes in Settings.

| Call | Use |
| --- | --- |
| `play(id)` | A sound effect by id (`SoundId` in `sfx.ts`) |
| `playBuffer(buffer, rate?)` | A decoded buffer on the sound bus (cries) |
| `playMenuTheme()` | The menus' music, looped |
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
| Menu theme | Synthesized: an original 16-bar loop | `menu-theme.ts` |
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
(at the search or the challenge, with `prepareNext`). Tracks loop at the same points as in Showdown's
client.

To change the tracks, edit `scripts/update-battle-music.mjs` and run `npm run update:battle-music`
(needs ffmpeg with libvorbis), then update the track list in `battle-music.ts`.

## Cries

`BattleCries` plays a Pokémon's cry when it comes out and when it faints. Team preview preloads both
teams' cries. A Mega or forme without its own cry file uses its species'.

## Adding a sound

- **A UI sound**: add its id to `SoundId` and its notes to `SOUNDS` in `sfx.ts`, then call
  `audio.play(id)`. Keep it short and quiet next to the existing ones.
- **A recorded sound**: put the file in `public/audio/`, add it to `SOUND_FILES`, and make sure you
  have the right to ship it ([data.md](../data.md#licensing-of-data-and-assets)).
