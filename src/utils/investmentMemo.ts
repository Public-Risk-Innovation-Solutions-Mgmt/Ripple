// ============================================================================
// THE INVESTMENT MEMO'S FIGURES COME FROM THE ENGINE, NOT FROM THE PROSE.
//
// ⚠ WHAT THIS FIXES, AND IT WAS A LIVE DEFECT RATHER THAN A TIDY-UP.
// investmentMemo.md carried the asset table as literal text — "Cash | 4.19% |
// 0.40% | 0.040%" — and opened with a comment asserting "EVERY FIGURE BELOW
// MATCHES THE ENGINE EXACTLY". Both were true when written and neither was
// checked by anything. defaultAssumptions.ts had already named it: the memo
// "restates this table downstream rather than sourcing it". The moment the
// returns moved, a player-facing document would have quoted the old market back
// at them, with a comment in the file promising it did not.
//
// This is the same class of defect already closed on the export headers and the
// audit page, and it is closed the same way: THE DOCUMENT ASKS, IT DOES NOT
// REMEMBER.
//
// ⚠ SUBSTITUTION, NOT A GENERATED DOCUMENT, AND THE CHOICE IS DELIBERATE.
// riskControlMemo.ts builds its memo in TypeScript because its CONTENT is
// conditional — the program list depends on the lines the pool writes. This
// memo's content is not conditional; only two values in it are. Rewriting 150
// lines of the author's prose into template literals to reach two numbers would
// move the whole document out of the file where it can be read and edited as
// prose, for no gain. The tokens stay in the markdown and the values arrive
// here.
//
// ⚠ VISIBLE TOKENS, NOT HTML COMMENTS, SO A FAILURE IS LOUD. `{{ASSET_CLASS_
// TABLE}}` renders as itself if substitution is ever skipped, where a
// `<!-- -->` placeholder would render as nothing and the memo would quietly
// lose its table. assertFilled() turns that into a throw instead, and the
// Departments document is in the render baseline, so a changed table is caught
// there too.
//
// ⚠ GROSS RETURN, AS BEFORE. The table's "Expected return" column shows the
// GROSS mean, before fees, with the fee in its own column beside it; a net
// figure there would count the fee twice against the column next to it.
// ============================================================================
// ⚠ AND THE ALLOCATION IS THE POOL'S, NOT THE DEFAULT. The memo now says what
// the Pool "currently holds": the pool-wide allocation in force — the latest
// year's (the last pre-game year's before year 1, then the year just played),
// as Decision History shows it. currentAllocation reads it.
// ============================================================================
import { ASSET_CLASS_ASSUMPTIONS } from '../data/defaultAssumptions';
import type { AssetAllocation, GameState } from '../types/simulation';
import { formatPct } from './formatters';

/** The class order the memo's prose introduces them in. Not object order. */
const ORDER: (keyof typeof ASSET_CLASS_ASSUMPTIONS)[] = ['cash', 'bonds', 'equities'];
const LABEL: Record<string, string> = { cash: 'Cash', bonds: 'Bonds', equities: 'Equities' };

/**
 * The body rows of the memo's table, from the constants: the expected return
 * before fees, two decimals, and the fee, three — the precision the audit page
 * uses, so the two player-facing surfaces agree digit for digit.
 */
function assetClassTable(): string {
  return ORDER.map(k => {
    const a = ASSET_CLASS_ASSUMPTIONS[k];
    return `| ${LABEL[k]} | ${formatPct(a.expectedReturn, 2)} | ${formatPct(a.feeRate, 3)} |`;
  }).join('\n');
}

/** The pool-wide allocation in force: the latest year's, played or pre-game. */
export function currentAllocation(gs: GameState): AssetAllocation {
  const latest = gs.lockedResults.at(-1) ?? gs.priorHistory.at(-1);
  return latest?.pool?.assetAllocation ?? gs.currentDecisions.assetAllocation;
}

/**
 * The investment memo with its figures filled from the game.
 *
 * ⚠ IT THROWS ON AN UNFILLED TOKEN rather than shipping one to a player. A
 * mistyped token is a document that silently lost a paragraph, and a blank
 * tab in development is a far cheaper way to find that out than a screenshot
 * from a game.
 */
export function buildInvestmentMemo(raw: string, allocation: AssetAllocation): string {
  const tokens: Record<string, string> = {
    '{{ASSET_CLASS_TABLE}}': assetClassTable(),
    '{{cash}}': allocation.cashPct.toFixed(0),
    '{{bonds}}': allocation.bondsPct.toFixed(0),
    '{{equities}}': allocation.equitiesPct.toFixed(0),
  };
  let out = raw;
  for (const [token, value] of Object.entries(tokens)) out = out.split(token).join(value);
  // ⚠ THE SCAN SKIPS HTML COMMENTS, AND THE FIRST VERSION DID NOT — IT THREW ON
  // ITS OWN DOCUMENTATION. The markdown's authoring note names the token shape,
  // and renderMarkdown strips `<!-- -->` before anything is displayed, so only
  // the RENDERED body has to be clean.
  const body = out.replace(/<!--[\s\S]*?-->/g, '');
  const leftover = body.match(/\{\{[A-Za-z_]+\}\}/);
  if (leftover) {
    throw new Error(`buildInvestmentMemo: ${leftover[0]} is not a known token. `
      + `Known: ${Object.keys(tokens).join(', ')}`);
  }
  return out;
}
