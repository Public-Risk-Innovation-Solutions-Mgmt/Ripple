# Investment Memorandum

<!--
⚠ RULE — THE WELCOME MEMO'S RULE HOLDS HERE: no engine detail beyond what is
written below, and nothing about liquidity requirements or early-sale costs,
which are not in effect. Shown in the Introduction tab.

TEMPLATE. Every figure is READ FROM THE GAME, never typed
(src/utils/investmentMemo.ts):
  {{ASSET_CLASS_TABLE}}   each asset class's expected return (before fees) and
                          fee, from ASSET_CLASS_ASSUMPTIONS
  {{cash}} {{bonds}} {{equities}}
                          the Pool's current allocation, in percent — the one
                          in force: the latest year's
An unknown {{TOKEN}} throws rather than rendering.

⚠ NO "[year] return" COLUMN. Each year's market is drawn separately for every
world, so the year's averaged return by asset class sits close to the expected
return and cannot be squared with the statement's investment income; the column
waits on that (see the round's report).
-->

**To:** Incoming Pool Management\
**From:** Finance Department\
**Re:** Investment Strategy

---

Alongside rates, reserves and reinsurance, you decide how the Pool's assets are invested. Because claims are paid
over several years, the money held for them earns investment income in the meantime. Higher returns, though, come
with bigger swings from year to year.

## The three asset classes

| Asset class | Expected return | Fee |
|---|---|---|
{{ASSET_CLASS_TABLE}}

Cash is steady but earns least. Bonds earn more with moderate swings. Equities earn most but can gain or lose
heavily in a single year. Expected returns are averages, not promises.

The Pool currently holds {{cash}}% cash, {{bonds}}% bonds and {{equities}}% equities. This is simply where it
stands, not a recommendation.

## What to weigh

A poor investment year can arrive at the same time as a bad claims year. A Pool with thin surplus has less room
to absorb both. A Pool with a strong cushion can afford more risk.

No allocation removes all risk. Your task is to balance return against the swings your surplus can bear.

Finance Department
