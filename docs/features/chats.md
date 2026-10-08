# Chats (`/chats`)

`features/lobby/`

Showdown's chat rooms, one at a time: a Gen 3 style menu of rooms on the left and the room on the
right, with its log or its user list.

## Controls

| Button | Action |
| --- | --- |
| D-pad, A | Pick a room; scroll the log or the users while they have the focus |
| ZR | Write a message (opens the `CanvasKeyboard`) |
| ZL | Show or hide the user list |
| L | Leave the room |
| B | Back to the home menu (leaves the room) |

Offline, ZR opens the login box over the page first.

## Code

| File | Role |
| --- | --- |
| `components/chats-scene/chats-scene.ts` | The page |
| `gl/chat-log-view.ts` | The log (messages wrapped to the box, names in their colour) and the user list |
| `state/chat-room-store.ts` | The joined room: users, recent messages, `send()`. Rejoins after a reconnection until `leave()` |
| `state/chat-users.ts` | The user list's sorting and ranks |
| `data/chat-rooms.ts` | The rooms offered |
| `models/chat.ts` | Types |

`shared/utils/username-color.ts` gives each name the colour Showdown's client gives it.

## Notes

- **One room at a time, and only on this page.** Leaving the page leaves the room: a busy room's
  traffic costs the console work even when nothing shows it.
- Protocol messages are applied **in batches**, and only the recent messages are kept, so a busy
  room like the Lobby doesn't slow the app down.
- **Server HTML is never rendered** (`|raw|`, `|uhtml|`, `/raw` messages): there's no DOM to render it
  in, and it would be unsafe.
- **Room ids** drop accented letters ("Español" is `espanol`, "Français" is `franais`). Verify a new
  room's id by joining it before adding it to `chat-rooms.ts`.
