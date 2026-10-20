// npx tsx scripts/probes/flat-summary.ts today-logs... -- change-logs...
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2), cut = args.indexOf('--');
const load = (fs: string[]) => { const all = new Map<string, Record<string, number[]>>(); let st: any[] = []; const heads: string[] = [];
  for (const f of fs) { const L = readFileSync(f, 'utf8').split('\n'); heads.push(L[0]);
    if (!st.length) st = JSON.parse(L.find(l => l.startsWith('STATEMENT '))!.slice(10));
    for (const [k, a] of JSON.parse(L.find(l => l.startsWith('JSON '))!.slice(5))) { const t = all.get(k) ?? {}; for (const [f2, v] of Object.entries(a as Record<string, number[]>)) (t[f2] ??= []).push(...v); all.set(k, t); } }
  return { all, st, heads }; };
const T = load(args.slice(0, cut)), C = load(args.slice(cut + 1));
const mean = (x: number[] = []) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN;
const sd = (x: number[] = []) => { const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); };
const M = (x: number) => (x / 1e6).toFixed(1).padStart(6), P = (x: number) => (100 * x).toFixed(1) + '%';
[...T.heads, ...C.heads].forEach(h => console.log(h));
console.log('\n== B. PRE-GAME, mean (sd across seeds): loss ratio | rate | investment income $M');
for (const l of ['WC', 'GL', 'Property']) for (const y of [-4, -3, -2, -1, 0]) {
  const t = T.all.get(`pre|${l}|y${y}`)!, c = C.all.get(`pre|${l}|y${y}`)!;
  console.log(`${l.padEnd(8)} y${y} today ${mean(t.lr).toFixed(3)} (${sd(t.lr).toFixed(3)}) | ${mean(t.rate).toFixed(3)} (${sd(t.rate).toFixed(3)}) | ${M(mean(t.inv))} (${M(sd(t.inv))})   change ${mean(c.lr).toFixed(3)} (${sd(c.lr).toFixed(4)}) | ${mean(c.rate).toFixed(3)} (${sd(c.rate).toFixed(4)}) | ${M(mean(c.inv))} (${M(sd(c.inv))})`);
}
console.log('\n== D. PLAY: arm | line | A/E regular mean sd | A/E shock mean sd | mean |dRate| sd dRate | UW/yr mean | reins cost, recovery /yr | s5 avg min | s10 avg min | <0 ever');
for (const [name, R] of [['TODAY', T], ['CHANGE', C]] as const) {
  console.log(`-- ${name}`);
  for (const [k, a] of R.all) { if (k.startsWith('pre|')) continue; const [arm, line] = k.split('|');
    const loss = line === 'POOL' ? ''.padEnd(78) : `${mean(a.aeReg).toFixed(3)} ${sd(a.aeReg).toFixed(3)} | ${mean(a.aeShock).toFixed(3)} ${sd(a.aeShock).toFixed(3)} | ${P(mean(a.dRate.map(Math.abs)))} ${P(sd(a.dRate))} | ${M(mean(a.uw))} | ${M(mean(a.reins))} ${M(mean(a.rec))}`;
    console.log(`${arm.padEnd(34)} ${line.padEnd(8)} ${loss} | ${M(mean(a.s5))} ${M(Math.min(...a.s5))} | ${M(mean(a.s10))} ${M(Math.min(...a.s10))} | ${P(mean(a.neg))}`); }
}
console.log('\n== E. ONE SEED (FLAT0000), pre-game Annual Statement, $M');
for (const [name, R] of [['TODAY', T], ['CHANGE', C]] as const) {
  console.log(`-- ${name}\nline     year  premium incurred   LAE     UW   inv   net  reserve surplus  LR    rate`);
  for (const r of R.st) console.log(`${r.line.padEnd(8)} ${String(r.year).padStart(3)} ${M(r.premium)} ${M(r.incurred)} ${M(r.lae)} ${M(r.uw)} ${M(r.inv)} ${M(r.net)} ${M(r.reserve)} ${M(r.surplus)}  ${r.lr.toFixed(3)} ${r.rate.toFixed(3)}`);
}
