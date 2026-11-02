// ============================================================================
// THE RIPPLE SCORE — ⚠ A PLACEHOLDER UNTIL THE REAL SCORE IS DESIGNED.
//
// For now a team's Ripple Score is its rank by total surplus: the pool's net
// surplus for the year the standings show, 1 for the highest. Ties share a
// rank (standard competition ranking: two teams level at the top are both 1st
// and the next is 3rd). The rank is the pool's, so every line view shows the
// same one. It is worked out from the standings each team has already posted
// (RoomView.standings / the host's TeamViews) — no engine, save or session
// contract is involved — and shown as an ordinal alone, with no figure beside it.
// A team with no pool figures posted for the year has no rank.
//
// Replace this module when the Ripple Score is designed; StandingsTable reads
// it and nothing else does.
// ============================================================================

/** Rank by surplus, highest first; equal surpluses share a rank. Teams with no surplus are left out. */
export function rippleScoreRanks(surplusByTeam: Readonly<Record<string, number | undefined>>): Record<string, number> {
  const posted = Object.entries(surplusByTeam).filter((e): e is [string, number] => e[1] !== undefined && Number.isFinite(e[1]));
  return Object.fromEntries(posted.map(([name, s]) => [name, 1 + posted.filter(([, o]) => o > s).length]));
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11 → "11th", 21 → "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
