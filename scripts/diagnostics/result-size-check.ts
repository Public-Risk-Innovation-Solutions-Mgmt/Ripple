// ============================================================================
// ONE YEAR'S RESULT AND THE SAVE STAY INSIDE THEIR BUDGETS — the gate the ten
// worlds stand on.
//
//   npx tsx scripts/diagnostics/result-size-check.ts
//
// Loss engine commit 3 cut individual members, and with them the per-member
// and per-claim detail that made one three-line year's result 953 KB and a
// ten-year save 1,127 KB stored. Measured after the cut: 52 KB and 175 KB.
// Ten worlds come next and multiply the result by ten, which is affordable
// only while it stays this small — so the budgets below are set with room for
// ordinary growth and none for the detail to come back.
//
//   RESULT_BUDGET_BYTES        one year's pooled ResultSet, raw JSON, three
//                              lines, at default decisions: 64 KB
//   SAVE_10Y_STORED_BUDGET     the save at year ten as stored (packSave): 256 KB
//
// Means over three games, measured by result-size-report's own function so the
// report and the gate cannot measure two different things. save-size-check
// still guards the browser's quota; this guards the size the game is designed
// around.
//
// ⚠ AND IT FAILS WHEN BROKEN — see THE CONTROL at the foot.
// ============================================================================

import { measureSizes } from '../tools/result-size-report';

export const RESULT_BUDGET_BYTES = 64 * 1024;
export const SAVE_10Y_STORED_BUDGET = 256 * 1024;

const m = measureSizes(3);
const failed: string[] = [];
const KB = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const check = (ok: boolean, label: string) => {
  if (!ok) failed.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}`);
};

console.log('=== RESULT SIZE — three three-line games, default decisions, means ===');
check(m.result5 <= RESULT_BUDGET_BYTES,
  `one year's result ${KB(m.result5)} within ${KB(RESULT_BUDGET_BYTES)}`);
check(m.save10Packed <= SAVE_10Y_STORED_BUDGET,
  `the save at year ten ${KB(m.save10Packed)} stored within ${KB(SAVE_10Y_STORED_BUDGET)}`);
console.log(`        (save at year five ${KB(m.save5Packed)} stored; raw ${KB(m.save5Raw)} and ${KB(m.save10Raw)})`);

console.log(failed.length === 0 ? '\nTHE RESULT AND THE SAVE ARE INSIDE THEIR BUDGETS.' : `\n${failed.length} FAILURE(S).`);

// ============================================================================
// ⚠ THE CONTROL — RUN AND RECORDED. With MEMBER_LEVEL switched back on (the
// override loader, nothing edited), the per-member records and their claims
// return: EXIT 1, one year's result 623.5 KB and the save at year ten 1,057.6 KB
// stored, both far over budget. Off again, green.
// ============================================================================
process.exit(failed.length === 0 ? 0 : 1);
