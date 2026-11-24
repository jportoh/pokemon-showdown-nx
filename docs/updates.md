# Online updates

The `.nro` can run a newer version of the app that it downloads by itself: its code (~2 MB) and the
assets that changed since a **baseline** `.nro` (an **asset pack**: say, a sprite sheet with a new
regulation's Pokémon). So a bug fix, a format, a regulation's new Pokémon or a gimmick don't need
everyone to copy a new `.nro`. Only a new engine needs one, or a new baseline now and then. The
engine features this relies on were checked on a console first
([native.md](native.md#online-updates-probe-test-u1-2026-11-23)); the app can't replace its own
`.nro` (test u4), so assets come this way too.

**Status:** the loader (test u2), the updater and its prompt (test u3) and asset packs (test u5: a
packed asset served, a lost pack fetched again, going back to the .nro) are confirmed on a console.

## The loader

The RomFS holds the loader, the app and the app's asset list:

- `main.js`: the loader (`native/loader/main.ts`), a few KiB that import nothing of the app.
- `app.mjs`: the app itself (the native shims, Angular's bundle, `after-app.ts`).
- `assets.json`: every asset's sha256 by its RomFS path, the engine's, and the build's fingerprint
  (assets id).

An update lives in `sdmc:/switch/pokemon-showdown-nx/update/` (`native/update/boot-state.ts`): the
bundle `app-<version>.mjs` (the engine's `import()` takes no `?query`, so the version goes in the
name), the folder `assets-<hash>/` with its pack's files at their RomFS paths, and `state.json`,
which says which bundle to run and which assets it brought. The loader runs the update when:

- the updater checked it against **this `.nro`** (`state.json`'s assets id is this `.nro`'s): a
  newer `.nro` copied over doesn't run an update checked against the old one;
- it is **newer** than the `.nro`'s own code (semver), so installing a newer `.nro` makes it obsolete;
- it hasn't **failed** before, and hasn't started `MAX_BOOT_ATTEMPTS` (2) times without confirming;
- every file of its pack is on the SD card.

Then it wraps `fetch` (`native/loader/asset-redirect.ts`) so the app's relative URLs for the packed
files read the SD card's copies, and imports the bundle. Otherwise it runs `app.mjs`, and removes an
update that can never run here. It leaves `globalThis.psbBoot` (which code runs, its version and
source); the L3 + R3 HUD and Settings (More › App version) show it.

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
- Settings › More › App version: while an update runs, A goes back to the `.nro`'s version (that
  update isn't downloaded again; a newer one is).

## The updater

`AppUpdater` (`src/app/core/update/app-updater.ts`, SD card work in `update-files.ts`) runs once per
start, a second after the loading screen (the entry screen leaves the main thread mostly idle for its
TLS handshakes), on the console only:

1. It reads the latest release's `update.json` and `update.json.sig`
   (`github.com/<repo>/releases/latest/download/…`; pre-releases are never "latest") and checks the
   ECDSA P-256 signature with the public key in `update-config.ts`. Ed25519 would be smaller, but
   the engine's `crypto.subtle` doesn't have it.
2. Nothing to do when the version isn't newer than the running code, or it is already downloaded
   (or failed, or was set aside) for this `.nro`.
3. It reads the release's asset list (`assets-<version>.json`, checked against the manifest) and
   compares it with the `.nro`'s own `assets.json`: the update can run here when the engine is the
   same and each asset its code expects is in this RomFS with the same hash, or in its pack.
   Otherwise the player is told once per version to get the new `.nro`, with the releases page. A
   `.nro` from before asset packs (no `assets.json`) only takes a release with exactly its assets.
4. It downloads the pack straight to the SD card, checking each 4 MiB block against the manifest's
   hashes as it arrives (a pack never sits whole in memory; ~1.7 MiB/s), unpacks it into
   `assets-<hash>.part/` and renames that folder; a pack already unpacked (the same one as the last
   update's) isn't downloaded again.
5. It downloads `app-<version>.mjs`, checks its size and sha256, writes it as `.part`, renames it,
   points `state.json` at it and its assets, and removes the previous update's files.

`UpdatePrompt` (`update-prompt.ts`) then opens a box over the entry screen or the home menu (never a
battle or an editor, and never over the on-screen keyboard): "Update ready". The app can't restart
itself (nx.js has no relaunch), so A closes it, to be opened again with the update, and B keeps
playing: the update runs at the next start. Each step goes to `native.log` (`[update]`).

For testing, an https URL in `sdmc:/switch/pokemon-showdown-nx/update-channel.txt` replaces the
latest release's manifest (a pre-release's, say); it still needs a valid signature.

## Baselines and asset packs

`native/baseline.json` names the **baseline** release: the `.nro` the asset packs are made against.

- `"tag": null`: no baseline. Each release's update carries no pack, so it only runs on a `.nro`
  with exactly its assets (a code-only change).
- `"tag": "vX.Y.Z"`: each later release's pack holds the assets that differ from that release's
  `.nro` (`assets-X.Y.Z.json`, downloaded from its release once and kept in `dist/nro-cache`). Packs
  are cumulative: each one has everything changed since the baseline, so a player only needs the
  latest. A release whose own tag is the baseline's is the baseline (no pack).

**Cutting a new baseline:** in the release's PR, set `tag` to that release (`"v0.5.0"` for 0.5.0).
Do it when the engine changes (the build refuses a pack over a baseline with another engine), and
when the packs grow big. Players on an older `.nro` are told to get the new one.

**Sprites for a new regulation:** `npm run update:sprites` only appends: the sheets already made stay
byte for byte as they are and the new species go on new sheets, so a pack carries just those.
`npm run update:sprites -- --repack` packs everything again (every sheet changes): only for a new
baseline.

## Building an update

`npm run build:nro` also writes `dist/nro/update/`:

- `app-<version>.mjs`: the code;
- `assets-<version>.json`: the asset list (and which assets are packed);
- `assets-<hash>.pack`: the pack, when an asset differs from the baseline (`PSBPACK1`, the header's
  length, a JSON header with each file's path, offset and size, then the files);
- `update.json`: the manifest (version, the bundle's size and sha256, the engine, the asset list's
  size and sha256, the pack's size and its blocks' sha256).

A build is reproducible: two builds of the same assets give the same assets id. `--app-version=x.y.z`
overrides `package.json`'s version, `--baseline=<assets json>` uses a local baseline list and
`--baseline=none` builds without one (for test updates).

## Publishing

On a `v*` tag, CI checks that the tag is `v` + `package.json`'s version, builds (downloading the
baseline's asset list), signs `update.json` with the `UPDATE_SIGNING_KEY` repository secret
(`scripts/sign-update.mjs`, an ECDSA P-256 private key in PEM; every push to `main` checks it is the
pair of the app's public key) and attaches everything in
`dist/nro/update/` to the release next to the `.nro`.

The private key lives only in that secret (and its owner's copy). Losing it means a new key pair,
whose public key only a new `.nro` brings. To sign by hand: `node scripts/sign-update.mjs
--key=<file.pem>`.
