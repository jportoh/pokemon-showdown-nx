---
name: test-report
description: Record the user's console test results after a release into the local work lists. Use when the user reports what worked or failed on the console ("probé la v0.6.2", "funciona X, falla Y"), or asks to tick off pending tests.
argument-hint: "[v<x.y.z>]"
---

# Record a console test

Arguments: `$ARGUMENTS`. The lists' format is in [docs/agents/work-lists.md](../../../docs/agents/work-lists.md): read it first. The user's report is in the conversation.

## 1. Gather

1. **Release.** The argument, or the one the user names. Otherwise the latest (`gh release list --limit 1`): updates are mandatory, so the console runs it. Say which you assumed.
2. **What it carries.** `git log --oneline <previous-tag>..v<x.y.z>` gives the squash-merged PRs. An entry that names a branch instead of a PR: `gh pr list --state merged --head <branch> --json number` finds its PR.
3. Read `pending-tests.md`, every screenshot the user names (`references/images/`; ask them to copy it there if missing) and any crash report they mention.

## 2. Match

Assign every statement in the report, and every pending entry the release carries, to one class:

- **confirmed**: the user saw it work.
- **failed**: it doesn't work, or only part of it does. Split a partial one: the working part is confirmed, the rest failed.
- **untested**: the release carries it but the report doesn't mention it.
- **new**: a problem or wish no entry covers.

When a statement could match two entries, or it's unclear whether something worked, ask: all the questions in one message.

Done when every statement and every carried entry has exactly one class.

## 3. Write

1. `bugs-and-improvements.txt`: one new line at the end per **failed** part and per **new** problem, in Spanish, close to the user's words, citing the screenshot and where it was found ("test de v0.6.2, PR #90"). A **new** wish for something bigger goes to `features.txt` instead.
2. `pending-tests.md`:
   - **confirmed**: tick it and move it to the top of `## Confirmed`.
   - **failed**: remove it; its new list line carries it now, and the fix will add a fresh entry.
   - **untested**: move it from `## Waiting for the next release` to `## Shipped in v<x.y.z>, not yet confirmed on the console` (create the section after the waiting one), or leave it where it already is.
   - Drop a `## Shipped in …` section once it's empty.
3. The `HECHO` lines a confirmed entry came from get `, release v<x.y.z>` in their marker.
4. Project memories that call a confirmed change untested or pending a test: update them to "confirmed on v<x.y.z>".

## 4. Report

A few lines: what's confirmed, each failure with its new line number (ready for `/work-line <n>`), and what this release still leaves untested.
