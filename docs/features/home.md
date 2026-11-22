# Home, loading and Trainer Card

## Loading screen (`/loading`)

`features/loading/components/loading-scene/loading-scene.ts`

Every launch starts here: the home route's guard sends the app to `/loading` until `AssetPreload`
says it's done. While a bar fills, the screen:

- downloads, decodes and uploads every image the app shows (`loading/data/preload-list.ts`: the item
  icon sheet, the move category icons and the bundled Champions sprite sheets). Decoding runs flat out
  (`SpriteBitmaps.rush`) and more textures are made per frame than on other screens, since a stutter
  costs nothing here;
- synthesizes the UI sounds and the menu theme, a slice per frame (`AudioEngine.prepare`);
- decodes the bundled battle music (`BattleMusic.preload`), waiting for it at most a few seconds;
- makes the on-screen keyboard's texts ahead (`CanvasKeyboard.warm`).

Then the logo flies to its place in the home screen's header and the entry screen (or the menu) takes over. It took about
3.7 s on the console when it was measured. The report of how long each part took shows in the L3 HUD.

**If you add an image every screen needs**, add it to the preload list, so no screen waits for it.

## Entry screen (`/start`)

`features/home/components/start-scene/start-scene.ts`

The menu is the player's, so it needs to know who they are first: the home route's guard sends the
app here unless a connection was asked for (Settings' automatic login) or the player chose to play
offline. The screen is built like the menu (the lit side, the trainer on their platform with a name
plate, slanted buttons, the logo in the same corner), so entering the menu only brings its buttons in
(`HomeMenu.fromEntry`). Its steps:

- **Welcome**, when Settings remembers a name: its last trainer (`ShowdownLogin.knownAvatar`), its
  ratings, the password and one button to continue; under an OR, another name, a guest or offline.
- **Doors**, otherwise: connect as a guest, log in, or **play offline** (`HomeMenu.offlineChosen`:
  the Teambuilder and Settings work without a connection).
- **Form**, from Log in or Another name: name, password, *Remember me* (on by default) and, on the
  console, *Log in automatically*. B goes back.

The menu opens once the server calls the player by a name. Logging out of the menu (ZR held) comes
back here, and so does a login left without a name (the automatic one refused). The shared drawing
(`core/gl/ui/menu-kit.ts`) is used by both screens.

## Home (`/`)

`features/home/`

| File | Role |
| --- | --- |
| `components/home-scene/home-scene.ts` | The scene: the player's trainer on a platform with a name plate (name, best rating, win rate), the menu as slanted buttons with Pokémon art, Settings at the top, the focused button's description and the controls |
| `components/start-scene/start-scene.ts` | The entry screen (above) |
| `core/gl/ui/menu-kit.ts` | What the menu and the entry screen share: the lit side, the trainer and name plate, slanted buttons, chips, fields, switches |
| `state/home-menu.ts` | The menu items, each with its colour per appearance, description and A's action |
| `state/home-summary.ts` | The live facts in each button's chips (format and team, a challenge, number of teams…) |
| `gl/login-view.ts` | The login box over other pages (`LoginView`) and registration (`RegisterView`) |
| `gl/login-overlay.ts` | The same login box opened over other pages (Chats, Watch Live) with ZR |
| `gl/logo-ball.ts` | The header's pixel-art Poké Ball |

The trainer is the screen's protagonist: the player's avatar at 5x (a faint Poké Ball offline), and a
button: A on it opens the Trainer Card (registered names) or registration. The buttons are slanted
quads (`QuadStyle.skew`) fading into each item's colour (`fillEnd`); Battle draws the player's
own team. The left side is lit by the palette's `hero` colour.

Controls: the d-pad and A open a page; **ZR** held down logs out (or disconnects) and goes back to
the entry screen; offline, ZR goes there to log in; **L** opens the Trainer Card or registration too;
**R3** opens the UI kit showcase (`/gl-kit`).

Adding a page to the menu means adding its item to `home-menu.ts`, its chips to the home scene,
and its route to `app.routes.ts`. Keep the layout in mind (Battle wide, two rows of two, Settings
at the top): a new page may belong inside an existing one (Replays lives under Settings, for example).

## Login

`LoginView` connects as a guest first, then lets the player claim their own name (a registered one
with its password). Fields type with the `CanvasKeyboard`, whose OK moves on to the next field. The
box closes itself once the server calls the player by a name. The login logic is `ShowdownLogin`
([showdown.md](../showdown.md#names-and-login)).

`RegisterView` registers the player's current unregistered name: password twice and Showdown's
"What is this Pokémon?" question.

## Trainer Card

`features/trainer-card/`

A Gen 3 style card: the avatar, the name, totals across every ladder (battles, wins, losses, win
rate) and the best ladder ratings, loaded each time it's shown.

| File | Role |
| --- | --- |
| `gl/trainer-card-view.ts` | The card and the avatar picker (10×4 avatars a page) |
| `state/ladder-ratings.ts` | A player's ratings from Showdown's ladder API |
| `state/player-details.ts` | Another player's name and avatar (`/cmd userdetails`) |
| `data/avatar-*.ts` | Showdown's avatar list and how its client resolves avatar names to sprites |

The card is shown for the player (from the home menu: A on the trainer, or **L**) and for a challenger (from the
Battle lobby). The player's own card links to the battle history (`/history?from=card`).

`avatar-aliases.ts` is copied from Showdown's client (`BattleAvatarNumbers` in
`battle-dex-data.js`); if Showdown adds avatars, update it from there.
