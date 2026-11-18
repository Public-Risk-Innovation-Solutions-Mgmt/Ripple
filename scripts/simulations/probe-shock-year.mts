// ============================================================================
// WHAT THE SHOCKS DO EACH YEAR, with no game played — resolveShockYear on a bare
// instance carrying a host schedule. Prints each year's surge (A, share added
// to ordinary losses), development rate on prior-year reserves (R) and large
// claims (T, base-year $M) for WC and GL. Use it to check a schedule or a
// design switch before spending games on it.
//
//   ROOT   the checkout (default: this repository)
//   SEED   the game seed the draws are keyed on (default 6)
//   SCHED  JSON [{"shockId":"#4","yearNumber":2}, ...]
//   YEARS  default 5
//
//   SCHED='[{"shockId":"#4","yearNumber":2}]' npx tsx scripts/simulations/probe-shock-year.mts
// ============================================================================
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { resolveShockYear } = await import(`${ROOT}/src/utils/shockLosses.ts`);
const sched = JSON.parse(process.env.SCHED ?? '[]');
const instance = { seed: Number(process.env.SEED ?? 6), instanceId: 'probe', scheduledShocks: sched };
for (let y = 1; y <= Number(process.env.YEARS ?? 5); y++) {
  const r = resolveShockYear(instance, 'host', y);
  console.log(`y${y} ` + (['WC', 'GL', 'Property'] as const).map(l => {
    const b = r.byLine[l];
    const t = b.arrivals.map((a: { size: number }) => `${(a.size / 1e6).toFixed(1)}M`).join('+') || '-';
    return `${l} A ${b.uplift.toFixed(3)} R ${b.rRate.toFixed(4)} T ${t}`;
  }).join(' | '));
}
