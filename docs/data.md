# Game data and assets

The console can't reasonably download Showdown's data files at runtime (the teambuilder tables alone
are ~16 MB, and each request takes ~100 ms there). So the app **bundles** compact JSON files generated
from Showdown's data by scripts, plus a few asset files in `public/`.

## Bundled data (`src/app/core/dex/`)

| File | Contents | Made by | Read through |
| --- | --- | --- | --- |
| `champions-regmc.json` | The Champions format: usable species, learnsets, legal items, Megas, ability descriptions | `npm run update:champions` | `champions-dex.ts` |
| `moves.json` | Every move: name, type, category, base power, accuracy | `npm run update:moves` | `moves.ts` |
| `species.json` | Every species: name, types, base stats, abilities | `npm run update:species` | `species.ts` |
| `names.json` | Item and ability names, each item's place in Showdown's icon sheet | `npm run update:names` | `names.ts` |
| `gen1.json` … `gen4.json` | What differs in Gens 1 to 4 (moves and species), for their Random Battles | `npm run update:past-gens` (after `update:moves` and `update:species`) | the battle code |
| `calc-sets.json` | Common sets for the damage calculator | `npm run update:calc-sets` | `teambuilder/calc` |
| `sprite-sheets.json` | Where each Champions sprite is in the bundled sheets | `npm run update:sprites` | `core/gl/sprite-sheets.ts` |

The JSON files are generated: **don't edit them by hand**. Change the script and run it again, and
commit the script and its output together.

Each script's header comment explains what it keeps and why. Common points:

- They download Showdown's client data (`play.pokemonshowdown.com/data/*.js` and the teambuilder
  tables) and **parse it as text, never run it** (`scripts/showdown-data.mjs`).
- They keep only what the app shows, in compact arrays, to keep the bundle small.
- Run `update:champions` and then `update:sprites` when Showdown updates the format. Run the others
  when new species, moves or items appear.

## Formats

The formats the app offers are a curated list in `src/app/shared/data/formats.ts`:

- `TEAM_FORMATS`: what teams can be built for (the Champions VGC and BSS formats, which share the
  same data and rules).
- `PLAYABLE_FORMATS`: what Watch Live and Replays offer, with a label, a category, a one-line
  description and a short rules summary. The Battle page offers its team formats (`TEAM_PLAY_FORMATS`),
  the Random Battle page its random ones (`RANDOM_PLAY_FORMATS`).

Format IDs must match the server's `|formats|` list exactly. Regulations rotate, so check the IDs
against the live server when you add or update one (the comments note the date they were checked).
Adding a random format is usually just an entry in `PLAYABLE_FORMATS`; a new team format also needs its
data (a script like `update:champions`) and any rule that differs from Champions' (stat points, natures).

## Assets (`public/`)

Everything in `public/` is copied as-is into the build and the console zip.

| Folder | Contents | Made by |
| --- | --- | --- |
| `sprites/champions-*.png` | Front and back sprites of every Champions species and Mega, packed into sheets | `npm run update:sprites` |
| `sprites/substitute*.png` | The substitute doll | — |
| `audio/battle/*.ogg` | Four battle tracks, mono 24 kHz Vorbis, cut at their loop end | `npm run update:battle-music` (needs ffmpeg with libvorbis) |
| `audio/music/*.ogg` | Official tracks beyond Showdown's: the soundtracks' (Champions, Classic) and two more battle tracks, mono 24 kHz Vorbis, cut at their loop end | `npm run update:soundtracks` from `references/music/` (needs ffmpeg with libvorbis; see [audio.md](features/audio.md#soundtracks)) |
| `audio/*.wav`, `audio/*.mp3` | Battle sound effects (hits, stat changes) | — |
| `categories/*.png` | Physical / Special / Status icons | `npm run update:moves` |

Item icons, Pokémon cries, trainer avatars and the sprites of formats outside Champions are loaded
from Showdown at runtime.

UI sounds and the app's own menu theme are **not files**: they're synthesized at launch (`core/audio/chip-synth.ts`,
`sfx.ts`, `menu-theme.ts`) during the loading screen.

### Missing sprites

Showdown has no sprites (or poor ones) for some of the newest Megas. `missing-sprites.json` at the
repository root maps a sprite id to links to replacement images:

```json
{ "raichu-megax": { "front": "https://…/front.png", "back": "" } }
```

`update:champions` and `update:sprites` use those links instead of Showdown's (see
`scripts/sprite-overrides.mjs`); an empty link leaves that sprite to Showdown. Without the file, the
scripts use Showdown alone.

## Licensing of data and assets

The code in this repository is MIT licensed. **Game data, sprites, music and sounds are not ours**:
they belong to Nintendo, Game Freak and The Pokémon Company, and are served or derived from Pokémon
Showdown and its contributors. The calculator's sets come from the
[NCP VGC Damage Calculator](https://github.com/nerd-of-now/NCP-VGC-Damage-Calculator) (MIT). Don't add
assets you don't have the right to share, and credit the source of anything new in the script or
file that brings it in.

## Saved data

What the app saves on the device goes through `core/persistence/device-storage.ts` (see
[native.md](native.md#running-it)). Keys are versioned (`psb.settings.v1`, `psb.teams.v1`…): when a
saved shape changes incompatibly, read the old version and migrate it, or bump the key, so players
don't lose their teams.
