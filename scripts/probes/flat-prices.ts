// C. Package prices, year 1, at the 3-line opening book. ARM=today|change under flat-loader.
import { ARM, LINES } from './flat-setup';
import { R_MODEL, SHOCK_LOSS_COUNT, SHOCK_ONE_OCCURRENCE } from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER, PROPERTY_PERIL_DEDUCTIBLE } from '../../src/data/reinsuranceTower';
import { SHOCK_EVENTS, drawLargeLosses, eventLines, type EventFiring, type LineShockYear } from '../../src/utils/shockLosses';
import { newEngineLayerMoments } from '../../src/utils/shockExpectation';
import { reinsuranceOptionsFor, placementFor } from '../../src/utils/reinsuranceOptions';
import { occurrenceTotals, occurrenceProgramCost } from '../../src/utils/reinsuranceTower';
import { drawShockSchedule, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { openSoloInstance } from '../../src/utils/soloGame';
import { exposureFactor } from '../../src/data/exposureTrend';
import { SeededRandom } from '../../src/utils/random';
import type { CoverageLine } from '../../src/types/simulation';

const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 10, startingYear: 2026, instanceId: 'FLAT0000', activeLines: LINES } as never);
const ph = runPriorHistory(instance, setup);
const EXP = Object.fromEntries(LINES.map(l => [l, (ph.poolState.lines[l].bookExposure ?? 0) * exposureFactor(l, 1)])) as Record<CoverageLine, number>;
// conditional recovery of a package, given one event (no routine claims: off in the change; on in today, added below)
function conditional(line: CoverageLine, name: string, att: number, lim: number, n = 20_000) {
  const ev = SHOCK_EVENTS.find(e => e.name === name)!, row = eventLines(name).find(r => r.line === line)!;
  const [lo, hi] = R_MODEL.tShock[line][row.t as 'Low'], rng = new SeededRandom(7 + ev.index);
  let q = 0;
  for (let i = 0; i < n; i++) {
    const u = { a: rng.next(), r: rng.next(), t: rng.next() };
    const region = (['North', 'Central', 'South'] as const)[Math.min(2, Math.floor(rng.next() * 3))];
    const firing = { event: ev, firedYear: 1, ordinal: 0, ...(ev.regional ? { region } : {}), draws: { WC: u, GL: u, Property: u } } as EventFiring;
    const shocks = { uplift: 0, rRate: 0, byFiring: [], arrivals: [{ firing, line, level: row.t, tModel: lo + u.t * (hi - lo),
      count: SHOCK_LOSS_COUNT[name][line]!, oneOccurrence: SHOCK_ONE_OCCURRENCE.includes(name) }] } as unknown as LineShockYear;
    const d = drawLargeLosses(line, null, 1, 2026, 4_000_000 + i, shocks, EXP[line]);
    const ded = line === 'Property' && name === 'Earthquake' ? PROPERTY_PERIL_DEDUCTIBLE.earthquake : 0, from = Math.max(att, ded);
    if (occurrenceTotals(d.claims, d.occurrences).some(t => t > from && from < att + lim)) q++;
  }
  return q / n;
}
const inSched = new Map<string, number>(); const NS = 40_000;
for (let s = 0; s < NS; s++) for (const x of drawShockSchedule(`S${s}`, 10, SOLO_SHOCK_STREAM)) { const nm = SHOCK_EVENTS.find(e => e.id === x.shockId)!.name; inSched.set(nm, (inSched.get(nm) ?? 0) + 1); }
console.log(`Measured at ${process.env.MEASURE_SHA}; arm ${ARM}; year 1; shocks a year ${SHOCK_EVENTS.reduce((a, e) => a + e.probability, 0).toFixed(3)}; schedule fires ${([...inSched.values()].reduce((a, b) => a + b, 0) / NS).toFixed(2)} per game`);
const M = (x: number) => `$${(x / 1e3).toFixed(0)}K`;
for (const line of LINES) {
  const tEv = SHOCK_EVENTS.filter(e => eventLines(e.name).some(r => r.line === line && r.t !== 'None'));
  for (const o of reinsuranceOptionsFor(line).filter(o => o.limit > 0)) {
    const placed = placementFor(line, o.id);
    const q = occurrenceProgramCost(line as never, placed, { exposure: EXP[line] } as never, 1);
    const m = newEngineLayerMoments(line as never, EXP[line], 1);
    const sdSum = REINSURANCE_TOWER[line as 'WC'].reduce((a, _, i) => a + (placed[i] ? m[i].sd : 0), 0);
    let pNo = 1, pNoGame = 1;
    for (const e of tEv) { const c = conditional(line, e.name, o.attachment, o.limit); pNo *= 1 - e.probability * c; pNoGame *= 1 - (inSched.get(e.name) ?? 0) / NS * c; }
    console.log(`${line.padEnd(8)} ${o.id.padEnd(14)} E[rec] ${M(q.expectedCeded)}  SD(layers) ${M(sdSum)}  price ${M(q.premium)}  ${(q.premium / Math.max(q.expectedCeded, 1)).toFixed(2)}x E  ${(100 * q.premium / o.limit).toFixed(2)}% of limit  pays (shock T) ${(100 * (1 - pNo)).toFixed(2)}% of years, ${(100 * (1 - pNoGame)).toFixed(1)}% of solo games`);
  }
}
