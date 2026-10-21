// ============================================================================
// THE YEARLY ADVERSE RATE IS A PLACEHOLDER — THE GATE (stable-scenarios commit 4).
//
//   npx tsx scripts/diagnostics/adverse-rate-placeholder-check.ts
//
//   1. ZERO: YEARLY_ADVERSE_RATE is 0 on every line.
//   2. READ BY NOTHING: no file under src/ other than pricingParameters.ts
//      names it.
//   3. VALUE-NEUTRAL: the same games played with the rate set to 50% on every
//      line come back identical, field for field.
//   4. MARKED: its parameters-page entry is flagged not yet used and says
//      PLACEHOLDER.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a non-zero rate, a reader
// slipped in, a game that moves with it, and the flag dropped from the page.
// When the rate is wired, this gate is retired with it.
// ============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRICING_PARAMETER_SECTIONS, YEARLY_ADVERSE_RATE, type ParameterEntry } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { CoverageLine, GameSetupSettings, GameState, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../../src');
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// ---------------------------------------------------------------- 1
function gradeZero(rate: Record<CoverageLine, number>, tag: string) {
  check(LINES.every(l => rate[l] === 0), `${tag}1. the rate is 0 on every line`, LINES.map(l => `${l} ${rate[l]}`).join(', '));
}

// ---------------------------------------------------------------- 2
const files: { file: string; text: string }[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push({ file: path.relative(SRC, p), text: readFileSync(p, 'utf8') });
  }
};
walk(SRC);
function gradeReaders(all: { file: string; text: string }[], tag: string) {
  const readers = all.filter(f => f.file !== path.join('data', 'pricingParameters.ts') && f.text.includes('YEARLY_ADVERSE_RATE'));
  check(readers.length === 0, `${tag}2. nothing under src/ reads it`,
    `${all.length} files scanned${readers.length ? `; read by ${readers.map(r => r.file).join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- 3
function play(id: string): ResultSet[] {
  const { setup, instance } = openSoloInstance({ poolName: 'A', gameLength: 6, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState;
  const out: ResultSet[] = [...(earlyPreGameHistory ?? []), ...priorHistory];
  for (let y = 1; y <= 6; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    out.push(p.result);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return out;
}
const IDS = ['ARP1', 'ARP2'];
const atZero = IDS.map(id => JSON.stringify(play(id)));
const mutable = YEARLY_ADVERSE_RATE as Record<CoverageLine, number>;
for (const l of LINES) mutable[l] = 0.5;
const atHalf = IDS.map(id => JSON.stringify(play(id)));
for (const l of LINES) mutable[l] = 0;
function gradeNeutral(other: string[], tag: string) {
  const differ = atZero.filter((s, i) => s !== other[i]).length;
  check(differ === 0, `${tag}3. value-neutral: games at 50% match games at 0%`,
    `${IDS.length} six-year games, ${atZero.reduce((a, s) => a + s.length, 0).toLocaleString('en-US')} characters compared; ${differ} differ`);
}

// ---------------------------------------------------------------- 4
const entryOf = (name: string): ParameterEntry | undefined =>
  PRICING_PARAMETER_SECTIONS.flatMap(s => s.entries).find(([n]) => n === name)?.[1];
function gradePage(e: ParameterEntry | undefined, tag: string) {
  check(e !== undefined && e.notYetUsed === true && e.what.includes('PLACEHOLDER'),
    `${tag}4. its page entry is flagged not yet used and says PLACEHOLDER`);
}

console.log('THE YEARLY ADVERSE RATE IS A PLACEHOLDER');
gradeZero(YEARLY_ADVERSE_RATE, '');
gradeReaders(files, '');
gradeNeutral(atHalf, '');
gradePage(entryOf('Yearly adverse development'), '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a non-zero rate', () => gradeZero({ WC: 0, GL: 0.01, Property: 0 }, ''), '1.');
controlFails('a reader slipped in', () => gradeReaders([...files, { file: 'utils/hostDevelopment.ts', text: 'YEARLY_ADVERSE_RATE[line]' }], ''), '2.');
controlFails('a game that moves with it', () => gradeNeutral(atHalf.map((s, i) => (i === 0 ? s.replace(/"endingSurplus":(\d)/, '"endingSurplus":9$1') : s)), ''), '3.');
controlFails('the flag dropped from the page', () => {
  const e = entryOf('Yearly adverse development');
  gradePage(e ? { ...e, notYetUsed: undefined } : undefined, '');
}, '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the yearly adverse rate is 0, read by nothing, value-neutral, and marked a placeholder.');
