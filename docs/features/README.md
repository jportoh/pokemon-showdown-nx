# Features

One page per area of the app: what it does, where its code is, how its parts fit together and what
to watch out for when changing it. Each feature lives in `src/app/features/<name>/` (see the layout in
[architecture.md](../architecture.md#code-layout)).

| Page | Routes | Folders |
| --- | --- | --- |
| [Home, loading and Trainer Card](home.md) | `/`, `/loading` | `home`, `loading`, `trainer-card` |
| [Battle lobby](play.md) | `/play` | `play` |
| [Battle](battle.md) | `/battle` | `battle` |
| [Teambuilder and damage calc](teambuilder.md) | `/teambuilder` | `teambuilder` |
| [Watch Live, Replays and history](watching.md) | `/live`, `/replays`, `/history` | `live`, `replays` |
| [Chats](chats.md) | `/chats` | `lobby` |
| [Settings](settings.md) | `/settings` | `settings` |
| [Audio](audio.md) | — | `core/audio`, `battle/audio` |

The connection to Showdown that most features use is described in [showdown.md](../showdown.md).
