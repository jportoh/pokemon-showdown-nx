# Battle lobby (`/play`)

`features/play/`

Where the player picks a format and a team, searches the ladder, challenges players and answers
challenges.

## Layout

The page is a showcase in three rows:

1. **Formats**: a carousel that loops round (`gl/format-carousel.ts`). The picked format's card turns
   over to show the search while it runs.
2. **Teams** for the picked format: another carousel (`gl/team-showcase.ts`), each Pokémon with its
   sprite, types, item and ability. Random formats need no team.
3. **Actions**: BATTLE! (search or cancel), challenge a player, and a pending challenge's button.

It is drawn in the menu's style (`core/gl/ui/menu-kit.ts`): the menu-style header (`PageBar.drawHeader`),
slanted format cards and a team panel fading into Battle's colour, a name plate with the player's
trainer, and BATTLE! and the challenge button as slanted buttons (BATTLE! in the accent, the lead
Pokémon drawn on it).

## Random Battle (`/random`)

The home menu's Random Battle opens the same scene (route data `random`) for the random formats
(`RANDOM_PLAY_FORMATS`), with its own picked format (`PlaySelection.randomFormat`). There are no
teams, so the two carousels give way to a grid of every format (`gl/format-grid.ts`): tiles in rows
of five under their category (Standard, Randomized Metas), each with its short name
(`PlayableFormat.short`) and its sets. The d-pad walks the grid, A picks a tile and moves on to
BATTLE!, ZL/ZR step through them; while searching, the picked tile shows the search and the rest dim.
The actions along the foot are the Battle page's.

Over the page, as modals: the format and team lists (`OptionPickerView`), the challenge form, incoming
challenges (`gl/challenge-views.ts`) and a challenger's Trainer Card.

## Controls

| Button | Action |
| --- | --- |
| ZL / ZR | Previous / next format, from anywhere on the page |
| L / R | Previous / next team, from anywhere on the page |
| D-pad up | Reach the carousels; left/right turn them, A opens their list |
| A on BATTLE! | Search the ladder, or cancel the search |
| B | Leave a challenge for later, close a modal, or go back home |

The focus can stay on BATTLE! while the shoulder buttons change format and team: the common flow is
ZL/ZR, L/R, A.

## Code

| File | Role |
| --- | --- |
| `components/play-scene/play-scene.ts` | The scene: rows, modals and their input. What's on top decides who gets the input |
| `gl/carousel.ts` | The carousel's sliding motion, shared by both rows |
| `gl/format-carousel.ts`, `gl/team-showcase.ts` | The two carousels' cards |
| `gl/format-grid.ts` | The Random Battle page's grid of formats |
| `gl/challenge-views.ts` | The challenge form and the incoming challenge popup |
| `state/play-selection.ts` | The picked format and team, kept while the app runs |

The page uses the connection services directly: `ShowdownSearch` for the ladder,
`ShowdownChallenges` for challenges, and `TeamStore` for the teams, packed with
`packTeam` before they're sent ([showdown.md](../showdown.md#finding-a-battle)). When a match is found
or a challenge accepted, `App` opens `/battle`; this page doesn't navigate there itself.

## Notes

- **Best-of-3** (VGC Bo3): the format is offered as its own entry in `PLAYABLE_FORMATS` with the VGC
  format's teams (`teamFormat`). Open Team Sheets are forced on in that format.
- Challenges can arrive on any page: `PageBar` shows a notice, and this page shows the challenge
  itself.
- After a challenge is rejected for its team, the player can accept again with another one.
