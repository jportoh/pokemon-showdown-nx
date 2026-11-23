# Contributing

Thanks for wanting to help! This is a Pokémon Showdown client for the Nintendo Switch (a homebrew
`.nro`), built with Angular and drawn entirely on a WebGL canvas. Bug reports, ideas and pull requests are all welcome.

## Before you start

Read [docs/architecture.md](docs/architecture.md). The app works differently from a usual Angular
app: **there is no DOM UI**. Every screen is drawn on one canvas, every control is reachable with a
controller, and everything has to run at 60 fps on a console that is much slower than your computer.
The other guides in [docs/](docs/) go deeper:

| Guide | Read it when you… |
| --- | --- |
| [architecture.md](docs/architecture.md) | start; it's the map |
| [ui-kit.md](docs/ui-kit.md) | build or change a screen |
| [input.md](docs/input.md) | touch controls, buttons or focus |
| [rendering.md](docs/rendering.md) | draw a lot, add images, or chase a dropped frame |
| [native.md](docs/native.md) | want to know why something is done the hard way, or test on a console |
| [showdown.md](docs/showdown.md) | talk to the Showdown server |
| [data.md](docs/data.md) | touch game data, formats, sprites or sounds |
| [features/](docs/features/README.md) | work on a specific screen |
| [releases.md](docs/releases.md) | want to know how changes are shipped |

For anything bigger than a small fix, **open an issue first** to talk it through. Some designs here
are deliberate trade-offs for the console (see [native.md](docs/native.md)), and it saves you work
to know before you start.

## Setting up

Requirements: Node.js 22+ and npm.

```bash
git clone <your fork>
cd pokemon-showdown-nx
npm install
npm start          # http://localhost:4200
```

The keyboard stands in for the controller: arrows or WASD move, Enter or J is A, Escape or K is B,
Z/C are ZL/ZR, Q/E are L/R, X/Y are X/Y, + and - are + and −, R is R3 and F is L3 (the performance
HUD). Any gamepad also works. See
[input.md](docs/input.md#the-buttons).

To log in or play online from a desktop browser, you need one with web security disabled, because
Showdown's login server only allows its own site
([native.md](docs/native.md#developing-in-a-desktop-browser)). Browsing, the teambuilder and
everything offline work without it.

## Making a change

1. Fork the repository and create a branch from `main`: `feat/<name>`, `fix/<name>`, `docs/<name>` or
   `chore/<name>`.
2. Make your change, following the conventions below.
3. Run the checks.
4. Open a pull request against `main`. Describe what changed and why, and how you tested it
   (browser, console, or both). Add a screenshot or a short video for visual changes.
5. CI builds the `.nro` for your PR; a maintainer tests it on a console if you couldn't, and
   squash-merges it.

### Checks

```bash
npm run build:nro   # must pass: CI runs it as the required check
```

It runs `ng build` and then packages the result as the Switch app ([native.md](docs/native.md#building-it)).

There are no unit tests yet (`npm test` runs Vitest, and CI doesn't run it). Tests for pure
logic (protocol parsing, battle text, team formats, the damage calc wrapper) are a very welcome
contribution.

Then check your change in the app with the keyboard only (no mouse), in at least two themes, and with
the L3 HUD open: no long frames when opening or using the screen you changed.

## Conventions

The project's rules for code assistants are in [CLAUDE.md](CLAUDE.md); they apply to everyone.

**Angular**

- Standalone components (don't set `standalone: true`, it's the default) and the default `OnPush`.
- Signals for state, `computed()` for derived state, `inject()` instead of constructor injection.
- `@Service()` for singleton services.
- New routes are lazy-loaded scenes with an empty template.
- No `@HostBinding` / `@HostListener`; use the decorator's `host` object.

**UI**

- No DOM templates, HTML controls or CSS for UI. Build screens with the canvas kit
  ([ui-kit.md](docs/ui-kit.md)).
- Everything usable with the controller alone. Say on screen what the shoulder buttons do.
- Colours from the theme's palette, with WCAG AA contrast in every theme.
- Text fields never open the keyboard on their own.
- Irreversible actions use hold-to-confirm (`HoldAction`), not a confirmation dialog.

**TypeScript**

- Strict typing; no `any` (use `unknown` when the type is uncertain).
- Use the path aliases: `@core/…`, `@features/…`, `@shared/…`.

**Style**

- Match the code around you. Formatting follows `.editorconfig` and `.prettierrc` (2 spaces, single
  quotes).
- Comment the **why**: the existing code explains each non-obvious decision, often with the console
  test that led to it. Keep doing that, especially for anything that works around the console.
- Write in English, in plain words.

**Data and assets**

- Generated files (`src/app/core/dex/*.json`, the sprite sheets, the battle music) come from the
  scripts in `scripts/`: change the script and run it again rather than editing the output
  ([data.md](docs/data.md)).
- Only add assets you have the right to share, and credit their source.

**Commits and PRs**

- One topic per pull request. The PR title becomes the squashed commit on `main`, so make it a clear
  sentence, e.g. "Teambuilder: skeleton placeholders while texts load".

## Reporting bugs

Open an issue with what you did, what you expected and what happened. Say where it happened (console
or browser, docked or handheld, which screen) and attach a screenshot if you can. For performance
problems, a photo of the L3 HUD helps a lot.

## Be kind

Be respectful and constructive in issues, pull requests and reviews. Remember that the app talks to
the official Pokémon Showdown server: don't use it, or this repository, to spam, automate play or
stress the server.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
