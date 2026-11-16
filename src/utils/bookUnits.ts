// ============================================================================
// THE GAME'S SEED — what is left of book units.
//
// ⚠ THE MARKET OF UNITS IS RETIRED (simple underwriting). Each line's book is
// now UNDERWRITING_MEMBERS equal members, which need no market, no sizes, no
// risk scores and no storage: see bookUnderwriting.ts and ordinaryLoss.ts.
// What survives is the seed the market was drawn from, which the admin
// overrun and the ALAE ratio still read so every world books the same.
// ============================================================================

/** The seed a game's shared draws come from, on any copy of its instance. */
export const marketSeedOf = (instance: { seed: number; marketSeed?: number }): number =>
  instance.marketSeed ?? instance.seed;
