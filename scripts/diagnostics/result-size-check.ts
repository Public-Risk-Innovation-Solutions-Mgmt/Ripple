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
//                              lines, at default decisions: 64 KB — the
//                              AVERAGED row since commit 4b, which is the one
//                              the pages read and the session posts from
//   SAVE_10Y_STORED_BUDGET     the save at year ten as stored (packSave):
//                              1,400 KB since Prompt B commit 1 (1,464 KB at
//                              Prompt A commit 1, 1,280 KB from commit 4b,
//                              256 KB before)
//
// ⚠ THE SAVE BUDGET WAS RESTATED FOR TEN WORLDS (loss engine commit 4b), AND
// THIS IS WHY. The brief keeps each world's results, and each world carries its
// own ledger, cohorts and played years, so the save holds ten of each. Measured
// over these three games at year ten:
//
//     one world (3a's game)                          175 KB stored
//     ten worlds, every world row whole            1,829 KB stored
//     ten worlds, world rows without their per-
//       accident-year reserve split (gameSave's
//       WORLD_ROW_STRIPPED_KEYS)                   1,066 KB stored
//
// 6.1x one world rather than 10x, because the pre-game, the opening and the
// averaged state are stored once. 1,280 KB is that with a fifth for ordinary
// growth, and it sits inside save-size-check's 1,500,000-character threshold
// (the save at year ten measured 1,103,440 characters there, 21% of the
// browser's quota). The result budget did not move: the averaged year is 59 KB.
//
// ⚠ AND RESTATED AGAIN FOR ROUTINE LARGE LOSSES (Prompt A commit 1), TO
// 1,464 KB — WHICH IS save-size-check's OWN 1,500,000-CHARACTER THRESHOLD, SO
// THERE IS NO ROOM LEFT FOR ORDINARY GROWTH. Routine claims above the ordinary
// limit now arrive every year, each one an individual claim that every world
// carries in its cohorts and its year's row. Measured at year ten over these
// three games: 1,440 KB stored (was within 1,280), and save-size-check's game
// 1,467,944 characters, 98% of its threshold and 28% of the browser's quota.
// This is the loss model the brief asked for, not member detail coming back,
// so the budget follows it — but a game longer than ten years now crosses
// save-size-check's threshold, and the next growth has to slim the save
// (the world rows' claim lists are the first candidate), not move this line.
//
// ⚠ AND RESET TO 1,400 KB AT PROMPT B COMMIT 1, BELOW THE THRESHOLD, WITH ROOM.
// Two things freed space: the ten-year opening window (Prompt A commit 2) took
// the year-ten save from 1,440 KB to 1,287 KB, and worlds 2-10 now drop their
// claim and occurrence lists once a year settles (OTHER_WORLD_ROW_STRIPPED_KEYS
// in gameSave; world 1 keeps its own for the claims download), which takes it
// to 1,233 KB. 1,400 KB is that plus 167 KB: room for book units held as pool
// state — measured with synthetic units, 60 per line in every world, at about
// +97 KB stored — and for ordinary growth, while staying 64 KB under
// save-size-check's 1,464 KB so this gate fires before the browser-quota one.
// ⚠ BOOK UNITS DO NOT FIT AS A PER-YEAR RECORD IN EVERY WORLD'S ROWS: the same
// units written into each world's year rows measured +1,049 KB.
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
export const SAVE_10Y_STORED_BUDGET = 1400 * 1024;

const m = measureSizes(3);
const failed: string[] = [];
const KB = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const check = (ok: boolean, label: string) => {
  if (!ok) failed.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}`);
};

console.log('=== RESULT SIZE — three three-line games, ten worlds, default decisions, means ===');
check(m.result5 <= RESULT_BUDGET_BYTES,
  `one year's result ${KB(m.result5)} within ${KB(RESULT_BUDGET_BYTES)}`);
check(m.save10Packed <= SAVE_10Y_STORED_BUDGET,
  `the save at year ten ${KB(m.save10Packed)} stored within ${KB(SAVE_10Y_STORED_BUDGET)}`);
console.log(`        (save at year five ${KB(m.save5Packed)} stored; raw ${KB(m.save5Raw)} and ${KB(m.save10Raw)}; `
  + `${m.msPerYear.toFixed(0)} ms per year, every world)`);

console.log(failed.length === 0 ? '\nTHE RESULT AND THE SAVE ARE INSIDE THEIR BUDGETS.' : `\n${failed.length} FAILURE(S).`);

// ============================================================================
// ⚠ THE CONTROL — RUN AND RECORDED. With MEMBER_LEVEL switched back on (the
// override loader, nothing edited), the per-member records and their claims
// return: EXIT 1, one year's result 623.5 KB and the save at year ten 1,057.6 KB
// stored, both far over budget. Off again, green.
//
// RE-RUN AT LOSS ENGINE COMMIT 4b: EXIT 1 on the result, 952.9 KB against 64 KB.
// The member path runs ONE world, so its save (1,127.7 KB) now sits inside the
// ten-world budget; the save budget's own control is the measurement in the
// header — ten worlds with every world row whole, 1,829 KB stored, over it.
// ============================================================================
process.exit(failed.length === 0 ? 0 : 1);
