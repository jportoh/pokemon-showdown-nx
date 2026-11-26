---
name: ship-release
description: Cut and publish a new release of the app end to end (release PR, merge, tag, CI, verification). Only when the user types /ship-release.
argument-hint: "[x.y.z] [--baseline]"
disable-model-invocation: true
---

# Ship a release

Publish everything merged on `main` since the last tag as a new release. Typing `/ship-release` is the user's go-ahead to open the release PR, **squash-merge it**, push the tag and let CI publish. The process is in [docs/releases.md](../../../docs/releases.md) and baselines in [docs/updates.md](../../../docs/updates.md#baselines-and-asset-packs).

Arguments: `$ARGUMENTS`. A version (`0.7.0`) skips the version question; `--baseline` makes this release the new baseline without asking.

A release reaches every player: updates are mandatory, so the app installs it at its next start.

Rules for the whole run:

- `gh` is pinned to the `jportoh` account through `GH_CONFIG_DIR`. Never run `gh auth` commands. If `gh auth status` doesn't show `jportoh`, stop.
- Commits and PRs carry **no attribution lines** (no Co-Authored-By, no "Generated with Claude Code").
- Never merge anything but the release PR this run opened. Never delete, move or re-push a tag that was already pushed, and never force-push: if something breaks after the tag is pushed, stop and report.

## 1. Pre-flight

1. `gh auth status` shows `jportoh`. The working tree is clean (`git status --porcelain` is empty); if not, stop and say what's uncommitted.
2. `git fetch origin --tags`. Last tag: `git tag --sort=-v:refname | head -1`.
3. Changes to release: `git log --oneline <last-tag>..origin/main`. If empty, stop: nothing to release.
4. Open PRs (`gh pr list --state open`): list them as **not included**, so the user can stop and merge first if one should go in. Don't merge them.
5. `origin/main`'s CI is green: `gh run list --branch main --limit 1 --json conclusion,status,headSha`. If it failed, stop.

## 2. Version and baseline

**Version.** With a version argument, use it (it must be greater than the last tag). Otherwise propose one from the squash-merged PR titles since the last tag: a minor bump (`0.6.1` → `0.7.0`) if any is a new feature, otherwise a patch bump. Show the list of PRs and the proposal, and wait for the user's OK or another number.

**Baseline.** The current one is `tag` in `native/baseline.json`. Recommend a new one when either is true, and ask:

- The engine fingerprint changed since the baseline tag: `git diff <baseline-tag>..origin/main -- scripts/build-nro.mjs` touches `DEFAULT_ENGINE`, the `ENGINES` entries or `LOADER_GENERATION`. CI refuses to build a pack over a baseline with another engine, so a missed baseline fails the tag build.
- The latest release's pack is big: `gh release view <last-tag> --json assets` and the `assets-*.pack` asset is over 20 MiB.

With `--baseline`, don't ask. Otherwise, without either signal, keep the baseline and don't mention it. A new baseline means every player's app downloads the whole new `.nro` (about 170 MB) instead of a pack, and they open it once from the Homebrew Menu: say so when asking.

Ask the version and baseline questions together in one message.

## 3. Release PR

1. `git switch -c chore/release-<x.y.z> origin/main`
2. `npm version <x.y.z> --no-git-tag-version` (changes `package.json` and `package-lock.json`). For a baseline, set `"tag": "v<x.y.z>"` in `native/baseline.json`.
3. Commit `Release <x.y.z>` and `git push -u origin chore/release-<x.y.z>`.
4. `gh pr create --base main --title "Release <x.y.z>"` with a short body: the PRs going out (from step 1), and whether it's a new baseline.

## 4. Merge

1. Wait for the required check: `gh pr checks <n> --watch --required`. If `build` fails, read the log (`gh run view <run> --log-failed`), report and stop: don't merge.
2. `gh pr merge <n> --squash --delete-branch --subject "Release <x.y.z> (#<n>)"`.
3. Merge commit: `gh pr view <n> --json mergeCommit --jq .mergeCommit.oid`. `git switch main && git pull --ff-only`, and check `git show <sha>:package.json` has version `<x.y.z>`.

## 5. Tag

```bash
git tag v<x.y.z> <merge-sha>   # lightweight, like every earlier tag
git push origin v<x.y.z>
```

## 6. Watch CI

Find the tag's run (`gh run list --commit <merge-sha> --event push --json databaseId,headBranch` and pick the one whose `headBranch` is `v<x.y.z>`; wait a few seconds if it hasn't appeared) and `gh run watch <id> --exit-status`. It builds strictly, signs the update and publishes the release; it takes several minutes.

If it fails: `gh run view <id> --log-failed`, report the cause and stop. Known one: the strict build fails when Showdown's servers don't answer; the fix is `gh run rerun <id> --failed` once they're back, which the user decides.

## 7. Verify

1. `gh release view v<x.y.z> --json tagName,isLatest,assets`: it's the latest, and its assets include `pokemon-showdown-v<x.y.z>.nro`, `update.json`, `update.json.sig`, `app-<x.y.z>.mjs` and `assets-<x.y.z>.json` (and an `assets-*.pack` unless it's the baseline).
2. Download `update.json` (`gh release download v<x.y.z> -p update.json -D <scratchpad>`) and check its `version` is `<x.y.z>`.

## 8. Report

A few lines: the version and release URL, the PRs it carries, baseline or not (with the new-`.nro` note for a baseline), the pack size, and that the user's console will install it at its next start.
