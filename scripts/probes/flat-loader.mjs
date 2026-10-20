// PROBE LOADER (measurement only) — rewrites four engine modules' TypeScript
// SOURCE on its way into this process, never on disk. Every rewrite reads a
// global the probe sets; with the globals unset each is numerically inert.
// Registered BEFORE tsx (see flat-register.mjs), so it sees raw .ts source.
const G = '(globalThis as any)';
const T = {
  'src/utils/priorHistoryEngine.ts': [
    // scenarios: the opening surplus the pre-game's starting surplus is solved to land on
    ['  const surplus = setOpeningSurplus(line, netUnpaidReserve, openingCatCapital(line, bookForCapital));',
     `  const surplus = ${G}.__OPEN_SURPLUS?.[line] ?? setOpeningSurplus(line, netUnpaidReserve, openingCatCapital(line, bookForCapital));`],
  ],
  'src/utils/shockSchedule.ts': [
    // Randomise: 2, 3 or 4 shocks per ten-year game
    ['  const count = Math.min(shockDrawCount(yearCount), years.length, events.length);',
     `  const count = Math.min((${G}.__SHOCK_COUNT?.(seed) ?? shockDrawCount(yearCount)), years.length, events.length);`],
  ],
  'src/utils/ordinaryLoss.ts': [
    // 1. the fold: routine cost added to the ordinary cost per $100, per line-year
    ['  return EXPECTED_ORDINARY_LOSS_COST_PER_100[line]',
     `  return (${G}.__FOLD?.(line, yearNumber) ?? 0) + EXPECTED_ORDINARY_LOSS_COST_PER_100[line]`],
    // 4. flat pre-game: no year factor and no unit factor in years <= 0
    ['  const factor = drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), typicalBookOrdinaryCv());',
     `  const factor = (${G}.__FLAT_PREGAME && yearNumber <= 0) ? (${G}.__PREGAME_LOSS_MULT ?? 1) : drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), typicalBookOrdinaryCv());`],
    ['  const year = drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), UNIT_ORDINARY_YEAR_CV);',
     `  const year = (${G}.__FLAT_PREGAME && yearNumber <= 0) ? (${G}.__PREGAME_LOSS_MULT ?? 1) : drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), UNIT_ORDINARY_YEAR_CV);`],
    ['  const ownFactors = Array.from({ length: UNIT_MARKET_COUNT }, () => drawOrdinaryFactor(own, UNIT_ORDINARY_OWN_CV));',
     `  const ownFactors = Array.from({ length: UNIT_MARKET_COUNT }, () => (${G}.__FLAT_PREGAME && yearNumber <= 0) ? 1 : drawOrdinaryFactor(own, UNIT_ORDINARY_OWN_CV));`],
  ],
  'src/utils/shockLosses.ts': [
    // 1. T is scaled off the UNFOLDED ordinary cost, so the fold does not grow shocks
    ['ordinaryLossCostPer100(line, yearNumber)) / rModelOrdinary(line)',
     `(ordinaryLossCostPer100(line, yearNumber) - (${G}.__FOLD?.(line, yearNumber) ?? 0))) / rModelOrdinary(line) * (${G}.__T_MULT?.[line] ?? 1)`],
  ],
  'src/utils/reinsuranceTower.ts': [
    // 3. price = E + lambda x SD of annual recovery, per layer
    ['    premium += layerPriceFrom(moments[i].expected);',
     `    premium += ${G}.__REINS_LAMBDA !== undefined ? moments[i].expected + ${G}.__REINS_LAMBDA * moments[i].sd : layerPriceFrom(moments[i].expected);`],
    ['  return layerPriceFrom(layerRiskMoments(line, layerIndex, members, yearNumber).expected);',
     `  { const m = layerRiskMoments(line, layerIndex, members, yearNumber); return ${G}.__REINS_LAMBDA !== undefined ? m.expected + ${G}.__REINS_LAMBDA * m.sd : layerPriceFrom(m.expected); }`],
  ],
  'src/utils/simulationEngine.ts': [
    // 4. flat pre-game: the expected return on each asset class, net of fee
    ['  const drawnMarket = simulateMarketReturns(',
     `  const drawnMarket = (${G}.__FLAT_PREGAME && yearNumber <= 0) ? ${G}.__FLAT_MARKET : simulateMarketReturns(`],
  ],
};
export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  const key = Object.keys(T).find(k => url.endsWith(k));
  if (!key) return r;
  let src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8');
  for (const [from, to] of T[key]) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`flat-loader: ${key} has ${n} copies of: ${from}`);
    src = src.replace(from, to);
  }
  // hooks run on their own thread, so the marker goes into the module itself
  src += `\n;(globalThis as any).__FLAT_LOADER_APPLIED = [...((globalThis as any).__FLAT_LOADER_APPLIED ?? []), '${key}'];\n`;
  return { ...r, source: src };
}
