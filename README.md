# Pokémon Showdown for Brewser

A [Pokémon Showdown](https://pokemonshowdown.com) client for the **Brewser** console. It connects to
Showdown's main server, is played with a controller on a 1280×720 screen (1920×1080 docked), and has
a Gen 3 style retro look. It's built with Angular, and the whole UI is drawn with WebGL on a single
canvas.

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
| R3 | R | Page action (battle timer, search) |
| L3 | F | Performance overlay |

The console's touchscreen and a mouse also work.

## Getting started

Requirements: Node.js 22+ and npm.

```bash
npm install
npm start          # dev server at http://localhost:4200
```

Logging in to Showdown needs `play.pokemonshowdown.com/api`, which only allows CORS from Showdown's
own site, so in a desktop browser online play needs web security disabled (for example Chrome
started with `--disable-web-security`). The Brewser console doesn't enforce CORS.

## Building for Brewser

```bash
npm run build:brewser        # → dist/pokemon-showdown-brewser/brewser.zip
npm run build:brewser:diag   # the same, with an on-screen boot report
```

Upload `brewser.zip` to Brewser, with these origins on the network allow-list:
`wss://sim3.psim.us`, `https://play.pokemonshowdown.com`, `https://replay.pokemonshowdown.com` and
`https://pokepast.es`. CI builds the zip for every pull request and attaches it to every release.

## Documentation

Developer documentation lives in [docs/](docs/):

- [Architecture](docs/architecture.md): one canvas, Angular as the skeleton, scenes, state, code layout
- [UI kit](docs/ui-kit.md): building screens on the canvas, step by step
- [Input](docs/input.md): controller, keyboard, touch and focus
- [Rendering](docs/rendering.md): the renderer, text and image caches, performance
- [Running on Brewser](docs/brewser.md): the console's engine, the console build, testing on a device
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

This is an unofficial fan project. It is not affiliated with Pokémon Showdown, Brewser, Nintendo, Game
Freak or The Pokémon Company.
