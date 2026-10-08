# Branches, CI and releases

## Branches and pull requests

- `main` is protected: changes go in through pull requests, and the `build` check must pass.
- Work on a branch per change, named by kind: `feat/<name>`, `fix/<name>`, `docs/<name>`,
  `chore/<name>`.
- Pull requests are **squash-merged**: the PR title becomes the commit on `main`, so make it a clear
  sentence ("Teambuilder: skeleton placeholders while texts load"). Head branches are deleted after
  merging.
- Changes that affect what the player sees or how the app performs are confirmed on a console before
  merging ([brewser.md](brewser.md#testing-on-a-console)).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the whole contribution flow.

## CI

`.github/workflows/ci.yml` runs on every pull request, every push to `main` and every `v*` tag:

1. `npm ci`
2. `npm run build:brewser`: the Angular production build plus the console re-bundle and zip
   ([brewser.md](brewser.md#the-console-build)).
3. The zip is renamed after the commit (`brewser-<short sha>.zip`) or the tag
   (`brewser-vX.Y.Z.zip`) and **uploaded as a build artifact** (kept 30 days). Download it from the
   run's summary page and upload it to Brewser to test that exact commit.
4. On a tag, a **GitHub release** is published with the zip attached and notes generated from the
   merged pull requests.

CI doesn't run unit tests: the suite is almost empty for now (see
[CONTRIBUTING.md](../CONTRIBUTING.md#checks)). A passing build is the required check.

## Versioning and releases

Versions follow [semantic versioning](https://semver.org) (`0.y.z` while the app is young). The
version lives in `package.json`.

To release:

1. Open a PR that bumps `version` in `package.json` and `package-lock.json`
   (`npm version <x.y.z> --no-git-tag-version`), titled "Release x.y.z". Merge it.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. CI builds `brewser-vX.Y.Z.zip` and publishes the release. Upload that zip to Brewser, with the
   network allow-list ([brewser.md](brewser.md#network)) updated if the release talks to a new origin.

The repository's Releases page lists every version with its notes and zip.
