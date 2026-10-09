// ============================================================================
// THE PER-CLAIM DRIFT — THE DERIVER TRIANGLE_DEVELOPMENT_DRIFT NEVER HAD.
// A PROBE: it prints a rate to paste, it does not write or assert.
//
//   npx tsx scripts/diagnostics/claim-drift-derive.ts
//   FACTOR=2 npx tsx scripts/diagnostics/claim-drift-derive.ts     re-solve for closure x2 faster
//   LINES=WC FACTOR=2 npx tsx ...
//
// The identity it holds: on a real register, each claim's FIRST estimate
// (initialEstimate, the forward-booking contraction) compounded by
// developmentDrift to that claim's own CLOSURE AGE, summed by value,
//
//     sum over claims of  init(x) . prod_{a=1}^{ca-1} (1 + g . N/(a+1))
//
// is held at what today's shipped g gives. With FACTOR=1 the bisection returns
// today's g (the round-trip check: it must reproduce TRIANGLE_DEVELOPMENT_DRIFT
// to the printed precision). With FACTOR=F every closure scale is divided by F
// and g is re-solved to hold the same sum — step 2 of the compression re-solve
// order in STATE_fast-development.md. TRIANGLE_OPEN_SHARE reads this rate and
// must be re-derived after it (open-share-derive.ts).
//
// The register is the open-share deriver's: 40 market years, predefined
// members, instanceSeed 6_100_000 + y.7919, closure unit keyed `OS${line}${y}`.
//
// ⚠ "booked/drawn" IS THE IDENTITY'S LEVEL, NOT THE ENGINE'S TERMINATION. It is
// what a claim would close at if it climbed to its closure age with no noise
// and no horizon. What the engine actually closes tracked claims at is
// termination-by-size-report.ts, and the two disagree by size band.
// ============================================================================
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { initialEstimate } from '../../src/utils/claimTriangle';
import { closedShare, claimClosureUnit, type ClosureCurve } from '../../src/utils/claimClosure';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import {
  CLAIM_REVISION_MAGNITUDE_NUMERATOR as N, TRIANGLE_DEVELOPMENT_DRIFT, CLOSURE_BY_SIZE,
  CLOSURE_SIZE_THRESHOLD, FITTED_CLOSURE_CURVE,
} from '../../src/data/defaultAssumptions';

const F = Number(process.env.FACTOR ?? 1);
const curveFor = (line: string, x: number, f: number): ClosureCurve => {
  const sp = CLOSURE_BY_SIZE[line];
  const c = sp ? (x >= CLOSURE_SIZE_THRESHOLD ? sp.large : sp.small) : FITTED_CLOSURE_CURVE[line];
  return { k: c.k, b: c.b / f };
};
const members = getPredefinedMarketMembers();
const cum = (g: number, ca: number) => { let v = 1; for (let a = 1; a < ca; a++) v *= 1 + g * N / (a + 1); return v; };

for (const line of (process.env.LINES ?? 'WC,GL,Property').split(',')) {
  const rows: { init: number; drawn: number; ca1: number; caF: number }[] = [];
  for (let y = 1; y <= 40; y++) {
    const gameId = `OS${line}${y}`;
    const base = { members, yearNumber: 1, calendarYear: 2026, instanceSeed: 6_100_000 + y * 7919, riskControlEffectiveness: 0 };
    const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
      : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
      : generatePropertyClaims({ ...base, kPr: 1 });
    for (const c of r.claims) {
      const u = claimClosureUnit(gameId, c.id);
      const age = (f: number) => { const cv = curveFor(line, c.grossUltimate, f); for (let k = 1; k <= 40; k++) if (closedShare(cv, k) >= u) return k; return 40; };
      rows.push({ init: initialEstimate(line as never, c.grossUltimate), drawn: c.grossUltimate, ca1: age(1), caF: age(F) });
    }
  }
  const g0 = TRIANGLE_DEVELOPMENT_DRIFT[line];
  const S = (g: number, key: 'ca1' | 'caF') => rows.reduce((s, r) => s + r.init * cum(g, r[key]), 0);
  const drawn = rows.reduce((s, r) => s + r.drawn, 0);
  const target = S(g0, 'ca1');
  let lo = 0, hi = 50;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (S(m, 'caF') < target) lo = m; else hi = m; }
  const initAll = rows.reduce((s, r) => s + r.init, 0);
  const share1 = rows.filter(r => r.caF === 1).reduce((s, r) => s + r.init, 0) / initAll;
  console.log(`${line.padEnd(9)} claims ${rows.length}  shipped g ${g0}  identity booked/drawn ${(target / drawn).toFixed(4)}   `
    + `closure /${F}: g ${lo.toFixed(5)} (x${(lo / g0).toFixed(2)})   first-estimate value closing at age 1: ${(100 * share1).toFixed(1)}% — takes NO development`);
}
