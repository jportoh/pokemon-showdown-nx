---
name: work-line
description: Take one or more lines of the local work lists (bugs-and-improvements.txt, features.txt) from the request to a pushed branch. Use when the user names a list line to do, like "línea 87", "L87", "lines 54-57" or "features L22".
argument-hint: "<line(s)> [features] [--on <branch>]"
---

# Work a list line

Arguments: `$ARGUMENTS`. The lists' format (line numbers, markers, `pending-tests.md`) is in [docs/agents/work-lists.md](../../../docs/agents/work-lists.md): read it first.

## 1. Read the request

1. Re-read the file and find each named line. If a line already has `HECHO` or `ZANJADO`, or reads like something else than the user described, stop and quote it back.
2. Open every screenshot or log the line cites (`references/images/`, `references/crash-reports/`). If one is missing, ask the user to copy it there.
3. When a line asks for a new screen or layout with several reasonable looks, show the options (mockups) and let the user choose before building. Bugs and clear-cut changes go straight on.

Done when, for every line, you can name the screen(s) it touches, the files to change and what the user will see differently.

## 2. Branch

1. The working tree is clean (`git status --porcelain`); otherwise stop and say what's uncommitted.
2. `git fetch origin` and `git switch -c <kind>/<name> origin/main`: `fix/` for a bug, `feat/` for a feature, a short kebab name of the change. Lines the user names together share one branch.
3. Base it on another branch only with `--on <branch>` or when the change needs work that isn't on `main` yet; say which and why.

## 3. Build it

Follow [CLAUDE.md](../../../CLAUDE.md) and the docs it points to ([ui-kit](../../../docs/ui-kit.md), [input](../../../docs/input.md), [rendering](../../../docs/rendering.md)). Every screen works with the controller **and** the touchscreen, in the light and dark themes.

## 4. Verify

1. `npm run build` passes with no new errors or warnings.
2. For a change the player can see, look at it running in the browser at 1280x720 (`/run`), in the state the line describes.

Done when the build is green and every line's described problem is gone in the browser (or, for console-only behaviour, the reason it can only be checked there is noted for step 5).

## 5. Record it

1. Mark each line `[HECHO <today>, <branch>]`.
2. Add one entry per change the player will notice under `## Waiting for the next release` in `pending-tests.md`: concrete steps to check on the console, and the branch.

Done when every worked line is marked and every visible change has its pending test.

## 6. Commit and push

1. One commit (more only when the lines are unrelated), its subject a clear sentence like a PR title ("Battle: field view shows both Mega partners"). No attribution lines.
2. `git push -u origin <branch>`. The user opens PRs by hand: open one only when asked.
3. Save or refresh a project memory for the work: lines, branch, commit, "pushed, PR by hand, untested".

## 7. Report

A few lines: the lines done, the branch and commit, what to check on the console (the pending-tests entries), and anything left out or found along the way.
