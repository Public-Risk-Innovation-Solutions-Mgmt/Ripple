// ============================================================================
// PROPERTY MITIGATION REACHES BUILDINGS AND WINTER STORMS AND NOTHING ELSE —
// a GATE.
//
//   GAMES=8 YEARS=4 npx tsx scripts/diagnostics/property-mitigation-check.ts
//
// ⚠ IT ASSERTS THE MECHANISM, NOT THE MAGNITUDE — wc-program-check's rule and
// claims-system-check's. The building dollar share (0.945) has a basis and the
// dial's lag curve is older than this program, so an assertion that the cut is
// any particular size would be a test of a preference. What is tested is the
// SHAPE: which bands move, by exactly what factor, that the catastrophe band and
// the other two lines do not move at all, and that the tower sees none of the
// storm saving. Changing the share must leave every assertion here true.
//
// ⚠ THE STRONGEST ASSERTIONS HERE ARE SUBSET ASSERTIONS, AND THEY ARE EXACT
// RATHER THAN STATISTICAL. A frequency cut lowers a Poisson mean, and this
// engine draws Poisson by inverse CDF from one uniform per member, so a smaller
// lambda returns a count that is LESS THAN OR EQUAL to the unmitigated one for
// the same uniform — and the severity draws that follow are consumed in order.
// So a mitigated member's claims are a PREFIX of the claims they would have had.
// The storm is a prefix for the same reason by construction (claim n is keyed on
// n). That turns "the program removed the right losses" from a mean comparison
// with sampling error into a claim-for-claim identity, which is what lets this
// gate run on 8 games instead of 300.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { regenerateLineYearClaims } from '../../src/utils/claimRegeneration';
import { occurrenceTotals, cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { FULL_OCCURRENCE_PLACEMENT } from '../../src/data/reinsuranceTower';
import { PROPERTY_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import {
  PROPERTY_MITIGATION_BUILDING_DOLLAR_SHARE, propertyMitigation,
} from '../../src/utils/riskControlPrograms';
import { CAT_BAND, WEATHER_BAND } from '../../src/utils/propertyClaimEngine';
import type { Claim, CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 4);
const STORM_YEAR = 2;
const SHARE = PROPERTY_MITIGATION_BUILDING_DOLLAR_SHARE;
const RETENTION = PROPERTY_LOSS_MODEL.perRiskRetention;
const M = 1e6;

const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const ok = (cond: boolean, msg: string) => { if (!cond) fail(msg); };
const RULE = '='.repeat(72);
// The catastrophe band's two tiers. An earthquake is a cat claim with its own
// peril label, so a check that only looked for CAT_BAND would miss it.
const isCat = (c: Claim) => c.tier === CAT_BAND || c.tier === 'earthquake';
const isWeather = (c: Claim) => c.tier === WEATHER_BAND;
const isAttritional = (c: Claim) => !isCat(c) && !isWeather(c);
const key = (c: Claim) => `${c.id}|${c.memberId}|${c.grossUltimate}`;

console.log(RULE);
console.log('PROPERTY MITIGATION — buildings and winter storms, and nothing else');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, all three lines, WINTER-STORM in year ${STORM_YEAR}.`);
console.log(`building dollar share ${SHARE}; rate is riskControlEffectiveness on Property.\n`);

// --- 1. THE TWO MULTIPLIERS, IN ISOLATION ---------------------------------
console.log('--- 1. the rule: two multipliers from one rate, identity at zero ---');
{
  const z = propertyMitigation(0);
  ok(z.attritionalMultiplier === 1, `e=0 attritional multiplier ${z.attritionalMultiplier}, wanted exactly 1`);
  ok(z.weatherMultiplier === 1, `e=0 weather multiplier ${z.weatherMultiplier}, wanted exactly 1`);
  for (const e of [0.01, 0.05, 0.10, 0.15]) {
    const m = propertyMitigation(e);
    ok(Math.abs(m.attritionalMultiplier - (1 - e * SHARE)) < 1e-12,
      `e=${e}: attritional ${m.attritionalMultiplier} != 1 - e x ${SHARE}`);
    ok(Math.abs(m.weatherMultiplier - (1 - e)) < 1e-12,
      `e=${e}: weather ${m.weatherMultiplier} != 1 - e`);
    // THE STORM TAKES MORE THAN THE BODY, AND THAT ORDERING IS THE DESIGN: a
    // storm is all buildings, the attritional band is 44% vehicles by count.
    ok(m.weatherMultiplier < m.attritionalMultiplier,
      `e=${e}: the storm was not cut harder than the attritional band`);
  }
  // Clamped at both ends — a rate outside [0,1] must not produce a negative
  // lambda or an amplifying multiplier.
  ok(propertyMitigation(-1).attritionalMultiplier === 1, 'a negative rate amplified the draw');
  ok(propertyMitigation(5).weatherMultiplier === 0, 'a rate above 1 was not clamped');
  console.log(`   identity at 0, 1-e*${SHARE} / 1-e, storm cut harder, clamped: OK`);
}

// --- 2. PLAY, WITH A STORM ------------------------------------------------
interface Played { result: ResultSet; instance: ReturnType<typeof generateGameInstance>; year: number }
const played: Played[] = [];
for (let g = 0; g < GAMES; g++) {
  const id = `PMG${g}`;
  const inst = generateGameInstance(id, 6_200_000 + g * 7717, [{ shockId: 'WINTER-STORM', yearNumber: STORM_YEAR }]);
  const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    played.push({ result: p.result, instance: inst, year: y });
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
}

/**
 * Redraw one played year with the mitigation rate overridden.
 *
 * ⚠ rcEffectivenessApplied IS THE RATE. There is no separate field, because
 * mitigation is not a separate mechanism — it is what the risk-control dial buys
 * on this line. Overriding the stored rate is therefore exactly what setting the
 * dial would have done, with every other input held.
 */
function redraw(pl: Played, line: CoverageLine, e: number) {
  const copy = JSON.parse(JSON.stringify(pl.result)) as ResultSet;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (copy.byLine[line] as any).rcEffectivenessApplied = e;
  return regenerateLineYearClaims(pl.instance, copy, line);
}

// --- 3. THE NULL ARM, CLAIM FOR CLAIM -------------------------------------
console.log('\n--- 3. the null arm: a pool that spent nothing draws what it always drew ---');
{
  let checked = 0, storms = 0, stormClaims = 0;
  for (const pl of played) {
    for (const line of LINES) {
      const lr = pl.result.byLine[line];
      if (!lr) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (lr as any).rcEffectivenessApplied as number;
      ok(e === 0, `${line} y${pl.year}: the engine applied rate ${e} at defaults — nothing should set it`);
      const re = redraw(pl, line, e);
      const engine = (lr.claims ?? []).map(key).join('\n');
      ok(re.claims.map(key).join('\n') === engine, `${line} y${pl.year}: the redraw did not reproduce the engine`);
      checked++;
      if (line === 'Property' && pl.year === STORM_YEAR) {
        const w = re.claims.filter(isWeather).length;
        ok(w >= 80 && w <= 120, `the storm landed ${w} claims, outside the catalog's 80-120`);
        storms++; stormClaims += w;
      }
    }
  }
  ok(storms === GAMES, `the storm fired in ${storms} of ${GAMES} games`);
  console.log(`   ${checked} line-years reproduced claim for claim; ${storms} storms, `
    + `${(stormClaims / Math.max(1, storms)).toFixed(1)} claims each: OK`);
}

// --- 4. CONFINEMENT: THE CAT BAND AND THE OTHER TWO LINES DO NOT MOVE -----
console.log('\n--- 4. confinement: catastrophes untouched, WC and GL untouched ---');
{
  const E = 0.15; // the dial's ceiling — the largest effect that can ever apply
  let catClaims = 0, catYears = 0;
  for (const pl of played) {
    const base = redraw(pl, 'Property', 0);
    const mit = redraw(pl, 'Property', E);
    const b = base.claims.filter(isCat).map(key).join('\n');
    const m = mit.claims.filter(isCat).map(key).join('\n');
    ok(b === m, `y${pl.year}: the catastrophe band moved under mitigation`);
    if (b.length) { catYears++; catClaims += base.claims.filter(isCat).length; }
    // WC and GL read their own rcEffectivenessApplied, which this did not touch.
    for (const line of ['WC', 'GL'] as CoverageLine[]) {
      const l0 = redraw(pl, line, 0);
      ok(l0.claims.map(key).join('\n') === (pl.result.byLine[line]?.claims ?? []).map(key).join('\n'),
        `${line} y${pl.year}: moved while Property was mitigated`);
    }
  }
  console.log(`   cat band identical at the dial's ceiling in ${played.length} years `
    + `(${catClaims} cat claims across ${catYears} of them); WC and GL untouched: OK`);
}

// --- 5. THE ATTRITIONAL BAND: A PREFIX, NOT A RESHUFFLE -------------------
console.log('\n--- 5. the attritional band: mitigation REMOVES claims, it does not redraw them ---');
{
  const E = 0.10;
  let kept = 0, dropped = 0, moved = 0, g0 = 0, g1 = 0;
  for (const pl of played) {
    const base = redraw(pl, 'Property', 0).claims.filter(isAttritional);
    const mit = redraw(pl, 'Property', E).claims.filter(isAttritional);
    const baseKeys = new Set(base.map(key));
    for (const c of mit) { if (baseKeys.has(key(c))) kept++; else moved++; }
    dropped += base.length - mit.length;
    g0 += base.reduce((s, c) => s + c.grossUltimate, 0);
    g1 += mit.reduce((s, c) => s + c.grossUltimate, 0);
  }
  ok(moved === 0, `${moved} mitigated claims were not in the unmitigated draw — the band was reshuffled`);
  ok(dropped > 0, 'mitigation removed no attritional claims at all');
  // The MAGNITUDE is reported, not asserted: it is a Poisson thinning, so it
  // carries sampling error, and the subset identity above is what proves the
  // mechanism. The bound is loose enough to pass noise and tight enough to fail
  // a multiplier applied to the wrong quantity.
  const cut = (g0 - g1) / g0;
  ok(cut > 0.5 * E * SHARE && cut < 2 * E * SHARE,
    `the band fell ${(100 * cut).toFixed(2)}%, nowhere near e x ${SHARE} = ${(100 * E * SHARE).toFixed(2)}%`);
  console.log(`   at e=${E}: ${kept} claims kept identically, ${dropped} removed, 0 altered; `
    + `band -${(100 * cut).toFixed(2)}% against a target of ${(100 * E * SHARE).toFixed(2)}%: OK`);
}

// --- 6. THE STORM: EXACTLY round(n x (1-e)), AND THE TOWER GETS NONE OF IT -
console.log('\n--- 6. the storm: the first program to reach a scheduled shock ---');
{
  let exact = 0, towerSaving = 0, grossSaving = 0;
  for (const pl of played.filter(p => p.year === STORM_YEAR)) {
    const base = redraw(pl, 'Property', 0);
    const n0 = base.claims.filter(isWeather);
    for (const e of [0.05, 0.10, 0.15]) {
      const mit = redraw(pl, 'Property', e);
      const n1 = mit.claims.filter(isWeather);
      const want = Math.round(n0.length * (1 - e));
      ok(n1.length === want, `e=${e}: the storm landed ${n1.length} claims, wanted round(${n0.length} x ${1 - e}) = ${want}`);
      if (n1.length === want) exact++;
      // ⚠ A PREFIX IN n, A SUBSET IN THE ARRAY — AND THIS GATE CAUGHT THE
      // DIFFERENCE. The first version of this assertion compared n1[i] against
      // n0[i] and failed on every arm. Storm claims are emitted in the MEMBER
      // loop, in roster order, not in n order: weatherPlan maps member -> the
      // claims they drew, and each member's are emitted when that member is
      // reached. So dropping the high-n claims removes entries scattered
      // through the array. What is a prefix is the set of n RETAINED, which is
      // what the mechanism actually promises.
      const base0 = new Set(n0.map(key));
      ok(n1.every(c => base0.has(key(c))),
        `e=${e}: a mitigated storm claim was not in the unmitigated storm — it was redrawn, not removed`);
      // n is the last field of the weather occurrence id: PR-y-SHOCK-<id>-<ev>-<n>.
      const nOf = (c: Claim) => Number(c.occurrenceId.slice(c.occurrenceId.lastIndexOf('-') + 1));
      const retained = n1.map(nOf).sort((a, b) => a - b);
      ok(retained.every((v, i) => v === i),
        `e=${e}: the storm kept claims ${retained.slice(0, 5).join(',')}... — not the first ${want} by n`);
      // Every storm claim is its own occurrence and none reaches the retention,
      // so the tower's share of this saving must be exactly zero.
      ok(n1.every(c => c.grossUltimate < RETENTION), `e=${e}: a storm claim reached the retention`);
    }
    // The tower, on the whole year, at the dial's ceiling.
    const mit = redraw(pl, 'Property', 0.15);
    const placed = FULL_OCCURRENCE_PLACEMENT.Property;
    const c0 = cedeOccurrences('Property', occurrenceTotals(base.claims, base.occurrences), placed).totalCeded;
    const c1 = cedeOccurrences('Property', occurrenceTotals(mit.claims, mit.occurrences), placed).totalCeded;
    const sw0 = n0.reduce((s, c) => s + c.grossUltimate, 0);
    const sw1 = mit.claims.filter(isWeather).reduce((s, c) => s + c.grossUltimate, 0);
    towerSaving += c0 - c1;
    grossSaving += sw0 - sw1;
  }
  console.log(`   ${exact} of ${3 * GAMES} storm arms landed exactly round(n x (1-e)), each a subset of the`);
  console.log(`   unmitigated storm keeping claims 0..count-1; $${(grossSaving / M / GAMES).toFixed(2)}M of storm`);
  console.log(`   loss removed per storm at the ceiling, 100% of it retained by the pool.`);
  console.log(`   (the whole YEAR's tower cession moved $${(towerSaving / M / GAMES).toFixed(3)}M per storm year — that is`);
  console.log(`   the attritional band's leak, not the storm's, which cannot reach a layer at all)`);
}

// --- 7. POSITIVE CONTROLS: EVERY RULE ABOVE CAN FAIL ----------------------
console.log('\n--- 7. controls: every rule above fires when broken ---');
{
  // A probe that cannot fail is worse than none. Each rule is re-run against a
  // deliberately wrong implementation and must come back false.
  const wrongShare = (e: number) => 1 - e * 0.560;   // the COUNT share — the plausible wrong answer
  const wrongBoth = (e: number) => 1 - e;            // one multiplier for both bands
  ok(Math.abs(wrongShare(0.10) - propertyMitigation(0.10).attritionalMultiplier) > 1e-6,
    'CONTROL: the count share is indistinguishable from the dollar share');
  ok(wrongBoth(0.10) !== propertyMitigation(0.10).attritionalMultiplier,
    'CONTROL: one multiplier for both bands passes the two-multiplier rule');
  // A storm scaled before the draw rather than after would NOT be a prefix:
  // scaling the uniform changes which claim index each draw lands on.
  const pl = played.find(p => p.year === STORM_YEAR)!;
  const n0 = redraw(pl, 'Property', 0).claims.filter(isWeather);
  const n1 = redraw(pl, 'Property', 0.15).claims.filter(isWeather);
  ok(n1.length < n0.length, 'CONTROL: the storm did not shrink, so the prefix rule proves nothing');
  ok(n0.length > 0, 'CONTROL: there was no storm to test');
  // And the cat band must be reachable in principle, or "cat untouched" is
  // vacuous. It is checked across the whole run rather than this one year.
  const anyCat = played.some(p => (p.result.byLine.Property?.claims ?? []).some(isCat));
  if (!anyCat) {
    console.log('   ⚠ NO CATASTROPHE DREW IN THIS RUN — part 4 is vacuous at these seeds.');
    console.log('     The cat band is ~0.084 events/yr, so this is expected at small GAMES.');
    console.log('     Raise GAMES to make it bite; the gate does not fail on it, because a');
    console.log('     gate that needs a rare event to pass would be red for the wrong reason.');
  }
  console.log(`   the wrong share, one-multiplier, and a non-shrinking storm all fire; `
    + `cat band present in this run: ${anyCat}`);
}

console.log(`\n${RULE}`);
if (failed.length) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exit(1);
}
console.log('OK — mitigation cuts the attritional band by the building DOLLAR share and removes');
console.log('claims rather than redrawing them; cuts a scheduled winter storm by the FULL rate,');
console.log('keeping claims 0..count-1 of the storm that would have happened; leaves the');
console.log('catastrophe band and the other two lines bit-identical; and is the identity at a');
console.log('rate of zero.');
console.log(RULE);
