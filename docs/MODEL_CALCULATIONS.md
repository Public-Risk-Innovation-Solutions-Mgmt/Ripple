# How the game calculates its numbers

Read from the executable code on `multiplayer` at commit **6f4dc56** (26 Oct 2026), not from comments or earlier documents. Where a comment disagrees with the code, this document follows the code and lists the disagreement under **Flags** at the end. All constants live in `src/data/pricingParameters.ts` unless another file is named.

## How to read this

**The live engine.** `MEMBER_LEVEL = { enabled: false }`, so `newLossEngineRuns()` is true. Since *simple underwriting* (merged at ebc3b4a), each line is **one book of 100 equal members**. There is no market of units, no unit sizes or risks, and no loss history by unit. The book moves only as **exposure**. Ordinary losses are drawn member by member, and large losses are individual shock claims that land on the line, never on a member. This document leaves out code behind switches that are off and that nothing live reads, but lists the switches themselves.

| Switch | Value | What it means today |
|---|---|---|
| `MEMBER_LEVEL` | off | New loss engine: one book of 100 equal members per line |
| `NEW_RATE_STACK` | on | The rate is built by `quoteNewRateStack` |
| `SOLO_SHOCKS` / `SOLO_SHOCK_DRAW` | on / `'catalogue'` | Single player draws a shock schedule at the start |
| `SHOCK_FREE_PRICING`, `SHOCKS_OUT_OF_EXPERIENCE` | on, on | Shocks never reach the pure premium |
| `CATASTROPHE_LOAD` | off | The rate carries no shock allowance |
| `ROUTINE_LARGE_LOSSES` | off | No routine large claims; Property gets a "fold" instead |
| `AGGREGATE_STOP` | off | Only per-occurrence covers are sold |
| `RISK_CONTROL` | off | No risk-control charge and no effect |
| `UP_FRONT_TREND`, `FLAT_PRE_GAME` | off, off | |
| `PRE_GAME_MARGIN_ON_DESIGN` | on | The prior board's margin is solved on a "designed" history |
| `FULL_COST_BOOKING` (`defaultAssumptions.ts`) | on | No booking bias and no random IBNER walk |
| `DEVELOPMENT_TAIL.closed` | true | Payout patterns end at their last row |
| `WORLD_COUNT` | 100 | Every year is played in 100 worlds |

**Worlds.** Each year runs in 100 worlds (`src/utils/worlds.ts`).
- **Each world draws its own:** ordinary-loss year factor, each member's luck, and investment market.
- **All worlds share:** the book and its movement, each member's yearly risk score, the shock schedule and shock sizes, the ALAE ratio, the admin overrun, and the one rate per team-year.
- **Every dollar figure on screen is the average across the 100 worlds**, and every ratio is recomputed from the averaged dollars.

**Units.** Exposure is in $M: payroll for WC, payroll or revenue for GL, insured value for Property. Premium = exposure × rate per $100 × 10,000.

**The worked example.** One game is carried through every section: **scenario 1, WC**, built the way the app builds it.
- **Setup:** `openSoloInstance({ instanceId: '1', gameLength: 5, startingYear: 2027, activeLines: ['WC'] })` (`src/utils/soloGame.ts`). These are the Single player Setup page defaults, whose only default line is WC. Then `runPriorHistory`, `openWorlds`, and year 1 played at `defaultDecisionSet(1)` through `playWorldsYear` → `settleWorldsYear` → `commitSettledYear`.
- **Seed:** `seedFromInstanceId('1')` = 177556.
- **The first priced year** is year 1, 2027.
- **Default decisions:** funding at Expected, non-renewal 0%, new members 0%, no reinsurance, no dividend, allocation 10/80/10.
- **The same numbers elsewhere.** A hosted room on seed 1 produces the same WC year 1 to the dollar; it was run through `buildTeamGame` → `replayTeamYears`. With all three lines active, WC is also the same, except for a GL loan offer in 1 of the 100 worlds (5.3).

---

## 1. The opening

### 1.1 Scenarios and their targets

- **The scenario is the game's only seed.** The instance id is the text "1"–"20" (`SCENARIO_COUNT = 20`; `src/utils/scenarios.ts`). Its seed is `seedFromInstanceId(id)`, a djb2-style hash (`src/seedHash.ts`). The pre-game draws, the members' risk scores, the shock schedule and the worlds all come from that seed.
- **Order.** `SCENARIOS_THIN_TO_RICH = [12, 19, 10, 14, 3, 8, 15, 11, 20, 6, 9, 5, 4, 1, 18, 7, 17, 2, 13, 16]` runs from thinnest (highest premium-to-surplus) to richest. It is the same on every line.
- **Target premium-to-surplus (P/S).** `SCENARIO_PREMIUM_TO_SURPLUS[line][n]` = thinnest − k × (thinnest − richest)/19, where k is the scenario's 0-based position in that order. `SCENARIO_RATIO_RANGE` sets the ends: **WC 3.0 → 1.5, GL 2.3 → 1.3, Property 1.7 → 1.2**.
- **The target does two things:**
  1. It sets the prior board's margin (1.4).
  2. It scales the pre-game's ordinary losses: `preGameLossMultiplier` = 1 + (1 − `PRE_GAME_EXPERIENCE_BASE[line]` / target) × `PRE_GAME_EXPERIENCE_WEIGHT`. The base is the midpoint of the range (**WC 2.25, GL 1.8, Property 1.45**) and the weight is **0.3**. A thin scenario runs above 1 (a worse record), a rich one below. It applies to years ≤ 0 and to ordinary losses only, never to expected loss (`preGameLossFactor`, `src/utils/ordinaryLoss.ts`).
- **The target is not where the opening lands.** See 1.4.

### 1.2 Paid-in capital by line

`STARTING_CAPITAL` = **WC $3,000,000; GL $12,000,000; Property $12,500,000**.
- Each line starts the pre-game (2021) with this surplus, no reserves and an empty ledger (`simulateLineCandidate`, `src/utils/priorHistoryEngine.ts`).
- After that, surplus moves only with income, dividends and assessments. The paid-in capital is the only capital event before the game.

### 1.3 The pre-game years

- **How many.** `PRIOR_HISTORY_YEARS = 6`: years −5 … 0, which are calendar 2021–2026. The last three are returned as `priorHistory` and the first three as `earlyPreGameHistory`. All six are played by the same engine (`processYear`).
- **Each line separately.** `runPriorHistory` → `runLinePreGame` runs per active line, so a line's pre-game does not depend on the other lines.
- **Decisions each year** (`preGameDecisionSet`): the defaults, plus `fundingCushion = margin` (CLF 1 + margin), and a cash and bonds allocation of 11.1% / 88.9%.
- **The book grows on a set path** (1.6). There is no underwriting decision in the pre-game, and host development is 0.
- **Losses** are drawn as in play (2.4), on separate `pregame_` streams, × the scenario's loss multiplier. Each year's growth carries the new-business penalty.
- **No shocks** fire before year 1.
- **Pricing.** Each pre-game year is priced by the normal rate (section 4) at the margin's CLF.
  - 2021 and 2022 have no usable history and price on expected loss.
  - 2023 prices on one year of history, rising to four years by 2026.

### 1.4 How the prior board's margin is set

The prior board funds every pre-game year at one margin over expected (CLF = 1 + margin). `runLinePreGame` solves it per scenario and line:

1. **Designed run.** The pre-game is replayed with every ordinary loss at exactly expected × the scenario multiplier (no draws), and the market at its expected return (3.28% on the cash/bond mix). A secant search (`solvePreGameMargin`, tolerance $0.01, up to 40 steps) finds the margin at which the 2026 year-end surplus equals **year-1 premium at Expected ÷ the target P/S**.
2. **Floor.** `PRE_GAME_MARGIN_FLOOR = 0`. It now binds in **WC scenario 4 and GL scenario 19**, both of which open at a 0% margin.
3. **Played run.** The real, drawn pre-game is played at that margin. **The opening surplus is wherever the played 2026 year-end lands.**
4. **Guardrails** (`OPENING_PREMIUM_TO_SURPLUS_BOUNDS = { min: 1.0, max: 3.5 }`).
   - If surplus ≤ 0 or played P/S > 3.5, the margin is re-solved on the played history to land exactly on 3.5.
   - If P/S < 1.0, it is re-solved to land on 1.0, but not below the floor.
   - Today only **scenario 3 WC** trips one: it opens at P/S 3.50 on a 4.27% margin.
5. **In year 1** the player's default is funding at Expected, so the prior board's margin comes off the rate.

Year-1 premium at Expected is `openingYear1Premium`: the engine's own year-1 quote (`strikeBookRate`, default decisions) × the opening book.

### 1.5 Pre-game investment return

- Each played pre-game year averages `PRE_GAME_MARKET_DRAWS = 10` market draws (`preGameMarketReturns`, `src/utils/investmentEngine.ts`), blended on the 11.1% cash / 88.9% bonds mix.
- The designed run uses the expected return of 3.28%.
- `PRE_GAME_INVESTMENT_RETURN = 0.03` is read only with `FLAT_PRE_GAME` on, so it is not used.

### 1.6 The book at the opening, and pre-game growth

- **One fixed opening book per line, the same in every scenario.** `OPENING_BOOK_EXPOSURE` = base × `EXPOSURE_SCALE` (**WC 2.342, GL 1.640, Property 0.546**):

  | | WC | GL | Property |
  |---|---|---|---|
  | Opening book ($M) | **916.113** | **614.916** | **9,614.900** |
  | `FULL_MARKET_EXPOSURE` ($M) | 3,044.6 | 2,132.0 | 32,341.2 |
  | Share of the market | 30.09% | 28.84% | 29.73% |

  The book of units, and with it the seeded opening book, is retired (`src/utils/bookUnits.ts` keeps only `marketSeedOf`).
- **100 equal members** (`UNDERWRITING_MEMBERS`). Each member holds 1/100 of the line's exposure. Members never come or go; only exposure moves.
- **Pre-game growth.** `PRE_GAME_BOOK_GROWTH = 0.02`, so year y ≤ 0 holds the opening book × 1.02^y (`preGameBook`, `src/utils/bookUnderwriting.ts`). Each year's increase is new exposure at the penalty: lossFactor = (last year's book + 1.2 × growth) ÷ this year's book.
- **Exposure trend.** `EXPOSURE_GROWTH_PER_YEAR = 0`, so exposure moves only with the book.
- **Market cap.** `FULL_MARKET_EXPOSURE` caps the book in play.

### 1.7 Opening reserves and the balance sheet

- **Reserves** are the cohorts the pre-game wrote (2021–2026), net of reinsurance. There are no bulk years.
- **Host development.** Each cohort is given its lifetime host-development total once, at the opening (2.8).
- **Invested assets** = surplus + net reserve + LAE reserve − cash.

### 1.8 Single player, Test player and hosted

The opening is the same function in all three modes (`runPriorHistory`). Pricing and the pre-game see no shocks, so every team in a room and a single player of the same scenario inherit the same opening. One thing differs: a Test player or a host can set prior development (2.8, 7). That changes emergence after year 1, not the opening.

### Worked example — 1. The opening (scenario 1, WC)

| Item | Value | Source |
|---|---|---|
| Position thin → rich | 14th of 20 | `SCENARIOS_THIN_TO_RICH` |
| Target P/S | 3.0 − 13 × 1.5/19 = **1.9737** | `SCENARIO_PREMIUM_TO_SURPLUS` |
| Pre-game loss multiplier | 1 + (1 − 2.25/1.9737) × 0.3 = **0.9580** | `preGameLossMultiplier` |
| Paid-in capital | **$3,000,000** | `STARTING_CAPITAL.WC` |
| Opening book | **916.113** ($M), 30.09% of 3,044.6 | `OPENING_BOOK_EXPOSURE.WC` |
| Designed surplus aimed at | $32,317,386 ÷ 1.9737 = $16,374,142 | 1.4 step 1 |
| Designed margin = final margin | **+0.966%** (CLF 1.009664); no floor, no guardrail | `solvePreGameMargin` |

Pre-game years, played at the 0.966% margin. The rate is the member charge ÷ (billed exposure × 10,000).

| Year | Exposure $M | Rate /$100 | Premium | Net ultimate loss | Inv. income | Net income | Ending surplus | Ending net reserve |
|---|---|---|---|---|---|---|---|---|
| 2021 | 829.75 | 2.8404 | $23.57M | $16.79M | $0 | $0.67M | $3.67M | $14.01M |
| 2022 | 846.35 | 2.9483 | $24.95M | $17.96M | $0.86M | $0.79M | $4.46M | $25.78M |
| 2023 | 863.27 | 3.2081 | $27.69M | $17.67M | $0.69M | $2.92M | $7.38M | $34.93M |
| 2024 | 880.54 | 3.3375 | $29.39M | $19.19M | $1.77M | $4.12M | $11.51M | $43.74M |
| 2025 | 898.15 | 3.3985 | $30.52M | $18.28M | $2.47M | $6.62M | $18.12M | $50.42M |
| 2026 | 916.11 | 3.4987 | $32.05M | $22.80M | $1.28M | $0.05M | **$18.17M** | **$59.99M** |

The opening, at the start of 2027:

| Item | Value |
|---|---|
| Opening surplus | **$18,173,463** |
| Year-1 premium at Expected (3.5277 × 916.113) | **$32,317,386** |
| Opening P/S | **1.778**, against a target of 1.974 |
| Net unpaid reserve | **$59,989,996** |
| LAE reserve | **$10,643,488** |
| Invested assets / cash | $83,999,130 / $4,807,816 |
| Host development set at the opening (3% of $59.99M) | $1,799,700 in total, to emerge during play |

---

## 2. Loss model

### 2.1 The book

- **What it is.** A line's book is its exposure (`LinePoolState.bookExposure`), shared equally by `UNDERWRITING_MEMBERS = 100` members.
- **Expected loss carries no book risk.** Expected loss = exposure × the line's cost (`expectedLossBreakdown` at risk 1). `strikeRates` passes book risk = 1.
- **Where the members show up.** They appear only inside the ordinary draw (2.4). No screen, export or host view shows a member.

### 2.2 Ordinary losses: base cost per $100

- **WC and GL** come from the pool's supplied pure premium by layer, `POOL_LOSS_COST_LAYERS`, at the 2027 level:

  | Line | $0–1M | $1M–5M | Sum |
  |---|---|---|---|
  | WC | 2.50 | 0.118 | 2.618 |
  | GL | 2.50 | 0.95 | 3.45 |

  The supplied figures include ULAE, so the claims cost is the sum ÷ (1 + `ULAE_OF_LOSS_COST`):
  - `EXPECTED_ORDINARY_LOSS_COST_PER_100` WC = 2.618/1.05 = **2.493333**
  - GL = 3.45/1.05 = **3.285714**
- **Property** is a fixed **0.159515**. While `ROUTINE_LARGE_LOSSES` is off, it gets a routine "fold" added (`routineFoldPer100`, `src/utils/shockExpectation.ts`) of +0.050466 in 2027, so its live cost is **0.209981**.
- **No per-claim limit.** Ordinary losses have no claims, so `ORDINARY_LOSS_LIMIT` ($1M WC/GL, $5M Property) is not applied to them. On WC and GL the $1M–5M layer is inside the ordinary cost.
- **Never ceded.** Ordinary losses are not occurrences, so no reinsurance applies to them.

### 2.3 Trend

`ordinaryLossCostPer100(line, n)` = base × (1 + `SEVERITY_TREND_PER_YEAR`)^(n − 1), plus Property's fold.
- `SEVERITY_TREND_PER_YEAR` = **WC 4%, GL 8%, Property 5%**.
- The base year is year 1 (2027). Pre-game years are trended backwards.
- `FREQUENCY_TREND_PER_YEAR` = 0, and only pricing reads it.

| Cost per $100 | 2021 | 2026 | **2027** | 2028 |
|---|---|---|---|---|
| WC | 1.97052 | 2.39744 | **2.49333** | 2.59307 |
| GL | 2.07056 | 3.04233 | **3.28571** | 3.54857 |
| Property | 0.15669 | 0.19998 | **0.20998** | 0.22048 |

### 2.4 The draw: year factor, member risk and member luck

`ordinaryLossFromMembers` (`src/utils/ordinaryLoss.ts`) draws on the book **after** the year's underwriting movement:

```
expected  = exposure × 10,000 × cost per $100
realised  = expected × lossFactor × F × (1/100) Σ_i ( r_i × f_i ) × (1 + shock uplift)
```

The terms are:
- **lossFactor** is underwriting's one-year factor (3.2), 1 when the book does not move.
- **F** is the year factor: one draw per line, year and world. It is lognormal with mean 1 and CV `BASELINE_CV` = **WC 6%, GL 10%, Property 8%**.
- **r_i** is member i's **risk score**: lognormal, mean 1, CV `MEMBER_RISK_CV` = **30%**.
  - It is redrawn every year for every member.
  - It comes from the **game's** seed (stream `member_risk_<line>`), so all 100 worlds hold the same scores.
- **f_i** is member i's **luck**: lognormal, mean 1, CV `MEMBER_LUCK_CV` = **10%**, one draw per member per year per world.

The line's CV is √((1+Y²)(1 + ((1+0.10²)(1+0.30²) − 1)/100) − 1), where Y is the year CV: **WC 6.8%, GL 10.5%, Property 8.6%** (`typicalBookOrdinaryCv`).

`expected` is pricing's figure. It leaves out lossFactor, so actual over expected shows what underwriting did.

### 2.5 The new-business penalty, and the non-renewal relief

These are both one-year factors on the year's actual ordinary loss, and are covered in 3.2. `NEW_BUSINESS_PENALTY = 0.20` is flat: nothing buys it down, since the rejection rate is gone. `NON_RENEWAL_LOSS_RELIEF = 0.5`. Neither is in expected loss or in pricing; the rate learns them only through the loss history.

### 2.6 LAE: the ALAE draw and ULAE

- **ALAE ratio.** One draw per accident year and line, uniform in `ALAE_RATIO_RANGE`: **WC 7–15%, GL 10–20%, Property 2–5%** (`alaeRatioFor`, `src/utils/alaeRatio.ts`). It comes from the game seed, so all worlds share it, and it is stored on the cohort.
- **ALAE default.** `ALAE_OF_LOSS_COST` (the midpoints **11%, 15%, 3.5%**) is used only where no drawn ratio exists.
- **ULAE.** `ULAE_OF_LOSS_COST` = **5%** on all lines.
- **Booking** (`src/utils/lossExpense.ts`). Both are shares of the gross loss:
  - **incurred** = share × the change in each cohort's gross ultimate, so development and reserve inflation on old years attract LAE too, at those years' ratios;
  - **paid** = share × gross paid;
  - **LAE reserve** = share × gross unpaid.

### 2.7 Reserve inflation

`RESERVE_INFLATION_PER_YEAR` is a copy of the severity trend (**WC 4%, GL 8%, Property 5%**). Each year, for every open prior accident year (`processIbner`, `src/utils/simulationEngine.ts`):
- inflation = rate × the cohort's gross unpaid at the start of the year;
- it is added after that year's payment and paid out in later years;
- it is reported inside prior-year development.

The current accident year gets none in its own year. Pricing anticipates part of it (4.3).

### 2.8 Prior development: the host's, or the Test player's

- **Settings.** `PRIOR_DEVELOPMENT_DEFAULTS` = **WC +3%, GL +10%, Property −2%**. Positive is adverse.
- **Who sets it.** Single player always uses the defaults. A Test player and a host each start at the defaults and may set each line to 0–100%, adverse or favourable, in whole percent (`HostCreateScreen`). The value rides on `setup.priorDevelopment`, and an unset line reads the default.
- **A lifetime total, not a yearly rate** (`src/utils/hostDevelopment.ts`). Each accident year gets total = pct × its gross unpaid at a base date. The base date is the game start for the opening cohorts, and the end of its own first year for a played year.
- **Emergence.** The total emerges in step with payments: each year's share is that year's paid share over the share unpaid at the base. Exactly pct × base has emerged by run-off.
- **Pre-game.** None emerges during the pre-game.
- **Nothing else develops.** `FULL_COST_BOOKING` is on, so no other routine development runs.

**Sign.** The result field `priorYearDevelopment` is negative when development is adverse.

### 2.9 Payout patterns and speed; case and IBNR

- **Patterns.** The pool's recorded paid patterns (`PAID_DEVELOPMENT_PATTERN`, `src/data/paidDevelopmentPatterns.ts`), with unpaid share u(t) = 1 − 1/paid LDF.
  - **Speed:** compressed in time by `DEVELOPMENT_SPEED` = **WC 1.5, GL 1.5, Property 1.0**.
  - **Tail:** closed at the last row (`DEVELOPMENT_TAIL.closed`).
- **Current year.** Paid = ultimate × (1 − u(1)).
- **Later years.** The unpaid balance × (1 − u(t)/u(t−1)).

| Unpaid share at end of year | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| WC | **0.8344** | 0.6223 | 0.4861 | 0.3929 | 0.3324 |
| GL | 0.9271 | 0.6981 | 0.4035 | 0.2217 | 0.1348 |
| Property | 0.5413 | 0.1935 | 0.0826 | 0.0319 | 0.0196 |

- **Case and IBNR** are presentation only (`src/utils/reserveSplit.ts`). The IBNR share of unpaid = (1 − 1/incurred LDF) ÷ (1 − 1/paid LDF), clamped to [0, 1], and case is the rest. At 12 months the IBNR share of unpaid is WC 61.7%, GL 68.9% and Property 31.2%.

### 2.10 Shocks

**Catalogue.** `R_MODEL.catalogue` gives each of 12 events an annual probability, a duration, and whether it is regional. Probabilities are scaled so they sum to `SHOCKS_PER_YEAR = 0.3` events a year: scale = 0.3/0.432 = **0.6944** (`SHOCK_CATALOGUE_SCALE`).

**The three effects** (`resolveShockYear` and `drawLargeLosses`, `src/utils/shockLosses.ts`):
- **A, uplift.** The line's ordinary losses × (1 + A), in the firing year only (`SHOCK_A_YEARS = 1`). It applies to the whole line, even for a regional event. A is drawn uniformly in `R_MODEL.aShock[line][level]`.
- **T, one large claim** in the firing year. Its size is a uniform draw in `SHOCK_T_CLAIM_RANGE[line][level]` × `shockCostFactor`.
  - `shockCostFactor` = (1 + severity trend)^(year − 1) × this year's exposure ÷ the year-1 exposure (`src/utils/shockCost.ts`).
  - Each T claim is its own occurrence and lands **on the line**, in a region: a regional event's claim lands in the struck region, any other event's lands in a region drawn by `REGION_EXPOSURE_SHARE`. A book always has all four regions, so a T claim always lands.
- **R, adverse development.** Each year the event is in force, R adds rate × 0.65^age (`R_MODEL.shockDecayRate`) × each prior accident year's start-of-year outstanding. It is added on top of prior development and ceded under that year's cover.
- **Record keys.** Each firing is recorded under its own key (`firingRecordKey` = event@year#ordinal), so the same event fired twice is two rows.

**Levels.** Each event's Low / Mid / High level for A, T and R is fixed in the catalogue. **No mode lets anyone set a shock's level**; a host or Test player chooses only which events fire and in which years.

| Level | A, WC | A, GL | A, Property | T, WC | T, GL | T, Property | R (all lines) |
|---|---|---|---|---|---|---|---|
| Low | 5–15% | 5–15% | 10–25% | $1–3M | $1–3M | $2–5M | 2–5% |
| Mid | 15–35% | 15–35% | 25–50% | $3–6M | $3–7M | $5–12M | 5–12% |
| High | 35–75% | 35–70% | 50–100% | $6–40M | $7–40M | $12–40M | 12–25% |

| Id | Event | Probability (raw → scaled) | Years | Regional | WC A/T/R | GL A/T/R | Property A/T/R |
|---|---|---|---|---|---|---|---|
| #1 | Earthquake | 0.002 → 0.0014 | 1 | yes | High/–/– | Mid/–/– | High/High/– |
| #2 | Winterstorm/Rainstorm | 0.06 → 0.0417 | 1 | yes | – | – | High/Low/– |
| #3 | Wildfire | 0.035 → 0.0243 | 1 | yes | – | – | Low/High/– |
| #4 | Legislation Change | 0.015 → 0.0104 | 3 | no | – | Mid/–/High | – |
| #5 | WC Reform | 0.02 → 0.0139 | 3 | no | High/–/Mid | – | – |
| #6 | Economic Recession | 0.06 → 0.0417 | 2 | no | Low/–/– | Low/–/– | – |
| #7 | Nuclear Verdict | 0.025 → 0.0174 | 1 | no | – | –/High/Mid | – |
| #8 | Social Inflation (GL) | 0.045 → 0.0312 | 3 | no | – | High/Low/Mid | – |
| #9 | Pandemic | 0.01 → 0.0069 | 2 | no | High/High/– | –/Mid/– | – |
| #10 | Economic Inflation | 0.10 → 0.0694 | 3 | no | see 2.11 | see 2.11 | see 2.11 |
| #11 | Large Investment Loss | 0.04 → 0.0278 | 1 | no | see 2.11 | | |
| #12 | Large Member Withdrawal | 0.02 → 0.0139 | 2 | no | see 2.11 | see 2.11 | see 2.11 |

**Shared across worlds.** Every A, T and R draw, and every T claim's region, comes from the game seed, so all 100 worlds share the same events and sizes.

**Who draws the schedule** is covered in section 7. **Announced only after the fact:** players learn of an event when its year is processed ("An event this year", `src/utils/yearEvents.ts`).

### 2.11 Economic Inflation, Investment Loss, Member Withdrawal

- **Economic Inflation** adds `R_MODEL.economicInflationInitialRate` × 0.65^age to every line's uplift for 3 years: **+12%, +7.8%, +5.07%** on ordinary losses. It does not touch T claims or reserves.
- **Investment Loss**, in its year, adds `INVESTMENT_LOSS_BY_ASSET` = **cash 0, bonds −5 points, equities −20 points** to the drawn returns, after the market clamp. At 10/80/10 that is −6.0 points on the blend.
- **Member Withdrawal**, at the renewal after it fires, removes `R_MODEL.memberWithdrawalReduction = 25%` of what renews (`moveBook`). It is pure exposure, at the renewing book's relieved cost.

### 2.12 Reinsurance recoveries

- **Options.** `REINSURANCE_OPTIONS`, the same on every line: None, $9M xs $1M, $8M xs $2M, $18M xs $2M, $38M xs $2M, each per occurrence.
- **Default.** **None** on every line (`REINSURANCE_DEFAULT_OPTION`). With shocks off, only None is offered (`REINSURANCE_OFFERED_SHOCKS_OFF`).
- **Recovery** per occurrence = min(max(occurrence total − attachment, 0), limit) (`cedeOccurrences`, `src/utils/reinsuranceTower.ts`).
  - The only occurrences are T claims. Ordinary losses, A uplifts and Economic Inflation are never ceded.
  - Anything above $40M is retained.
  - Later R development on a year with a T claim is ceded under that year's cover.
- **No GL pool limit.** `POOL_LIMIT_PER_OCCURRENCE` is `null` on every line.
- **Dormant.** The aggregate stop is off.

### 2.13 Investment income

- **Formula.** income = start-of-year invested assets × (cash% × r_cash + bonds% × r_bonds + equities% × r_eq) (`blendInvestmentReturn`). The year's premium and loss cash flows earn nothing that year.
- **Market.** One draw per world per year: Normal(mean, SD) − fee, clamped (`ASSET_CLASS_ASSUMPTIONS`, `defaultAssumptions.ts`, × `INVESTMENT_RETURN_SCALE` = 2/3):

  | Class | Mean | SD | Fee | Net expected |
  |---|---|---|---|---|
  | Cash | 2.793% | 0.40% | 0.040% | 2.753% |
  | Bonds | 3.467% | 4.04% | 0.124% | 3.343% |
  | Equities | 5.507% | 18.25% | 0.124% | 5.383% |

- **Allocation.** The default `ASSET_ALLOCATION_DEFAULT` is 10/80/10, with an expected net return of **3.488%**.
- **Year-end sweep.** Cash above 15% of the member charge (`OPERATING_CASH_PCT_OF_PREMIUM`) is swept into investments, and a shortfall is drawn out of them.

### 2.14 The admin overrun

- **Draw.** One draw per year and line, uniform in `ADMIN_OVERRUN_RANGE` = **0–2%** (`adminOverrunFor`, `src/utils/adminOverrun.ts`). It comes from the game seed, so all worlds share it.
- **Booking.** Booked expense = admin charged × (1 + overrun). Pricing never sees it.

### Worked example — 2. Loss model (scenario 1, WC, 2027)

**Book.** The defaults move nothing: **916.113** ($M), lossFactor **1**.

**Expected ordinary loss.** 916.113 × 10,000 × 2.493333 = **$22,841,754**, the same in every world. The result row's `expectedLoss` of **$23,566,175** adds two catalogue expectations: $564,699 of uplift and $159,722 of large loss. Single player counts shocks as on (7.1).

**Actual ordinary loss.**
- **This year's shared risk scores:** mean **0.99794** across the 100 members, ranging from 0.558 to 2.011.
- **World 0:** F = 0.98790 and mean luck × risk 0.99567, giving a line factor of **0.98362** ($22,467,672).
- **Across the 100 worlds** the line factor averages **0.993813**, so the averaged gross = net ultimate is **$22,700,428**.
- **Shocks this year:** none. The scenario's schedule at length 5 is one event, #5 WC Reform, in year 3.

**ALAE and ULAE.** The ALAE ratio drawn for 2027 is **14.3127%**; ULAE is 5%.

**Payout of accident year 2027 in 2027.** The unpaid share is 0.834357.
- Paid **$3,760,176**; unpaid **$18,940,253** (case $7,255,670, IBNR $11,684,582, an IBNR share of 61.7%).

**Prior accident years in 2027.**
- Reserve inflation: 4% × $59,989,996 = **$2,399,600**.
- Prior development emerging (3% default): **$359,603**.
- `priorYearDevelopment` = **−$2,759,203** (adverse).
- Net paid on all years: **$17,247,161**.

**Net incurred loss.** $22,700,428 + $2,759,203 = **$25,459,631**.

**LAE.**

| Item | Amount |
|---|---|
| ALAE incurred: 14.3127% × $22,700,428 = $3,249,042, plus $351,581 on prior years' development at their own ratios | $3,600,623 |
| ULAE incurred: 5% × $25,459,631 | $1,272,982 |
| LAE incurred | **$4,873,604** |
| LAE paid | $3,117,572 |
| LAE reserve | $10,643,488 → **$12,399,521** |

**Admin overrun.** Drawn at 0.935%: admin charged $3,672,614 → booked **$3,706,949**.

**Reinsurance.** None: cost $0, recovery $0.

**Investment income.** On $83,999,130 at 10/80/10. World 0's market returns 0.0745% ($62,618). The 100-world mean is 2.5998%, giving **$2,183,794**.

---

## 3. Underwriting sliders

The live code is `moveBook` (`src/utils/bookUnderwriting.ts`), called from `processLineYear`. Two sliders move the line's **exposure** and give this year's ordinary losses a one-year **lossFactor**. They run in this order within a year: non-renewal, then any Member Withdrawal, then new members (sized on the start-of-year book), then the cap. Losses are drawn on the book after the movement.

### 3.1 Non-renewal (a₁)

- **Slider.** `NON_RENEWAL_SLIDER` = **0–5%, step 1%, default 0** (labelled "Non-renewal").
- **Exposure.** renewedOff = a₁ × the start-of-year book.
- **Relief.** The renewing exposure's ordinary loss per unit is cut by `NON_RENEWAL_LOSS_RELIEF` × a₁ = **0.5 × a₁** this year: 5% non-renewed runs 2.5% cheaper.
- **No selection.** There is no loss history and no ranking, and no member leaves: the whole book shrinks alike.

### 3.2 New members (a₂)

- **Slider.** `NEW_MEMBERS_SLIDER` = **0–5%, step 1%, default 0** (labelled "New members").
- **Exposure.** written = a₂ × the start-of-year book, capped so the book stays within `FULL_MARKET_EXPOSURE`.
- **Penalty.** The new exposure's ordinary loss per unit carries 1 + `NEW_BUSINESS_PENALTY` = **1.20** this year. The penalty is flat.

### 3.3 How exposure and losses move

```
after       = before × (1 − a₁) × (1 − withdrawal) + min(room, before × a₂)
lossFactor  = [ renewing × (1 − 0.5 a₁) + written × 1.2 ] ÷ after
expected ordinary loss this year (what is drawn around) = f(x) × before × [ (1 − a₁)(1 − 0.5 a₁) + 1.2 a₂ ]   (no withdrawal)
```

- **One year only.** Next year's factor is 1 unless a slider is used again.
- **Defaults move nothing.** The default is **0% / 0%**, so a team that touches nothing plays a constant book.
- **The Decisions screen previews** ("Premium not renewed", "Premium from new members") call the same `moveBook` without a withdrawal, and price the result at the quoted rate (`underwritingFigures`, `src/game/derivations.ts`).

### Worked example — 3. Underwriting (scenario 1, WC, 2027)

| Setting | Book after ($M) | lossFactor | Ordinary actual (100-world mean) | Member charge | Combined ratio | Ending surplus |
|---|---|---|---|---|---|---|
| **0% / 0% (default)** | **916.113** | **1.0000** | **$22,700,428** | **$32,317,386** | **105.33%** | **$18,634,459** |
| Non-renewal 5% | 870.307 | 0.975 | $21,026,272 | $30,701,517 | 103.76% | $19,201,419 |
| New members 5% | 961.919 | 1.009524 | $24,062,454 | $33,933,256 | 105.65% | $18,439,912 |
| Both at 5% | 916.113 | 0.98625 | $22,388,297 | $32,317,386 | 104.18% | $19,006,871 |

- **Previews at 5%.** Each slider at 5% shows 45.806 × 10,000 × 3.52766 = **$1,615,869**.
- **The ratio tie-out.** Each row's ordinary actual ÷ (book after × 10,000 × 2.493333) = 0.993813 × lossFactor: the same draws scaled by the bracket.
- **The rate does not move.** The rate is struck on the book before movement (916.113), so every row charges 3.5277 per $100. It is billed on the book after.

---

## 4. Pricing

### 4.1 The live call path

`strikeRates` (`worlds.ts`) → `strikeBookRate` (`simulationEngine.ts`) → `bookPurePremium` (`src/utils/newPurePremium.ts`) → `quoteNewRateStack` (`src/utils/linePricing.ts`).

- **One rate per team-year.** It is struck on the averaged line state (or, once a shock has fired, on the shock-free shadow's ledger), on the book **before** this year's movement, at book risk 1. Every world charges it on the book **after** movement.
- **Display only.** The Decisions panel, the Rate Indication page and the Model tab call the same functions; `rateIndication.ts` and `modelRate.ts` only display.

### 4.2 The experience window and data lag

- **Latest data year** = priced year − 1 − `PRICING_DATA_LAG_YEARS` (1).
- **Window.** The last `PRICING_WINDOW_YEARS_NEW` = **5** accident years up to the latest data year, all valued at its end. For 2027 that is accident years **2021–2025 valued at 12/31/2025**; 2026 is not used.
- **Basis.** Ground-up gross paid, on each year's own recorded exposure.
- **Weighting.** Equal weights, hard-coded.
- **No-history fallback.** Expected ordinary loss × reserve inflation to come. Only the first two pre-game years use it.

### 4.3 Development to ultimate, and inflation priced in

- **Development.** developed = paid × the **paid** age-to-ultimate LDF from the recorded pattern, compressed by `DEVELOPMENT_SPEED` and closed (`recordedPaidLdf`). WC: **6.0371** at 12 months, 2.6478 at 24, 1.9458 at 36, 1.6472 at 48, 1.4979 at 60.
- **Inflation priced in.** Each window year is multiplied by `reserveInflationToCome` = Π (1 + reserve inflation × unpaid share) over its remaining development years. Only the newest `RESERVE_INFLATION_PRICED_YEARS` (**WC 2, GL 1, Property 2**) window years get it. WC: 1.0591 on the newest year, 1.0249 on the next, 1 on the rest.

### 4.4 Trend

- **Yearly trend** = (1 + frequency) × (1 + severity) ÷ (1 + exposure growth) = **WC 1.04, GL 1.08, Property 1.05**.
- **Period.** From each accident year to the priced year: for 2027, 2021 takes 1.04^6 and 2025 takes 1.04^2.

### 4.5 Book risk

There is none: `bookRisk` is 1 on every line. The experience carries whatever the members' risk scores, the penalty and the relief did.

### 4.6 How shocks are kept out

- `SHOCK_FREE_PRICING`: once a shock is first in force, a shock-free shadow game runs beside the real one, and every pure premium is struck from the shadow's ledger.
- `SHOCKS_OUT_OF_EXPERIENCE` removes shock dollars from paid before development.
- `CATASTROPHE_LOAD` is off, so the rate carries no shock allowance.

### 4.7 ALAE and ULAE loads

- **Pure premium** = trended loss cost × (1 + mean drawn ALAE ratio of the window years + `ULAE_OF_LOSS_COST` 5%).
- **ALAE default.** `ALAE_OF_LOSS_COST` (the midpoints) is used where a year has no drawn ratio.

### 4.8 Admin and its trend

- **Admin per $100** = (1 + `ADMIN_TREND_PER_YEAR`)^(year − `ADMIN_BASE_YEAR`) × (`ADMIN_FIXED_PER_YEAR` ÷ (exposure × 10,000) + `ADMIN_PER_EXPOSURE_PER_100`), with `ADMIN_TREND_PER_YEAR = 3%` and `ADMIN_BASE_YEAR = 1` (2027).

  | | WC | GL | Property |
  |---|---|---|---|
  | `ADMIN_FIXED_PER_YEAR` | $1,078,586 | $1,751,022 | $3,398,817 |
  | `ADMIN_PER_EXPOSURE_PER_100` | 0.275138 | 0.459324 | 0.018236 |

- **Booked.** Admin is billed through the divisor (admin ÷ divisor × billed exposure) and booked with the overrun (2.14).

### 4.9 Risk control, and profit & contingency

- **Risk control.** `RISK_CONTROL` is off: 0 in the divisor, no spend, no effect.
- **P&C.** `PROFIT_AND_CONTINGENCY_OF_RATE` = **WC 2%, GL 0, Property 0**, a share of the rate.
- **Divisor** = 1 − risk control − P&C = **WC 0.98, GL 1.00, Property 1.00**.

### 4.10 The funding level and CLF tables

- **Slider.** `FUNDING_SLIDER_RANGE` = **30–90%, step 5%**, with the slider resting at 60%. The **default decision is "Expected"** (`fundingAtExpected = true`), which is **CLF 1.000**.
- **Order** (`selectedClfFor`): the pre-game cushion (1 + margin) if set; else Expected = 1.0; else `staticClf(line, level)`, linear between table stops.
- **Tables.** `STATIC_CLF_TABLE` = `BASELINE_CV_TABLES` at each line's `BASELINE_CV` (WC 6%, GL 10%, Property 8%; `src/data/clfTables.ts`).
  - They are built on ordinary losses only, at the year-factor CV alone; the members' risk and luck are not in them.
  - The CLF multiplies the retained pure premium only, not admin.

  WC (6% table):

  | Stop | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 95 | 99 |
  |---|---|---|---|---|---|---|---|---|---|
  | WC CLF | 0.9664 | 0.9827 | 0.9982 | 1.0140 | 1.0310 | 1.0513 | 1.0802 | 1.1045 | 1.1517 |

### 4.11 Reinsurance prices and their growth

- **Price** = a fixed table price (`REINSURANCE_PRICE`) × `shockCostFactor` (2.10), which grows at the severity trend and with the book's exposure.

  | Option | WC | GL | Property |
  |---|---|---|---|
  | $9M xs $1M | $390k | $430k | $650k |
  | $8M xs $2M | $290k | $330k | $550k |
  | $18M xs $2M | $390k | $430k | $730k |
  | $38M xs $2M | $590k | $630k | $930k |

- **In the rate.** The price is added undivided: reinsurance per $100 = dollars ÷ (rated exposure × 10,000). It is charged as its fixed dollars.
- **Nothing netted.** Nothing ceded is netted off the pure premium (expected ceded = 0).
- **Unused loads.** `REINSURANCE_LOAD` (14%) and `REINSURANCE_RISK_LOAD_LAMBDA` (0) have no effect, because the fixed price overrides them.

### 4.12 The rate formula

```
loss cost per AY = paid at valuation × paid LDF × inflation to come ÷ (AY exposure × 10,000)
loss cost        = mean over the 5 window years of [loss cost per AY × trend^(priced year − AY)]
pure premium     = loss cost × (1 + mean ALAE ratio + ULAE 5%)
admin            = 1.03^(year − 1) × (fixed $ ÷ (rated exposure × 10,000) + per-exposure rate)
rate per $100    = (pure premium × CLF + admin) ÷ (1 − risk control − P&C) + reinsurance $ ÷ (rated exposure × 10,000)
member charge    = (pure premium × CLF + admin) ÷ divisor × billed exposure × 10,000 + reinsurance $
```

The "Indicated" rate (`firstIndicationPer100`) is the same formula at CLF 1 with no reinsurance.

### 4.13 How the Rate Indication page and the Decisions panel show it

- **Rate Indication** (`src/utils/rateIndication.ts`) shows:
  - the projected pure premium;
  - a "2026 rate level" figure, which is that pure premium ÷ one year's trend;
  - the expense shares of the rate at Expected, and the permissible loss ratio;
  - rates at Expected and at `RATE_INDICATION_FUNDING_LEVELS` = 70/80/90%, with the change against last year's rate (less its reinsurance);
  - each offered cover's price per $100.
- **Decisions panel** (`NewRatePanel`; `ratePieces` and `pieceCents` in `derivations.ts`):
  - The "Indicated" column is ground-up pure premium + admin + risk control and P&C, which is `firstIndicationPer100`.
  - The "Your rate" column is retained × CLF + admin + risk control + P&C + reinsurance, which is `finalRatePer100`.
  - Rows are in cents, and P&C absorbs the rounding so the rows add to the rate.
  - "Expected to surplus" = (retained × (CLF − 1) + loaded base × P&C) × rated exposure.

### Worked example — 4. Pricing (scenario 1, WC, 2027)

| Accident year | Age (months) | Paid at 12/31/2025 | LDF | Inflation to come | Exposure $M | Loss cost /$100 | Trend | Trended | ALAE ratio |
|---|---|---|---|---|---|---|---|---|---|
| 2021 | 60 | 12,290,142 | 1.4979 | 1.0000 | 829.75 | 2.2187 | 1.2653 | 2.8073 | 14.17% |
| 2022 | 48 | 11,768,987 | 1.6472 | 1.0000 | 846.35 | 2.2906 | 1.2167 | 2.7869 | 13.75% |
| 2023 | 36 | 9,618,406 | 1.9458 | 1.0000 | 863.27 | 2.1680 | 1.1699 | 2.5362 | 14.41% |
| 2024 | 24 | 7,488,169 | 2.6478 | 1.0249 | 880.54 | 2.3077 | 1.1249 | 2.5959 | 10.14% |
| 2025 | 12 | 3,027,441 | 6.0371 | 1.0591 | 898.15 | 2.1552 | 1.0816 | 2.3311 | 9.22% |

| Piece | Calculation | Per $100 |
|---|---|---|
| Loss cost | mean of the five trended figures | **2.6115** |
| ALAE | 2.6115 × 12.337% | 0.3222 |
| ULAE | 2.6115 × 5% | 0.1306 |
| **Pure premium** (ground-up = retained) | | **3.0642** |
| Admin | 1,078,586 ÷ 9,161,131 + 0.275138 = 0.117735 + 0.275138 | **0.3929** |
| CLF | Expected = 1.000 (at the 60% stop it would be 1.0140, rate 3.5714) | |
| Divisor | 1 − 0 − 0.02 | 0.98 |
| P&C inside the loaded base | | 0.0706 |
| Reinsurance | None | 0.0000 |
| **Rate** | (3.0642 + 0.3929) ÷ 0.98 | **3.5277** |

- **Struck and charged on the same book at the defaults.** 3.5277 × 916.113 × 10,000 = **$32,317,386**: pool premium $28,644,773 (3.0642/0.98 × 9,161,131) plus admin $3,672,614.
- **Rate Indication.**
  - Projected pure premium 3.064, and 2026-level 2.946 (trended average losses $26,992,190 on 916.113).
  - Total expense ratio 13.1%: fixed admin 3.3%, per-exposure admin 7.8%, P&C 2.0%. Permissible loss ratio 86.9%.

  | | Rate | Change vs 2026's 3.499 |
  |---|---|---|
  | Expected | 3.528 | +0.8% |
  | 70% | 3.625 | +3.6% |
  | 80% | 3.688 | +5.4% |
  | 90% | 3.778 | +8.0% |

  Single player, with shocks on, lists cover prices of 0.043 / 0.032 / 0.043 / 0.064 per $100. A hosted room with no shocks scheduled lists only None.
- **Decisions panel.** Pure premium $3.06 + admin $0.39 + risk control $0.00 + P&C $0.08 (absorbing the rounding of 0.0706) + reinsurance $0.00 = **$3.53**, +0.8% vs last year. Expected to surplus is **+$646,348** (0.07055 × 9,161,131).
- **Tie-out.** The struck quote, the charged row, the Rate Indication at Expected and the hosted Teams table all give 3.5276633203138.

---

## 5. Dividends and assessments

### 5.1 The slider and what it does

- **Control.** One slider, "Dividend / Assessment", runs **−15% to +15%, step 1%, default 0** (`SLIDER_RANGES.dividendAssessment`, `defaultAssumptions.ts`). A positive value sets `dividendPct` and a negative one sets `assessmentPct`; only one applies in a year.
- **Basis** = max(0, the line's opening surplus) (`dividendAssessmentBasis`, `src/utils/dividendAssessment.ts`). Amount = basis × percentage.
- **Effect on results.** Dividends reduce underwriting income, cash and ending surplus dollar for dollar. Assessments add to them.
- **Kept off the premium.** Neither enters the member charge, the loss ratio, the expense ratios, the combined ratio or pricing. Statements show them on a separate line.
- **Timing.** The decision applies to that year's opening surplus and is paid in that year.

### 5.2 Limits

- **Range.** The slider limits the value to ±15%; the engine does not clamp it.
- **Dividend block.** If the line's prior ending surplus was negative, the slider's maximum is 0 and the engine pays no dividend. An assessment is still allowed, but a negative opening surplus gives a basis of 0, so it collects nothing.

### 5.3 Loans between lines

- **When.** After a year, any line that ends with negative surplus and no existing loan gets an offer, if the other lines' combined capacity covers the whole deficit. Each line's capacity is max(0, min(surplus, investments)). Lenders contribute in proportion to capacity.
- **If authorised.** Lenders' surplus and investments fall by their shares, and the borrower's surplus is set to exactly 0.
- **Interest** = the pool's blended investment return that year, floored at 0. It is reset every year.
- **Repayment each later year** = min(`loanRepaymentAggressiveness` × max(0, net income), balance, liquid assets), returned to the lenders in their original shares. The slider runs 0–100%, step 5%, default 50%, and appears only while there is a balance.
- **By mode:**
  - **Single player and Test player** show a prompt, defaulting to authorise, if **any one** of the 100 worlds needs a loan. The offer averages the deficit over only the worlds that need it, and the choice is applied in each of those worlds.
  - **Hosted** games decline every offer automatically (`replayTeamYears`).
  - **A one-line game** can never borrow, since there is no lender.

### Worked example — 5. Dividends and assessments (scenario 1, WC, 2027)

- **Basis.** WC's opening surplus, **$18,173,463**; not blocked.
- **At the default 0%.** Nothing is paid or collected.
- **At +5%.** The dividend is **$908,673**. Net income falls from $460,997 to −$447,676, and ending surplus to $17,725,786. The loss ratio stays at 78.8% and the combined ratio at 105.3%.
- **At −5%.** The same $908,673 is collected. Net income is $1,369,670 and ending surplus $19,543,132.
- **Loans.** The default game is WC only, so no loan can arise. With all three lines active, GL ends 2027 negative in 1 of the 100 worlds. Single player then shows a GL prompt: an average deficit of $103,916, lenders WC 38.0% and Property 62.0%, at a 0% rate. Authorising it moves an average **$395** of WC surplus to GL, so WC ends at $18,634,064.

---

## 6. Capital

### 6.1 Required capital

required = max(0, net unpaid reserve × (CLF at `RESERVE_MARGIN_CONFIDENCE_PARAM` − 1) + catastrophe term) (`simulationEngine.ts`):
- **Confidence.** `RESERVE_MARGIN_CONFIDENCE_PARAM` = **0.80**, read on the same `STATIC_CLF_TABLE`: **WC 1.0513, GL 1.0829, Property 1.0672**.
- **Catastrophe term.** `newEngineCatCapital` (`shockExpectation.ts`) is 0 on WC and GL. On Property with shocks on, it is the probability-weighted retained amount of one regional catastrophe after the cover placed. The cover's cession is now capped at its ceiling (`propertyCatastrophe.ts`).

### 6.2 Capital status

- **Ratio.** Excess capital ratio = (ending surplus − required) ÷ required.
- **Bands** (`CAPITAL_ADEQUACY_THRESHOLDS`, `defaultAssumptions.ts`): **Strong ≥ 0.25; Adequate ≥ 0; Thin ≥ −0.10; Deficient below**.
- **Pool level.** The sum of the lines' excess ÷ the sum of the lines' required.
- **Worlds.** Recomputed from the averaged dollars.
- **Where shown.** The Dashboard, Financials, the Decisions funding panel, results and exports.
- **No gate.** Required capital gates no decision.

### Worked example — 6. Capital (scenario 1, WC)

| | Opening (end 2026) | After 2027, defaults |
|---|---|---|
| Net unpaid reserve | $59,989,996 | $68,202,466 |
| Required = reserve × 0.0513 | **$3,077,487** | **$3,498,786** |
| Ending surplus | $18,173,463 | $18,634,459 |
| Excess capital ratio | **4.91** | **4.33** |
| Status | Strong | Strong |

---

## 7. Game modes

The Setup page (`src/pages/SetupPage.tsx`) offers **Single player** and **Test player**. Hosting is a separate route (`/host`, behind an admin sign-in). All three build the game the same way: `generateGameInstance` → `runPriorHistory` → `openWorlds`. They differ only in what goes into the setup and the shock schedule.

### 7.1 Single player

| Setting | What the player can set | Default |
|---|---|---|
| Pool name | free text | "Ripple Public Entity Risk Pool" |
| Game length | 3–10 years (`GAME_LENGTH_YEARS`) | 5 |
| First program year | any year | 2027 |
| Scenario | 1–20 | a random scenario |
| Lines | any of WC, GL, Property | **WC only** |
| Prior development | **not settable**: `PRIOR_DEVELOPMENT_DEFAULTS` (WC +3%, GL +10%, Property −2%) | |
| Shocks | **not settable** | see below |

- **The shock draw.** At start, `openSoloInstance` draws `drawCatalogueSchedule(seed, gameLength, 'solo_shock_schedule')`. Each of the 12 events fires independently at its scaled probability in each year from **year 2** on, so year 1 never has a shock. Repeats and several events in one year are possible. Game length is part of the stream key, so the same scenario draws a different schedule at a different length.
- **Scenario 1's draws:**
  - at 3 years, #4 Legislation and #6 Recession, both in year 2;
  - at 5 years, #5 WC Reform in year 3;
  - at 10 years, **nothing**.
- **Shocks are always "on".** `setup.shockTiming = 'solo'` and `SOLO_SHOCKS` is on, so `gameShocksOn` is true even when the draw is empty. The four covers are offered, expected loss carries the catalogue expectation, and Property capital carries the catastrophe term.
- **Shock levels and R rates** are the catalogue's (2.10) and cannot be changed.
- **Loans** prompt as in 5.3.

### 7.2 Test player

"Test player" opens the host's own setup screen (`HostCreateScreen` with `soloTest`), starting from the Setup page's values, and plays the result solo. Nothing is sent to a server and no admin sign-in is needed.

| Setting | What the player can set |
|---|---|
| Pool name (required), seed 1–20, first program year, lines | as the host |
| Years | **3–10** (the Start button is disabled outside that range) |
| Prior development | **per line, 0–100% in whole percent, adverse or favourable**; it starts at WC 3% adverse, GL 10% adverse, Property 2% favourable |
| Shock schedule | a hand-built list (any of the 12 events, any year from 1 to the game length, repeats allowed), or **Randomise** |
| Not shown | event name, number of teams |

- **Randomise** replaces the list with `drawShockSchedule(seed, years, 'host_shock_schedule')`, the **host's** rule (7.3), not Single player's catalogue draw. For seed 1 over 5 years it gives #4 Legislation in year 3 and #2 Winterstorm in year 5. The screen marks a draw as stale once the seed or the year count changes.
- **Start.** On Start, entries outside years 1 to the game length are dropped, and the game fires exactly that list (`openSoloInstance(settings, { schedule })`). Its prior development rides on `settings.priorDevelopment`.
- **Shocks are "on" even with an empty list.** Test player sets `shockTiming = 'solo'` (Flags).
- **Loans** prompt as in Single player.

### 7.3 Hosted

The host's create screen (`HostCreateScreen`) sets:

| Setting | Range |
|---|---|
| Event name | required |
| Pool name | optional; the event name is used if blank |
| Seed | 1–20 |
| Years | **1–20** (input bounds; creation requires ≥ 1) |
| First program year | 2000–2100 (input bounds) |
| Number of teams | an expectation only; it limits nothing |
| Lines | at least one; **every team plays exactly these** (`RoomView.lines`) |
| Prior development | per line, 0–100% adverse or favourable, as for Test player |
| Shock schedule | a hand-built list, or Randomise |

- **Randomise** (`drawShockSchedule`, `src/utils/shockSchedule.ts`) works like this:
  - count = round(0.3 × years) + a uniform offset of −1, 0 or +1 (`SHOCK_SCHEDULE_SPREAD`), clamped to between 1 and max(1, years − 1);
  - distinct years from year 2 (year 1 only for a 1-year game);
  - events weighted by probability, without replacement.
- **The server's checks.** It requires only a list of `{shockId: string, yearNumber: integer}`. It does not check the year range, duplicates or that the id exists.
- **Every team builds the same game** (`buildTeamGame`, `src/session/client/buildGame.ts`) with `shockTiming = 'host'`. Shocks are on only if the list is non-empty; with an empty list only None is offered and expected loss excludes shocks.
- **Prior development** comes from the room (`setup.priorDevelopment`).
- **Loans are always declined.**
- **Results run one year behind** (`latestKnownRoomYear` = the room's current year − 2), as in solo.
- **Each player's own screens** show the team's **room market share** (Results, Calculation Audit, and the top-bar chip), never another team's. Single player shows no market share.

### Worked example — 7. Modes (scenario 1, WC)

| | Single player | Test player, list left empty | Hosted, no shocks |
|---|---|---|---|
| Shock schedule | #5 WC Reform, year 3 | none | none |
| Shocks on? | yes | **yes** | no |
| Covers offered | 4 + None | 4 + None | None only |
| Prior development, WC | 3% (fixed) | as set; default 3% | as set; default 3% |
| 2027 rate / ending surplus | 3.5277 / $18,634,459 | the same | the same |

---

## 8. What the host sees

The host screen (`src/session/screens/HostShell.tsx`) has several tabs. This section covers the **Teams** tab (`HostTeamsTab.tsx`), whose figures every team posts after each year (`summarize`, `src/session/client/results.ts`).

### 8.1 Which year the table shows

- **Reporting year** = min(`latestKnownRoomYear`, current year − 1), where the room's current year is the year being decided.
  - Before the first advance it is −1 and every row reads "no results known yet".
  - With the room deciding year N it shows year N − 2: the opening (2026) once year 2 is being decided.
  - After the last year it shows the final year.
- **The heading** reads "Results for {starting year + reporting year − 1}".
- **The line view.** A bar switches between **Pool** and each line any team writes. Every team in a room writes the room's lines.

### 8.2 The columns

Each row is one team. Every figure is the team's own, read off its own Annual Statement at that year (`statementFiguresOf`) and posted with the year's result.

| Column | How it is calculated | Source |
|---|---|---|
| Team | the name the team chose | |
| **Market share** | Line view: own `activeExposure` ÷ the sum of every counted team's `activeExposure` on that line. Pool view: own `poolPremium` ÷ the sum of `poolPremium`. See 8.3. | `roomSharesFor`, `src/session/marketShares.ts` |
| **Combined ratio** | Cumulative since the game began: Σ (net incurred loss + LAE + booked admin + risk control + reinsurance cost) ÷ Σ member charge, over every played year up to the row's year. Before year 1 it is over the six pre-game years. | `topCombinedRatio` (`resultsStatement.ts`) |
| Surplus | `endingSurplus` for the year, shown as $x.xM; green above 0, red at or below | |
| **Premium to surplus** | The balance sheet's row for that year: (member charge − reinsurance cost) ÷ ending surplus | `balanceRows` |
| **Rate** | Line view: `finalRatePer100` charged that year, with the change on the year before's rate. Pool view: one line per line, since the units differ. | `statementFiguresOf` |
| **Funding** | "Expected" if the line funded at Expected, else the chosen stop. Pool view: one answer only if every line agrees, else "—". Year 0 is "—", because the opening was the prior board's. | `fundingOf` |
| Ripple Score | always "—"; a placeholder | |

- **Row states.** A team that does not write the viewed line shows one cell, "does not write {line}". A team that writes it but has not posted shows "{year} not reported yet".
- **Colour.** The combined ratio is coloured by `colorForRatio`, the loss-ratio bands: green below 70%, sky below 100%, amber below 110%, red at or above.

### 8.3 Room market share

- **What it measures.** A team's share of the **room**, not of the full market.
  - Per line: exposure ÷ the room's exposure on that line.
  - Pool: `poolPremium` ÷ the room's `poolPremium`. This is the pool premium at the selected CLF, without admin or reinsurance.
- **When it is computed.** The set for year Y is computed in the submit that brings in the last year-Y result from the teams that **locked** year Y.
  - A team that did not lock year Y counts on its newest result at or before Y.
  - A team with no result at all is left out.
  - The set is stored once per year in `marketSharesByYear` (`mayStoreShares`).
  - Year 0 (the opening posts) is rewritten as teams post, but never by a smaller set.
- **Which set is shown** (`shownShares`): the newest stored year ≤ max(0, min(latest known year, current year − 1)). Before the first advance that is year 0, standing in for 2025, which no team posts.
  - If a team that locked the year has not posted yet, the newest complete earlier year is shown, with its year in brackets.
- **At the opening** every team holds the same book, so N teams read 1/N each.
- **Who sees it.** The host sees every team's share on `RoomView`; a player or viewer gets only its own on `CallerView.marketShare`.

### Worked example — 8. The Teams table (a room on seed 1, WC only, no shocks, default prior development)

Three teams lock year 1 (2027) as follows:
- **A** keeps the defaults.
- **B** sets new members to 5%.
- **C** sets non-renewal to 5% and funds at 80%.

Team A's year is exactly section 2's. Each posted figure:

| Team | Exposure ($M) | Pool premium | Member charge | Ending surplus | Rate struck (on 916.113) |
|---|---|---|---|---|---|
| A | 916.11 | $28,644,773 | $32,317,386 | $18,634,459 | 3.5277 |
| B | 961.92 | $30,077,011 | $33,933,256 | $18,439,912 | 3.5277 |
| C | 870.31 | $28,608,537 | $32,097,520 | $20,597,422 | 3.6881 (80% CLF 1.0513) |

**While deciding 2029 (current year 3),** the host's **WC** view reads "Results for 2027":

| Team | Market share | Combined ratio | Surplus | Premium to surplus | Rate | Funding | Ripple Score |
|---|---|---|---|---|---|---|---|
| A | **33.3%** (916.11 ÷ 2,748.34) | **105.3%** | $18.6M | **1.73** | $3.53 (+0.8%) | Expected | — |
| B | **35.0%** | **105.7%** | $18.4M | **1.84** | $3.53 (+0.8%) | Expected | — |
| C | **31.7%** | **99.3%** | $20.6M | **1.56** | $3.69 (+5.4%) | 80% | — |

On the **Pool** view the share column reads A **32.8%**, B **34.4%** and C **32.8%** (pool premium ÷ $87,330,321).

**While deciding 2028 (current year 2),** the table shows 2026, the opening. Every team reads share 33.3%, combined ratio **95.2%** (cumulative over 2021–2026), surplus $18.2M, P/S **1.76** ($32,052,108 ÷ $18,173,463), rate $3.50 (+2.9%), and funding "—".

---

## The year carried through: scenario 1, WC, 2027

| Line of the statement | Amount | Section |
|---|---|---|
| Member charge (premium): 3.5277/$100 × 916.113 × 10,000 | **$32,317,386** | 4 |
| − Net incurred loss: current year $22,700,428 + prior development $2,759,203 | −$25,459,631 | 2.4, 2.7, 2.8 |
| − LAE incurred | −$4,873,604 | 2.6 |
| − Operating (admin) expense, with the 0.935% overrun | −$3,706,949 | 4.8, 2.14 |
| **= Underwriting income** | **−$1,722,797** | |
| + Investment income | +$2,183,794 | 2.13 |
| **= Net income** | **+$460,997** | |
| ± Dividends / assessments | $0 | 5 |
| Opening surplus | $18,173,463 | 1 |
| **Ending surplus** | **$18,634,459** | 6 |

| Ratio | Calculation | Value |
|---|---|---|
| Loss ratio | 25,459,631 ÷ 32,317,386 | 78.8% |
| LAE ratio | 4,873,604 ÷ 32,317,386 | 15.1% |
| Expense ratio | 3,706,949 ÷ 32,317,386 | 11.5% |
| Combined ratio | | **105.3%** |
| Premium to surplus | 32,317,386 ÷ 18,634,459 | 1.73 |
| Capital status | | **Strong, 4.33** |

| Balance sheet, end 2027 | |
|---|---|
| Invested / cash | $94,388,838 / $4,847,608 |
| Net loss reserve (case $42,258,603 + IBNR $25,943,862) | $68,202,466 |
| LAE reserve | $12,399,521 |
| Surplus | $18,634,459 |

Every figure above is the 100-world average the game shows, from the engine's own functions on the instance described at the top. The hosted room's team A shows the same figures.

---

## Flags

### Fixed since the last version (2ae5c1a)

- **Old flag 2, struck on one book and charged on another: fixed at the defaults.** The default no longer grows the book, so the rate is struck and billed on 916.113, and the Model tab's premium is what is charged. It still happens whenever a slider moves the book (new flag N4).
- **Old flag 4, the default always paid the penalty: fixed.** Default play no longer grows the book 5% a year at ×1.20. The penalty is still never priced (still open).
- **Old flag 8, part 3, a regional T claim could vanish: fixed.** T claims land on the line by region and always land.
- **Old flag 12, near-perfect renewal selection: moot.** There is no selection; non-renewal is a fixed relief of 0.5 × a₁.
- **Old flag 17, partly fixed.** `OPENING_BOOK_EXPOSURE` is live again as the opening book, and `noiseZ` and the unit market are gone.
- **Shock records were double-counted** when an event fired again while in force. They are now kept one per firing (`firingRecordKey`).
- **Property catastrophe capital** now caps the cover's cession at its ceiling.

### Inconsistent or surprising: behaviour

1. **Openings land far from their scenario targets** (still).
   - Scenario 1 WC targets 1.97 and opens at 1.78.
   - Rank correlation of target with actual across the 20 scenarios: **WC 0.64, GL 0.02, Property 0.22**. On GL the thin-to-rich order is lost.
   - Scenario 3 WC trips the 3.5 guardrail (margin 4.27%).
   - **New:** the 0% margin floor now binds for **WC 4 and GL 19**.
   - Year-1 premium at Expected now spans $27.5M–$35.7M on WC across scenarios, although every scenario has the same opening book.
2. **Using both sliders at 5% is a free lunch, every year.** Exposure is unchanged (−5% + 5%), but lossFactor is 0.95 × 0.975 + 0.05 × 1.2 = **0.98625**, so ordinary losses are 1.4% lower at the same premium. In scenario 1 that moves the combined ratio from 105.3% to 104.2% and adds $372k of surplus in year 1. Nothing limits doing it every year. The relief applies to the renewing book with no selection behind it.
3. **Non-renewal's effect is mostly price, not risk.** At 5% non-renewal, premium falls $1.62M, ordinary loss falls $1.67M (5% exposure plus 2.5% relief), and prior-year development stays the same in dollars. A 5% non-renewal team's combined ratio still improves (103.8% vs 105.3%) only because of the relief. The landing note in `pricingParameters.ts` says this was measured as intended.
4. **New flag N4: the rate is struck before movement and billed after,** whenever a slider is used (B and C in section 8). Fixed admin is then over- or under-collected by the movement, and "Expected to surplus" uses the rated exposure.
5. **Part of P&C is booked as expense** (still). The 2% P&C loading on the admin part, **$73,452** on WC in 2027, is billed inside admin ÷ divisor and booked as admin expense. "Expected to surplus" counts it as surplus.
6. **The new-business penalty and the non-renewal relief are never priced** (still). The rate learns both only through the experience.
7. **The 100-world average barely shows the year factor; the member risk scores now dominate the averaged noise.** F is drawn per world, so its 6% CV averages to about 0.6% across 100 worlds. The members' risk scores are shared by every world: they move the averaged ordinary loss with a CV of about 3% (0.30/√100), redrawn each year (2027: 0.9979). The funding tables are built at 6% / 10% / 8% and leave out both member terms (`typicalBookOrdinaryCv` says 6.8% / 10.5% / 8.6%).
8. **The capital standard is light, and the screen mislabels it** (still). Required capital uses the 80% stop on ordinary-loss-only tables, about 5% of reserves on WC, so "Strong" is nearly automatic (4.91 at the opening). `DecisionsPage.tsx:750` still says "90% confidence" next to the 80% factor.
9. **Ordinary losses run up to $5M on WC and GL** (still). `ORDINARY_LOSS_LIMIT` is not applied to them; it is read only by the routine-large-loss basis behind Property's fold. The per-occurrence covers can recover only on shock T claims.
10. **No GL pool limit** (still). `POOL_LIMIT_PER_OCCURRENCE` is `null` on every line.
11. **Shock behaviour** (still):
    - A regional event's A applies to the whole line.
    - Recession and Pandemic have no effect in their second year (`SHOCK_A_YEARS = 1`).
    - Investment Loss is added after the market clamp, so equities can reach −80%.
    - A T claim's region now affects nothing but its label and Property's catastrophe flag.
12. **Shocks are "on" in Single player and Test player whatever the schedule holds.**
    - A Test player who leaves the list empty, or a Single player whose draw is empty (scenario 1 over 10 years), is offered four covers that can never recover. That player's expected loss also carries the catalogue (+$724k on WC in 2027).
    - A hosted room with an empty list has shocks off.
    - Test player's Randomise uses the **host's** rule, so it does not reproduce what Single player would draw for the same seed.
13. **Schedules are not validated** (still, and Test player now has the same gaps).
    - The host and Test player can add year 1 and duplicates.
    - The server accepts any id (an unknown one throws in the engine) and any year. Test player drops years outside 1 to the game length.
    - The host's year count goes to 20 while solo allows 3–10.
14. **Loans differ by mode** (still). Single player and Test player prompt if 1 of 100 worlds needs a loan; hosted declines all. A borrower lands at exactly $0 and is not dividend-blocked the next year. The screen's dividend block reads the averaged prior surplus, while the engine blocks per world.
15. **The pool-level starting surplus omits the LAE reserve** (still). `StartingFinancials.surplus` shows $28.82M for scenario 1 against a true $18.17M ($18.17M + $10.64M LAE reserve). Only a Dashboard fallback reads it.
16. **WC's first pre-game year earns no investment income** (still): 2021 shows $0.
17. **The Rate Indication's year-1 change nets the prior board's cushion** (still). Its "+0.8%" is +1.7% of experience less the 0.97% margin coming off.
18. **Two development notes** (still):
    - GL's LDFs describe a limited layer, but the engine's GL losses are not limited (`GL_LAYER_MISMATCH = true`).
    - `FREQUENCY_TREND_PER_YEAR` is read by pricing and not by the loss draw.
19. **The host's Teams table:**
    - **The combined ratio is coloured on the loss-ratio scale** (`colorForRatio`). A team at 99.3% reads blue, not the green `colorForCombinedRatio` gives the team's own header.
    - **The combined ratio's basis changes after the opening.** At year 0 it is cumulative over the six pre-game years (95.2%); from year 1 it covers played years only.
    - **Before the first advance** every row says "no results known yet", but the Market share column already shows 33.3% (2026).
    - **Line shares use `activeExposure` rounded to two decimals:** A reads 33.33321%, not 1/3.
    - **The pool share is pool premium** (no admin), while every other premium on the table is the member charge.
    - **Ripple Score** is always "—".
20. **Single player's default is WC only.** The previous version of this document said three lines.

### Settings that are read by nothing, or overridden

21. These have no effect on the game:
    - `SUPPLIED_PURE_PREMIUM_INCLUDES_ULAE` (the ÷1.05 is hard-wired)
    - `PRICING_WINDOW_WEIGHTING_NEW`
    - `RATE_CHANGE_CAP_NEW`, `RESERVE_BASIS_NEW`, `PRIOR_HISTORY_YEARS_NEW`
    - `PRE_GAME_INVESTMENT_RETURN`
    - `SHOCK_T_BASIS_PER_100` (its reader is uncalled)
    - `REINSURANCE_LOAD` (overridden by the fixed prices)
    - `PRICING_WINDOW_YEARS = 10` (old triangle display only)
    - `ADMIN_LOAD_OF_EXPECTED_LOSS` (old stack only)
    - `R_MODEL.tShock`, `.reinsurance`, `.investmentLossAdjustment` and the investment fields
    - `OPENING_SURPLUS_BAND`
    - `renewalUnderwriting.ts` (called with an empty roster)
    - `requiredCapital` and `openingCatCapital` in `openingReserves.ts`
    - `DIVIDEND_ASSESSMENT_RANGE` (parameters page only; the slider reads `SLIDER_RANGES`)

### Comments that contradict the code

The code is described above; this is a selection.

22. New since simple underwriting:
    - The UNDERWRITING block in `pricingParameters.ts` says "No risk scores" and "They exist ONLY for each member's own luck draw"; `MEMBER_RISK_CV = 0.30` gives every member a yearly risk score.
    - `UNDERWRITING_MEMBERS`'s CV formula leaves out the risk score.
    - The `HostTeamsTab.tsx` header says "Teams pick their own lines"; the room fixes the lines.
    - `App.tsx` says the solo schedule is drawn "by the host's Randomise rule"; it is the catalogue draw. It also says "3-year pre-game"; the pre-game is 6 years.
    - `buildGame.ts` says single player "leaves this absent and draws from the catalogue"; it sets `shockTiming: 'solo'`.
23. Still wrong from before:
    - "Ten worlds" (it is 100).
    - "Trended at 5%" (4/8/5%).
    - "5% P&C on every line" (2/0/0).
    - "ALAE 5%" (drawn at 7–15/10–20/2–5%).
    - `PRIOR_HISTORY_YEARS` "five" (6).
    - The `STARTING_CAPITAL` narrative ($5M/$12.5M/$17.5M; the code is 3/12/12.5).
    - `ROUTINE_LARGE_LOSSES` "a switch, now on" (off).
    - The `newPurePremium.ts` header "shadow mode, read by nothing that prices" (it is the live pure premium).
    - The reinsurance tower header ($4M/$5M packages, $25M GL limit).
    - The default cover "the middle option" (None).
    - The reserve margin "CLF90" (the 80% stop).
