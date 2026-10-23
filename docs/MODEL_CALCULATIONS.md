# How the game calculates its numbers

Read from the executable code on `multiplayer` at commit **2ae5c1a** (23 Oct 2026), not from comments or earlier documents. Where a comment disagrees with the code, the code is described and the disagreement is listed under **Flags** at the end. All constants live in `src/data/pricingParameters.ts` unless another file is named.

## How to read this

**The live engine.** `MEMBER_LEVEL = { enabled: false }`, so `newLossEngineRuns()` is true. Each line is one *book* of units (no member roster), its ordinary losses are an aggregate draw, and large losses are individual shock claims. Code behind switches that are off and read by nothing live is left out; the switches themselves are listed.

| Switch | Value | What it means today |
|---|---|---|
| `MEMBER_LEVEL` | off | New loss engine; book of units, no members |
| `NEW_RATE_STACK` | on | The rate is built by `quoteNewRateStack` |
| `SOLO_SHOCKS` / `SOLO_SHOCK_DRAW` | on / `'catalogue'` | Single-player draws a shock schedule at start |
| `SHOCK_FREE_PRICING`, `SHOCKS_OUT_OF_EXPERIENCE` | on, on | Shocks never reach the pure premium |
| `CATASTROPHE_LOAD` | off | No shock allowance in the rate |
| `ROUTINE_LARGE_LOSSES` | off | No routine large claims; Property gets a "fold" instead |
| `AGGREGATE_STOP` | off | Only per-occurrence covers are sold |
| `RISK_CONTROL` | off | No risk-control charge or effect |
| `UP_FRONT_TREND`, `FLAT_PRE_GAME` | off, off | |
| `PRE_GAME_MARGIN_ON_DESIGN` | on | Prior board's margin is solved on a "designed" history |
| `FULL_COST_BOOKING` (`defaultAssumptions.ts`) | on | No booking bias, no random IBNER walk |
| `DEVELOPMENT_TAIL.closed` | true | Payout patterns end at their last row |
| `WORLD_COUNT` | 100 | Every year is played in 100 worlds |

**Worlds.** Each year runs in 100 worlds (`src/utils/worlds.ts`). Each world draws its own ordinary-loss year and unit factors and its own investment market. Shared by all worlds: the book and its movement, the shock schedule and shock sizes, the ALAE ratio, the admin overrun, and the one rate per team-year. **Every dollar figure on screen is the average across the 100 worlds**, and every ratio is recomputed from the averaged dollars.

**Units.** Exposure is in $M (payroll for WC, payroll/revenue for GL, insured value for Property). Premium = exposure × rate per $100 × 10,000.

**The worked example.** One game is carried through every section: **scenario 1, WC**, built the way the app builds it.
- **Setup:** `openSoloInstance({ instanceId: '1', gameLength: 5, startingYear: 2027, activeLines: [WC, GL, Property] })` (`src/utils/soloGame.ts`), the Setup page defaults. Then `runPriorHistory`, `openWorlds`, and year 1 played at `defaultDecisionSet(1)` through `playWorldsYear` → `settleWorldsYear` → `commitSettledYear`.
- **Seed:** `seedFromInstanceId('1')` = 177556. Scenario 1 is fully deterministic; WC's numbers are the same whatever other lines are active, and the same in a hosted room.
- **The first priced year** is year 1 = 2027.
- **Default decisions:** funding at Expected, 0% renewals declined, 0% new-business rejection, no reinsurance, no dividend, allocation 10/80/10.

---

## 1. The opening

### 1.1 Scenarios and their targets

- **The scenario is the game's only seed.** The instance id is the text "1"–"20" (`SCENARIO_COUNT = 20`; `src/utils/scenarios.ts`). Its seed is `seedFromInstanceId(id)`, a djb2-style hash (`src/seedHash.ts`). The unit market, the opening book, the pre-game draws, the shock schedule and the worlds all come from that seed.
- **Choosing.** Single-player: the Setup page dropdown, defaulting to a random scenario. Hosted: the host picks the room seed from the same 20.
- **Order.** `SCENARIOS_THIN_TO_RICH = [12, 19, 10, 14, 3, 8, 15, 11, 20, 6, 9, 5, 4, 1, 18, 7, 17, 2, 13, 16]` runs thinnest (highest premium-to-surplus) to richest, the same on every line.
- **Target premium-to-surplus (P/S).** `SCENARIO_PREMIUM_TO_SURPLUS[line][n]` = thinnest − k × (thinnest − richest)/19, where k is the scenario's position (0-based) in that order. `SCENARIO_RATIO_RANGE`: **WC 3.0 → 1.5, GL 2.3 → 1.3, Property 1.7 → 1.2**.
- **The target does two things:**
  1. It sets the prior board's margin (1.4).
  2. It scales the pre-game's ordinary losses: `preGameLossMultiplier = 1 + (1 − PRE_GAME_EXPERIENCE_BASE[line] / target) × PRE_GAME_EXPERIENCE_WEIGHT`, with base = the midpoint of the range (**WC 2.25, GL 1.8, Property 1.45**) and weight **0.3**. A thin scenario runs above 1 (a worse record), a rich one below. It applies to years ≤ 0 and to ordinary losses only, never to expected loss (`preGameLossFactor`, `src/utils/ordinaryLoss.ts`).
- **The target is not where the opening lands** — see 1.4.

### 1.2 Paid-in capital by line

`STARTING_CAPITAL` = **WC $3,000,000; GL $12,000,000; Property $12,500,000**. Each line starts the pre-game (2021) with this surplus, no reserves, an empty ledger, and nothing else (`simulateLineCandidate`, `src/utils/priorHistoryEngine.ts`). Surplus then moves only with income, dividends and assessments. It is the only capital event before the game.

### 1.3 The pre-game years

- **How many.** `PRIOR_HISTORY_YEARS = 6`: years −5 … 0 = calendar 2021–2026. The last three (2024–2026) are returned as `priorHistory`; the first three as `earlyPreGameHistory`. All six are played by the same engine (`processYear`).
- **Each line separately.** `runPriorHistory` → `runLinePreGame` per active line, so a line's pre-game does not depend on the other lines.
- **Decisions each year** (`preGameDecisionSet`): the defaults, plus `fundingCushion = margin` (CLF 1 + margin), and a cash-and-bonds allocation of 11.1% / 88.9%.
- **No underwriting** (`freezeMembership: true`): no declines, withdrawals or applications. The book grows on a set path instead (1.6). Host development is 0 in the pre-game.
- **Losses** are drawn as in play (2.4), on separate `pregame_` streams, × the scenario's loss multiplier. New units carry the new-business penalty.
- **No shocks** fire before year 1.
- **Pricing.** Each pre-game year is priced by the normal rate (section 4) at the margin's CLF. 2021 and 2022 have no usable history and price on expected loss; 2023 prices on one year, rising to four by 2026.

### 1.4 How the prior board's margin is set

The prior board funds every pre-game year at one margin over expected (CLF = 1 + margin), solved per scenario and line in `runLinePreGame`:

1. **Designed run.** The pre-game is replayed with every ordinary loss at exactly expected × the scenario multiplier (no draws), and the market at its expected return (3.28% on the cash/bond mix). A secant search (`solvePreGameMargin`, tolerance $0.01, up to 40 steps) finds the margin at which the 2026 year-end surplus equals **year-1 premium at Expected ÷ the target P/S**.
2. **Floor.** `PRE_GAME_MARGIN_FLOOR = 0`. Not binding in any scenario today.
3. **Played run.** The real (drawn) pre-game is played at that margin. **The opening surplus is wherever the played 2026 year-end lands.**
4. **Guardrails** (`OPENING_PREMIUM_TO_SURPLUS_BOUNDS = { min: 1.0, max: 3.5 }`). If surplus ≤ 0 or played P/S > 3.5, the margin is re-solved on the played history to land exactly on 3.5. If P/S < 1.0, re-solved to land on 1.0, but not below the floor. Today only **scenario 3 WC** trips one (margin 1.80% → 6.60%).
5. **In year 1** the player's default is funding at Expected, so the prior board's margin comes off the rate.

Year-1 premium at Expected is `openingYear1Premium` = the engine's own year-1 quote (`strikeBookRate`, default decisions) × the opening book.

### 1.5 Guardrails and pre-game investment return

- **Guardrails** are the P/S bounds above (1.0 to 3.5).
- **Pre-game investment return.** Each played pre-game year averages `PRE_GAME_MARKET_DRAWS = 10` market draws (`preGameMarketReturns`, `src/utils/investmentEngine.ts`), blended on the 11.1% cash / 88.9% bonds mix. The designed run uses the expected return (3.28%). `PRE_GAME_INVESTMENT_RETURN = 0.03` is read only with `FLAT_PRE_GAME` on, so it is not used.

### 1.6 The book at the opening and pre-game growth

- **Market.** 200 units per line (`UNIT_MARKET_COUNT`; `marketUnits`, `src/utils/bookUnits.ts`). Sizes are lognormal with CV `UNIT_SIZE_CV = 0.40`, scaled to sum to `FULL_MARKET_EXPOSURE`. Risk is lognormal with CV `UNIT_RISK_CV = 0.30`, scaled to a size-weighted mean of 1.0.
- **Market size.** `FULL_MARKET_EXPOSURE` = base × `EXPOSURE_SCALE` (**WC 2.342, GL 1.640, Property 0.546**) = **WC 3,044.6; GL 2,132.0; Property 32,341.2** ($M).
- **Opening book.** The market is shuffled; units are taken until the book first reaches `UNIT_POOL_SHARE = 0.30` of the market (`openingBookUnits`). About 60 units, about 30%.
- **Pre-game growth.** `PRE_GAME_BOOK_GROWTH = 0.02`: year y ≤ 0 holds the opening book × 1.02^y (`preGameBookShares`, `src/utils/bookUnderwriting.ts`). Each year's increase is booked as new business and carries the penalty.
- **Exposure trend.** `EXPOSURE_GROWTH_PER_YEAR = 0`, so exposure moves only with the book.

### 1.7 Opening reserves and the balance sheet

- **Reserves** are the cohorts the pre-game wrote (2021–2026), net of reinsurance. There are no bulk years.
- Each cohort is given its lifetime **host development** total once, at the opening (2.8).
- **Invested assets** = surplus + net reserve + LAE reserve − cash.

### 1.8 Single-player vs hosted

The opening is the same function in both (`runPriorHistory`), and pricing and the pre-game see no shocks. So every team in a room and a solo player of the same scenario inherit the same opening; measured identical on all 20 scenarios × 3 lines. The only difference is a host-edited prior-development percentage (2.8), which changes emergence after year 1, not the opening.

### Worked example — 1. The opening (scenario 1, WC)

| Item | Value | Source |
|---|---|---|
| Position thin → rich | 14th of 20 | `SCENARIOS_THIN_TO_RICH` |
| Target P/S | 3.0 − 13 × 1.5/19 = **1.9737** | `SCENARIO_PREMIUM_TO_SURPLUS` |
| Pre-game loss multiplier | 1 + (1 − 2.25/1.9737) × 0.3 = **0.9580** | `preGameLossMultiplier` |
| Paid-in capital | **$3,000,000** | `STARTING_CAPITAL.WC` |
| Opening book | 58 units, **$921.06M** (30.25% of $3,044.6M), size-weighted risk **0.9131** | `openingBookUnits` |
| Designed margin = final margin | **+0.73%** (CLF 1.0073); no guardrail | `solvePreGameMargin` |

Pre-game years, played at the 0.73% margin:

| Year | Exposure $M | Rate /$100 | Premium | Net ultimate loss | Inv. income | Net income | Ending surplus | Ending net reserve |
|---|---|---|---|---|---|---|---|---|
| 2021 | 834.23 | 2.6177 | $21.84M | $15.33M | $0 | $0.67M | $3.67M | $12.79M |
| 2022 | 850.91 | 2.7247 | $23.19M | $16.25M | $0.80M | $1.03M | $4.69M | $23.42M |
| 2023 | 867.93 | 2.9405 | $25.52M | $15.33M | $0.64M | $3.60M | $8.29M | $31.13M |
| 2024 | 885.29 | 3.0467 | $26.97M | $16.84M | $1.64M | $4.45M | $12.75M | $38.78M |
| 2025 | 903.00 | 3.0627 | $27.66M | $17.19M | $2.29M | $5.03M | $17.78M | $45.55M |
| 2026 | 921.06 | 3.1393 | $28.91M | $20.47M | $1.18M | −$0.19M | **$17.59M** | **$54.07M** |

Opening, start of 2027:

| Item | Value |
|---|---|
| Opening surplus | **$17,591,242** |
| Year-1 premium at Expected (on 921.06) | **$29,478,253** |
| Opening P/S | **1.676** against a target of 1.974 |
| Net unpaid reserve | **$54,068,232** |
| LAE reserve | **$9,578,193** |
| Invested assets / cash | $76,900,444 / $4,337,222 |
| Host development set at the opening (3%) | $1.62M in total, to emerge during play |

---

## 2. Loss model

### 2.1 The book (sizes, risk)

See 1.6 for the market and the opening book.
- **Partial units.** A unit can be held in part: the ledger records a share, and its exposure, losses and premium are size × share.
- **Book risk.** The book's risk is its size-weighted mean true risk (`bookOrdinaryRisk`). It multiplies expected loss.
- **Unread draw.** Units also draw a region and a `noiseZ`; nothing live reads `noiseZ`.

### 2.2 Normal (ordinary) losses — base cost per $100

- **WC and GL** come from the pool's supplied pure premium by layer, `POOL_LOSS_COST_LAYERS`, at the 2027 level:

  | Line | $0–1M | $1M–5M | Sum |
  |---|---|---|---|
  | WC | 2.50 | 0.118 | 2.618 |
  | GL | 2.50 | 0.95 | 3.45 |

  The supplied figures include ULAE, so the claims cost is the sum ÷ (1 + `ULAE_OF_LOSS_COST`):
  - `EXPECTED_ORDINARY_LOSS_COST_PER_100` WC = 2.618/1.05 = **2.493333**
  - GL = 3.45/1.05 = **3.285714**
- **Property** is the fixed **0.159515**. While `ROUTINE_LARGE_LOSSES` is off it gets a routine "fold" added (`routineFoldPer100`, `src/utils/shockExpectation.ts`) of +0.050466 in 2027, so the live cost is **0.209981**.
- **No per-claim limit.** `ORDINARY_LOSS_LIMIT` ($1M WC/GL, $5M Property) is not applied to ordinary losses, which have no claims; on WC and GL the $1M–5M layer is inside the ordinary cost.
- **Never ceded.** Ordinary losses are not occurrences, so no reinsurance applies to them.

### 2.3 Trend

`ordinaryLossCostPer100(line, n)` = base × (1 + `SEVERITY_TREND_PER_YEAR`)^(n − 1) (+ Property's fold).
- `SEVERITY_TREND_PER_YEAR` = **WC 4%, GL 8%, Property 5%**.
- Base year = year 1 (2027). Pre-game years are trended backwards.
- `FREQUENCY_TREND_PER_YEAR` = 0, read only by pricing.

| Cost per $100 | 2021 | 2026 | **2027** | 2028 |
|---|---|---|---|---|
| WC | 1.97052 | 2.39744 | **2.49333** | 2.59307 |
| GL | 2.07056 | 3.04233 | **3.28571** | 3.54857 |
| Property | 0.15669 | 0.19998 | **0.20998** | 0.22048 |

### 2.4 The draw: year factor and member factor

`ordinaryLossFromUnits` (`src/utils/ordinaryLoss.ts`), on the book **after** the year's underwriting movement. For each held unit u:

- expected_u = size_u × share × 10,000 × risk_u × cost per $100
- realised_u = expected_u × **F** × **f_u** × (1 + penalty if u was written this year) × (1 + shock uplift)

where:
- **F** is the year factor: one draw per line, year and world. Lognormal with mean exactly 1 and CV `BASELINE_CV` = **WC 6%, GL 10%, Property 8%**.
- **f_u** is the unit's own factor: lognormal, mean 1, CV `UNIT_ORDINARY_OWN_CV` = **10%**, one per unit per year per world.

The line's ordinary loss is the sum over units. Over a book of about 60 units the line's CV is about **WC 6.2%, GL 10.1%, Property 8.1%**.

### 2.5 The new-business penalty

factor = 1 + `NEW_BUSINESS_PENALTY` × (1 − min(1, rejection / `FULL_SAVINGS_AT`)), with `NEW_BUSINESS_PENALTY = 0.20` and `FULL_SAVINGS_AT = 0.10`.

| Rejection | 0% | 5% | ≥ 10% |
|---|---|---|---|
| Factor | **1.20** | 1.10 | 1.00 |

It applies to the **actual** ordinary losses of units written this year, in their first year only. It is **not** in expected loss or in pricing; the rate learns it only through the loss history.

### 2.6 LAE — the ALAE draw and ULAE

- **ALAE ratio.** One draw per accident year and line, uniform in `ALAE_RATIO_RANGE`: **WC 7–15%, GL 10–20%, Property 2–5%** (`alaeRatioFor`, `src/utils/alaeRatio.ts`). It comes from the game seed, so all worlds share it. It is stored on the cohort.
- **ALAE default.** `ALAE_OF_LOSS_COST` (the midpoints **11%, 15%, 3.5%**) is used only where no ratio exists.
- **ULAE.** `ULAE_OF_LOSS_COST` = **5%** on all lines.
- **Booking** (`src/utils/lossExpense.ts`). Both are shares of the gross loss:
  - **incurred** = share × the change in each cohort's gross ultimate, so development and reserve inflation on old years attract LAE too, at those years' ratios;
  - **paid** = share × gross paid;
  - **LAE reserve** = share × gross unpaid.

### 2.7 Reserve inflation

`RESERVE_INFLATION_PER_YEAR` = a copy of the severity trend (**WC 4%, GL 8%, Property 5%**). Each year, for every open prior accident year (`processIbner`, `src/utils/simulationEngine.ts`):
- inflation = rate × the cohort's gross unpaid at the start of the year;
- it is added after that year's payment and paid out in later years;
- it is reported inside prior-year development.

The current accident year gets none in its own year. Pricing anticipates part of it (4.3).

### 2.8 The host's development

- **Settings.** `PRIOR_DEVELOPMENT_DEFAULTS` = **WC +3%, GL +10%, Property −2%**; positive is adverse.
- **Who sets it.** Single-player uses the defaults. A hosted room starts at the same values and the host may edit them per line (`src/session/contract.ts`).
- **A lifetime total, not a yearly rate** (`src/utils/hostDevelopment.ts`): each accident year gets total = pct × its gross unpaid at a base date. The base date is the game start for the opening cohorts, and the end of its own first year for a played year.
- **Emergence.** The total emerges in step with payments: each year's share is that year's paid share over the share unpaid at the base, so exactly pct × base has emerged by run-off.
- **Pre-game.** None during the pre-game.
- **Nothing else develops.** No other routine development runs, because `FULL_COST_BOOKING` is on.

**Sign.** The result field `priorYearDevelopment` is negative when development is adverse.

### 2.9 Payout patterns and speed; case and IBNR

- **Patterns.** The pool's recorded paid patterns (`PAID_DEVELOPMENT_PATTERN`, `src/data/paidDevelopmentPatterns.ts`), with unpaid share u(t) = 1 − 1/paid LDF.
  - **Speed:** compressed in time by `DEVELOPMENT_SPEED` = **WC 1.5, GL 1.5, Property 1.0**.
  - **Tail:** closed at the last row (`DEVELOPMENT_TAIL.closed`).
  - Lengths: WC 25 years, GL 14, Property 11.
- **Current year.** Paid = ultimate × (1 − u(1)).
- **Later years.** The unpaid balance × (1 − u(t)/u(t−1)).

| Unpaid share at end of year | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| WC | **0.8344** | 0.6223 | 0.4861 | 0.3929 | 0.3324 |
| GL | 0.9271 | 0.6981 | 0.4035 | 0.2217 | 0.1348 |
| Property | 0.5413 | 0.1935 | 0.0826 | 0.0319 | 0.0196 |

- **Case and IBNR** are presentation only (`src/utils/reserveSplit.ts`): IBNR share of unpaid = (1 − 1/incurred LDF) ÷ (1 − 1/paid LDF), clamped to [0, 1]; case is the rest. At 12 months the IBNR share of unpaid is WC 61.7%, GL 68.9%, Property 31.2%.

### 2.10 Shocks

**Catalogue.** `R_MODEL.catalogue` gives each of 12 events an annual probability, a duration and whether it is regional. Probabilities are scaled so they sum to `SHOCKS_PER_YEAR = 0.3` events a year: scale = 0.3/0.432 = **0.6944** (`SHOCK_CATALOGUE_SCALE`).

**The three effects** (`resolveShockYear` and `drawLargeLosses`, `src/utils/shockLosses.ts`):
- **A — uplift.** The line's ordinary losses × (1 + A) in the firing year only (`SHOCK_A_YEARS = 1`), on the whole line (a regional event does not reduce it). A is drawn uniformly in `R_MODEL.aShock[line][level]`.
- **T — one large claim** in the firing year: size = a uniform draw in `SHOCK_T_CLAIM_RANGE[line][level]` × `shockCostFactor`.
  - `shockCostFactor` = (1 + severity trend)^(year − 1) × this year's exposure ÷ the year-1 exposure (`src/utils/shockCost.ts`).
  - Each T claim is its own occurrence. It lands on a unit chosen by size × risk; for a regional event, only units in the struck region are eligible.
- **R — adverse development.** Each year the event is in force: rate × 0.65^age (`R_MODEL.shockDecayRate`) × each prior accident year's start-of-year outstanding. It is added on top of host development and ceded under that year's cover.

| Level | A — WC | A — GL | A — Property | T — WC | T — GL | T — Property | R (all) |
|---|---|---|---|---|---|---|---|
| Low | 5–15% | 5–15% | 10–25% | $1–3M | $1–3M | $2–5M | 2–5% |
| Mid | 15–35% | 15–35% | 25–50% | $3–6M | $3–7M | $5–12M | 5–12% |
| High | 35–75% | 35–70% | 50–100% | $6–40M | $7–40M | $12–40M | 12–25% |

| Event | Probability (raw → scaled) | Years | Regional | WC A/T/R | GL A/T/R | Property A/T/R |
|---|---|---|---|---|---|---|
| Earthquake | 0.002 → 0.0014 | 1 | yes | High/–/– | Mid/–/– | High/High/– |
| Winterstorm | 0.06 → 0.0417 | 1 | yes | – | – | High/Low/– |
| Wildfire | 0.035 → 0.0243 | 1 | yes | – | – | Low/High/– |
| Legislation | 0.015 → 0.0104 | 3 | no | – | Mid/–/High | – |
| WC Reform | 0.02 → 0.0139 | 3 | no | High/–/Mid | – | – |
| Recession | 0.06 → 0.0417 | 2 | no | Low/–/– | Low/–/– | – |
| Nuclear Verdict | 0.025 → 0.0174 | 1 | no | – | –/High/Mid | – |
| Social Inflation | 0.045 → 0.0313 | 3 | no | – | High/Low/Mid | – |
| Pandemic | 0.01 → 0.0069 | 2 | no | High/High/– | –/Mid/– | – |
| Economic Inflation | 0.10 → 0.0694 | 3 | no | see below | see below | see below |
| Investment Loss | 0.04 → 0.0278 | 1 | no | see below | | |
| Member Withdrawal | 0.02 → 0.0139 | 2 | no | see below | see below | see below |

**Regions.** The struck region is drawn by `REGION_EXPOSURE_SHARE` (North 25%, South 30%, Central 25%, East 20%), once when the game is built.

**Shared across worlds.** Every A, T and R draw comes from the game seed, so all 100 worlds share the same events, sizes and landing unit.

**Single-player.** The schedule is drawn once at start (`drawCatalogueSchedule`): each event fires independently at its scaled probability in each year from **year 2** on, so year 1 never has a shock. The game length is part of the stream key, so the same scenario gets a different schedule at a different length.

**Hosted.** The host builds the list by hand (any event, any year), or presses Randomise (`drawShockSchedule`):
- count = round(0.3 × years) ± `SHOCK_SCHEDULE_SPREAD` (1), clamped to between 1 and years − 1;
- distinct years from year 2;
- events weighted by probability, without replacement.

Shocks are on only if the list is non-empty.

**Announced only after the fact.** Players learn of an event when the year is processed ("An event this year", `src/utils/yearEvents.ts`).

### 2.11 Economic Inflation, Investment Loss, Member Withdrawal

- **Economic Inflation** adds `R_MODEL.economicInflationInitialRate` × 0.65^age to every line's uplift for 3 years: **+12%, +7.8%, +5.07%** on ordinary losses. It does not touch T claims or reserves.
- **Investment Loss**, in its year, adds `INVESTMENT_LOSS_BY_ASSET` = **cash 0, bonds −5 pts, equities −20 pts** to the drawn returns, after the market clamp. At 10/80/10 that is −6.0 points on the blend.
- **Member Withdrawal**, in the year after it fires, removes whole units in a seeded order, ignoring risk, until about 25% of the book has gone (`R_MODEL.memberWithdrawalReduction = 0.25`; `moveBookUnits`).

### 2.12 Reinsurance recoveries

- **Options.** `REINSURANCE_OPTIONS`, the same on every line: None, $9M xs $1M, $8M xs $2M, $18M xs $2M, $38M xs $2M, each per occurrence.
- **Default.** **None** on every line (`REINSURANCE_DEFAULT_OPTION`). With shocks off, only None is offered.
- **Recovery** per occurrence = min(max(occurrence total − attachment, 0), limit) (`cedeOccurrences`, `src/utils/reinsuranceTower.ts`). The only occurrences are T claims; ordinary losses, A uplifts and Economic Inflation are never ceded. Above $40M is retained. Later R development on a year with a T claim is ceded under that year's cover.
- **No GL pool limit.** `POOL_LIMIT_PER_OCCURRENCE` is `null` on every line.
- **Dormant.** The aggregate stop is off.

### 2.13 Investment income

- **Formula.** income = start-of-year invested assets × (cash% × r_cash + bonds% × r_bonds + equities% × r_eq) (`blendInvestmentReturn`). The year's premium and loss cash flows earn nothing that year.
- **Market.** One market draw per world per year: Normal(mean, SD) − fee, clamped (`ASSET_CLASS_ASSUMPTIONS`, `defaultAssumptions.ts`, × `INVESTMENT_RETURN_SCALE` = 2/3):

  | Class | Mean | SD | Fee | Net expected |
  |---|---|---|---|---|
  | Cash | 2.793% | 0.40% | 0.040% | 2.753% |
  | Bonds | 3.467% | 4.04% | 0.124% | 3.343% |
  | Equities | 5.507% | 18.25% | 0.124% | 5.383% |

- **Allocation.** The default `ASSET_ALLOCATION_DEFAULT` is 10/80/10 (expected net **3.488%**); the player sets it on the Pool view.
- **Year-end sweep.** Cash above 15% of the member charge (`OPERATING_CASH_PCT_OF_PREMIUM`) is swept into investments; a shortfall is drawn out of them.

### 2.14 The admin overrun

- **Draw.** One draw per year and line, uniform in `ADMIN_OVERRUN_RANGE` = **0–2%** (`adminOverrunFor`, `src/utils/adminOverrun.ts`), from the game seed, so all worlds share it.
- **Booking.** Booked expense = admin charged × (1 + overrun). Pricing never sees it.

### Worked example — 2. Loss model (scenario 1, WC, 2027)

**Book after year-1 movement.** 62 units, **$967.11M**, risk **0.92639**. Four new units ($46.05M) carry the ×1.20 penalty.

**Expected ordinary loss.** 967.11 × 10,000 × 2.493333 × 0.92639 = **$22,338,168**, the same in every world. The result row's `expectedLoss` of $23,050,140 adds two ex-ante catalogue expectations, $552k of uplift and $160k of large loss.

**Actual ordinary loss.** World 0 draws F = 0.9879 and a line factor of 1.0020. Across the 100 worlds the line factor averages 1.0083.
- Averaged gross = net ultimate: **$22,522,685**.
- Shocks this year: none. The scenario's schedule at length 5 is one event, WC Reform, in year 3.

**ALAE and ULAE.** ALAE ratio drawn for 2027 = **14.313%**; ULAE 5%.

**Payout of accident year 2027 in 2027.** Unpaid share 0.834357.
- Paid **$3,730,734**; unpaid **$18,791,952** (case $7,198,859, IBNR $11,593,093).

**Prior accident years in 2027.**
- Reserve inflation: 4% × $54,068,232 = **$2,162,729**.
- Host development emerging: **$324,463**.
- `priorYearDevelopment` = **−$2,487,192** (adverse).
- Net paid on all years: **$15,896,998**.

**Net incurred loss.** $22,522,685 + $2,487,192 = **$25,009,877**.

**LAE.**

| Item | Amount |
|---|---|
| ALAE incurred | $3,539,839 |
| ULAE incurred | $1,250,494 |
| LAE incurred | **$4,790,333** |
| LAE paid | $2,874,112 |
| LAE reserve | $9,578,193 → **$11,494,414** |

**Admin overrun.** Drawn at 0.935%: admin charged $3,870,817 → booked **$3,907,005**.

**Reinsurance.** None: cost $0, recovery $0.

**Investment income.** On $76,900,444 at 10/80/10. World 0's market returns 0.0745% ($57,326). The 100-world mean is 2.60%, giving **$1,999,244**.

---

## 3. Underwriting sliders

The live code is `moveBookUnits` (`src/utils/bookUnderwriting.ts`), called from `processLineYear`. Order within a year: renewal declines, then any Member Withdrawal, then new business (sized on the start-of-year book). Losses are drawn on the book after the movement.

### 3.1 Renewals declined

- **Slider.** `RENEWALS_DECLINED_SLIDER` = **0–10%, step 1%, default 0**. Declines exactly slider × the start-of-year exposure.
- **Grace.** A unit written in year J is exempt at the next renewal and eligible from J + 2 (`NEW_MEMBER_GRACE_YEARS = 1`). Opening-book units are always eligible.
- **Loss history** (`unitLossRatio`): each unit's loss ÷ premium summed over the last `LOSS_HISTORY_YEARS = 3` accident years.
  - A unit's recorded loss = its ordinary loss × (1 + uplift), plus each shock claim capped at `LOSS_HISTORY_CLAIM_CAP = $1,000,000`.
  - Its premium = the line's total charge × its share of the book's exposure.
  - A unit with no premium on record is not ranked.
- **Averaging.** Each world writes its own record. At settlement each unit's record is replaced by the mean across the 100 worlds (`averageLedgerYear`), so every world ranks and declines the same units.
- **Taking units.** Worst ratio first; whole units, then the needed fraction of the last.

### 3.2 New business

- **Slider.** `NEW_BUSINESS_REJECTION_SLIDER` = **0–15%, step 1%, default 0**.
- **Applications.** Market units not held at the start of the year, in a seeded random order, up to exactly `NEW_BUSINESS_APPLICATIONS = 0.05` × the start-of-year exposure. They are random, so they carry market-average risk.
- **Rejection.** Random and exact: written = applied × (1 − rejection).
- **Penalty and savings** (2.5): 1.20 at 0% rejection, falling linearly to 1.00 at `FULL_SAVINGS_AT = 10%`. Rejection above 10% saves nothing more and only shrinks growth.

### 3.3 How exposure moves

after = before − declined − withdrawn + written. There is no exposure trend. On the units path the market cap is implicit: only units not already held can apply.

**The Decisions screen previews** ("Premium not renewed", "Premium from new business accepted") call the same `moveBookUnits` (without a withdrawal) and price the result at the quoted rate (`underwritingFigures`, `src/game/derivations.ts`).

### Worked example — 3. Underwriting (scenario 1, WC, 2027)

- **Opening.** 58 units, $921.06M, risk 0.913.
- **Defaults (0% / 0%).** Declined $0. Applied = written = **$46.05M** (exactly 5% × 921.06), in four units, the last at a 59.7% share. After: **62 units, $967.11M**, risk 0.926; new share 4.76%; penalty 1.20.
- **At 5% declined.** $46.05M of the worst-ranked units go (true risks 1.47–2.03, 3-year loss ratios 1.02–1.44). The book returns to $921.06M at risk 0.886.
- **At 10% rejected.** Written $41.45M; penalty 1.00.

---

## 4. Pricing

### 4.1 The live call path

`strikeRates` (`worlds.ts`) → `strikeBookRate` (`simulationEngine.ts`) → `bookPurePremium` (`src/utils/newPurePremium.ts`) → `quoteNewRateStack` (`src/utils/linePricing.ts`).

- **One rate per team-year.** It is struck on the averaged line state (once a shock has fired, on the shock-free shadow's ledger) and on the book **before** this year's movement. Every world charges it on its own book **after** movement.
- **Display only.** The Decisions panel, the Rate Indication page and the Model tab call the same two functions; `rateIndication.ts` and `modelRate.ts` only display.

### 4.2 The experience window and data lag

- **Latest data year** = priced year − 1 − `PRICING_DATA_LAG_YEARS` (1).
- **Window.** The last `PRICING_WINDOW_YEARS_NEW` = **5** accident years up to it, all valued at the end of the latest data year. For 2027 that is accident years **2021–2025 valued at 12/31/2025**; 2026 is not used.
- **Basis.** Ground-up gross paid on each year's own recorded exposure.
- **Weighting.** Equal weights, hard-coded.
- **No-history fallback.** Expected ordinary loss at the book's risk, × reserve inflation to come. Used only by the first two pre-game years.

### 4.3 Development to ultimate, and inflation priced in

- **Development.** developed = paid × the **paid** age-to-ultimate LDF from the recorded pattern, compressed by `DEVELOPMENT_SPEED` and closed (`recordedPaidLdf`). WC: **6.0371** at 12 months, 2.6478 at 24, 1.9458 at 36, 1.6472 at 48, 1.4979 at 60.
- **Inflation priced in.** Each window year × `reserveInflationToCome` = Π (1 + reserve inflation × unpaid share), over its remaining development years, limited to the newest `RESERVE_INFLATION_PRICED_YEARS` = **WC 2, GL 1, Property 2** window years. WC: 1.0591 on the newest year, 1.0249 on the next, 1 on the rest.

### 4.4 Trend

- **Yearly trend** = (1 + frequency) × (1 + severity) ÷ (1 + exposure growth) = **WC 1.04, GL 1.08, Property 1.05**.
- **Period.** From each accident year to the priced year: for 2027, 2021 takes 1.04^6 and 2025 takes 1.04^2.

### 4.5 Book risk

`bookRisk` (0.9131 for scenario 1 WC) enters only the no-history fallback. When the window has history the experience already carries the book's risk, and book risk does not change the rate.

### 4.6 How shocks are kept out

- `SHOCK_FREE_PRICING`: once a shock is first in force, a shock-free shadow game runs beside the real one and every pure premium is struck from the shadow's ledger.
- `SHOCKS_OUT_OF_EXPERIENCE` removes shock dollars from paid before development.
- `CATASTROPHE_LOAD` is off, so the rate carries no shock allowance.

### 4.7 ALAE and ULAE loads

- **Pure premium** = trended loss cost × (1 + mean drawn ALAE ratio of the window years + `ULAE_OF_LOSS_COST` 5%).
- **ALAE default.** `ALAE_OF_LOSS_COST` (midpoints) is used where a year has no drawn ratio.

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

- **Slider.** `FUNDING_SLIDER_RANGE` = **30–90%, step 5%** (the slider rests at 60%). The **default decision is "Expected"** (`fundingAtExpected = true`), which is **CLF 1.000**.
- **Order** (`selectedClfFor`): the pre-game cushion (1 + margin) if set; else Expected = 1.0; else `staticClf(line, level)`, linear between table stops.
- **Tables.** `STATIC_CLF_TABLE` = `BASELINE_CV_TABLES` at each line's `BASELINE_CV` (WC 6%, GL 10%, Property 8%; `src/data/clfTables.ts`). They are built on ordinary losses only. The CLF multiplies the retained pure premium only, not admin. WC (6% table):

  | Stop | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 95 | 99 |
  |---|---|---|---|---|---|---|---|---|---|
  | WC CLF | 0.9664 | 0.9827 | 0.9982 | 1.0140 | 1.0310 | 1.0513 | 1.0802 | 1.1045 | 1.1517 |

  Expected sits at about the 51.2% stop.

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
admin            = 1.03^(year − 1) × (fixed $ ÷ (exposure × 10,000) + per-exposure rate)
rate per $100    = (pure premium × CLF + admin) ÷ (1 − risk control − P&C) + reinsurance $ ÷ (exposure × 10,000)
member charge    = (pure premium × CLF + admin) ÷ divisor × billed exposure × 10,000 + reinsurance $
```

The "Indicated" rate (`firstIndicationPer100`) is the same at CLF 1 with no reinsurance.

### 4.13 How the Rate Indication page and the Decisions panel show it

- **Rate Indication** (`src/utils/rateIndication.ts`) shows:
  - the projected pure premium;
  - a "2026 rate level" figure, which is that pure premium ÷ one year's trend;
  - the expense shares of the rate at Expected and the permissible loss ratio;
  - rates at Expected and at `RATE_INDICATION_FUNDING_LEVELS` = 70/80/90%, with the change against last year's rate (less its reinsurance);
  - each cover's price per $100.
- **Decisions panel** (`NewRatePanel`; `ratePieces`, `pieceCents` in `derivations.ts`):
  - "Indicated" column: ground-up pure premium + admin + risk control and P&C = `firstIndicationPer100`.
  - "Your rate" column: retained × CLF + admin + risk control + P&C + reinsurance = `finalRatePer100`.
  - Rows are in cents, and P&C absorbs the rounding so the rows add to the rate.
  - "Expected to surplus" = (retained × (CLF − 1) + loaded base × P&C) × rated exposure.

### Worked example — 4. Pricing (scenario 1, WC, 2027)

| Accident year | Age (months) | Paid at 12/31/2025 | LDF | Inflation to come | Exposure $M | Loss cost /$100 | Trend | Trended | ALAE ratio |
|---|---|---|---|---|---|---|---|---|---|
| 2021 | 60 | 11,223,464 | 1.4979 | 1.0000 | 834.23 | 2.0152 | 1.2653 | 2.5499 | 14.17% |
| 2022 | 48 | 10,652,528 | 1.6472 | 1.0000 | 850.91 | 2.0622 | 1.2167 | 2.5089 | 13.75% |
| 2023 | 36 | 8,342,388 | 1.9458 | 1.0000 | 867.93 | 1.8703 | 1.1699 | 2.1880 | 14.41% |
| 2024 | 24 | 6,571,272 | 2.6478 | 1.0249 | 885.29 | 2.0143 | 1.1249 | 2.2658 | 10.14% |
| 2025 | 12 | 2,848,004 | 6.0371 | 1.0591 | 903.00 | 2.0166 | 1.0816 | 2.1811 | 9.22% |

| Piece | Calculation | Per $100 |
|---|---|---|
| Loss cost | mean of the five trended figures | **2.3388** |
| ALAE | 2.3388 × 12.337% | 0.2885 |
| ULAE | 2.3388 × 5% | 0.1169 |
| **Pure premium** (ground-up = retained) | | **2.7442** |
| Admin | 1,078,586 ÷ 9,210,565 + 0.275138 = 0.117103 + 0.275138 | **0.3922** |
| CLF | Expected = 1.000 (at the 60% stop it would be 1.0140, rate 3.2397) | |
| Divisor | 1 − 0 − 0.02 | 0.98 |
| P&C inside the loaded base | | 0.0640 |
| Reinsurance | None | 0.0000 |
| **Rate** | (2.7442 + 0.3922) ÷ 0.98 | **3.2005** |

- **Struck vs charged.** Struck on 921.06 → $29,478,253. **Charged** on the billed 967.11: **$30,952,165**, being pool premium $27,081,348 (2.7442/0.98 × 9,671,093) plus admin $3,870,817.
- **Rate Indication.** Projected pure premium 2.744; 2026-level 2.639; total expense ratio 14.3% (fixed admin 3.7%, per-exposure admin 8.6%, P&C 2.0%); permissible loss ratio 85.7%.

  | | Rate | Change vs 2026's 3.139 |
  |---|---|---|
  | Expected | 3.200 | +1.9% |
  | 70% | 3.287 | +4.7% |
  | 80% | 3.344 | +6.5% |
  | 90% | 3.425 | +9.1% |

  Cover prices per $100: 0.042 / 0.031 / 0.042 / 0.064.
- **Decisions panel.** Pure premium $2.74 + admin $0.39 + risk control $0.00 + P&C $0.07 + reinsurance $0.00 = **$3.20**, +1.9% vs last year. Expected to surplus +$0.59M.
- **Tie-out.** The panel, the Rate Indication page, the Model tab, the struck quote and the charged row all give 3.200482690526921.

---

## 5. Dividends and assessments

### 5.1 The slider and what it does

- **Control.** One slider, "Dividend / Assessment", **−15% to +15%, step 1%, default 0** (`SLIDER_RANGES.dividendAssessment`, `defaultAssumptions.ts`). Positive sets `dividendPct`, negative sets `assessmentPct`; only one applies in a year.
- **Basis** = max(0, the line's opening surplus) (`dividendAssessmentBasis`, `src/utils/dividendAssessment.ts`). Amount = basis × percentage.
- **Dividends** reduce underwriting income, cash and ending surplus dollar for dollar. **Assessments** add to them.
- **Neither enters the member charge (premium)**, the loss ratio, the expense ratios or pricing. Statements show them on a separate line.
- **No effect on members.** The member-satisfaction effects are member-path only and do nothing live.
- **Timing.** The decision applies to that year's opening surplus and is paid in that year.

### 5.2 Limits

- **Range.** The slider limits the value to ±15%; the engine does not clamp.
- **Dividend block.** If the line's prior ending surplus was negative, the slider's maximum is 0 and the engine pays no dividend. An assessment is still allowed, but a negative opening surplus gives a basis of 0, so it collects nothing.

### 5.3 Loans between lines

- **When.** After a year, any line ending with negative surplus and no existing loan gets an offer, if the other lines' combined capacity (each line's max(0, min(surplus, investments))) covers the whole deficit. Lenders contribute in proportion to capacity.
- **If authorised.** Lenders' surplus and investments fall by their shares, and the borrower's surplus is set to exactly 0.
- **Interest** = the pool's blended investment return that year, floored at 0. It is reset every year.
- **Repayment each later year** = min(`loanRepaymentAggressiveness` × max(0, net income), balance, liquid assets), returned to the lenders in their original shares. The slider runs 0–100%, step 5%, default 50%, and appears only while there is a balance.
- **Single-player** shows a prompt (defaulting to authorise) if **any one** of the 100 worlds needs a loan. The offer averages the deficit over only the worlds that need it, and the choice is applied in each of those worlds.
- **Hosted** sessions decline every offer automatically.

### Worked example — 5. Dividends and assessments (scenario 1, WC, 2027)

- **Basis.** WC's opening surplus, **$17,591,242**; not blocked.
- **At the default 0%.** Nothing is paid or collected.
- **At +5%.** The dividend is **$879,562**, net income falls from −$0.756M to −$1.635M, and the loss ratio is unchanged at 0.808.
- **At −5%.** The same $879,562 is collected.
- **Loans.** WC needs no loan. GL ends 2027 negative in 2 of the 100 worlds, so single-player shows a GL loan prompt: an average deficit of $1.98M, lenders WC 37% and Property 63%, at a 0% rate. Authorising it (the default button) moves an average **$14,930** of WC surplus to GL.

---

## 6. Capital

### 6.1 Required capital

required = max(0, net unpaid reserve × (CLF at `RESERVE_MARGIN_CONFIDENCE_PARAM` − 1) + catastrophe term) (`simulationEngine.ts`):
- **Confidence.** `RESERVE_MARGIN_CONFIDENCE_PARAM` = **0.80**, read on the same `STATIC_CLF_TABLE`: **WC 1.0513, GL 1.0829, Property 1.0672**.
- **Catastrophe term.** `newEngineCatCapital` (`shockExpectation.ts`): 0 on WC and GL. On Property with shocks on, it is the probability-weighted retained amount of one regional catastrophe after the cover placed.

### 6.2 Capital status

- **Ratio.** Excess capital ratio = (ending surplus − required) ÷ required.
- **Bands** (`CAPITAL_ADEQUACY_THRESHOLDS`, `defaultAssumptions.ts`): **Strong ≥ 0.25; Adequate ≥ 0; Thin ≥ −0.10; Deficient below**.
- **Pool level.** Sum of the lines' excess ÷ sum of the lines' required.
- **Worlds.** Recomputed from the averaged dollars.
- **Where shown.** Dashboard, Financials, the Decisions funding panel, results and exports.
- **No gate.** Required capital gates no decision.

### Worked example — 6. Capital (scenario 1, WC)

| | Opening (end 2026) | After 2027, defaults |
|---|---|---|
| Net unpaid reserve | $54,068,232 | $63,181,111 |
| Required = reserve × 0.0513 | **$2,773,700** | **$3,241,191** |
| Ending surplus | $17,591,242 | $16,820,506 |
| Excess capital ratio | **5.34** | **4.19** |
| Status | Strong | Strong |

---

## The year carried through: scenario 1, WC, 2027

| Line of the statement | Amount | Section |
|---|---|---|
| Member charge (premium): 3.2005/$100 × 967.11 × 10,000 | **$30,952,165** | 4 |
| − Net incurred loss: current year $22,522,685 + prior development $2,487,192 | −$25,009,877 | 2.4, 2.7, 2.8 |
| − LAE incurred | −$4,790,333 | 2.6 |
| − Operating (admin) expense, with the 0.935% overrun | −$3,907,005 | 4.8, 2.14 |
| **= Underwriting income** | **−$2,755,050** | |
| + Investment income | +$1,999,244 | 2.13 |
| **= Net income** | **−$755,806** | |
| Opening surplus | $17,591,242 | 1 |
| Surplus after income | $16,835,436 | |
| − Loan to GL (authorised in the worlds that need it, averaged) | −$14,930 | 5.3 |
| **Ending surplus** | **$16,820,506** | 6 |

| Ratio | Calculation | Value |
|---|---|---|
| Loss ratio | 25,009,877 ÷ 30,952,165 | 80.8% |
| LAE ratio | | 15.5% |
| Expense ratio | | 12.6% |
| Combined ratio | | **108.9%** |
| Capital status | | **Strong, 4.19** |

Every figure above is the 100-world average the game shows. They come from the engine's own functions on the instance described at the top.

---

## Flags

**Inconsistent or surprising — behaviour**

1. **Openings land far from their scenario targets.** With `PRE_GAME_MARGIN_ON_DESIGN` on, the opening is wherever the drawn pre-game ends.
   - Scenario 1 WC: target P/S 1.97, actual 1.68.
   - Rank correlation of target with actual across the 20 scenarios: WC 0.77, GL 0.05, Property 0.20. On GL the thin-to-rich order is essentially lost.
   - Scenario 3 WC trips the 3.5 guardrail, and its margin jumps to 6.6%.
2. **The rate is struck on one book and charged on another.** It is struck on the book before the year's movement (921.06) and billed on the book after (967.11, +5% by default).
   - Fixed admin is over-collected by about 5%.
   - The Model tab's "premium" ($29.48M) is not what is charged ($30.95M).
   - "Expected to surplus" uses the rated exposure.
3. **Part of P&C is booked as expense.** The 2% P&C loading on the admin part (about $74k on WC) is billed inside admin ÷ divisor and booked as admin expense. "Expected to surplus" counts it as surplus.
4. **The new-business penalty is never priced.** Default play grows the book 5% a year with the full ×1.20 penalty on new units.
5. **The capital standard is light, and the screen mislabels it.** Required capital uses the 80% stop on ordinary-loss-only tables, about 5% of reserves on WC, so "Strong" is nearly automatic (5.34 at the opening). The Decisions screen hard-codes "90% confidence" (`DecisionsPage.tsx:750`) next to the 80% factor.
6. **Ordinary losses run up to $5M on WC and GL.** `ORDINARY_LOSS_LIMIT` ($1M) is not applied; the $1M–5M layer is in the ordinary cost and can never be ceded. The per-occurrence covers can recover only on shock T claims.
7. **No GL pool limit.** `POOL_LIMIT_PER_OCCURRENCE` is `null` on every line, though comments and the tower file still describe $25M.
8. **Shock behaviour:**
   - A regional event's A applies to the whole line.
   - Recession and Pandemic have no effect in their second year (`SHOCK_A_YEARS = 1`).
   - A regional T claim is silently dropped if the book holds no unit in the struck region.
   - Investment Loss is added after the market clamp, so equities can reach −80%.
9. **Single-player and hosted shock draws differ.**
   - Single-player's catalogue draw allows repeats and several events a year, and its schedule changes with game length.
   - Host Randomise allows at most one event a year, without repeats.
   - Hosted lists are not validated: any year including 1, duplicates, and an unknown id that makes the engine throw.
10. **Loans differ between single-player and hosted.** Single-player prompts if any 1 of 100 worlds needs a loan (scenario 1, 2027: GL, 2 worlds). Hosted declines every offer. A borrower lands at exactly $0 and is not dividend-blocked the next year.
11. **Screen and engine can disagree with 100 worlds.** The dividend block shown on screen uses the averaged prior surplus, while the engine blocks per world. The basis floor is also applied per world.
12. **Renewal selection is close to perfect.** The averaged 3-year history ranks units almost by true risk. A partly held unit can never be topped up.
13. **The pool-level starting surplus omits the LAE reserve.** `StartingFinancials.surplus` shows $27.17M for scenario 1 against a true $17.59M. Only a Dashboard fallback reads it.
14. **WC's first pre-game year earns no investment income.** A legacy cash target ($6.9M) exceeds the $3M capital, so nothing is invested in 2021.
15. **The Rate Indication's year-1 change includes the prior board's cushion falling away.** Its "+1.9%" is partly the 0.73% margin coming off, not experience.
16. **Two development notes:**
    - GL's LDFs describe a limited layer, but the engine's GL losses are not limited (`GL_LAYER_MISMATCH = true`).
    - `FREQUENCY_TREND_PER_YEAR` is read by pricing but not by the loss draw, so setting it would trend the rate and not the losses.

**Settings that are read by nothing, or overridden**

17. These have no effect on the game:
    - `OPENING_BOOK_EXPOSURE`
    - `SUPPLIED_PURE_PREMIUM_INCLUDES_ULAE` (the ÷1.05 is hard-wired)
    - `PRICING_WINDOW_WEIGHTING_NEW`
    - `RATE_CHANGE_CAP_NEW`, `RESERVE_BASIS_NEW`, `PRIOR_HISTORY_YEARS_NEW`
    - `PRE_GAME_INVESTMENT_RETURN`
    - `SHOCK_T_BASIS_PER_100` (its reader is uncalled)
    - `REINSURANCE_LOAD` (overridden by the fixed prices)
    - `PRICING_WINDOW_YEARS = 10` (old triangle display only)
    - `ADMIN_LOAD_OF_EXPECTED_LOSS` (old stack only, though `computeFundingConsequence` still computes it on every render)
    - `R_MODEL.tShock`, `.reinsurance`, `.investmentLossAdjustment` and the investment fields
    - `OPENING_SURPLUS_BAND`
    - `noiseZ`; `renewalUnderwriting.ts` (called with an empty roster)
    - `requiredCapital` and `openingCatCapital` in `openingReserves.ts`
    - `DIVIDEND_ASSESSMENT_RANGE` (parameters page only; the slider reads `SLIDER_RANGES`)

**Comments that contradict the code** (a selection; the code is described above)

18. Comments contradicted by the code:
    - "Ten worlds" (it is 100).
    - "Trended at 5%" (4/8/5%).
    - "5% P&C on every line" (2/0/0).
    - "ALAE 5%" (drawn 7–15/10–20/2–5%).
    - `PRIOR_DEVELOPMENT_DEFAULTS` "stored, not read" (it is the live single-player value).
    - `PRIOR_HISTORY_YEARS` "five" (6).
    - The `STARTING_CAPITAL` narrative ($5M/$12.5M/$17.5M; the code is 3/12/12.5).
    - `ROUTINE_LARGE_LOSSES` "a switch, now on" (off).
    - The `newPurePremium.ts` header "shadow mode, read by nothing that prices" (it is the live pure premium).
    - Shock severities "per world" (shared).
    - The reinsurance tower header ($4M/$5M packages, $25M GL limit).
    - The default cover "the middle option" (None).
    - The reserve margin "CLF90" (the 80% stop).
    - Opening share-paid figures 59/90/50% (83.4/92.7/54.1%).
