# Battle (`/battle`)

`features/battle/`

The largest feature: playing a battle, watching one live and playing back replays, all on the same
screen and the same code. How battles reach the screen (connections, `BattleStore`, choices) is in
[showdown.md](../showdown.md#battles); this page covers the screen.

## Structure

```
battle/
  components/
    battle-screen/       BattleScreen: starts the battle, forfeit, rematch, next game of a set, leaving
    gl-battle-screen/    GlBattleScreen: the scene; lays out the field and the panels, routes input
  gl/                    the field: sprites, camera, weather, move animations
    screen/              the panels drawn over the field: top bar, command bar, party, Battle info…
  state/                 BattleStore (protocol → state), BattleChoices, BattleSession, series, team preview
  live/                  connections to server rooms (playing, spectating), side swap
  replay/                the replay connection
  models/                battle types: Pokémon, sides, field events, the BattleConnection interface
  audio/                 cries
```

A battle takes the whole stage, with no page bar. **The route can't be left while a battle is open**
(`canDeactivate` in `app.routes.ts`): the screen closes the battle before navigating away.

## The screen

`GlBattleScreen` draws, from back to front:

1. **The field** (`gl/battle-field-scene.ts`, 1280×676 in field coordinates): platforms, sprites,
   status boxes, weather, terrains and every animation, following the store's field events.
2. **The panels** (`gl/screen/`):

   | View | What |
   | --- | --- |
   | `header-view.ts` | Top bar: players, turn, timer |
   | `play-panel-view.ts` | The command bar in our battles: the message while the turn plays; moves, targets, Switch and Mega/Tera while choosing; the result at the end |
   | `watch-panel-view.ts` | The controls for spectating and replays (pause, speed, skip turn) |
   | `party-view.ts` | The party screen (switching) |
   | `info-view.ts` | Battle info (ZR): both teams, field conditions, the log |
   | `team-select-view.ts` | Team preview face to face: pick the Pokémon to bring, in order |
   | `face-off.ts` | The "p1 vs p2" intro |
   | `overlay-views.ts`, `message-box.ts`, `side-strip-view.ts`, `team-card.ts`, `pokemon-info-view.ts` | Smaller pieces used by the above |

   `screen-context.ts` holds what every panel draws with.

### Controls

| Button | Action |
| --- | --- |
| D-pad, A, B | Choose moves, targets and switches; B steps back |
| L | Toggle Mega Evolution or Terastallization while choosing a move |
| R (held) | Forfeit (`HoldAction`) |
| R3 | Battle timer on/off |
| ZR | Battle info (ZL opens it on the opponent's team; ZL/ZR change its tabs) |
| ZL | At team preview: accept open team sheets, or show the opponent's |

`BattleScreen` owns L, R and R3; `GlBattleScreen` owns ZL and ZR.

## The field

| File | Role |
| --- | --- |
| `battle-field-scene.ts` | Draws the field and runs its animations from the store's events |
| `battle-camera.ts`, `camera-tuning.ts` | The camera: closer to our side while we choose, onto the opponent's while targeting; layers move by depth (parallax) |
| `field-layout.ts` | Where each slot stands, singles and doubles |
| `hp-bar.ts` | The HP bars |
| `gl-effects.ts` | Particles, glows and the effect primitives |
| `effect-shapes.ts`, `type-effects.ts` | Shapes and the particles of each type (flames, drops, leaves…) |
| `move-patterns.ts` | How a move animates by kind (beam, wave, rush, flurry…), or by category for any other move |
| `signature-moves.ts` | Hand-made animations for the most used moves |
| `move-stage.ts` | Shared state of a move animation |

### Adding a move animation

1. Most moves are covered by their **category** (physical burst, special orb, status rings) and type
   colour. Check what the move looks like first.
2. If it fits a **pattern** (a beam, a sound wave, a priority rush…), add it to the pattern's list in
   `move-patterns.ts`.
3. If it deserves its **own animation**, add it to `signature-moves.ts`, following the existing ones.
   Keep the particle count modest and check the frame time on the console (L3).

All animation time runs on the field's clock, divided by the playback `speed` (replays can play
faster).

## State and text

- `state/battle-store.ts`: the battle's state from the protocol, played back step by step.
- `state/battle-text.ts`: the battle log's wording, following Showdown's own texts. Pure functions.
- `state/battle-choices.ts`: building and sending the turn's choice.
- `state/battle-series.ts`: Best-of-3 sets (the next game, the score).
- `state/team-preview.ts`, `state/team-sheet.ts`: team preview and open team sheets.
- `state/field-conditions.ts`, `state/status-conditions.ts`: weather, terrains, rooms, side conditions
  and statuses, with their names and turns left.
- `state/pokemon-inspection.ts`: both teams as far as the battle has shown them, with their open team
  sheets, for Battle info.
- `state/battle-ratings.ts`: the new ladder ratings the server announces when a rated battle ends.

## Notes

- **We're always at the bottom.** When we're p2, `side-swap.ts` swaps the sides in every frame before
  the store sees it. Spectated battles and replays show p1 at the bottom.
- **Coming back to a battle** (the app closed or the connection dropped mid-battle): the server puts
  the player back in their rooms by name, and the store applies the log so far at once instead of
  replaying it.
- **Sprites** of Champions Pokémon come from the bundled sheets; other formats' come from Showdown
  ([rendering.md](../rendering.md#images)). Team preview requests the sprites and cries of both teams
  ahead of time.
- The **battle music** starts with the battle; team preview and the end have their own themes
  ([audio.md](audio.md)).
