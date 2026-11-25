# Pokémon Showdown NX

[![CI](https://github.com/jportoh/pokemon-showdown-nx/actions/workflows/ci.yml/badge.svg)](https://github.com/jportoh/pokemon-showdown-nx/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/jportoh/pokemon-showdown-nx)](https://github.com/jportoh/pokemon-showdown-nx/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Play [Pokémon Showdown](https://pokemonshowdown.com) on your **Nintendo Switch**: ladder battles,
challenges, a teambuilder, live battles and replays, all with the controller, in a standalone
homebrew app (`.nro`) with a Gen 3 style retro look.

It's an unofficial fan project: it plays on Showdown's main server with your Showdown account (or as
a guest), like the website does.

## Install

You need a Switch that runs homebrew (Atmosphère with the Homebrew Menu) and an internet connection.

1. Download `pokemon-showdown-vX.Y.Z.nro` from the
   [latest release](https://github.com/jportoh/pokemon-showdown-nx/releases/latest).
2. Copy it to the `switch/` folder of the SD card (`sdmc:/switch/`).
3. Open it from the Homebrew Menu in **application mode**: hold **R** while you launch a game, then
   pick the app. Opened from the album (applet mode), it doesn't get enough memory to run.

You can also install a forwarder to the `.nro` to open it from the HOME menu (see
[docs/native.md](docs/native.md)). To leave the app, press the console's HOME button.

## Updates

The app keeps itself up to date. Each time it starts, it checks for a new version before the menu,
and downloads and installs it right there (the code and any new sprites, a few MB), then carries on
with it: you always play the latest version. Without a connection to check, you can still play
offline (no Showdown). If a new version ever fails to start, the app offers to download it again.

Now and then a version needs a new `.nro` (a new engine). The app downloads that too, next to the
old one, and asks you to open the new version once from the Homebrew Menu (hold R): it then puts
itself where your HOME menu forwarder opens and cleans up the old one.
Your teams, settings and saved login stay on the SD card, in `sdmc:/switch/pokemon-showdown-nx/`.

## Features

- **Battle**: pick a format and a team, then search Showdown's ladder or challenge a player by name.
  Incoming challenges can be answered from any page. Doubles and singles, Mega Evolution,
  Terastallization, the battle timer, forfeit, rematches, instant replays, Best-of-3 sets and Open
  Team Sheets.
- **Formats**: VGC 2026 (single games and Bo3), Battle Stadium Singles, and Gen 9, Champions and
  Gen 3 Random Battles.
- **Teambuilder**: build teams for the Champions formats, validate them on the server, import them
  from PokePaste, and check damage against common sets with the built-in calculator.
- **Watch Live**: spectate battles being played right now.
- **Replays and battle history**: play back public replays, and your own battles (saved
  automatically).
- **Chats**: join Showdown's main chat rooms.
- **Trainer Card**: your avatar, ladder ratings and record.
- **Settings**: light and dark appearance, six colour themes, music and sound volumes, default
  formats, spectators, saved login.
- Animated battles on seven battlefields, with per-move effects, battle music and cries, and
  chiptune menu music.

## Controls

| Controller | Keyboard | Use |
| --- | --- | --- |
| D-pad | Arrows / WASD | Move between controls |
| A / B | Enter / Escape (J / K) | Confirm / back |
| L / R, ZL / ZR | Q / E, Z / C | Page actions, shown on screen (switch formats and teams, Battle info, Mega Evolution…) |
| X / Y | X / Y | X: the focused thing's option (favourite, Settings, the party in battle); Y: search, the field in battle |
| + / − | + / − | +: confirm or send (the battle menu, the keyboard's OK, chat); −: the battle timer, remove |
| R3 | R | Page action (search) |
| L3 + R3 | F + R | Performance overlay (both together) |

Every screen shows its buttons. The touchscreen works too, and text is typed with the app's own
on-screen keyboard.

## Known limitations

- **Sleep closes the app.** The engine can't survive the console sleeping with a connection open, so
  the app closes when the console wakes. Open it again.
- **720p only.** The engine draws at 1280×720; docked, the console scales it to the TV.
- **Guests can't chat in battles.** That's a Showdown server rule: log in to chat.

## Development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm start                    # dev server at http://localhost:4200
npm run build:nro            # → dist/nro/pokemon-showdown.nro
```

The browser is for development. Logging in to Showdown needs `play.pokemonshowdown.com/api`, which
only allows CORS from Showdown's own site, so in a desktop browser online play needs web security
disabled (for example Chrome started with `--disable-web-security`). The console doesn't enforce
CORS.

It's built with Angular and runs on the [nx.js_extended](https://github.com/natureglass/nx.js_extended)
engine; the whole UI is drawn with WebGL on a single 1280×720 canvas. CI builds the `.nro` for every
pull request; a `vX.Y.Z` tag publishes a release and the online update.

Developer documentation lives in [docs/](docs/):

- [Architecture](docs/architecture.md): one canvas, Angular as the skeleton, scenes, state, code layout
- [UI kit](docs/ui-kit.md): building screens on the canvas, step by step
- [Input](docs/input.md): controller, keyboard, touch and focus
- [Rendering](docs/rendering.md): the renderer, text and image caches, performance
- [The Switch app](docs/native.md): the engine, the `.nro` build, testing on a console
- [Online updates](docs/updates.md): the loader, the updater, asset packs
- [Talking to Showdown](docs/showdown.md): connection, login, battles
- [Game data and assets](docs/data.md): bundled data, update scripts, formats
- [Features](docs/features/README.md): one page per area of the app
- [Branches, CI and releases](docs/releases.md)

Want to help? Read [CONTRIBUTING.md](CONTRIBUTING.md). Bugs and ideas are welcome as
[issues](https://github.com/jportoh/pokemon-showdown-nx/issues).

## License

The code is released under the [MIT License](LICENSE).

The license covers this project's code only. Pokémon, its names, sprites, music and sounds belong to
Nintendo, Game Freak and The Pokémon Company; game data and many assets come from Pokémon Showdown
and its contributors, and the app icon is based on Pokémon Showdown's logo. They are not covered by
this license.

This is an unofficial fan project. It is not affiliated with Pokémon Showdown, Nintendo, Game Freak or
The Pokémon Company.
