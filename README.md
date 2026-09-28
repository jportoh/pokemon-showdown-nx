# Pokémon Showdown for Brewser

A [Pokémon Showdown](https://pokemonshowdown.com) client for the **Brewser** console, built with Angular.
It connects to Showdown's main server and is designed to be played with a controller on a fixed
1280×720 screen, with a Gen 3–style retro look.

## Features

- **Battle**: pick a format and one of your teams, then search Showdown's ladder for an opponent.
  You can also challenge a player by name and accept incoming challenges. Doubles (VGC) and singles
  (Random Battle) are supported, including Mega Evolution, Terastallization, the battle timer,
  forfeit and rematches.
- **Random Battle**: a one-button ladder search from the home screen.
- **Teambuilder**: build and validate teams for `[Gen 9 Champions] VGC 2026 Reg M-C`.
- **Watch Live**: spectate battles that are being played right now.
- **Replays**: browse and play back replays from `replay.pokemonshowdown.com`.
- **Chats**: join Showdown's chat rooms.
- **Login**: connect as a guest (random name) or log in with a registered Showdown account.

## Controls

The UI is controller-only on the console. Buttons come from the Gamepad API.

| Button | Use |
| --- | --- |
| D-pad | Move between controls (spatial navigation) |
| A / B | Confirm / back |
| L / R, ZL / ZR | Page-specific actions, shown as badges on screen. Examples: Mega/Tera and Forfeit in battle, switching teams on the Battle page, login on the home screen |

The keyboard also works in a desktop browser (arrow keys, Enter, Escape).

## Getting started

Requirements: Node.js 22+ and npm.

```bash
npm install
npm start          # dev server at http://localhost:4200
```

Signing in to Showdown needs `play.pokemonshowdown.com/api`, and that endpoint only allows CORS from
Showdown's own site. So in a regular browser, online play works only with web security disabled, for
example Chrome started with `--disable-web-security`. The Brewser console doesn't enforce CORS.

## Building for Brewser

The console runs a custom engine, not Chrome. It runs every script as a classic script (no ES modules)
and has a limited CSS engine (no `@layer`, no escaped class selectors, no `oklch()`, and more).
`scripts/build-brewser.mjs` post-processes the normal Angular build so it can run there. It re-bundles
the app into a single classic `app.js`, lowers Tailwind v4's CSS, and adds a few runtime polyfills and
patches.

```bash
npm run build:brewser        # → dist/pokemon-showdown-brewser/brewser.zip
npm run build:brewser:diag   # same, with on-screen diagnostics
```

Upload `brewser.zip` (`index.html`, `app.js` and `assets/`) to Brewser. The submission's network
allow-list must include:

- `wss://sim3.psim.us`: the Showdown server
- `https://play.pokemonshowdown.com`: login, sprites and data
- `https://replay.pokemonshowdown.com`: replays

### Things to keep in mind on Brewser

- The app is a fixed 1280×720 stage with fixed pixel sizes. Avoid percentage or flex-grown sizes
  around dynamic content.
- Use `p-*` padding shorthands. Brewser ignores padding longhands such as `px-*`.
- Add the `appScrollRegion` directive to every scrollable region, or its content stays painted after
  navigation.
- Don't use shadows or gradients, and keep DOM counts small, for performance.

## Game data

The game data is bundled as JSON under `src/app/core/dex/`. It's generated from Showdown's client data
files by these scripts:

| Script | Output |
| --- | --- |
| `npm run update:champions` | `champions-regmc.json`: species, learnsets, items and rules for the VGC format |
| `npm run update:moves` | `moves.json` and category icons: every move's name, type, category, power and accuracy |
| `npm run update:names` | `names.json` and item icons: item and ability names for any format |
| `npm run update:species` | `species.json`: types, base stats and abilities of every species |

## Project structure

```
src/app/
  core/       dex data, controller input, layout, persistence, render scheduling
  features/
    battle/       battle screen, protocol parsing, live/spectate/replay connections
    connection/   Showdown WebSocket, login, challenges, ladder search, battle rooms
    home/         home menu and login box
    play/         Battle page (format/team selection, challenges)
    teambuilder/  team editor, packed-team format, validation
    live/         live battle list
    replays/      replay list
    lobby/        chat rooms
  shared/     shared components, format list, directives, UI classes, utilities
scripts/      Brewser build and game-data update scripts
```

## Tests

```bash
npm test     # Vitest
```

## Disclaimer

This is an unofficial fan project. It is not affiliated with Pokémon Showdown, Nintendo, Game Freak or
The Pokémon Company.
