# Watch Live, Replays and battle history

Three pages that list battles and open them on the battle screen as a spectator. They share most of
their UI.

## The shared page: `FormatListScreen`

`core/gl/ui/format-list-screen.ts` is a whole page: the page bar, a format selector (an
`OptionPickerView`), Previous (L), Next (R) and Refresh (ZR), and a box of rows or a message. A page
built on it only supplies a **model** (`FormatListModel`): its title, formats, rows, what happens on
Refresh and when a row is opened. `LiveScene` is a good example of how little a page needs.

## Watch Live (`/live`)

`features/live/`

- `state/live-battles.ts`: the battles being played in a format, from `/cmd roomlist <format>` (the
  latest 100), best rated first.
- `state/player-ratings.ts`: players' current ladder ratings, used to show the average rating of
  Best-of-3 games (the room list doesn't rate them). Downloaded only for the rows shown
  (`shared/utils/row-lookups.ts`), a couple at a time.
- `components/live-scene/live-scene.ts`: the page. Opening a row asks `BattleSession` to spectate the
  room and navigates to `/battle`.

It needs the connection: offline, ZR opens the home menu's login box over the page
(`LoginOverlay`).

## Replays (`/replays`)

`features/replays/`, opened from Settings.

- `data/replay-api.ts`: the replay server's search and log download. It answers CORS from any origin.
- `data/replay-game.ts`: what a replay's log says that the list leaves out (each game's ratings, the
  game number in a Best-of-3, the winner).
- `data/replay-rows.ts`: row texts (time ago, game details, errors).
- `components/replays-scene/replays-scene.ts`: the page. A replay plays on the battle screen with a
  `ReplayBattleConnection`, from p1's side.

## Battle history (`/history`)

`components/history-scene/history-scene.ts`

Showdown keeps no list of a player's battles, only the replays saved of them. So the app saves the
replay of every battle the player plays (`ReplayAutoSave`, `/savereplay`, on by default in Settings),
and the history is the replay server's **search by the player's name**. Only for registered names:
an unregistered name may have been anyone's.

Each row says whether the player won (from the replay's log, fetched for the rows shown). A replay
plays from the player's own side. The page is opened from the Trainer Card (`?from=card`) or Settings
(`?from=settings`), and B goes back there.

Battles played with spectators off are saved as private replays, which the search can't list.
