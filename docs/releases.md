# Branches, CI and releases

## Branches and pull requests

- `main` is protected: changes go in through pull requests, and the `build` check must pass.
- Work on a branch per change, named by kind: `feat/<name>`, `fix/<name>`, `docs/<name>`,
  `chore/<name>`.
- Pull requests are **squash-merged**: the PR title becomes the commit on `main`, so make it a clear
  sentence ("Teambuilder: skeleton placeholders while texts load"). Head branches are deleted after
  merging.
- Changes that affect what the player sees or how the app performs are confirmed on a console before
  merging ([native.md](native.md#testing-on-a-console)).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the whole contribution flow.

## CI

`.github/workflows/ci.yml` runs on every pull request, every push to `main` and every `v*` tag:

1. `npm ci`
2. `npm run build:nro`: the Angular production build packaged as the Switch app
   ([native.md](native.md#building-it)).
3. The `.nro` is renamed after the commit (`pokemon-showdown-<short sha>.nro`) or the tag
   (`pokemon-showdown-vX.Y.Z.nro`) and **uploaded as a build artifact** (kept 30 days). Download it
   from the run's summary page and copy it to the console's `sdmc:/switch/` to test that exact commit.
4. On a tag, a **GitHub release** is published with the `.nro` attached and notes generated from the
   merged pull requests.

CI doesn't run unit tests: the suite is almost empty for now (see
[CONTRIBUTING.md](../CONTRIBUTING.md#checks)). A passing build is the required check.

## Versioning and releases

Versions follow [semantic versioning](https://semver.org) (`0.y.z` while the app is young). The
version lives in `package.json`.

To release:

1. Open a PR that bumps `version` in `package.json` and `package-lock.json`
   (`npm version <x.y.z> --no-git-tag-version`), titled "Release x.y.z".
   To make this release a new **baseline** for the online updates' asset packs (a new engine,
   or packs grown big; see [updates.md](updates.md#baselines-and-asset-packs)), set `tag` in
   `native/baseline.json` to `vx.y.z` in the same PR. Merge it.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. CI builds `pokemon-showdown-vX.Y.Z.nro`, signs the online update and publishes the release with
   both: players' apps download the code (and the asset pack) by themselves.

The repository's Releases page lists every version with its notes and `.nro`. Releases up to v0.3.0
also shipped a zip for the Brewser browser; that build lives on in the `brewser-support` branch.
