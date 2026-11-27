---
name: work-line
description: Take one or more lines of the local work lists (bugs-and-improvements.txt, features.txt) from the request to a pushed branch with an open PR. Use when the user names a list line to do, like "línea 87", "L87", "lines 54-57" or "features L22".
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
3. For a UI bug fix or feature (anything the player sees), take the PR's screenshots while you're there (see [Screenshots](#screenshots)): the state the line describes, **before** and **after**. A bug's console capture from `references/images/` is the best "before"; otherwise shoot the same steps with `origin/main`'s version of the changed files swapped in for a moment, then restore them (`git checkout -- <files>`).

Done when the build is green, every line's described problem is gone in the browser (or, for console-only behaviour, the reason it can only be checked there is noted for step 5), and a UI change has its before/after screenshots.

## 5. Record it

1. Mark each line `[HECHO <today>, <branch>]`.
2. Add one entry per change the player will notice under `## Waiting for the next release` in `pending-tests.md`: concrete steps to check on the console, and the branch.

Done when every worked line is marked and every visible change has its pending test.

## 6. Commit, push and open the PR

1. One commit (more only when the lines are unrelated), its subject a clear sentence like a PR title ("Battle: field view shows both Mega partners"). No attribution lines.
2. For a UI change, push the screenshots to the `pr-screenshots` branch first (see [Screenshots](#screenshots)).
3. `git push -u origin <branch>`, then open its PR with `gh pr create --base main` (a short body: the lines it covers and what changed; no attribution lines). A UI change's body ends with a `## Screenshots` section: before, then after, each with one line on the state shown, so the reviewer can comment before the console test. Never merge it: the user does.
4. Save or refresh a project memory for the work: lines, branch, commit, PR number, "untested".

## 7. Report

A few lines: the lines done, the branch, commit and PR link, what to check on the console (the pending-tests entries), and anything left out or found along the way.

## Screenshots

Use the Chrome extension (`/run`) when it's connected. Otherwise drive the installed Chrome headless with [screenshot.mjs](screenshot.mjs) (no install needed):

1. Start the dev server (`npm start`) and, in the background, Chrome:
   `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --remote-debugging-port=9333 --user-data-dir=<scratchpad>/chrome-prof --window-size=1280,720 --use-angle=swiftshader --enable-unsafe-swiftshader about:blank`
2. Reach the state with steps, taking a `shot:` after each few to check where you are (a key pressed during a load can be lost: look, then continue). From a fresh profile: `nav:http://localhost:4200/`, `key:Enter` (title), `key:ArrowDownx2` `key:Enter` (Play Offline), then the home menu. Seed what the state needs with `eval:` (teams are `psb.teams.v1` in `localStorage`, set before reloading). Example: `node .claude/skills/work-line/screenshot.mjs "key:Enter" "wait:1500" "key:e" "shot:<scratchpad>/after.png"`.
3. Look at every shot before using it. Crop the part that changed (PowerShell `System.Drawing`) and keep one full screen. Headless Chrome uses a fallback font, narrower than the console's: when that changes what the shot shows (e.g. an overlap that only touches), say so in the PR.
4. Host them on the orphan branch `pr-screenshots`, never on the feature branch: in a temporary worktree (`git worktree add --detach <scratchpad>/pr-shots`, then `git switch pr-screenshots`, or `git switch --orphan pr-screenshots` if it doesn't exist yet), copy them to `pr-<n>/` (`pr-<branch>/` before the PR has a number), commit "Screenshots for PR #<n>", push, remove the worktree. Link them in the body as `https://raw.githubusercontent.com/jportoh/pokemon-showdown-nx/<that commit>/pr-<n>/<file>` (the repo is public).
5. Stop the dev server and Chrome when done.
