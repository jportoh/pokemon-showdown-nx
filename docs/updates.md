# Online updates

The `.nro` can run a newer copy of the app's code that it finds on the SD card, so a bug fix or a
format change doesn't need everyone to copy a new `.nro`. Only the code changes this way (~2 MB);
the engine, the icon and the assets (sprites, audio: most of the `.nro`'s size) still come with a new
`.nro`. The engine features this relies on were checked on a console first
([native.md](native.md#online-updates-probe-test-u1-2026-11-23)).

**Status:** the loader is confirmed on a console (test u2: an update runs and confirms; a broken,
crashing or foreign one falls back; loading takes ~1 s from the SD card as from the RomFS). The
updater and the player's prompt are built; test u3 (on a console, from a GitHub pre-release) is next.

## The loader

The RomFS holds two scripts:

- `main.js`: the loader (`native/loader/main.ts`), a few KiB that import nothing of the app.
- `app.mjs`: the app itself (the native shims, Angular's bundle, `after-app.ts`).

An update lives in `sdmc:/switch/pokemon-showdown-nx/update/` (`native/update/boot-state.ts`):
the bundle `app-<version>.mjs` (the engine's `import()` takes no `?query`, so the version goes in the
name) and `state.json`, which says which bundle to run. The loader runs the update when:

- its **assets id** is this `.nro`'s: a fingerprint of the engine and every RomFS asset, so a bundle
  only runs next to exactly the files its code expects;
- it is **newer** than the `.nro`'s own code (semver), so installing a newer `.nro` makes it obsolete;
- it hasn't **failed** before, and hasn't started `MAX_BOOT_ATTEMPTS` (2) times without confirming.

Otherwise it runs `app.mjs`, and removes an update that can never run here. It leaves
`globalThis.psbBoot` (which code runs, its version and source); the L3 HUD shows it.

## Starting safely

- Each start of an update counts one attempt in `state.json`. Once Angular has bootstrapped
  (`src/main.ts` sets `psbAppBooted`) and 6 s pass with no uncaught error,
  `native/app/boot-confirm.ts` confirms it and the counter goes back to 0. A start that crashes,
  freezes or kills the engine never confirms: after two, the loader goes back to the `.nro`'s code.
- If the update's file can't be loaded (missing, a syntax error), the loader marks it failed and runs
  `app.mjs` in the same start.
- If it fails after it started running (`native/app/boot-start.ts`, the bundle's first module, sets
  `psbBoot.evaluating`), part of it already ran, so a second copy on top isn't safe: the loader marks
  it failed and closes the app (`Switch.exit()` takes effect after the current task, so the loader
  returns right after it); the next start runs the `.nro`'s code.

## The updater

`AppUpdater` (`src/app/core/update/app-updater.ts`) runs once per start, a second after the loading
screen (the entry screen leaves the main thread mostly idle for its TLS handshakes), on the console
only:

1. It reads the latest release's `update.json` and `update.json.sig`
   (`github.com/<repo>/releases/latest/download/…`; pre-releases are never "latest") and checks the
   ECDSA P-256 signature with the public key in `update-config.ts`. Ed25519 would be smaller, but
   the engine's `crypto.subtle` doesn't have it.
2. Nothing to do when the version isn't newer than the running code. A newer one with another assets
   id needs a new `.nro`: the player is told once per version, with the releases page.
3. Otherwise it downloads `app-<version>.mjs` from the same release, checks its size and sha256,
   writes it as `.part`, renames it, and points `state.json` at it (the previous update's file
   goes). A version that failed to start, or that the player set aside, isn't downloaded again.

`UpdatePrompt` (`update-prompt.ts`) then opens a box over the entry screen or the home menu (never a
battle or an editor, and never over the on-screen keyboard): "Update ready". The app can't restart
itself (nx.js has no relaunch), so A closes it, to be opened again with the update, and B keeps
playing: the update runs at the next start. Each step goes to `native.log` (`[update]`).

For testing, an https URL in `sdmc:/switch/pokemon-showdown-nx/update-channel.txt` replaces the
latest release's manifest (a pre-release's, say); it still needs a valid signature.

## Building an update

`npm run build:nro` also writes `dist/nro/update/`: `app-<version>.mjs` and `update.json` (version,
file, assets id, size, sha256). The assets id is printed with the build; a build is reproducible, so
two builds of the same assets give the same id. `--app-version=x.y.z` overrides `package.json`'s
version (for test updates).

## Publishing

On a `v*` tag, CI checks that the tag is `v` + `package.json`'s version, signs `update.json` with
the `UPDATE_SIGNING_KEY` repository secret (`scripts/sign-update.mjs`, an ECDSA P-256 private key
in PEM) and attaches `update.json`, `update.json.sig` and `app-<version>.mjs` to the release next to
the `.nro`. Players with a `.nro` of the same assets get the code on their next start; the others
are told to download the new `.nro`.

The private key lives only in that secret (and its owner's copy). Losing it means a new key pair,
whose public key only a new `.nro` brings. To sign by hand: `node scripts/sign-update.mjs
--key=<file.pem>`.
