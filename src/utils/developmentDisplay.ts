// ============================================================================
// ONE CONVENTION FOR RESERVE DEVELOPMENT, EVERYWHERE IT IS PRINTED.
//
//   Adverse    (the estimate rose)  RED,   plus sign,  the word:  +$0.6M adverse
//   Favourable (the estimate fell)  GREEN, minus sign, the word:  -$0.6M favourable
//
// Recorded in docs/PENDING_MULTIPLAYER.md §2 before development returned, and
// applied here to every display at once: the Actuarial exhibit, the income
// statement and the results page.
//
// ⚠ THE INCOME STATEMENT USED THE OPPOSITE SIGN AND IT CHANGES WITH THIS. A
// reader who saw "+$0.6M" on one tab and "-$0.6M" on the next for the same
// event would be owed an explanatory paragraph, and the point of settling the
// convention before the mechanism landed was that no such paragraph is ever
// written. The ENGINE's field keeps its own sign — `priorYearDevelopment` is
// favourable-positive, because netIncurredLoss subtracts it — and what changes
// is how every page prints it. That split is deliberate: an engine field whose
// sign follows a display convention is an engine field that moves whenever a
// designer changes their mind.
//
// ⚠ THE WORD IS NOT DECORATION. "+$0.6M" alone is ambiguous to anyone who has
// not memorised which way the sign runs, and that is most readers most of the
// time. The sign, the colour and the word all say the same thing, so no one
// has to remember which of the three is authoritative.
// ============================================================================

/** Everything a page needs to print development the one agreed way. */
export interface DevelopmentDisplay {
  /** Signed for display: POSITIVE IS ADVERSE. Note this is the NEGATION of
   *  the engine's favourable-positive field. */
  signed: number;
  /** "+$0.6M adverse", "-$0.6M favourable", or "$0" when nothing moved. */
  text: string;
  /** 'adverse' | 'favourable' | 'none' — for a caller that styles its own. */
  direction: 'adverse' | 'favourable' | 'none';
  /** Tailwind colour class matching the convention. */
  className: string;
}

/**
 * @param favourablePositive the ENGINE's figure — `priorYearDevelopment` or
 *   any quantity on that convention, where positive means the estimate fell.
 * @param format how to render the magnitude in dollars.
 */
export function developmentDisplay(
  favourablePositive: number,
  format: (v: number) => string,
): DevelopmentDisplay {
  // ⚠ THE NEGATION IS THE WHOLE TRANSLATION, and it happens once, here.
  const signed = -favourablePositive;
  // A hair either side of zero is zero: a cohort that has fully run off can
  // leave float dust, and "+$0 adverse" is a worse answer than "$0".
  if (Math.abs(signed) < 0.5) {
    return { signed: 0, text: format(0), direction: 'none', className: 'text-gray-600' };
  }
  const adverse = signed > 0;
  return {
    signed,
    text: `${adverse ? '+' : '−'}${format(Math.abs(signed))} ${adverse ? 'adverse' : 'favourable'}`,
    direction: adverse ? 'adverse' : 'favourable',
    className: adverse ? 'text-red-600' : 'text-green-700',
  };
}

/** The same convention without the word — for a column whose HEADER already
 *  says it is development, where repeating the word on every row is noise. */
export function developmentSigned(
  favourablePositive: number,
  format: (v: number) => string,
): string {
  const signed = -favourablePositive;
  if (Math.abs(signed) < 0.5) return format(0);
  return `${signed > 0 ? '+' : '−'}${format(Math.abs(signed))}`;
}

/**
 * The same convention for a figure that is ALREADY adverse-positive — the
 * Actuarial exhibit's `oneYear` and `total`, which are current-minus-prior and
 * current-minus-initial and so rise when the estimate rises.
 *
 * ⚠ IT EXISTS SO THAT NOBODY NEGATES TWICE. The two memo columns and the two
 * results rows are on opposite engine conventions and print identically; the
 * only safe way to keep that true is for both to call something named for the
 * convention of its input.
 */
export function adverseSigned(
  adversePositive: number | null,
  format: (v: number) => string,
  withWord = false,
): string {
  if (adversePositive === null) return '';
  if (Math.abs(adversePositive) < 0.5) return format(0);
  const sign = adversePositive > 0 ? '+' : '\u2212';
  const word = withWord ? ` ${adversePositive > 0 ? 'adverse' : 'favourable'}` : '';
  return `${sign}${format(Math.abs(adversePositive))}${word}`;
}
