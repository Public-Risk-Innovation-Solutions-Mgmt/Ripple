# Probes — the reserve-inflation measurements

Read-only measurement scripts kept so the figures behind the reserve-inflation
build can be reproduced. **None is a gate**: nothing in `scripts/gates.ts` runs
them, and nothing here asserts anything.

Each `.mts` probe copies `src/` into a scratch directory, patches the COPY by
exact source text, and runs games on it; the tree is never touched. A patch
whose source text is gone throws `patch site not unique` rather than measuring
something else. The copies need `node_modules` beside them:

    ln -s "$PWD/node_modules" <COPIES>/node_modules

| Probe | Written against | What it measured |
|---|---|---|
| `ri-probe.mts` | `wip/policy-year-2027` e238cbb | Reserve inflation: A today, B priced in full, C unpriced; `PC` contingency 3% / 5% |
| `ri-part-probe.mts` | e238cbb | Inflation priced for the first N years (2, 3, 5) at contingency 0 / 3% / 5% |
| `ri-ps-probe.mts` | e238cbb | Per-line contingency and N; re-centred targets (one range for all lines), experience base, guardrails, capital |
| `ri-split-probe.mts` | e238cbb | Per-line target ranges (`RANGES`), each line's experience base at its midpoint; loans, Deficient years, GL's lowest surplus |
| `ri-growth-probe.mts` | e238cbb | The split plus pre-game book growth (`GROWTH` 1% / 2% / 3%) |
| `capital-solve-probe.mts` | this branch | Paid-in capital by the rule — designed margins at trial capitals (`CAPS`), patching only `STARTING_CAPITAL` |
| `build-measure-probe.mts` | this branch | The build as it stands, unpatched but for a hook recording the designed margin and guardrail hits |

The e238cbb probes patch source that this branch has since changed (the
settings they toggled are now real parameters), so they run against a worktree
at e238cbb: `WT=<that worktree>`.

The `*-summ.py` scripts print the reports from the probes' JSON; they and
`ps-run.sh` name the scratch directory the runs used (`S=...`) — set it to
yours. `ps-run.sh TAG "ENV=..." ...` runs probes in parallel and logs exit codes.
