// PAID-IN CAPITAL BY THE RULE — the largest amount, in $0.5M steps, that keeps
// every scenario's DESIGNED prior-board margin above zero — read off the
// pre-game at trial capitals. A probe, not a gate: it patches a COPY of src
// (STARTING_CAPITAL, and a hook that records the designed margin before the
// floor) and leaves the tree untouched.
//
//   WT=<repo> COPIES=<scratch dir> CAPS=WC:4,GL:8,Property:17.5 TAG=lo N=20 npx tsx scripts/probes/capital-solve-probe.mts > lo.json
//
// Run at two capitals a line, interpolate each scenario's designed margin
// (it is affine in the capital to well within a $0.5M step), take the largest
// $0.5M step with every margin above zero, and confirm it and the step above.
// The copies need node_modules beside them: ln -s <repo>/node_modules <COPIES>/node_modules.
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const WT = process.env.WT!, TAG = process.env.TAG ?? 'cap', N = Number(process.env.N ?? 20);
const CAP = Object.fromEntries((process.env.CAPS ?? '').split(',').filter(Boolean).map(x => { const [k, v] = x.split(':'); return [k, Number(v)]; }));
const DIR = `${process.env.COPIES}/${TAG}`;
rmSync(DIR, { recursive: true, force: true });
cpSync(`${WT}/src`, `${DIR}/src`, { recursive: true });
const patch = (f: string, a: string | RegExp, b: string) => {
  const p = `${DIR}/src/${f}`, s = readFileSync(p, 'utf8');
  const hits = typeof a === 'string' ? s.split(a).length - 1 : (s.match(new RegExp(a, 'g')) ?? []).length;
  if (hits !== 1) throw new Error(`patch site not unique in ${f}: ${a}`);
  writeFileSync(p, s.replace(a, b));
};
const G = '(globalThis as any).__CS';
patch('data/pricingParameters.ts', /export const STARTING_CAPITAL: PerLine<number> = \{[^}]*\};/,
  `export const STARTING_CAPITAL: PerLine<number> = { WC: ${CAP.WC * 1e6}, GL: ${CAP.GL * 1e6}, Property: ${CAP.Property * 1e6} };`);
patch('utils/priorHistoryEngine.ts',
  "  const designed = Math.max(PRE_GAME_MARGIN_FLOOR, solvePreGameMargin(run('designed'), line).start);",
  `  const designedRaw = solvePreGameMargin(run('designed'), line).start;
  const designed = Math.max(PRE_GAME_MARGIN_FLOOR, designedRaw);
  ${G}[line] = designedRaw;`);
const R = `${DIR}/src`;
(globalThis as any).__CS = {};
const { openSoloInstance } = await import(R + '/utils/soloGame.ts');
const { runPriorHistory } = await import(R + '/utils/priorHistoryEngine.ts');
const LINES = ['WC', 'GL', 'Property'];
const out: Record<string, unknown> = { caps: CAP, scenarios: {} };
for (let n = 1; n <= N; n++) {
  const { setup, instance } = openSoloInstance({ poolName: 'C', gameLength: 10, startingYear: 2027, instanceId: String(n), activeLines: LINES } as never);
  (globalThis as any).__CS = {};
  const { priorHistory } = runPriorHistory(instance, setup);
  const y0 = priorHistory.find((r: { yearNumber: number }) => r.yearNumber === 0);
  (out.scenarios as Record<number, unknown>)[n] = Object.fromEntries(LINES.map(l => [l, {
    designedRaw: (globalThis as any).__CS[l], margin: y0.byLine[l].decisions.fundingCushion,
  }]));
  console.error(`${TAG} scenario ${n} done`);
}
console.log(JSON.stringify(out));
