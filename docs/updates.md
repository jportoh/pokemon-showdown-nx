# Online updates

The `.nro` can run a newer copy of the app's code that it finds on the SD card, so a bug fix or a
format change doesn't need everyone to copy a new `.nro`. Only the code changes this way (~2 MB);
the engine, the icon and the assets (sprites, audio: most of the `.nro`'s size) still come with a new
`.nro`. The engine features this relies on were checked on a console first
([native.md](native.md#online-updates-probe-test-u1-2026-11-23)).

**Status:** the loader is built and confirmed on a console (test u2: an update runs and confirms, a broken, crashing or foreign one falls back; loading takes ~1 s from the SD card as from the RomFS). Downloading updates from the GitHub releases, checking
their signature and telling the player come next.

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

## Building an update

`npm run build:nro` also writes `dist/nro/update/`: `app-<version>.mjs` and `update.json` (version,
file, assets id, size, sha256). The assets id is printed with the build; a build is reproducible, so
two builds of the same assets give the same id. `--app-version=x.y.z` overrides `package.json`'s
version (for test updates).
