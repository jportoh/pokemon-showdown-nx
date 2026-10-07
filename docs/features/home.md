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

Then the logo flies to its place in the home screen's header and the menu takes over. It took about
3.7 s on the console when it was measured. The report of how long each part took shows in the L3 HUD.

**If you add an image every screen needs**, add it to the preload list, so no screen waits for it.

## Home (`/`)

`features/home/`

| File | Role |
| --- | --- |
| `components/home-scene/home-scene.ts` | The scene: header (logo, connection, name, avatar), menu tiles, footer (controls legend, players and battles online) |
| `state/home-menu.ts` | The menu items: Battle and Random Battle as big tiles, four smaller ones |
| `state/home-summary.ts` | The live line under each tile (format and team, a challenge, number of teams…) |
| `gl/login-view.ts` | The login box (`LoginView`) and registration (`RegisterView`) |
| `gl/login-overlay.ts` | The same login box opened over other pages (Chats, Watch Live) with ZR |
| `gl/logo-ball.ts` | The header's pixel-art Poké Ball |

Controls: the d-pad and A open a page; **ZR** opens the login box (connecting as a guest) or, held
down, disconnects; **L** opens the Trainer Card (registered names) or registration; **R3** opens the
UI kit showcase (`/gl-kit`).

Adding a page to the menu means adding its item to `home-menu.ts`, its line to `home-summary.ts`
and its route to `app.routes.ts`. Keep the layout of 2 big + 4 small tiles in mind: a new page may
belong inside an existing one (Replays lives under Settings, for example).

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

The card is shown for the player (from the home menu, with **L**) and for a challenger (from the
Battle lobby). The player's own card links to the battle history (`/history?from=card`).

`avatar-aliases.ts` is copied from Showdown's client (`BattleAvatarNumbers` in
`battle-dex-data.js`); if Showdown adds avatars, update it from there.
