# How the game works

The game as the code runs it today (the `aws` branch). Where comments or older notes disagree, this follows the
code; section 7 lists the disagreements. Any change to how the game works must update this file in the same
pull request.

## 1. Modes

**Single player** (`/solo`). One person runs a risk pool alone. Setup: pool name, length (3–10 years, default 5),
first program year (default 2027), scenario (1–20 or random), and the lines (Workers' Compensation, General
Liability, Property). Events ("shocks") are drawn automatically; there is no adverse reserve development.
Locking a year plays it at once. Decisions carry into the next year; the game saves in the browser. There is no
market competition (section 5): New Members and Non-Renewal work as the formula in section 5 says.

**Test player** (also on `/solo`). Single player on the host's setup form: the person sets the shock schedule and
an adverse-development level per line, and the Year Walkthrough shows the scenario's seed. No sign-in. During the
game an "Edit game" button opens the host's mid-game panel (section 2), with the same rules; the history reads
"Test player". Single player has no such panel. Test player has no market competition either.

Both show: Introduction · Rate Indication · Annual Statement · Decisions · Decision History · Year Walkthrough.

**The Annual Statement** (every mode) lays out the template's sections — Net Income Statement, Balance Sheet,
Underwriting, Contributions, Program Year Totals, Reinsurance — over Prior and five years, then a **Decisions**
section over the same years: funding level, Non-Renewal, New Members, per-claim cover, aggregate cover, risk control
and dividend / (assessment) per line, and on the Pool view the asset mix and each line's. Every value is the year's
recorded decision; the history years before play show the prior board's. A sticky index links each section and
marks the one in view. The Excel and PDF downloads carry the Decisions section too.

**Hosted.** A host runs an event for teams on their own devices; viewers watch a team.

- **Host** (`/host`, admin sign-in). Tabs: Game Setup · Teams · Charts · Decisions. Creates the room, follows the
  teams, hands teams to new devices, advances the year.
- **Teams** (`/join/<code>`). Tabs: Introduction · Rate Indication · Annual Statement · Decisions · Decision
  History · Market Survey. No Year Walkthrough; the Rate Indication hides "How the [year] rate was built".
- **Viewers** (`/view/<code>`, or a 6-digit PIN from the lobby). One team's six tabs, read-only.

**The team's status strip** (above the tabs) shows only the team's viewer PIN, and an error message when something
fails (a lock that did not go through, a refresh or a year that failed). Nothing else: no team name or number, lines,
room code, year, lock state, "Saved", who is still deciding or which year is posted. The lock button still reads
"Waiting for host" once the team has locked. A viewer's strip keeps all of these (the team's number and name, lines,
room code, year, locked or still deciding, who is still deciding and the computed year), as that is how a viewer
follows the team.

The lobby (`/`) lists open and running events with Join or Watch. Only a signed-in admin sees "Play Solo" and
"Host an Event", but `/solo` itself is open to anyone.

## 2. A hosted game start to finish

**Sign-in.** `/host` asks for an admin username and password; sessions last 30 days. On `/admin` any admin can
add, reset, disable or delete other admins.

**Setup** (Game Setup tab):

| Setting | Default | Notes |
|---|---|---|
| Event name | — | required |
| Pool name | the event name | |
| Scenario (seed) | random 1–20 | the server accepts only 1–20 |
| Years | 5 | 1–20 on the form |
| First program year | 2027 | |
| Number of teams | 3 | a label; it limits nothing |
| Coverage lines | all three | every team writes the room's lines |
| Adverse development, per line | Low | None, Low (1–5%), Mid (5–15%), High (15–20%) |
| Shock schedule | empty | add events by year, or Randomise (2–4 events, never year 1) |
| Market competition | Medium | Off, Low, Medium, High (section 5). A room created before the setting reads Off |

The host gets a resume code for reopening the room elsewhere, and can hide the event from the lobby.

**Joining.** A team opens the join link, types a name and joins. Teams are numbered in join order ("Team 1 |
Harbour Mutual"). Each new team is shown, once, a 6-digit viewer PIN and a 4-digit recovery code. Teams can join
until the host's first advance; after that only rejoins and viewers.

- **Recovery code** + team name moves the team to another device and signs the old one out. Five wrong tries in
  15 minutes lock it for a while.
- **Device hand-off:** the host's Teams tab shows a QR code and link ("Move to new device") that works once, for
  10 minutes, and issues a new recovery code.

**Each year.**

1. Each team sets its decisions and presses **Lock Program Year YYYY**, then confirms. The server stores the
   decisions and marks the team locked. With market competition on, the lock also carries the team's whole rate
   per line (as its game will charge it), its book, and its two market decisions.
2. **Locking is real.** The server refuses a different decision set from a team that has locked the year
   (`ALREADY_LOCKED`); sending the same set again (a retry) is accepted. The host's Game Setup tab shows who has
   locked, who has not ("Waiting on …") and who has reported, and has an **Unlock** button beside each locked
   team: the team's form reopens on what it sent, and it may lock again with different decisions.
3. **Only the host's "Advance to year N" button moves the room on.** It does not wait for locks: the host can
   advance with teams unlocked, or with none. There is no timer, deadline or automatic advance. A team that was
   unlocked and did not lock again has that year's set dropped at the advance, so it plays its previous locked
   decisions. With market competition on, the advance also runs the year's **market step** once, on the server,
   and stores each team's result with the room (section 5).
4. After the advance each team's browser notices within seconds, plays the year, and posts a results summary.
   The opening position (year 0) is posted when a team first loads.

**Mid-game edits.** The host's Game Setup tab has an "Edit game" panel listing the current year and every
later year: each year's shock events (add or remove) and each line's adverse development level (None / Low / Mid /
High; a level set in a year applies from that year onward). Played years are not listed and cannot be changed.
If any team has already locked the current year, the host is told which and can apply anyway; their decisions
stand and the year plays on the new settings. Every team gets the same change. Teams are not told: a development
change shows only in their results, and a shock through the news banner in its year, as any shock does. The room
records each change (who, what, which year, when), shown to the host only.

**A team that never locks** is still played, on its most recent locked decisions (or the defaults if it never
locked). The market counts it at its last locked rate and decisions, on its book carried forward, and the host's
Teams tab flags it ("counted at its YYYY lock"); a team that never locked stays out of the market ("not in the
market"). It posts only while its browser is open; until then its row reads "[year] not reported yet". Loans are
always declined in hosted games.

**The end.** The advance past the last year completes the room ("Session complete"); the event leaves the lobby.
Rooms are kept 7 days.

## 3. Where the game is worked out

**In the browser.** The simulation runs only in each team's and viewer's browser. The server never runs it: it
stores settings, decisions and posted summaries, moves the year, and works out market shares. The one game step
it does run is the market step (section 5), from the rates the teams locked with, once per year at the advance.

**Rebuilt, not saved.** On every load, on any device, a hosted team's browser rebuilds the game from the room's
scenario, lines, shocks and development levels, then replays each played year on that year's stored decisions
(`buildTeamGame`, `replayTeamYears`), so a new device lands in the same place. Each year replays on the settings
in force in it — the shock schedule is kept by year, and a mid-game edit stores levels by year
(`developmentLevelsByYear`) — so an edit never changes a played year. A room never edited reads its setup
settings for every year. Each year also replays on the team's own stored market result for that year
(`setup.marketByYear`), so a rejoin on another device, and a replay after a mid-game edit, land where the team
played. Single player saves decisions and averaged results in the browser and replays them on reload.

**100 worlds.** Each year runs in 100 worlds sharing decisions, the rate and the events, differing in loss luck
and investment returns. Screens show averages and a surplus range.

**Stored per room:** settings and shock schedule (with any mid-game levels by year and the edit history), the current year, the roster (name, number, lines, locked and
posted years, hashed credentials, viewer PIN), market shares by year, and with the market on each year's market
step (every team's input, who was missing or stale, every team's result, and the members dropped that year, which the next year's outside supply refills).
**Per team, per year:** the locked decisions (and, with the market on, the rate, book and market decisions sent
with them), the team's own market result, and a posted summary (surplus, combined ratio, premium to surplus, rate and change, admin ratio, loss
figures, the decisions played). Full results, claims and the worlds are never stored — they are replayed.

## 4. What teams and the host see of each other

**Market Survey (teams, viewers) and the Teams tab (host)** are one table, for the latest known year, on the pool
or a line: team, Ripple Score, premium to surplus, rate and change, admin expense, combined ratio, net surplus,
market share. A team's own row is highlighted.

**Ripple Score** is a placeholder until the real score is designed: rank by the pool's net surplus ("1st",
"2nd"…), ties sharing a rank, the same on every line view (`utils/rippleScore.ts`).

**Market share** is a team's exposure over the room's on a line, and its premium over the room's for the pool,
fixed once every team that locked has posted the year. It is display only and never enters a simulation.

**The top bar** (Surplus, Combined ratio and, in a hosted game, Market Share) reads the **pool** on every tab — the
pool's market share is the team's premium share of the room, as on the Market Survey. Only on the Decisions page,
with a line selected, does it show that line's figures. A "Showing" chip says which: Pool, WC, GL or Property.

**The host also sees** each team's decisions for completed years, and charts of surplus, exposure and losses.
With market competition on, the Teams tab adds two host-only columns — **Exposure moved** (members in less out,
of the book at the start of the year) and **Book risk** — and the Charts tab a **Book risk** line. A team's
Market Survey shows neither.

**A team is not shown its market results** (market on): who wanted to leave, who left and how its appetite filled
appear nowhere on a team's screens. The server stores them, the team's game plays them (its book and book risk), and
only the host sees them, in the Teams columns and the Charts line. A team sees their effect in its own figures and
in the Market Survey's shares.

**Nor any market explanation.** With the market on, no note on the Decisions page or the Market Survey explains it,
and the sliders read the same as in every other room: "Non-Renewal" and "New Members".

**Private:** decisions are not shown to other teams, and full statements stay the team's own. The seed is shown
only to the host and in Test player. But a viewer sees the watched team's decisions (section 7).

## 5. Underwriting today

**The book** of each line is one exposure figure (WC about $916M, GL $615M, Property $9.6B at the opening) — no
member list. The six pre-game years (2021–2026) grow it 2% a year to that opening; teams on one scenario open
identically. In play it moves only through the two sliders, a Member Withdrawal event, and a cap at the market's
size.

**Member risk.** Inside the loss draw the book is split into 100 notional members with random risk scores (30%
spread), redrawn yearly. They only shape the year's randomness; nothing selects on them.

**The sliders** (per line, 0–10% in 1% steps, default 0%): *Non-Renewal* and *New Members*, in every room and in
Single player. Under each, its premium in dollars: "Premium not renewed: $X" and "Expected premium from new
members: $X".

**The formula** (`bookUnderwriting.ts`), with book E, non-renewal a1, new business a2:

- exposure this year = E × (1 − a1) + E × a2;
- the renewing book's loss per unit × (1 − 0.5 × a1); new business costs 20% more in its first year;
- so expected ordinary loss = cost per unit × E × [(1 − a1)(1 − 0.5 a1) + 1.2 a2]. Pricing learns it through
  experience.

**One team does not affect another — unless market competition is on.** With it Off (and in Single player and
Test player) each book is independent; market share is display only; shared events hit every team alike.

### Market competition (hosted rooms, Low / Medium / High)

Members move between the room's teams on price, by formula — there are no individual members. Every value is in
`pricingParameters.ts` ("MARKET COMPETITION"), with its reason and the measurements behind it; the step is
`utils/market/marketStep.ts`, run by the server at the advance (`session/market.ts`).

**Decisions change meaning** (per line, market on):

- **New Members = appetite** (0–10%, default 0%): the most the team takes in this year, as a share of its book.
  Members come only from dearer teams' leavers and outside supply — never from other teams' dropped members.
  Newcomers bring their actual risk; there is no flat 20% new-business load.
- **Non-Renewal** (0–10%, default 0%): the team keeps today's relief (its remaining book's losses × (1 − ½ × the
  share)); the dropped members leave the market, and no team takes them. (An "Accept non-renewed members" switch,
  default No, was removed; the behaviour is fixed at No.)

**The market step**, per line, once a year, from the rates teams locked with:

1. **Fade.** Each team's book risk moves 50% back towards 1.00.
2. **Pair gap** = the dearer team's whole rate (risk control and reinsurance included) ÷ the cheaper team's − 1.
3. **Willing leavers** = k × (pair gap − 1%)² per cheaper rival, averaged over the N − 1 rivals and × 4, drawn
   ±20%, capped at 15% of the book. k per line: Low WC 3.080 / GL 0.682 / Property 1.121; Medium 6.159 / 1.364 /
   2.242; High 12.318 / 2.728 / 4.484 (calibrated on the funding tables now on `aws`; to be recalibrated if the
   stretched tables of #72 land).
4. **Leaver quality** from five risk buckets (0.60 / 0.80 / 1.00 / 1.25 / 1.60, each ÷ 1.02), tilting towards the
   best as the gap grows; at a 10%+ gap the average leaver is 0.90 (Low), 0.80 (Medium), 0.70 (High). Dropped
   members average about 1.5×.
5. **Matching**, never past a team's appetite: (a) good leavers go to cheaper teams, weighted by how much cheaper,
   the cheapest picking the best first; (b) outside supply — 2% of the room's book plus last year's dropped
   members, about average risk — is shared by a **wide taper**: every team is eligible, with weight 1 at or below
   the room's average rate, falling in a straight line to 0 at 20% above it. Each team gets the supply by weight,
   capped at its appetite, and what a full team cannot take passes to the others by weight. Every team's outside
   newcomers carry the **same mix** (the average risk of the year's draw); the cheapest no longer pick the best.
   This replaced a cutoff (only teams at or below the average, cheapest first, up to the whole appetite), under
   which a team just over the average got almost nothing while one just under filled its appetite. No team
   takes another's dropped members: they leave the market and are refilled by the next year's outside supply.
   Unmatched leavers stay (and start fresh next year).
6. **Results.** Exposure moves with the members; the new book risk is the exposure-weighted risk of who stayed and
   who came. Book risk multiplies the team's ordinary losses for the year.

Every draw is seeded by the room, team, line and year, so the step is the same wherever it runs. A team's rate is
struck on its book before the moves, so the rate it locked with is the rate it is charged.

## 6. Pricing and results in brief

**The rate**, per line (`quoteNewRateStack`):

> rate = pure premium × funding factor ÷ (1 − admin 20% − risk control %) + reinsurance

- **Pure premium:** the last five complete accident years, a year behind (2027 uses 2021–2025), developed to
  ultimate, shock dollars removed, trended (WC 4%, GL 8%, Property 5% a year), plus ALAE (11% / 15% / 3.5%) and
  ULAE (5%). Before history exists, the expected loss cost.
- **Funding factor:** 1.00 at "Expected" (the default), otherwise from a table by funding level (30–90%).
- **Reinsurance** is added at its price, outside the divisor.
- **Pricing never sees shocks:** a shock-free twin of the game supplies the experience.

**Decisions, per line:** funding; non-renewal and new members; dividend or assessment (−$15M to +$15M); risk
control (0–5% of the rate before reinsurance); a per-claim cover (None or one of eight layers, e.g. $9M xs $1M);
an aggregate cover (none, 110/50, 125/50, 150/50); loan repayment while a loan is open. Pool-wide: the asset mix
(default 10% cash, 80% bonds, 10% equities). Funding defaults to Expected; the rest to none or zero.

**Where the rest comes in:**

- **Shocks:** single player draws from a 12-event catalogue (about 0.3 a year, from year 2); hosted rooms use
  the host's schedule. An event can surge a line's normal losses, add one large claim, strengthen old reserves,
  cut investment returns, or take 25% of the book.
  ⚠ Whether a game prices for shocks is fixed when it starts: one set up with no events and given one mid-game
  has it fire in its year, but its rates and the covers offered stay as the game began (the switch, `shocksOn`,
  is pinned at the first edit so replays agree).
- **Large claims** come only from those events.
- **Adverse development** (hosted and Test player): each open prior year's outstanding grows by a drawn rate.
- **Per-claim covers** pay on large claims; **the aggregate cover** pays on the year's attritional losses (normal
  plus surges) above its attachment. Both are offered in every game.
- **Risk control** is charged in the rate and booked as an expense; it cuts that year's normal losses by,
  on average, its cost. It never touches surges, large claims or older years.
- **Investments** earn by asset mix; a line ending negative may borrow from the others (single player only).

## 7. Anything surprising

- **Viewers see live decisions.** A viewer needs only the room code and team name, and gets that team's full
  decision history — including a locked year not yet played. That is more than the host sees, though comments
  say decisions stay private until played.
- **Every team's market share is shown to every team**, though the contract's comments say a team never sees
  another's.
- **Posted results are trusted** (never checked by the server); they feed others' displayed shares and ranks.
- **The admin gate is on screen only:** `/solo` is open; the server never checks an admin to create a room.
- **"Number of teams" limits nothing;** the last advance button reads one year past the game ("Advance to year 6"
  in a five-year game).
- **Comments and one on-screen line say teams pick their lines;** the host sets them.
- **Member risk scores exist** in the loss draw, though several comments say there are none.
- **The memo calls the sliders "for this year only";** decisions now carry forward until changed.
- **Stale comments** call the rate stack off (it prices every rate), say "ten worlds" (100), single-player
  shocks off (on), routine large losses on (off), risk control unread (live), and the default cover "the middle
  option" (None).
- **Cover prices assume large claims some lines can't get.** WC's only large-claim event is Pandemic (under 1% a
  year), and a hosted room with no scheduled event has none, so its covers never pay.
- **The aggregate cover is titled "Aggregate Stop-Loss Coverage",** not the dormant aggregate stop the parameters
  also describe; and the Decisions page says "Choose one cover" with it sitting beside the per-claim cover.
- **The lobby's "Delete" only hides an event;** its game and links keep working.
- **The recovery code is 4 digits,** cut from a specified 12 characters; the rate limit is the defence.
