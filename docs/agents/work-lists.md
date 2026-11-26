# Work lists

The maintainer keeps the day-to-day work in three local files under `references/files/` (gitignored, so they exist only on the maintainer's machine). `/work-line` and `/test-report` read and write them; this file is their single source of truth on the format.

| File | Holds | Language |
| --- | --- | --- |
| `bugs-and-improvements.txt` | bugs and small improvements | Spanish (the user's words) |
| `features.txt` | features and larger work | Spanish (the user's words) |
| `pending-tests.md` | changes nobody has confirmed on a console yet | English |

Screenshots from the console's album live in `references/images/` (named like `2026112418222000_s.jpg`); crash logs and Atmosphère reports in `references/crash-reports/`.

## Line numbers

The user names items by the **line number** of the file (1-based): "L87", "línea 87", "lines 54-57". A bare number means `bugs-and-improvements.txt`; "features L22" means `features.txt`. The files get edited between sessions, so re-read the file right before acting on a number, and check the line says what the user is talking about.

New lines go at the **end** of the file, so every existing number stays valid. Never reorder, merge or renumber lines.

## Markers

Each line is `- <text>`, open while it has no marker. Work changes only the marker prefix; the user's text stays untouched.

- `[HECHO <YYYY-MM-DD>, <branch>]`: done on that branch. Add `, release v<x.y.z>` once a release carries it.
- `[STANDBY <date>, <why>]`: parked until something happens again.
- `[BLOCKED]`: can't be done for now (engine limit, hardware).
- `[SPIKE IN PROGRESS]`: an analysis is under way.
- `[ZANJADO: <reason>]`: closed without a change (not a bug, user error, won't do).

A new line written by an agent follows the same shape, in Spanish, and names its origin: the screenshot, and the release, PR or branch it was found on.

## pending-tests.md

Sections, in order:

- `## Waiting for the next release`: committed or in a PR, not released yet.
- `## Shipped in v<x.y.z>, not yet confirmed on the console`: one section per release that still has open entries.
- `## First run`, `## Postponed by the user`, `## Standby`: entries the user set aside.
- `## Confirmed`: the log of ticked entries, newest first.

An entry is `- [ ] <what to check, as steps the user can see on the console> — <PR #n or branch> — <release, once known>`, wrapped at about 110 columns with a 6-space indent. A ticked one is `- [x] … — confirmed <YYYY-MM-DD> on v<x.y.z>`.
