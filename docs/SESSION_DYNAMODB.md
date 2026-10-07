# Session table — a provisioning summary

**This note is a summary. `src/session/server/keys.ts` is authoritative.** The design, the write
conditions, the reasons and the full list of what the design makes hard are in that file's header,
next to the functions that build every key. If this note and that file disagree, the file is right
and this note is stale: fix this note.

It is for whoever creates and sizes the table, not whoever writes the handlers.

**The acceptance test for a handler is `scripts/tools/session-contract-check.ts`, which is 144/144 over both transports** — the same assertions against `localStorage` and against a real socket. A Lambda that satisfies it satisfies the contract; neither this note nor `keys.ts` is a substitute for running it. (It was 126/126 when this note was written, before `advance` took an expected year and `join`/`createRoom` took client-minted tokens.)

## What the console asks for

None of these can be changed after the table exists.

| Console field | Enter | Type |
|---|---|---|
| Table name | `ripple-sessions` | — |
| Partition key | `pk` | String |
| Sort key | `sk` | String |
| TTL attribute (enable TTL after creation) | `expiresAtSec` | Number, **epoch seconds** |

The handler reads the table name from the `TABLE_NAME` environment variable and never hard-codes it.

## The keys: attribute names and value formats are two different things

The console asks what the key attribute is **called**. That is `pk` or `sk`. It does not ask for
the values below, which the handlers write into those attributes. **Do not type `ROOM#<code>` into
the console.**

| Attribute | Type | Value format | Item |
|---|---|---|---|
| `pk` | String | `ROOM#<code>` | every item of a room |
| `sk` | String | `ROOM` | the room header |
| `sk` | String | `NAME#<team name>` | a team name's claim |
| `sk` | String | `D#<teamId>#<yyy>` | one team's decisions for one year |
| `sk` | String | `R#<teamId>#<yyy>` | one team's result for one year (`000` is the opening position) |
| `sk` | String | `VIEW#<tokenHash>` | one viewer |
| `pk` | String | `CREATE#<hash(hostToken)>` | **not a room partition** — see below |
| `sk` | String | `CREATE` | the createRoom idempotency index, holding `{ code }` |

`<yyy>` is always three digits, so the sort order holds past year 99.

### The one item that is not in a room's partition

`createRoom` is idempotent: the host's client mints its own token and the server indexes it, so a
retried create returns the room it already made rather than a second room. That lookup happens
**before a code exists**, so the index cannot be keyed on the code — it is its own partition.

- **Key on the HASH of the host token, never the token itself.** It is a bearer token; the table
  should never hold one in plaintext. (The local implementation keys on the raw token and says so —
  the room record beside it already holds it in the clear in the same `localStorage`, so it is no
  worse *there*. A hosted table is a different setting.)
- **It is a second item per room.** Anything counting rooms must exclude it. The local store's
  `/health` reported its own length as the room count and went wrong the moment this landed.
- **Write it AFTER the room, never before.** A failure between the two then leaves no index pointing
  at a room that was never written. The reverse order strands a token resolving to nothing. They are
  deliberately not transacted — different partitions — and the ordering is what makes the non-atomic
  case harmless in one direction.
- **Give it the room's own `expiresAtSec`.** Longer outlives the room it names; shorter silently
  un-idempotents a create that is still live.

This does not change the "no secondary index" rule below: it is a main-table item, not a GSI.

- **No secondary index.** The handlers do not need one, and must not read through one: every read is
  strongly consistent (below), and a GSI cannot be.
- **Single region.** Strongly consistent reads hold only in the region that took the write.

## TTL

- **The attribute is `expiresAtSec`, a Number, in epoch SECONDS.** A value stamped in milliseconds —
  the unit the rest of this codebase's timestamps use — reads as tens of thousands of years away, and
  nothing is ever deleted. A duration stored in place of a timestamp reads as 1970 and expires at once.
- **One write sets it and every other write copies it.** `createRoom` sets the header's value once
  (creation time in seconds, plus the retention period). Every later write copies the header's value
  verbatim onto the item it writes — **including the `CREATE#` index item**, which is written in the
  same call and is the one item a reader will not think to check. A result posted in year 10 carries the same expiry as the header
  written two hours earlier, so the room expires as one rather than in pieces.
- **The retention period is not decided yet.** Unlike the attribute name, it can change later, for
  new rooms.
- **TTL deletes in the background, well after the expiry, item by item.** The handlers therefore treat
  a room as gone once its header's expiry has passed, whether or not TTL has removed it yet.

## Sizes, ten teams by ten years

| Item | Size | Basis |
|---|---|---|
| Header (`ROOM`) | ~3 KB | estimated from field counts |
| Decisions, per team-year | ~1.05 KB | derived by subtraction from a measured record |
| Result, per team-year | 0.5 KB rising to ~1.0 KB | measured (browser run, via `scripts/tools/poll-cost-report.ts`); years 9–10 extrapolated |
| Whole partition | ~200 KB | derived: the sum |

The measured figures are JSON characters, not DynamoDB item bytes — the same order, not the same
number. The largest item is the header at ~3 KB; the 400 KB item cap is not a concern.

## Capacity

Derived from `poll-cost-report.ts`'s two-hour, ten-team session (11,631 reads, 230 writes, with the
shipped back-off) and the sizes above. **Estimates, not measurements.**

- **Reads dominate by count, not by size.** Most polls find nothing new and cost one small batch get
  of the header (~1–2 read units, strongly consistent). A changed read costs ~3 read units for a
  player and up to ~22 for the host. Order of magnitude: **tens of thousands of read units per
  session**.
- **Writes are two-item transactions**, which bill at twice the standard rate and pay for the whole
  header each time: ~10 write units per write, **a few thousand per session**.
- **Strongly consistent reads are required**, at twice the cost of eventual ones. Do not switch them
  to eventual to save capacity: that reintroduces a lost update (see the module).
- **On-demand billing fits the shape.** A room is a two-hour burst and then idle.

## What capacity cannot fix

A room's writes all touch its header item. When many teams post in the same second — results
arrive in a burst just after each advance — their transactions conflict and retry. **That limit is
per item, not per table: raising capacity does not move it.** It is occasional at 10–12 teams and
sustained at 50+. Team count times burstiness is what breaks first, not years. The module records
the escape hatch.

**The planned event is inside that range.** The AWS owner's guide plans for 140 players: 25 to 45
teams at three to six a team. That sits between "occasional" and "sustained", and nothing in between
has been measured. At that size the escape hatch may not be optional. Settle it before the session,
not during it.
