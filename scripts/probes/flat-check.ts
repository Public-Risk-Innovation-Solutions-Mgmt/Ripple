// A. cost-neutral check. ARM=change NODE_OPTIONS=... npx tsx scripts/probes/flat-check.ts
import { ARM, CHECK, LINES, FOLD, SHOCK_SUM_TODAY, SHOCK_SUM_NOW } from './flat-setup';
const f = (x: number) => (x / 1e6).toFixed(3);
console.log(`Measured at ${process.env.MEASURE_SHA}; arm ${ARM}; shock probabilities sum ${SHOCK_SUM_TODAY.toFixed(3)} -> ${SHOCK_SUM_NOW.toFixed(3)} a year; expected loss on $1,000M of exposure, market risk`);
for (const l of LINES) {
  const c = CHECK[l];
  console.log(`${l}: year  today   | shocks scaled, routine on | change (fold + scaled) | change / scaled-only | change / today | fold per $100`);
  for (const y of [1, 2, 3, 5, 10]) console.log(`      ${String(y).padStart(2)}   ${f(c.today[y - 1])} | ${f(c.scaledOnly![y - 1])} | ${f(c.change![y - 1])} | ${(c.change![y - 1] / c.scaledOnly![y - 1]).toFixed(12)} | ${(c.change![y - 1] / c.today[y - 1]).toFixed(4)} | ${FOLD[l][y].toFixed(5)}`);
  const worst = Math.max(...c.change!.map((v, i) => Math.abs(v / c.scaledOnly![i] - 1)));
  console.log(`  worst |change/scaled-only - 1| over years 1-10: ${worst.toExponential(2)}; pre-game fold (year 0) ${FOLD[l][0].toFixed(5)} per $100`);
}
