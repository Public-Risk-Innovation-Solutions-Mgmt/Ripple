// npx tsx scripts/probes/scenarios-summary.ts runlogs/scn-three.log runlogs/scn-prop-{today,5,3,2.3}.log
import { readFileSync } from 'node:fs';
const read = (f: string) => { const L = readFileSync(f, 'utf8').split('\n');
  const get = (k: string) => JSON.parse(L.find(l => l.startsWith(k + ' '))!.slice(k.length + 1));
  return { head: L[0], factors: get('FACTORS'), wildfire: get('WILDFIRE'), rows: get('JSON') as any[] }; };
const [threeF, ...propF] = process.argv.slice(2); const three = read(threeF);
const M = (x: number) => (x / 1e6).toFixed(1).padStart(5), mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const L = ['WC', 'GL', 'Property'];
console.log(three.head);
console.log('FIXED SHUFFLE: ' + three.factors.map((f: any) => `${f.n}:${f.factor.toFixed(3)}`).join(' '));
console.log('\n== A. scn factor shocks | opening surplus WC GL PR | POOL | opening reserves WC GL PR | pre-game avg LR WC GL PR | year-1 rate WC GL PR');
for (const r of three.rows) console.log(`${String(r.n).padStart(2)} ${r.factor.toFixed(3)} ${r.shocks} | ${L.map(l => M(r[l].openSurplus)).join(' ')} | ${M(r.pool.open)} | ${L.map(l => M(r[l].openReserve)).join(' ')} | ${L.map(l => r[l].preLR.toFixed(3)).join(' ')} | ${L.map(l => r[l].rate1.toFixed(3)).join(' ')}`);
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); const c = mean(a.map((x, i) => (x - ma) * (b[i] - mb))); return c / Math.sqrt(mean(a.map(x => (x - ma) ** 2)) * mean(b.map(x => (x - mb) ** 2))); };
for (const l of L) console.log(`  ${l}: corr(factor, opening reserve) ${corr(three.rows.map(r => r.factor), three.rows.map(r => r[l].openReserve)).toFixed(3)}, corr(factor, pre-game LR) ${corr(three.rows.map(r => r.factor), three.rows.map(r => r[l].preLR)).toFixed(3)}, corr(factor, year-1 rate) ${corr(three.rows.map(r => r.factor), three.rows.map(r => r[l].rate1)).toFixed(3)}`);
console.log('\n== B. scn factor | per line: s5 avg/min  s10 avg/min  worlds<0 (of 10) | POOL');
for (const r of three.rows) console.log(`${String(r.n).padStart(2)} ${r.factor.toFixed(3)} | ${L.map(l => `${l} ${M(mean(r[l].s5))}/${M(Math.min(...r[l].s5))} ${M(mean(r[l].s10))}/${M(Math.min(...r[l].s10))} ${r[l].neg}`).join(' | ')} | POOL ${M(mean(r.pool.s5))}/${M(Math.min(...r.pool.s5))} ${M(mean(r.pool.s10))}/${M(Math.min(...r.pool.s10))} ${r.pool.neg}`);
for (const l of [...L, 'pool']) { const all = three.rows.flatMap(r => l === 'pool' ? [r.pool] : [r[l]]);
  console.log(`  ALL ${l}: s5 avg ${M(mean(all.flatMap(x => x.s5)))} min ${M(Math.min(...all.flatMap(x => x.s5)))}; s10 avg ${M(mean(all.flatMap(x => x.s10)))} min ${M(Math.min(...all.flatMap(x => x.s10)))}; worlds ever <0 ${all.reduce((a, x) => a + x.neg, 0)}/200`); }
console.log('\n== C. PROPERTY-ONLY at its scenario openings, by catastrophe scale');
for (const f of propF) { const p = read(f), w = p.wildfire, rows = p.rows.map(r => r.Property);
  console.log(`${p.head.split(';').slice(2, 4).join(';')}: T scale ${w.tScaleNow.toFixed(2)} (today ${w.tScaleToday.toFixed(2)}); wildfire T median ${M(w.tMedian)} p90 ${M(w.tP90)} mean ${M(w.tMean)} + A ${M(w.aMean)} ($M)`);
  console.log(`   expected loss y1 ${M(mean(rows.map(r => r.expLoss1)))}; rate y1 ${mean(rows.map(r => r.rate1)).toFixed(4)}, 10-yr avg ${mean(rows.map(r => r.rateAvg)).toFixed(4)}; prices: ${rows[0].prices.map((q: any) => `${q.id} $${(q.premium / 1e6).toFixed(2)}M (E $${(q.expectedCeded / 1e6).toFixed(2)}M)`).join(', ')}`);
  console.log(`   surplus y5 avg ${M(mean(rows.flatMap(r => r.s5)))} min ${M(Math.min(...rows.flatMap(r => r.s5)))}; y10 avg ${M(mean(rows.flatMap(r => r.s10)))} min ${M(Math.min(...rows.flatMap(r => r.s10)))}; worlds ever <0 ${rows.reduce((a, r) => a + r.neg, 0)}/200 (${(100 * rows.reduce((a, r) => a + r.neg, 0) / 200).toFixed(1)}%); by scenario: ${p.rows.map(r => `${r.n}:${r.Property.neg}`).join(' ')}`); }
const thin = three.rows.reduce((a, r) => r.factor < a.factor ? r : a), rich = three.rows.reduce((a, r) => r.factor > a.factor ? r : a);
console.log(`\n== D. WC pre-game Annual Statement: thin scenario ${thin.n} (factor ${thin.factor.toFixed(3)}) | rich scenario ${rich.n} (factor ${rich.factor.toFixed(3)}), $M`);
console.log('year | premium incurred LAE   UW   inv  net  reserve surplus  LR   rate | premium incurred LAE   UW   inv  net  reserve surplus  LR   rate');
thin.WC.statement.forEach((t: any, i: number) => { const r = rich.WC.statement[i];
  const c = (x: any) => `${M(x.premium)} ${M(x.incurred)} ${M(x.lae)} ${M(x.uw)} ${M(x.inv)} ${M(x.net)} ${M(x.reserve)} ${M(x.surplus)} ${x.lr.toFixed(3)} ${x.rate.toFixed(3)}`;
  console.log(`${String(t.year).padStart(3)}  | ${c(t)} | ${c(r)}`); });
