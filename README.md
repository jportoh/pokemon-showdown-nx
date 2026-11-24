# Pokémon Showdown NX

A [Pokémon Showdown](https://pokemonshowdown.com) client for the **Nintendo Switch**, as a standalone
homebrew app (`.nro`). It connects to Showdown's main server, is played with a controller on a
1280×720 screen, and has a Gen 3 style retro look. It's built with Angular and runs on the
[nx.js_extended](https://github.com/natureglass/nx.js_extended) engine; the whole UI is drawn with
WebGL on a single canvas.

## Features

- **Battle**: pick a format and a team, then search Showdown's ladder or challenge a player by name.
  Incoming challenges can be answered from any page. Doubles and singles, Mega Evolution,
  Terastallization, the battle timer, forfeit, rematches, Best-of-3 sets and Open Team Sheets.
- **Formats**: VGC 2026 Reg M-C (single games and Bo3), BSS Reg M-C, and Gen 9, Champions and
  Gen 3 Random Battles.
- **Teambuilder**: build teams for the Champions formats, validate them on the server, import them
  from PokePaste, and check damage against common sets with the built-in calculator.
- **Watch Live**: spectate battles being played right now.
- **Replays and battle history**: play back public replays, and your own battles (saved
  automatically).
- **Chats**: join Showdown's main chat rooms.
- **Trainer Card**: your avatar, ladder ratings and record.
- **Settings**: six colour themes, music and sound volumes, default formats, spectators, saved login.
- Animated battles with per-move effects, battle music and cries, and synthesized chiptune menu
  music.

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

To leave the app, use the console's HOME button.

The console's touchscreen and a mouse also work.

## Getting started

Requirements: Node.js 22+ and npm.

```bash
npm install
npm start          # dev server at http://localhost:4200
```

The browser is for development. Logging in to Showdown needs `play.pokemonshowdown.com/api`, which
only allows CORS from Showdown's own site, so in a desktop browser online play needs web security
disabled (for example Chrome started with `--disable-web-security`). The console doesn't enforce
CORS.

## Building the Switch app

```bash
npm run build:nro            # → dist/nro/pokemon-showdown.nro
```

Copy the `.nro` to `sdmc:/switch/` and open it from the Homebrew Menu in **application mode** (hold R
while launching a game), or install a forwarder to it. See [docs/native.md](docs/native.md). CI
builds the `.nro` for every pull request and attaches it to every release.

## Documentation

Developer documentation lives in [docs/](docs/):

- [Architecture](docs/architecture.md): one canvas, Angular as the skeleton, scenes, state, code layout
- [UI kit](docs/ui-kit.md): building screens on the canvas, step by step
- [Input](docs/input.md): controller, keyboard, touch and focus
- [Rendering](docs/rendering.md): the renderer, text and image caches, performance
- [The Switch app](docs/native.md): the engine, the `.nro` build, testing on a console
- [Talking to Showdown](docs/showdown.md): connection, login, battles
- [Game data and assets](docs/data.md): bundled data, update scripts, formats
- [Features](docs/features/README.md): one page per area of the app
- [Branches, CI and releases](docs/releases.md)

Want to help? Read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The code is released under the [MIT License](LICENSE).

The license covers this project's code only. Pokémon, its names, sprites, music and sounds belong to
Nintendo, Game Freak and The Pokémon Company; game data and many assets come from Pokémon Showdown
and its contributors. They are not covered by this license.

This is an unofficial fan project. It is not affiliated with Pokémon Showdown, Nintendo, Game Freak or
The Pokémon Company.
