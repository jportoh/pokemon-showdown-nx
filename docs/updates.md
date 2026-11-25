# Online updates

The `.nro` runs the latest version of the app, which it downloads by itself: its code (~2 MB) and the
assets that changed since a **baseline** `.nro` (an **asset pack**: say, a sprite sheet with a new
regulation's Pokémon). So a bug fix, a format, a regulation's new Pokémon or a gimmick don't need
everyone to copy a new `.nro`. Only a new engine or loader needs one, or a new baseline now and then,
and the app downloads that too ("A new .nro", below).
The engine features this relies on were checked on a console first
([native.md](native.md#online-updates-probe-test-u1-2026-11-23)); the app can't replace its own
`.nro` (test u4), so assets come this way too.

**Updates are mandatory.** Before any of the app's code runs, the **update gate** checks the latest
release and installs it, on its own screen; then the app starts with it, in the same start (no
restart). Nobody plays online with an older version: when the gate can't make sure (no connection,
GitHub not answering, a version that needs a new `.nro`), the player can try again or play offline.

**Status:** the loader (test u2) and asset packs (test u5) are confirmed on a console; the gate
drawing before the app and handing the screen over was probed in test u6 (2026-11-25: the app gets
the same WebGL2 context and runs normally after it). The gate itself (v0.6.0) is pending its test.

## The loader

The RomFS holds the loader, the app and the app's asset list:

- `main.js`: the loader (`native/loader/`), with the update gate, and nothing of the app.
- `app.mjs`: the app itself (the native shims, Angular's bundle, `after-app.ts`).
- `assets.json`: every asset's sha256 by its RomFS path, the engine's fingerprint (the engine and
  the loader's generation, `LOADER_GENERATION` in `scripts/build-nro.mjs`), and the build's
  fingerprint (assets id).

An update lives in `sdmc:/switch/pokemon-showdown-nx/update/` (`native/update/boot-state.ts`): the
bundle `app-<version>.mjs` (the engine's `import()` takes no `?query`, so the version goes in the
name), its pack `assets-<hash>.pack`, kept whole, and `state.json`, which says which bundle and pack
to run. A start goes:

1. **The gate** (`native/loader/gate.ts`, its screen `gate-screen.ts`, the work in
   `native/update/updater.ts`) checks the latest release (below) and installs it when it's newer
   than the code this console has.
2. **The loader** (`native/loader/main.ts`) runs the update when:
   - the updater installed it for **this `.nro`** (`state.json`'s assets id is this `.nro`'s): a
     newer `.nro` copied over doesn't run an update checked against the old one;
   - it is **newer** than the `.nro`'s own code (semver), so installing a newer `.nro` makes it
     obsolete;
   - it hasn't **failed** before, and hasn't started `MAX_BOOT_ATTEMPTS` (2) times without
     confirming;
   - its pack is on the SD card.

   Then it reads the pack's table of contents and wraps `fetch` (`native/loader/asset-pack.ts`) so
   the app's relative URLs for the packed files get their bytes out of the pack, and imports the
   bundle. Otherwise it runs `app.mjs`, and removes an update that can never run here.

The loader leaves `globalThis.psbBoot`: which code runs, its version and source, and whether it runs
**offline** (and why); the L3 + R3 HUD and Settings (More › App version) show it. Offline,
`ShowdownConnection` doesn't connect and says why.

## The gate's screen

The gate draws on the screen's WebGL2 context before the app does (test u6: drawing with a 2D
context first leaves the screen without WebGL2, so the app couldn't start). Its texts go on one
texture, drawn on an `OffscreenCanvas` and uploaded when they change; the progress bar is drawn as
rectangles each frame. When it's done it deletes everything it made, unbinds and clears, and the app
takes the same context over. It reads A and B from the controller (`navigator.getGamepads()`).

- **Checking for updates…** (a sliding bar): ~1.5 s at each start (two https requests).
- **Downloading version x.y.z**, with MB and a bar, then **Installing**, then the app starts.
- **Couldn't check for updates** (no connection, a timeout, an invalid signature): A Try again, B
  Play offline. GitHub not answering counts too, even when Showdown would.
- **Downloading the new app, version x.y.z**, then **Version x.y.z is ready**: a new `.nro` (below);
  A Close, nothing else.
- **Version x.y.z needs a new .nro** (a release without its `.nro` in the manifest): where to get
  it; A Check again, B Play offline.
- **Version x.y.z didn't start**: an update that failed to start on this console (below); A Download
  again, B Play offline with the newest code that works.

Offline runs the newest code the console has that can run, and Showdown stays unreached until the
app is opened again.

## Starting safely

- Each start of an update counts one attempt in `state.json`. Once Angular has bootstrapped
  (`src/main.ts` sets `psbAppBooted`) and 6 s pass with no uncaught error,
  `native/app/boot-confirm.ts` confirms it and the counter goes back to 0. A start that crashes,
  freezes or kills the engine never confirms: after two, the loader marks it failed and the gate
  offers to download it again.
- If the update's file can't be loaded (missing, a syntax error), the loader marks it failed and runs
  `app.mjs` in the same start; if its pack can't be read, it's removed (the next gate downloads it).
- If it fails after it started running (`native/app/boot-start.ts`, the bundle's first module, sets
  `psbBoot.evaluating`), part of it already ran, so a second copy on top isn't safe: the loader marks
  it failed and closes the app (`Switch.exit()` takes effect after the current task, so the loader
  returns right after it).

## The updater

`checkAndUpdate` (`native/update/updater.ts`, SD card work in `update-files.ts`), run by the gate:

1. It reads the latest release's `update.json` and `update.json.sig`
   (`github.com/<repo>/releases/latest/download/…`; pre-releases are never "latest"), 10 s at most
   each, and checks the ECDSA P-256 signature with the public key in `update-config.ts`. Ed25519
   would be smaller, but the engine's `crypto.subtle` doesn't have it.
2. Nothing to do when the version isn't newer than the newest code the console can run. If it's the
   update on the SD card that failed to start, the player chooses (above).
3. It reads the release's asset list (`assets-<version>.json`, checked against the manifest) and
   compares it with the `.nro`'s own `assets.json`: the update can run here when the engine
   fingerprint is the same (the engine and the loader's generation) and each asset its code expects
   is in this RomFS with the same hash, or in its pack. Otherwise the gate says to get the new `.nro`.
4. It downloads the pack straight to the SD card as `.part`, checking each 4 MiB block against the
   manifest's hashes as it arrives (a pack never sits whole in memory; ~1.7 MiB/s), renames it, and
   checks its table of contents lists exactly the asset list's packed files. A pack already there
   (named after its hash) isn't downloaded again. It is never unpacked: writing v0.5.1's 5,744 small
   files to the SD card one by one took minutes.
5. It downloads `app-<version>.mjs`, checks its size and sha256, writes it as `.part`, renames it,
   points `state.json` at it and its pack, and removes the previous update's files.

Each step goes to `native.log` (`[update]`, the gate's own lines as `[ loader]`).

For testing, a URL in `sdmc:/switch/pokemon-showdown-nx/update-channel.txt` replaces the latest
release's manifest: a pre-release's, or a PC on the local network serving a test build over plain
http (`node scripts/serve-update.mjs <folder>`). It still needs a valid signature, and the signed
manifest holds the hashes of everything it points to, so http doesn't weaken it.

## A new .nro

A release whose code can't run on the player's `.nro` (another engine or loader generation, assets
its pack doesn't bring) brings its own `.nro`: `update.json`'s `nro` names
`pokemon-showdown-v<version>.nro` (as CI publishes it) with its size and 4 MiB blocks' sha256
(`scripts/build-nro.mjs`, `addNroToManifest`). The app can't replace the `.nro` it runs from (test
u4), and a HOME menu forwarder always opens the same path (test u8: `Switch.argv[0]` is the
forwarder's `.nro`, `sdmc:/switch/pokemon-showdown.nro`), so the handover goes
(`native/update/nro-files.ts`, state in `sdmc:/switch/pokemon-showdown-nx/nro.json`):

1. **The old `.nro`'s gate** downloads the new one next to itself, to
   `sdmc:/switch/pokemon-showdown-v<version>.nro` (as `.part`, each block checked, renamed when
   complete: the Homebrew Menu never lists half of one; 128 MiB in ~50–60 s), and notes the path
   the forwarder opens (its own). Then, and at every later start (a newer versioned `.nro` on the SD
   card is enough, no network needed), it only says to close and open the new version once from
   the Homebrew Menu: **A Close**, no playing offline.
2. **The new `.nro`, opened from its versioned name**, renames the old one to
   `pokemon-showdown.nro.old` and copies itself over `pokemon-showdown.nro` (as `.part`, read back
   and checked, ~20 s), then starts as usual. If the copy fails, the old one goes back in place.
3. **Opened from the forwarder again**, once it started well (`native/app/boot-confirm.ts`), it
   removes its versioned copy, the `.old` and any older versioned `.nro`. Without a forwarder (the
   app opened from a versioned name), there's nothing to copy over and only older versions go.

Test u9 (2026-11-25) went through all of it on a console: the download kept native memory flat
(390–460 MiB) once the gate stopped redrawing its whole texture for each chunk (the first try ran
the engine out of native memory half way: a null pointer in nx.js).

## Baselines and asset packs

`native/baseline.json` names the **baseline** release: the `.nro` the asset packs are made against.

- `"tag": null`: no baseline. Each release's update carries no pack, so it only runs on a `.nro`
  with exactly its assets (a code-only change).
- `"tag": "vX.Y.Z"`: each later release's pack holds the assets that differ from that release's
  `.nro` (`assets-X.Y.Z.json`, downloaded from its release once and kept in `dist/nro-cache`). Packs
  are cumulative: each one has everything changed since the baseline, so a player only needs the
  latest. A release whose own tag is the baseline's is the baseline (no pack).
  Players may also have the `.nro` of a release published after the baseline, so the pack brings
  too every asset that differs from any of those (the build lists them from the repository's
  releases): CI fetches Showdown's files fresh, and one that changed in a release and back in the
  next (v0.4.1's `winona.png`) would otherwise leave that `.nro` asking for a new one (v0.5.0).

A release's CI build is **strict** (`--strict`, on by itself for tags): if Showdown doesn't answer
and a file it should bundle can't be downloaded, the build fails instead of shipping a `.nro`
without it (v0.5.0 was built during an outage and bundled none of the Gen 1–5 sprites). Run the
job again once Showdown is back.

**Cutting a new baseline:** in the release's PR, set `tag` to that release (`"v0.5.0"` for 0.5.0).
Do it when the engine or the loader's generation changes (the build refuses a pack over a baseline
with another engine fingerprint), and when the packs grow big. Players on an older `.nro` are told
to get the new one. v0.6.0 is one: loader generation 2 (the gate, packs read in place).

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
