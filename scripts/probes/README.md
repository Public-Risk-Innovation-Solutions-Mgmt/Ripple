# Measurement probes — stable regular years, flat pre-game, twenty scenarios

Measurement only, measured at `ada3bf7`. Nothing in `src/` is changed: `flat-loader.mjs`
rewrites engine source in memory, in the probe's process only, and every rewrite reads a
global the setup module sets (inert when unset). Each rewrite asserts its target text is
present exactly once, so a moved site fails loudly.

Run every probe under the loader, registered BEFORE tsx so it sees raw TypeScript:

    NODE_OPTIONS="--import $PWD/scripts/probes/flat-register.mjs" ARM=change npx tsx scripts/probes/<probe>.ts

- `flat-setup.ts` — import first. `ARM=today` leaves the engine as it is; `ARM=change` applies:
  1. routine large losses off, each line-year's routine cost folded into ordinary as
     routine(y) / (1 + E[uplift](y)) — exactly cost-neutral; shocks' T scaled off the unfolded cost;
  2. catalogue probabilities scaled to sum to 0.3 a year, relative weights kept;
  3. layer price = E + 0.5 x SD of annual recovery; WC $5M xs $5M and $10M xs $5M withdrawn
     (`WC_ONLY_9X1=1` also withdraws $14M xs $1M);
  4. pre-game years (<= 0) flat: expected asset returns net of fee, ordinary losses at expected.
- `flat-check.ts` — the cost-neutral check. `flat-games.ts`, `flat-prices.ts`, `flat-summary.ts` —
  the today-vs-change comparison (100 seeds, every package).
- `scenarios.ts` (`GAME=three|property`, `PSCALE=today|5|3|2.3`), `scenarios-summary.ts`,
  `scn-schedules.ts` — the twenty starting scenarios: opening factor x $35M per line (fixed shuffle,
  printed), pre-game losses x (1 + (1 - factor) x 0.3), 2-4 shocks per game, Property's catastrophe
  scale. The engine's own solve lands the pre-game on the scenario's opening.
- Summary logs are in `runlogs/` (force-added; the directory is otherwise ignored).
