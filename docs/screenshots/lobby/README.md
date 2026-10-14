# Lobby mockup — static, not wired, not part of the app

These five screens are a **mockup of a lobby that does not exist yet**. Nothing
here is reachable from the game: the code lives under `docs/`, is in no route,
and is imported by nothing the app builds. It exists to be screenshotted.

**Every figure on these screens is invented.** Event names, team names, counts
and years are sample data chosen to look like a real session. No engine ran.

| File | Screen |
| --- | --- |
| `01-lobby.png` | The lobby: Play Solo / Host an Event, and the current events list — one OPEN (PRISM Spring Workshop, 6 teams), one IN PROGRESS (Finance Committee Session, Year 3). |
| `02-open-event-role.png` | Picking the OPEN event: Team Leader (name your team) or Viewer (pick a team to follow). |
| `03-in-progress-viewer-only.png` | Picking the IN PROGRESS event: viewers only, Team Leader shown UNAVAILABLE with the reason. |
| `04-host-setup.png` | Host setup, with the new required **Event name** field promoted to the top. |
| `05-host-event-screen.png` | The host's event screen, with the **Hide from lobby** control and the event's status. |

## Running it

Self-contained: its own Vite root, Tailwind config and PostCSS config, so
serving it neither depends on nor alters the app's build.

```sh
npx vite --config docs/screenshots/lobby/vite.config.ts   # serves on :4180
```

Screens are selected by query string — `?s=1` through `?s=5`, in the table's
order. Screenshots were taken at 1440px wide, full page.

## Two things a later reader will want to know

- **It copies the app's markup rather than importing its screens.** The real
  `HostCreateScreen` talks to the session transport on mount and would need a
  server, a room and a token to render at all. The classes here are lifted from
  the real screens — same slate palette, same `rounded-xl` cards, same
  `blue-600` primary — so the look tracks the app even though the wiring does
  not. If the app's styling moves, this will not move with it.
- **The Tailwind content globs are absolute, and have to be.** Tailwind
  resolves a relative glob against the process CWD, not against the config
  file, and this is served from the repo root. The first capture emitted
  preflight with no utilities and rendered as unstyled text.
