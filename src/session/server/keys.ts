// ============================================================================
// THE DYNAMODB KEY DESIGN FOR THE SESSION LAYER — AND THE ONLY PLACE A KEY IS
// BUILT.
//
// ⚠ THIS FILE IS AUTHORITATIVE. docs/SESSION_DYNAMODB.md is a summary of it for
// whoever provisions the table; where the two disagree, this file is right and
// the note is stale. The design lives here rather than in httpTransport.ts
// (whose list is what the CLIENT cannot fix) or the stub server (whose header
// says nothing in it survives) because anyone writing the Lambda has to import
// this module to build any key — so this header is where they will be standing.
//
// ⚠ THE HANDLER EXISTS NOW AND BUILDS EVERY KEY HERE: rooms.ts (the transport),
// views.ts, dynamo.ts and handler.ts in this directory. This said "nothing
// imports it yet"; that stopped being true with them. Building them against this
// file found five places it was incomplete or wrong — each corrected below, in
// place, marked ⚠ CORRECTED. Every value below that is a size or a count says
// whether it was MEASURED, DERIVED or ESTIMATED, because on this project those
// have been confused before and it cost a re-solve each time.
//
// ============================================================================
// THE THREE THINGS THE TABLE CANNOT BE CREATED WITHOUT — none can be changed
// after the table exists.
//
//   table name          ripple-sessions
//                       The handler reads it from the TABLE_NAME environment
//                       variable (the AWS owner's guide sets it) and never
//                       hard-codes it, so a staging table can differ.
//   partition key       attribute  pk   type String (S)
//   sort key            attribute  sk   type String (S)
//   TTL attribute       expiresAtSec    type Number (N), EPOCH SECONDS
//
// ⚠ THE ATTRIBUTE IS NOT THE VALUE. The attribute is CALLED `pk`; its VALUE is
// ROOM#<code>. The attribute is called `sk`; its values are ROOM, NAME#..., D#...,
// R#..., VIEW#.... Nobody types ROOM#<code> into the console. The names are
// generic on purpose: one attribute carries several kinds of value, so a
// meaningful name (`roomCode`, `year`) would be wrong for at least one of them.
//
// ⚠ expiresAtSec IS SECONDS, AND THE NAME SAYS SO BECAUSE ITS NEIGHBOURS ARE
// MILLISECONDS. createdAt and updatedAt are Date.now(), as localTransport stamps
// them. A TTL stamped in milliseconds reads to DynamoDB as a date tens of
// thousands of years away, and nothing is EVER deleted — silently. Compute it as
// Math.floor(ms / 1000) + retention. A DURATION stored where a timestamp belongs
// fails the other way: an absolute time in 1970, expired at once.
//
// ============================================================================
// WHAT SETS THE EXPIRY — ONE WRITE SETS IT, EVERY OTHER WRITE COPIES IT.
//
//   createRoom   sets the header's expiresAtSec ONCE:
//                  Math.floor(createdAt / 1000) + retention seconds.
//                The retention length is not decided here. Unlike the three
//                names above it can change later — for new rooms.
//   every other write copies the HEADER'S value VERBATIM onto the item it writes:
//                  join     -> NAME#     viewer join -> VIEW#
//                  submit   -> D#, R#
//                Each of those already reads the header first, to resolve the
//                token or confirm the room and team exist, so the value is in
//                hand. No write computes an expiry from "now", and no write
//                extends it.
//
// ⚠ A LATE ITEM GETS THE ROOM'S EXPIRY, NOT ITS OWN. A year-10 result posted two
// hours after createRoom carries the same absolute expiresAtSec as the header
// written at the start. If writes stamped "now + retention" instead, the room
// would expire in pieces: the header first, its last results hours later —
// orphans a reader could still find.
//
// ⚠ AND IDENTICAL STAMPS STILL DO NOT DELETE A ROOM AT ONCE. TTL deletion is a
// background process that runs well after the expiry, item by item. So:
//   * a header past its expiresAtSec is ROOM_NOT_FOUND, whether or not TTL has
//     removed it yet — reads and writes check the stamp, not the item's presence;
//   * an absent header is ROOM_NOT_FOUND even if D#/R# items of that room
//     linger;
//   * createRoom's attribute_not_exists guards only the header, so a new room
//     drawing the code of a recently expired one could inherit its leftover
//     items. Rare at 32^6 codes; the guard for it is to refuse a code whose
//     partition has ANY item (Query, Limit 1), not just a header.
//
// ============================================================================
// ONE TABLE. ONE PARTITION PER ROOM — PLUS ONE INDEX ITEM THAT CANNOT BE IN ONE.
//
//   pk = ROOM#<code>            every item of a room shares it
//
//   sk                          holds (every item also carries expiresAtSec)
//   ------------------------    ------------------------------------------------
//   ROOM                        THE HEADER. seed, eventName, yearCount,
//                               startingYear, expectedTeams, LINES,
//                               PRIOR DEVELOPMENT, shocks,
//                               currentYear, rev, createdAt, updatedAt,
//                               expiresAtSec (the room's, set once),
//                               hostTokenHash, and the ROSTER:
//                                 { [teamId]: { name, lines, joined, lockedYear,
//                                               tokenHash, posted: { [year]: true } } }
//
// ⚠ WHAT THE LINES AND PRIOR DEVELOPMENT COST THE HEADER ITEM: NOTHING THAT
// MATTERS. `lines` is at most three short strings and `priorDevelopment` at most
// three numbers — on the order of 100 bytes against DynamoDB's 400 KB item
// limit, and against a roster that already carries a name, a token hash and a
// posted-year map per team. The header's size is driven by the roster and the
// shock list, and neither moved. There is no new item, no new key and no change
// to the access pattern: both fields are read and written with the header that
// was already being read and written.
//
// ⚠ AND THE ROSTER'S PER-TEAM `lines` IS NOW A COPY OF THE ROOM'S. It is kept
// because the host's table and a viewer read the team row rather than the room,
// but it is written FROM THE HEADER at join and never from a request. If it ever
// disagrees with the header, the header is right.
//   NAME#<trimmed team name>    { teamId }. Exists only so a name is claimed once.
//   D#<teamId>#<yyy>            one team's DECISIONS for one year (opaque JSON).
//   R#<teamId>#<yyy>            one team's RESULT for one year (TeamYearSummary).
//                               Year 000 is the opening position.
//   VIEW#<tokenHash>            { teamId } for one viewer.
//   TOKEN#<tokenHash>           { teamId } for one PLAYER token. Exists only so a
//                               token is claimed once — see THE TOKEN CLAIM.
//
// ⚠ AND ONE ITEM THAT IS NOT IN A ROOM'S PARTITION, WHICH IS WHY THE HEADING
// ABOVE IS QUALIFIED. createRoom became idempotent after this design was first
// written: the host mints its own token and the server indexes it, so a retry
// returns the room already made. That lookup happens BEFORE a code is known, so
// the item cannot be keyed on the code.
//
//   pk = CREATE#<hash(hostToken)>   sk = CREATE      { code }
//
// ⚠ AND A SECOND ITEM THAT IS NOT IN A ROOM'S PARTITION EITHER — THE LOBBY.
//
//   pk = LOBBY   sk = LOBBY   { events: { <code>: { eventName, status, teams,
//                                                   currentYear, yearCount,
//                                                   hidden, updatedAt } } }
//
// ⚠ IT EXISTS BECAUSE THIS TABLE CANNOT BE SCANNED FOR ROOMS, BY DESIGN. Every
// room is its own partition keyed ROOM#<code>; nothing relates them, and that
// is deliberate — a room is found by the code its host read out, never by
// enumeration. The lobby needs the opposite: "what is on right now", with no
// code in hand. A Scan would read every item of every room to answer it, costs
// the whole table per page view, and gets slower forever.
//
//   * ONE ITEM, NOT ONE PER EVENT. A GetItem answers the whole lobby. An item
//     per event would need a Query on a shared partition key, which is the same
//     hot partition with more moving parts.
//   * UPDATED AT FOUR MOMENTS: create, hide, start (the first advance) and
//     finish (the last). The local transport writes it at the same four, and
//     additionally when a team joins, so the row's team COUNT is honest.
//   * ⚠ EVERY WRITE IS AN UpdateExpression ON ONE PATH — SET events.#c = :e —
//     NEVER A PUT OF THE WHOLE MAP. Two hosts creating at once both read the
//     item, both add their own row, and a Put from each means the second
//     silently drops the first: a created event that is simply never listed,
//     with nothing anywhere recording that it happened. A path update touches
//     only its own code and the two interleave safely. This is the same
//     lost-update shape the CREATE# index was CORRECTED for below, and it is
//     the reason that correction is worth reading before touching this.
//   * NO CONDITION ON THE PATH, DELIBERATELY. The write is last-writer-wins for
//     ONE event's row, and the writers of a given row are that room's own
//     create/advance/hide — already serialised by the header's own conditional
//     writes. What must not be lost is ANOTHER event's row, and the path
//     expression is what guarantees that.
//   * NO TTL ON THIS ITEM. It outlives every room it names, so its rows must be
//     treated as pointers: listEvents BatchGets the headers and drops a row
//     whose room is gone (expired by TTL) or whose header disagrees. Rows found
//     dead are removed with REMOVE events.#c in the same pass, so the item does
//     not grow without bound.
//   * SIZE: 118 BYTES A ROW — MEASURED, attribute names plus values in UTF-8,
//     on a realistic row ("PRISM Spring Workshop", IN_PROGRESS, 6 teams, year
//     3 of 5). A hundred live events is 11.5 KB against the 400 KB item cap,
//     and FINISHED rows are pruned, so the live set is what is ON rather than
//     everything that ever was. It would take roughly 3,400 simultaneous live
//     events to reach the cap.
//
//   ⚠ AND THE ROOM HEADER BARELY MOVES: `hidden` is 11 bytes (name plus a
//     boolean) on an item the SIZES table below puts at ~3 KB, driven by the
//     roster and the shock list. No new item in a room's partition, no new key,
//     and no change to any access pattern — the flag is read and written with
//     the header that was already being read and written.
//
//   * HASHED, NOT RAW. The local implementation keys on the token itself and
//     says so — the room record beside it already holds the token in the clear
//     in the same localStorage, so it is no worse THERE. A hosted table is a
//     different setting: key on the hash and no plaintext bearer token is ever
//     written. The contract does not constrain this because it is entirely the
//     server's side of the wire.
//   * IT IS A SECOND ITEM PER ROOM, and anything counting rooms must exclude it.
//     The local store's /health reported `store.length` as the room count and
//     went wrong the moment this landed — the two-contexts driver caught it as
//     "the SERVER holds the room (2)" after a single create.
//   * WRITE IT AFTER THE ROOM, NEVER BEFORE. A failure between the two then
//     leaves no index pointing at a room that was never written; the reverse
//     order strands a token that resolves to nothing. They are deliberately NOT
//     transacted: they are in different partitions, and the ordering makes the
//     non-atomic case harmless in one direction only.
//   * GIVE IT THE ROOM'S OWN expiresAtSec. A longer life outlives the room it
//     names and a shorter one silently un-idempotents a create that is still
//     live. Same stamp, same reasoning as every other item here.
//
// ⚠ CORRECTED — THE TOKEN CLAIM, WHICH THE FIRST VERSION OF THIS DESIGN LACKED.
// localTransport refuses a client-supplied token already owned by the host, a
// team or a viewer (assertTokenFree), and httpTransport item 5 says that guard
// is not optional. Under the lock it is a read then a write. On DynamoDB the read
// half cannot be made a condition: the roster's tokenHash lives inside a map, and
// no ConditionExpression can say "no entry of this map has this value". So two
// joins presenting ONE token for TWO names both pass the read and both commit —
// one token, two seats. TOKEN#<hash> makes the claim a key: a new team's
// transaction puts it with attribute_not_exists and ConditionChecks that
// VIEW#<hash> is absent; a viewer's puts VIEW#<hash> with attribute_not_exists
// and ConditionChecks that TOKEN#<hash> is absent. The host token needs no item:
// it is fixed at creation, so checking it against the header is not a race.
// Same expiresAtSec as every other item. scripts/tools/session-race-probe.ts
// probe A fails without it.
//
// WHY THIS SHAPE, point by point:
//
//   * THE ROSTER IS IN THE HEADER because every `read` fetches the header
//     anyway (it carries `rev`, the ETag), so resolving a host or player token
//     costs no extra call. Tokens are stored HASHED; the header is never
//     returned raw.
//   * TEAMS ARE KEYED BY A RANDOM teamId, NOT BY NAME. Names are user text and
//     may contain '#'. Uniqueness comes from the NAME# item instead, keyed on
//     the name exactly as localTransport compares it today: trimmed, CASE-
//     SENSITIVE. Case-folding would be a behaviour change and a separate
//     decision.
//   * DECISIONS AND RESULTS ARE SEPARATE PREFIXES, NOT NESTED UNDER THE TEAM.
//     That makes the host's whole read ONE contiguous range (begins_with R#)
//     and keeps decisions physically out of the host's query, so "the host
//     never sees a team's decisions" does not depend on a filter someone could
//     forget. It is still enforced in code, not by the key — see HARD, 6.
//   * VIEWERS ARE THEIR OWN ITEMS because the viewer list grows with the number
//     of watchers, not with teams or years, and has no business in the header.
//   * `status` IS NOT STORED ON THE HEADER, AND STILL IS NOT. It is derived
//     from currentYear and the roster, as localTransport derives it today;
//     storing it would be one more field to keep in step.
//
//     ⚠ THE LOBBY ROW DOES CARRY A STATUS, AND THAT IS NOT A REVERSAL OF THIS.
//     The row is an INDEX of rooms it cannot read — the whole reason the item
//     exists is that answering "what is on" by reading every header is the
//     access pattern this table refuses. So the status there is a cached copy,
//     written from eventStatusOf at the four moments, and listEvents RE-DERIVES
//     from the header it fetches before serving a row. The cache is what makes
//     the row orderable and prunable; the header remains the authority, and
//     where they disagree the header wins and the row is rewritten.
//
//     ⚠ AND IT IS A DIFFERENT STATUS. RoomStatus ('lobby' | 'running' |
//     'complete') turns 'running' when the first team JOINS. EventStatus
//     ('OPEN' | 'IN_PROGRESS' | 'FINISHED') turns IN_PROGRESS at the host's
//     first ADVANCE, because that is when a new team would have missed a played
//     year. Two questions, two types; see contract.ts's eventStatusOf.
//
//   * `hidden` IS STORED ON THE HEADER, unlike status, because nothing derives
//     it: it is a choice the host made and the only record of it.
//   * YEARS ARE PADDED TO THREE DIGITS so the sort order holds past 99. padYear
//     below refuses anything else rather than truncating.
//
// ============================================================================
// SIZES AT TEN TEAMS BY TEN YEARS.
//
//   item            size                       basis
//   --------------  -------------------------  -----------------------------
//   ROOM header     ~3 KB                      ESTIMATED from field counts:
//                                              ~0.5 KB fixed + shocks + ~250 B
//                                              per roster entry.
//   D# per year     ~1.05 KB                   DERIVED BY SUBTRACTION: the
//                                              31 KB 2-team x 8-year record,
//                                              less 13.4 KB of results and the
//                                              headers, over 16 team-years.
//                                              Not measured directly.
//   R# per year     0.5 KB (year 0) rising     MEASURED: poll-cost-report.ts's
//                   to ~1.0 KB (year 10)       per-team series from the 2x8
//                                              browser run — 514 B at year 0,
//                                              659 B for year 1, growing ~45 B
//                                              a year because each post carries
//                                              one more accident year in its
//                                              developed column. Years 9 and 10
//                                              are that tool's EXTRAPOLATION.
//                                              10 teams x 8,677 B = ~87 KB.
//   NAME#, VIEW#    ~0.1 KB each               ESTIMATED.
//   partition       ~200 KB                    DERIVED: the sum of the above.
//
// ⚠ THE MEASURED FIGURES ARE JSON CHARACTERS, NOT DYNAMODB ITEM BYTES. DynamoDB
// counts attribute names plus values in UTF-8, which is the same order of
// magnitude but not the same number. No item is anywhere near the 400 KB cap;
// the largest is the header at ~3 KB, and it only outgrows the cap at roughly
// 1,500 teams.
//
// ============================================================================
// CONDITIONAL WRITES — EACH GUARDED ON WHAT IT ACTUALLY DEPENDS ON.
//
//   endpoint            write                                   condition
//   ------------------  --------------------------------------  -------------------------
//   createRoom          GetItem CREATE#<hash> FIRST — if it     attribute_not_exists(PK)
//                       resolves, return that room with          — a code collision fails
//                       reused: true and write nothing.          and the server redraws
//                       Otherwise Put ROOM, then Put
//                       CREATE#<hash> (that order).
//   createRoom, index   Put CREATE#<hash>                       attribute_not_exists(pk)
//                                                               — ⚠ CORRECTED, see below
//   join, new team      Transact: Put NAME#, Put TOKEN#,        NAME# not exists; TOKEN#
//                       ConditionCheck VIEW#, Update ROOM       not exists; VIEW# not
//                       (roster entry, ADD rev)                 exists; ROOM exists.
//                                                               On failure RE-READ and
//                                                               decide again — ⚠ CORRECTED
//   join, rejoin        none                                    token hash matches the
//                                                               roster. (The lines
//                                                               check is GONE: a join
//                                                               carries none.)
//   join, viewer        Transact: Put VIEW#, ConditionCheck     VIEW# not exists; TOKEN#
//                       TOKEN#. No rev bump — viewers are not   not exists (the token
//                       in RoomView                             claim, above)
//   submit, decisions   Transact: Update ROOM (lockedYear,      currentYear = :y
//                       ADD rev), Put D#
//   submit, result      Transact: Update ROOM (posted.<y>,      currentYear >= :y AND
//                       ADD rev), Put R#                        :y >= 0
//   advance             Update ROOM only: currentYear = :e+1,   currentYear = :e AND
//                       ADD rev                                 currentYear <= yearCount
//                                                               AND hostTokenHash = :h
//   setEventHidden      Update ROOM: hidden = :h, ADD rev        ROOM exists AND
//                                                                hostTokenHash = :h
//   lobby, any moment   Update LOBBY: SET events.#c = :entry     none — see the LOBBY
//                       (create / start / finish / hide)         item above on why the
//                                                                PATH is the guarantee
//                                                                and a condition is not
//   lobby, prune        Update LOBBY: REMOVE events.#c           none; removing a row
//                       for a row whose room is gone             twice is a no-op
//
// ⚠ CORRECTED — A FAILED CONDITION IS NOT AUTOMATICALLY THE ERROR IT GUARDS.
// This table said a failed NAME# condition is TEAM_TAKEN. Under concurrency it
// is not always: a join retried after a lost response (same token, same name)
// can read the header BEFORE its first attempt commits, decide "new team", and
// lose the NAME# condition to ITSELF. Answering TEAM_TAKEN there is the exact
// failure client-minted tokens exist to prevent. So a failed join condition
// re-reads the header and decides again; the second read sees the team, the
// token matches, and it is a rejoin. Probe B.
//
// ⚠ CORRECTED — THE INDEX PUT IS CONDITIONED. GetItem CREATE# then Put was safe
// under the lock. Two concurrent creates with one host token (a retry sent while
// the first is in flight) both miss the index and both make a room; an
// unconditioned second Put CREATE# silently replaces the first, and the two
// responses carry two codes for one request. Conditioned, the loser returns the
// winner's room with reused: true and deletes its own header, which nobody was
// ever given the code of. Probe C: 15 of 15 concurrent pairs split without it.
//
// ⚠ THE DECISIONS CONDITION MATTERS AS MUCH AS ADVANCE'S. Today the lock makes
// "check the year, then write" atomic. Split across items without that
// condition, a year-3 decision could land AFTER year 3 was processed, and a
// reloaded client would replay numbers nobody played — the slot-history bug
// that made decisions a history in the first place, back by another door.
//
// ⚠ ADVANCE'S COMPARE-AND-SWAP IS ON THE HEADER AND NOWHERE ELSE. It touches
// no team item: "locked" is derived as lockedYear === currentYear, so a new
// year needs no reset. On ConditionalCheckFailed, read the old header
// (ReturnValuesOnConditionCheckFailure = ALL_OLD) and decide, IN THIS ORDER:
//   host hash mismatch  -> NOT_HOST
//   already at :e + 1   -> the request was a retry; return success and the room
//   past yearCount      -> GAME_COMPLETE
//   anything else       -> WRONG_YEAR
// ⚠ CORRECTED: this list put the host-hash case THIRD, after the retry. As
// written that hands a SUCCESS to any non-host whose expectation happens to be
// one behind the room — it would match the retry case first. localTransport and
// httpTransport item 4 both put authority first, and the harness asserts it
// ("a forged token is refused before the year is even considered"). The handler
// also resolves the role from the header BEFORE the update, so a non-host never
// reaches the readback; the hash in the condition is the write enforcing it too.
// ⚠ AND THE RETRY BEFORE GAME_COMPLETE IS LOAD-BEARING: the retry of the advance
// that COMPLETED a game sees currentYear > yearCount exactly as a fresh advance
// past the end does; only :e tells them apart. The 144 do not exercise that
// case — the completion block never retries — so the probe does (probe D).
// AdvanceRequest CARRIES :e NOW — `expectedYear`, required, not optional. This
// said it did not yet; that was true when this was written and stopped being
// true on another branch. The retry branch above is therefore reachable and a
// server must implement it: a retry SUCCEEDS with advanced: false, it does not
// error.
//
// ============================================================================
// ⚠ rev IS NOT THE WRITE GUARD. httpTransport.ts item 8 and the stub server's
// header used to say it should be, and that is superseded here.
//
// rev stays monotonic per write and stays the ETag. It is bumped with an
// unconditional ADD inside each write's transaction. It is NOT a
// ConditionExpression on any write, because guarding writes on rev makes every
// write in a room conditional on one value: any two teams writing at once
// conflict and retry, which is exactly the contention the header-plus-items
// split exists to remove. Once writes are per item there is no whole-room
// read-modify-write left to guard; each write is guarded on the field it
// depends on — currentYear, or whether a key exists.
//
// Nor is rev the right guard for advance even there: a host who read at rev r
// and clicked would be refused whenever any team posted in between, and in the
// minute after an advance teams are posting constantly. The expected YEAR is
// the guard; rev is only how a poller knows something moved.
//
// ============================================================================
// READ — ONE ENDPOINT, ONE CLIENT CALL, THE QUERY CHOSEN BY ROLE.
//
//   1. BatchGetItem [ROOM, VIEW#<hash(token)>] — resolves every role in one
//      round trip. If rev equals the client's If-None-Match, answer 304 here.
//   2. By role:
//        host       Query begins_with R#              ~160 KB at 10x10
//        player     Query begins_with D#<teamId>#     ~11 KB; postedYears come
//                                                     from the roster
//                   AND Query begins_with R#<teamId>#   ⚠ CORRECTED: omitted
//                                                     before, but lastResult is
//                                                     the payload of the highest
//                                                     played year and the harness
//                                                     reads a player's OWN
//                                                     resultsByYear back. ~9 KB.
//        viewer     as the player it watches
//        anonymous  the header alone, token hashes stripped
//
// The response SHAPE does not change. What changes: players and anonymous
// callers stop receiving other teams' resultsByYear, which no screen of theirs
// reads — see the note at localTransport's teamView, where that over-send lives
// on the current build.
//
// ⚠ THE R# ITEM GREW WHEN DECISIONS JOINED IT, AND THE FIGURE IS MEASURED, NOT
// ESTIMATED. A TeamYearSummary carrying a three-line decisions block is +748
// BYTES, flat — the block is a fixed set of scalars plus a per-band placement
// array, so it does not grow with the year. Against the row itself that is
// +63% at year 1 and +37.5% at year 10 (the row grows because `developed`
// restates every accident year), +47% over a ten-year game.
//
// At the HOST's read that compounds: ~87 KB -> ~160 KB at ten teams by ten
// years, which is the largest single read in this design and roughly doubles
// it. It is accepted rather than trimmed, for two reasons that should be
// re-examined if a room gets much bigger than 10x10:
//   - the read is ETag'd on rev, so an unchanged poll is still a 304 and
//     transfers nothing. The cost falls on reads that were going to carry a
//     changed body anyway.
//   - the obvious saving is not available honestly. Investment allocation and
//     risk control are POOL-WIDE decisions projected onto each line, so storing
//     them per line triples them — but they are projected per line, each line
//     applies them to its own base, and the host's table compares lines. Hoist
//     them to the pool and a line that differs becomes unrepresentable.
// A real reduction would mean shortening keys, which trades a wire saving for a
// stored row nobody can read. Not taken.
//
// ⚠ NO NEW ITEM, NO NEW PREFIX, NO NEW ENDPOINT. Decisions ride inside the R#
// body that already exists. The D# items are untouched and still hold the
// opaque live decision stream for the team that wrote it.
//
// ⚠ HEADER FIRST, ITEMS SECOND — NEVER IN PARALLEL. A header read at rev r
// followed by a Query can only see items written at r or later: the caller
// stores r and its next poll refetches. Run the other way round, a Query at r
// can pair with a header at r+1, and the caller stores r+1 having missed the
// item that made it r+1 — the poller below, by another door. The lock gave
// localTransport an atomic snapshot; here the order is what replaces it. Every
// mutation's response is built the same way, from a fresh header read after the
// write, because a transaction cannot return values.
//
// ⚠ EVERY READ IS STRONGLY CONSISTENT (ConsistentRead = true), AND THIS IS WHY.
// A poller that sees a new rev on the header and then gets a STALE query would
// store that new rev as its ETag — and every later poll would 304 against it,
// so the missed item is never fetched. That is the lost-update bug in its fourth
// form: the first was four tabs sharing localStorage, the second the transport
// with nothing to serialise, the third Lambda's parallel invocations. For the
// same reason the read path uses NO secondary index: a GSI cannot be read
// strongly consistently.
//
// ============================================================================
// WHAT THIS DESIGN MAKES HARD — six things, most important first.
//
//   1. TEAM COUNT x BURSTINESS BREAKS FIRST, NOT YEARS. Every write goes
//      through the header. Results arrive in a burst: every client sees the
//      advance on its next poll and posts within seconds. Two transactions on
//      one item at once conflict and one retries. At 10-12 teams that is
//      occasional; at 50+ posting inside a second or two it is sustained
//      retries and visible latency. Each write also pays for the WHOLE header's
//      size, which grows with the roster (~3 KB at 10 teams, ~25 KB at 100).
//      Escape hatch if it ever matters: results stop touching the header —
//      postedYears comes from a Query of R#<teamId>#, rev becomes an
//      unconditional ADD outside the transaction.
//      ⚠ THE PLANNED EVENT IS INSIDE THAT RANGE. The AWS owner's guide plans for
//      140 players — 25 to 45 teams at three to six a team — which sits between
//      "occasional" and "sustained", where nothing has been measured. The
//      escape hatch may not be optional for that event; decide before it.
//   2. ANY QUESTION ACROSS ROOMS. Rooms by host, rooms active this week, an
//      admin list: each is a table Scan. A GSI added later fixes it, but only
//      for questions chosen in advance, and a GSI is eventually consistent.
//   3. DELTAS. The ETag is all-or-nothing: any change and the host refetches
//      every result. A `sinceRev` read needs each item stamped with the rev
//      that wrote it, which a write cannot know without guarding on rev —
//      which is point 1's problem. Affordable (~10 MB a session to the host);
//      not cheap to change later.
//   4. A SCOREBOARD FOR PLAYERS. The growth direction to watch hardest. If
//      players are ever shown other teams, every player's poll becomes
//      host-sized — ~87 KB x every client x every change. That wants a small
//      per-team "latest figures" entry in the header, not the full history.
//   5. REMOVING A ROOM. It is ~220 items, not one. Every item needs its own
//      expiresAtSec copied from the header's (see WHAT SETS THE EXPIRY), TTL
//      removes them one by one rather than as a room, and an explicit delete is
//      a Query followed by batched deletes.
//   6. PRIVACY IS ENFORCED BY CODE, NOT BY KEYS. The layout keeps decisions out
//      of the host's query, but nothing in DynamoDB stops a handler reading D#
//      for the host. It is a handler rule and needs the harness to hold it.
//
// ============================================================================
// CONTRACT GAPS THIS DESIGN ASSUMED CLOSED — ALL THREE ARE NOW ACTUALLY CLOSED.
//
// This file was written against three gaps it could only assume would be shut.
// They were shut on another branch and arrive with this merge, so the design no
// longer assumes anything; it DESCRIBES the wire:
//   advance      AdvanceRequest.expectedYear, REQUIRED. Compare-and-swap on
//                currentYear = :expected. A retry is a no-op that SUCCEEDS.
//   join         JoinRequest.token, minted by the client and sent on the FIRST
//                join as well as a return. Still OPTIONAL on the wire, so a
//                handler must serve both the idempotent and the one-shot form.
//   createRoom   CreateRoomRequest.hostToken, minted by the client, doubling as
//                the idempotency key, with the CREATE# index item above.
//
// ⚠ THE CONTRACT HARNESS IS 144/144 OVER ALL FOUR PASSES. It was 126/126 when
// this design was written — the figure STATE_member-satisfaction.md still
// records, correctly, as the count AT THAT MERGE. The extra eighteen are these
// three mechanisms. They run identically against localStorage, over a real
// socket to the stub, and — with --dynamo, against DynamoDB Local in Docker —
// in-process against DynamoSessionTransport and over a socket through the Lambda
// handler. ⚠ BUT THE 144 ARE SEQUENTIAL, so they cannot see a race: every
// correction above marked with a probe letter was deleted from rooms.ts in turn
// and the 144 stayed green. scripts/tools/session-race-probe.ts is what failed.
// ============================================================================

/** DynamoDB's hard limit on a sort key, in UTF-8 bytes. */
const MAX_SORT_KEY_BYTES = 1024;

/** Years are padded to this many digits so lexicographic order is numeric order. */
const YEAR_DIGITS = 3;

/** The header's sort-key VALUE — stored in the attribute named `sk`. */
export const ROOM_HEADER_SK = 'ROOM';

/** The prefix under which every team's results sort together — the host's range. */
export const RESULT_PREFIX = 'R#';

/**
 * A year as three digits. Year 0 is legal — it is the opening position — and
 * a negative year is refused, as the contract refuses it. Anything past 999 is
 * refused rather than widened, because a fourth digit would sort "1000" before
 * "999" and silently reorder the history.
 */
export function padYear(year: number): string {
  if (!Number.isInteger(year) || year < 0 || year >= 10 ** YEAR_DIGITS) {
    throw new RangeError(`Year must be an integer from 0 to ${10 ** YEAR_DIGITS - 1}; got ${year}.`);
  }
  return String(year).padStart(YEAR_DIGITS, '0');
}

// A teamId is minted by the server, so it can be held to a shape that cannot
// break the key: no '#', which is the separator.
function checkTeamId(teamId: string): string {
  if (teamId.length === 0 || teamId.includes('#')) {
    throw new RangeError(`A teamId must be non-empty and contain no '#'; got ${JSON.stringify(teamId)}.`);
  }
  return teamId;
}

function checkSortKey(sk: string): string {
  if (new TextEncoder().encode(sk).length > MAX_SORT_KEY_BYTES) {
    throw new RangeError(`Sort key exceeds DynamoDB's ${MAX_SORT_KEY_BYTES}-byte limit.`);
  }
  return sk;
}

/** The partition-key VALUE every item of one room shares — stored in the attribute named `pk`. */
export function roomPk(code: string): string {
  if (code.length === 0) throw new RangeError('A room code must be non-empty.');
  return `ROOM#${code}`;
}

/**
 * The name-claim item. Trimmed and case-sensitive, matching how
 * localTransport compares names today; '#' inside a name is harmless here
 * because this key is only ever read or written whole, never by prefix.
 */
export function nameSk(teamName: string): string {
  const trimmed = teamName.trim();
  if (trimmed.length === 0) throw new RangeError('A team name must be non-empty.');
  return checkSortKey(`NAME#${trimmed}`);
}

/** One team's decisions for one year. */
export function decisionSk(teamId: string, year: number): string {
  return `D#${checkTeamId(teamId)}#${padYear(year)}`;
}

/** Every decision of one team — a player's (and its viewers') read range. */
export function decisionPrefix(teamId: string): string {
  return `D#${checkTeamId(teamId)}#`;
}

/** Every result of one team — a player's (and its viewers') own results range. */
export function resultPrefix(teamId: string): string {
  return `${RESULT_PREFIX}${checkTeamId(teamId)}#`;
}

/** One team's result for one year; year 0 is the opening position. */
export function resultSk(teamId: string, year: number): string {
  return `${RESULT_PREFIX}${checkTeamId(teamId)}#${padYear(year)}`;
}

/** One viewer, keyed by the hash of its token. */
export function viewerSk(tokenHash: string): string {
  if (tokenHash.length === 0) throw new RangeError('A token hash must be non-empty.');
  return checkSortKey(`VIEW#${tokenHash}`);
}

/**
 * The createRoom idempotency index's partition-key VALUE. NOT a room partition:
 * the lookup happens before a code exists. See ONE TABLE above.
 */
export function createPk(hostTokenHash: string): string {
  if (hostTokenHash.length === 0) throw new RangeError('A token hash must be non-empty.');
  return `CREATE#${hostTokenHash}`;
}

/** The idempotency index item's sort-key VALUE. */
export const CREATE_SK = 'CREATE';

/**
 * THE LOBBY INDEX ITEM — a single item, not in any room's partition, holding
 * one row per current event. See ONE TABLE above for why it exists and why
 * every write to it is a path update rather than a Put.
 *
 * Both halves are the literal string LOBBY: there is exactly one of these, so
 * there is nothing to key it by. It is deliberately NOT namespaced under a room
 * prefix — anything matching ROOM#... must be a room.
 */
export const LOBBY_PK = 'LOBBY';
export const LOBBY_SK = 'LOBBY';

/**
 * The attribute path of ONE event's row inside that item.
 *
 * ⚠ THE CODE GOES IN AN ExpressionAttributeName, NEVER INTO THE EXPRESSION
 * TEXT. A code is drawn from a fixed alphabet today, so none of them can carry
 * a character a path would choke on — but an expression built by concatenation
 * is a habit that outlives the constraint that made it safe, and this one would
 * be built in the handler where the alphabet is not in view.
 */
export function lobbyEventPath(): { expression: string; nameKey: string } {
  return { expression: 'events.#c', nameKey: '#c' };
}

/**
 * One PLAYER token's claim, keyed by the hash of the token. Exists only so a
 * token is claimed once — see THE TOKEN CLAIM above for why the roster's own
 * tokenHash cannot do this.
 */
export function tokenSk(tokenHash: string): string {
  if (tokenHash.length === 0) throw new RangeError('A token hash must be non-empty.');
  return checkSortKey(`TOKEN#${tokenHash}`);
}
