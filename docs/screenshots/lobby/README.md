# Lobby mockup — the real screens, with the new parts around them

A mockup of a lobby that **does not exist yet**. Nothing here is reachable from
the game: the code lives under `docs/`, is in no route, and is imported by
nothing the app builds. It exists to be screenshotted.

## The rule this version follows

**Where a screen already exists, the real component is rendered.** The first
version of this mockup redrew the host setup from copied classes and, in doing
so, quietly changed its prior-development section — it drew three static rows
reading "prior development 3% / 10% / -2%" where the real screen has a
checkbox, a number input, an adverse/favourable select and a note saying the
value is stored but not yet used.

Nothing here redraws an existing screen. `HostScreen` and `PlayScreen` are
imported from `src/` and rendered as the app renders them, against a **real
room created through the real transport** — the same `sessionTransport()` the
app resolves in the browser. If the app's host setup changes, these screenshots
change with it.

**What is added is only ever added** — never inserted into a real screen's
markup, never restyled around it.

| File | Screen | Real component | Added |
| --- | --- | --- | --- |
| `01-lobby.png` | Play Solo / Host an Event, three OPEN events with team counts and Join buttons, one IN PROGRESS marked viewers only | — (no lobby exists; the one screen drawn from scratch) | all of it |
| `02-join-open-event.png` | The real join screen on an open room | `PlayScreen role="player"` | the role choice, above |
| `03-join-in-progress.png` | The same screen on a room genuinely advanced to Year 3 | `PlayScreen role="viewer"` | the role choice, Team Leader unavailable |
| `04-host-setup.png` | The real host setup | `HostScreen` | a required **Event name** field, above |
| `05-host-event-screen.png` | The real host room screen | `HostScreen code=…` | **Hide from lobby** and the status, below |
| `control-04-real-host-setup.png` | The real host setup with **nothing** added, for the comparison below | `HostScreen` | — |

The room, its code, its teams, its year and its lines on 02, 03 and 05 are a
**real session's**, built by real `createRoom` / `join` / `submit` / `advance`
calls. Only the lobby's event list (01) is invented, because no lobby exists to
read from.

## 04 compared against the real host setup

`scripts` in the session drivers' style: the app is built from this tree —
whose `src/` is byte-identical to `multiplayer` — served, and its `/host`
innerText compared with the mockup's `?s=4` after stripping the added block.

```
real host setup                 : 1442 chars
mockup 04, added block stripped : 1442 chars
IDENTICAL after normalising the randomised seed.
```

**Nothing differs but the seed**, and that is the real screen's own behaviour:
`HostCreateScreen` initialises from `randomSeed()` on mount, so two renders of
the same component disagree there.

### Two event fields on 04, deliberately

The real host setup already carries an **optional** `Event` input, lower down,
sharing a two-column grid with the seed. The addition asked for is a
**required** `Event name` at the top. Moving or re-labelling the existing one
would be rearranging a screen this mockup is supposed to leave alone, so both
are shown: the new field above, the real screen untouched beneath it. Whoever
builds this decides whether the old field then goes.

## Running it

Self-contained: its own Vite root, Tailwind config and PostCSS config, so
serving it neither depends on nor alters the app's build.

```sh
npx vite --config docs/screenshots/lobby/vite.config.ts   # serves on :4180
```

Screens select by query string — `?s=1` … `?s=5`, plus `?s=control-04`.
Captured at 1440px wide, full page.

## Things that cost time, recorded so they do not again

- **`sessionTransport` is a function, not the object.** It resolves the
  implementation on first call. `sessionTransport.createRoom(...)` throws
  `is not a function`.
- **`submit` takes `token`, not `teamToken`**, and refuses an empty payload
  with *"Nothing to submit"* — at least one of `decisions` / `result` must be
  present. `advance` requires `expectedYear`.
- **Tailwind content globs must be absolute**, and must include `src/**`, since
  the real screens' classes have to be generated. A relative glob resolves
  against the process CWD, not the config file.
- **`server.fs.allow` must reach the repo root**, or every import of a real
  component out of `src/` is refused.
