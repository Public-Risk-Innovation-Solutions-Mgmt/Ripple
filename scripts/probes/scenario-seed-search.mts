// ============================================================================
// SLOT 20'S NEW SEED — THE SEARCH (pr/named-scenarios). Stage 1 of 2.
//
//   npx tsx scripts/probes/scenario-seed-search.mts <from> <to>   # one shard
//
// Every seed in [from, to) — skipping the seeds in use (the twenty slots, and
// the named scenarios Staff Retreat and Test Seed) — opened on today's
// pre-game (the prior board at 65%, the 20/75/5 mix), its premium to surplus
// measured per line as scenarios-check measures it (scenario-seed-open.mts),
// and printed as one JSON line when it is within 5% of slot 20's design target
// (SCENARIO_PREMIUM_TO_SURPLUS) on EVERY line. Stage 2 plays them
// (scenario-seed-play.mts).
// ============================================================================
import { SCENARIO_PREMIUM_TO_SURPLUS, SCENARIO_SEEDS } from '../../src/data/pricingParameters';
import { LINES, openingPs } from './scenario-seed-open.mts';

const [from, to] = process.argv.slice(2).map(Number);
const USED = new Set<number>([...Object.values(SCENARIO_SEEDS), 82670, 53781]);
const target = Object.fromEntries(LINES.map(l => [l, SCENARIO_PREMIUM_TO_SURPLUS[l][20]]));
let n = 0;
for (let s = from; s < to; s++) {
  if (USED.has(s)) continue;
  n++;
  const ps = openingPs(String(s));
  const miss = Object.fromEntries(LINES.map(l => [l, ps[l] / target[l] - 1]));
  const worst = Math.max(...LINES.map(l => Math.abs(miss[l])));
  if (worst <= 0.05) console.log(JSON.stringify({ seed: s, ps, miss, worst }));
}
console.error(`shard ${from}-${to}: ${n} seeds opened`);
