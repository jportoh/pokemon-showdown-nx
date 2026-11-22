# Settings (`/settings`)

`features/settings/components/settings-scene/settings-scene.ts`, `core/settings/app-settings.ts`

In the menu's style: the groups (Look, Sound, Battles, Account, History) as slanted buttons on the
left, each with a chip that sums up its values, and the focused group's settings in a panel on the
right, each with its own control (a switch, a volume's bars, the themes' swatches, ◀ value ▶). Right
or A goes into a group; left/right change a value; A flips a switch or opens the battle history or
the replays; B goes back to the groups, then to the menu. The page header is `PageBar.drawHeader`
(the menu-style header: icon and title, our name, a round Back), the pieces are `core/gl/ui/menu-kit.ts`.

## The settings

`AppSettings` holds them in a signal and saves them on every change (`psb.settings.v1`, through
`device-storage`).

| Setting | Values | Used by |
| --- | --- | --- |
| `theme` | Sapphire, Night, Graphite, Emerald, Poké Ball, Sunset (Plum, replaced by Graphite, loads as it) | `GlTheme` (every screen) |
| `musicVolume`, `soundVolume` | 0–100 in steps of 10 | `AudioEngine` |
| `battleFormat` | `PLAYABLE_FORMATS` | The Battle lobby's starting format, Watch Live |
| `teamFormat` | `TEAM_FORMATS` | New teams |
| `allowSpectators` | on/off | `/inviteonlynext` before each search or challenge |
| `saveReplays` | on/off | `ReplayAutoSave` |
| `rememberName` | on/off | `SavedLogin` (the login box's name) |
| `autoLogin` | on/off | `SavedLogin` / `ShowdownLogin.logInSaved` (registered names only, password on the SD card) |

## Adding a setting

1. Add the field to `Settings`, its default to `DEFAULTS`, and its validation to `loadSettings` in
   `app-settings.ts`. `loadSettings` checks every saved value and falls back to the default for one
   that's missing or no longer valid, so settings saved by older versions keep loading.
2. Add a row in `SettingsScene.rows` (its label, a one-line detail, its value, and `kind`: `cycle`,
   `toggle` or `link`) and handle it in `change`.
3. Read it where it's used with `inject(AppSettings).settings().yourSetting`.

## Adding a theme

1. Add its id and name to `THEMES` in `app-settings.ts`.
2. Add its palette to `THEME_HEX` in `core/gl/ui/gl-theme.ts`, with every role.
3. **Check WCAG AA contrast** (4.5:1 for text): `ink` and `muted` on `panel` and `select`, white on
   `accent`, and `accentText`, `danger` and `teal` on `panel` and `bar`. The comment above `THEME_HEX`
   lists the pairs.
4. Look at every screen in the new theme, including the battle screen and modals.
