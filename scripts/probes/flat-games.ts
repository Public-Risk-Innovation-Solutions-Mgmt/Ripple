// B, D, E. ARM=today|change NODE_OPTIONS="--import <abs>/flat-register.mjs" npx tsx scripts/probes/flat-games.ts --games 50 --from 0
import { ARM, LINES } from './flat-setup';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { openSoloInstance } from '../../src/utils/soloGame';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { reinsuranceOptionsFor, defaultReinsuranceOption } from '../../src/utils/reinsuranceOptions';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { resolveShockYear } from '../../src/utils/shockLosses';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const GAMES = arg('--games', 50), FROM = arg('--from', 0), YEARS = 10, W = 10;
const DEF = Object.fromEntries(LINES.map(l => [l, defaultReinsuranceOption(l)])) as Record<CoverageLine, string>;
const ARMS: { name: string; option: Record<CoverageLine, string> }[] = [
  { name: 'none (all lines)', option: { WC: 'none', GL: 'none', Property: 'none' } }, { name: 'default (all lines)', option: DEF }];
for (const l of LINES) for (const o of reinsuranceOptionsFor(l)) if (o.id !== 'none' && o.id !== DEF[l]) ARMS.push({ name: `${l} ${o.id}, others default`, option: { ...DEF, [l]: o.id } });
const acc = new Map<string, Record<string, number[]>>();
const push = (k: string, f: string, v: number) => { const a = acc.get(k) ?? (acc.set(k, {}), acc.get(k)!); (a[f] ??= []).push(v); };
const statement: Record<string, unknown>[] = [];
for (let g = FROM; g < FROM + GAMES; g++) {
  const id = `FLAT${String(g).padStart(4, '0')}`;
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES } as never);
  const ph = runPriorHistory(instance, setup);
  const pre = [...ph.earlyPreGameHistory, ...ph.priorHistory];
  if (pre.length !== 5) throw new Error(`pre-game has ${pre.length} years`);
  pre.forEach((r, i) => { for (const l of LINES) { const x = r.byLine[l] as LineResultSet;
    push(`pre|${l}|y${i - 4}`, 'lr', x.actualLossRatio); push(`pre|${l}|y${i - 4}`, 'rate', x.ratePer100); push(`pre|${l}|y${i - 4}`, 'inv', x.investmentIncome);
    if (g === FROM) statement.push({ line: l, year: r.yearNumber, premium: x.totalMemberCharge, incurred: x.netIncurredLoss, lae: x.laeIncurred, uw: x.underwritingIncome,
      inv: x.investmentIncome, net: x.netIncome, reserve: x.endingNetReserve, surplus: x.endingSurplus, lr: x.actualLossRatio, rate: x.ratePer100 }); } });
  const shockYear = Array.from({ length: YEARS }, (_, i) => resolveShockYear(instance, 'host', i + 1));
  for (const arm of ARMS) {
    let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState: ph.poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory: ph.priorHistory } as GameState);
    const per: Record<string, LineResultSet[][]> = {}; for (const l of LINES) per[l] = Array.from({ length: W }, () => []);
    const pool: number[][] = Array.from({ length: W }, () => []);
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y); for (const l of LINES) d.byLine[l].reinsuranceOption = arm.option[l];
      const played = playWorldsYear(gs, d);
      const settled = settleWorldsYear(gs, played, played.loanOffers.map(o => o.line));
      gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1 };
      settled.worlds!.forEach((w, i) => { for (const l of LINES) per[l][i].push(w.lockedResults[y - 1].byLine[l] as LineResultSet); pool[i].push(w.lockedResults[y - 1].endingSurplus); });
    }
    for (let w = 0; w < W; w++) {
      const k0 = `${arm.name}|POOL`; push(k0, 's5', pool[w][4]); push(k0, 's10', pool[w][9]); push(k0, 'neg', pool[w].some(x => x < 0) ? 1 : 0);
      for (const l of LINES) {
        const rs = per[l][w], k = `${arm.name}|${l}`;
        push(k, 's5', rs[4].endingSurplus); push(k, 's10', rs[9].endingSurplus); push(k, 'neg', rs.some(r => r.endingSurplus < 0) ? 1 : 0);
        rs.forEach((r, i) => {
          const sy = shockYear[i].byLine[l], shock = sy.uplift > 0 || sy.arrivals.length > 0;
          push(k, shock ? 'aeShock' : 'aeReg', r.grossUltimateLoss / Math.max(r.expectedLoss, 1));
          push(k, 'uw', r.underwritingIncome); push(k, 'rate', r.ratePer100); push(k, 'reins', r.reinsuranceCost); push(k, 'rec', r.reinsuranceRecovery);
          if (i > 0) push(k, 'dRate', r.ratePer100 / rs[i - 1].ratePer100 - 1);
        });
      }
    }
  }
  console.error(`${ARM} game ${g} done`);
}
console.log(`Measured at ${process.env.MEASURE_SHA}; arm ${ARM}; WC+GL+Property solo games ${FROM}..${FROM + GAMES - 1}, ${YEARS} yrs x ${W} worlds, default decisions, loans authorised`);
console.log('STATEMENT ' + JSON.stringify(statement));
console.log('JSON ' + JSON.stringify([...acc.entries()]));
