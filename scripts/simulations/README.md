# Simulations — the market-measurement harness

Tools for measuring how the game plays: hosted rooms of chosen teams played on
the real session path, many at once. **They measure; they never pass or fail,
and no gate runs them.** Results go wherever you point them (not into the repo).

| File | What it does |
|---|---|
| `sim-room.mts` | Plays one hosted room: `LocalSessionTransport` (in-memory localStorage), `createRoom` / `join` / `submit` with each team's market lock / `advance` (the server's market step) / `read`, then each team's game replayed on its stored market results — what a browser does. Writes per year and team: the Annual Statement's surplus and combined ratio, and per line rate, premium, losses, prior-year development, reinsurance, the market result and the events in force. Room codes are seeded, so a room plays the same draws every run. |
| `probe-shock-year.mts` | Prints what the shocks do each year for a host schedule — surge (A), development rate on prior-year reserves (R), large claims (T) — with no game played. Check a schedule or a switch before spending games on it. |
| `run_matrix.py` | Runs a JSON list of `sim-room` jobs in parallel (default 4), skipping finished ones, one log per job. |
| `event_design_matrix.py` | The Legislation Change / WC Reform design test: writes its job list and tabulates the results (combined ratio by year, year-5 and lowest surplus, cost vs no events split one-time / continuous). |
| `event-design-switches.patch` | The test switches that test needed (`EVENT_DESIGN`, `EVENT_STEP`, `EVENT_CAP`, `EVENT_SI_STEP`, `DEV_RANGES`), as a patch on aws `f74aa88`. Not on aws: apply it to a scratch checkout. |

## Running

Needs `npm ci` in the checkout you play. One room:

```sh
OUT=/tmp/room.json SCEN=6 DEV=Low MARKET=medium \
SCHED='[{"shockId":"#4","yearNumber":2}]' \
npx tsx scripts/simulations/sim-room.mts
```

Environment (all optional but `OUT`): `ROOT` (the checkout to play, default
this repository), `SCEN` (scenario / room seed, default 6), `YEARS` (5), `DEV`
(Low / Mid / High on every line), `MARKET` (off / low / medium / high),
`SCHED` (the host's schedule, event ids `#1`–`#12` in catalogue order: `#4`
Legislation Change, `#5` Workers Comp Legislation, `#7` Nuclear Verdict, `#8`
Social Inflation), `TEAMS` (JSON list of
`{"name", "funding": "expected" | 0.30–0.95, "cover": "none" | "$9M xs $1M" | …,
"agg": "none" | "agg-110-50", "newMembers": 0.05, "nonRenewal": 0}`; default
Expected / 65% / 80%, each with and without covers).

A matrix, against a scratch checkout carrying test switches:

```sh
git worktree add --detach ../scratch origin/aws && (cd ../scratch && npm ci && git apply ../<repo>/scripts/simulations/event-design-switches.patch)
python3 scripts/simulations/event_design_matrix.py jobs /tmp/jobs.json
python3 scripts/simulations/run_matrix.py /tmp/jobs.json /tmp/out --root ../scratch --parallel 4
python3 scripts/simulations/event_design_matrix.py table /tmp/out
```

A five-year, six-team room takes about 20 seconds; four at a time is what a
four-core container holds.

## Notes

- **One game per case is one draw.** Shock sizes are keyed on the game seed
  (the scenario), so a schedule in scenario 6 always draws the same claim;
  run several scenarios before trusting a size effect.
- **Counterfactuals, not the engine's records, split a cost.** A hosted
  game's saved results are averages over worlds and drop the per-component
  loss record, so "how much came from X" is the game with X minus the game
  without it — which includes the market's response.
- Test switches belong in a scratch checkout as a patch, never in the repo's
  `src/`.
