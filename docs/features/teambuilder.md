# Teambuilder and damage calc (`/teambuilder`)

`features/teambuilder/`

Build teams for the Champions formats (VGC and Battle Stadium Singles, Regulation M-C), validate them
on the server, import them from PokePaste and check damage with a calculator.

## Pages

The scene (`components/teambuilder-scene/teambuilder-scene.ts`) switches between three views, and B
always goes back one step (editor → team → grid → home menu):

| View | File | What |
| --- | --- | --- |
| **Grid** | `gl/team-grid-view.ts` | The teams as cards, New team first, newest first. ZR imports a PokePaste |
| **Team** | `gl/team-view.ts` | A team as the games' party screen: the focused Pokémon's card, six slot rows. Rename and format in the header, L/R go through the teams, ZL validates, ZR (held) deletes |
| **Editor** | `gl/set-editor-view.ts` | One Pokémon across the page: its card, and Details, Stats or Calcs beside it (L/R switch tabs). On the native .nro ZL/ZR go through the team's Pokémon and - (held) removes it, X is the open list's none / Stats' undo, + opens the Calcs field and - swaps who attacks there; on Brewser (no X, - or +) ZL/ZR keep those jobs (see `ROLE_KEYS`, `SLOT_KEYS`) |

### The editor's parts

| File | What |
| --- | --- |
| `gl/hero-view.ts` | The Pokémon's card: name, sprite, types, nickname, gender; compact when a list or the Stats open |
| `gl/sprite-stage.ts` | The little stage the sprite stands on, shared by the team page and the editor so opening a Pokémon is seamless |
| `gl/set-rows-view.ts` | Details: item, ability, four moves, and the info box |
| `gl/chooser-view.ts` | The list to pick a species, item, ability or move: search (keyboard), filters (L/R), detail panel. Picking walks on to the next field, like Showdown's teambuilder |
| `gl/info-panel.ts` | What a move, item, ability or species is, for the info box and the detail panel |
| `gl/stats-view.ts` | Stats: points per stat (0–32, 66 in all) and the nature grid |
| `gl/calcs-view.ts` | Calcs: what your moves do to a rival, or the rival's to you (`ROLE_KEYS.calcsSwap`) |
| `gl/rival-picker.ts`, `gl/field-modal.ts` | The rival and field modals of the Calcs tab |
| `gl/rival-editor.ts` | Calcs: the rival's set edited (R3): item, ability and moves as the Details rows, points and nature as the Stats; the first change makes it a Custom set |
| `gl/set-choosers.ts` | The lists' options, filters and picks for a set (the editor's and the edited rival's) |
| `gl/validation-view.ts` | The server's verdict on a team |
| `gl/tb-draw.ts` | Drawing helpers shared by the views |

## Data and state

| File | Role |
| --- | --- |
| `models/team.ts` | `Team` and `PokemonSet` |
| `state/team-store.ts` | The player's teams, saved on the device (`psb.teams.v1`) |
| `state/team-validation.ts` | Server validation: `/utm` + `/vtm`, answered with a popup |
| `state/pokepaste-import.ts` | Imports a team from pokepast.es |
| `data/packed-team.ts` | Teams to Showdown's packed format |
| `data/showdown-paste.ts` | Parses Showdown's text format, for PokePaste imports |
| `data/game-rules.ts` | Stat points, natures and the stat formula at level 50 |

The format's species, learnsets, items and Megas come from the bundled `champions-regmc.json`
through `ChampionsDex` (`core/dex/champions-dex.ts`); see [data.md](../data.md).

Champions rules worth knowing:

- **Stat points** instead of EVs: 0–32 per stat, 66 in all. No IVs, level fixed at 50.
- **Megas** are the base species holding its Mega Stone; the card, stats and sprite follow the Mega
  while the stone is held.

## Damage calc

`calc/`

| File | Role |
| --- | --- |
| `damage-calc.ts` | Wraps [`@smogon/calc`](https://github.com/smogon/damage-calc) with Champions mechanics: a Mega Stone holder battles as its Mega, Aegislash's formes, immune moves, weather and terrain set by abilities |
| `rival-sets.ts` | The sets a rival can have: your edited one, common sets (`calc-sets.json`), your own teams' Pokémon, generic spreads |
| `calc-state.ts` | The rival, its edited set per species, the direction and the field, kept while the teambuilder is open |

The calculator is a teambuilder tool only: there's no damage calc during battles, by design.

## Notes

- **Text and performance.** The editor draws a lot of text. Descriptions are wrapped once and cached
  (`tb-draw.ts`), and texts not ready yet show skeletons ([rendering.md](../rendering.md#text)).
  Check the L3 HUD when changing these views.
- **Adding a format** for teams means its data (a new or extended script in `scripts/`), any rule
  that differs (`game-rules.ts`, the dex reader) and an entry in `TEAM_FORMATS` ([data.md](../data.md#formats)).
- **Saved teams** must keep loading after your change: if the saved shape changes, migrate it
  ([data.md](../data.md#saved-data)).
