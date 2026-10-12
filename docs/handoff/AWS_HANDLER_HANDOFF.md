# AWS session handler — handoff

For whoever (or whichever Claude session) picks up the review/prod AWS work next. This is the
build spec for the one piece nothing else can proceed without: the real Lambda handler. Read
`SESSION_PRACTICES.md` and `src/session/server/keys.ts` before writing any code — they are
authoritative and this file does not repeat their reasoning, only points at it.

> **Where this file came from.** It was written by an earlier session after checking the repo and
> then lived **outside the repository** — the failure `SESSION_PRACTICES.md` §1 names: a spec the
> next reader needs, nowhere they would look for it. It is committed here with the handler it
> specified. The body below is the original text; where building against it showed it was wrong
> or incomplete, the correction is in the next section and marked inline with **⚠ Correction N**.

---

## Status and corrections — read this first

**Priority 1 is built.** `src/session/server/` holds `dynamo.ts`, `views.ts`, `rooms.ts`
(`DynamoSessionTransport`) and `handler.ts`. `npm run build:handler` produces
`dist-lambda/handler.zip` (`index.js` at the root, exporting `handler`), and the same 144
assertions pass, unmodified, over all four passes:

```
npm run contract:dynamo    # localStorage, stub, DynamoDB in-process, HTTP through handler.ts
npm run contract:built     # build the zip, then all of the above plus HTTP through the zip's own index.js
npm run contract:races     # the races and the ordering trap the 144 cannot reach
npm run build:handler
```

Every DynamoDB pass prints how many items it wrote to the container's table and fails if none. A
pass that silently ran against something else would otherwise read 144/144. The over-HTTP pass runs
the module's exported `handler`, configured only through environment variables, as the function is.

**What the instruments cover, measured by breaking each protection in turn.** Sixteen deletions
from the handler: the 144 caught two, the race probes caught ten more, and **four survive both** —
the `TransactionConflict` retry (DynamoDB Local never raised a conflict, even for twenty
simultaneous transactions on one item), the any-item check on a new room code, the orphan delete
in createRoom's race, and the `MAX_ATTEMPTS` fallbacks. They are listed with their reasons in
`rooms.ts`'s header. **The first matters before the planned event:** only a load test against a
real table can measure it. Most race probes are sequential calls arranged into a race's exact
interleaving. That is deterministic, but it covers only "one request wholly inside another's
window", not two transactions overlapping at DynamoDB.

All three need Docker for DynamoDB Local (`amazon/dynamodb-local:3.3.1`) and **no AWS
credentials**. The SDK is given dummy credentials and a 127.0.0.1 endpoint.

⚠ **The Docker CLI being present is not the daemon running.** In a fresh cloud container
`docker --version` answers and `docker ps` fails. Start `dockerd` first.

**Where this spec and `keys.ts` disagreed, `keys.ts` was followed. Where `keys.ts` itself was
wrong or incomplete, it was corrected in place (marked ⚠ CORRECTED there).**

1. **Every response does NOT carry every team's results.** This file said every mutating
   response needs a full `RoomView` with every team's `resultsByYear`, so every endpoint pays for
   `begins_with R#`. `keys.ts` READ says players and anonymous callers stop receiving other
   teams' results — the over-send `localTransport.ts`'s `teamView` records as a privacy gap — and
   `keys.ts` wins. The harness assertion this file cited (the opening-position block) reads the
   player's *own* team, `teams[0]` on the player's own submit. So a player's view carries its own
   team's results and nobody else's, and the host's carries all of them. No player screen reads
   another team's `resultsByYear`; the 144 pass with it.
2. **createRoom's collision guard is not only `attribute_not_exists(pk)`.** `keys.ts` also refuses
   a code whose partition has *any* item (`Query`, `Limit 1`). An expired room's D#/R# items can
   outlive its header until TTL reaches them, and a new room drawing that code would inherit
   them. The `CREATE#` item also takes the room's own `expiresAtSec`, which this file did not say.
3. **The new-team join's header update is conditioned on the room existing** (`keys.ts`: "ROOM
   exists"). This file left that out.
4. **A failed `NAME#` condition is not automatically `TEAM_TAKEN`.** This file says it is, and so
   did `keys.ts`. That is wrong under concurrency. See the lock findings below.
5. **The handler is more than the five files in the table.** `keys.ts` gained `createPk`/`CREATE_SK`.
   It described the `CREATE#` key but never exported a builder, and "build every key through this
   module" could not be followed without one. It also gained `tokenSk`. Added files:
   `scripts/tools/session-race-probe.ts`, `dist-lambda` in `.gitignore`, `@aws-sdk/util-dynamodb`
   (for the `ALL_OLD` readback), and an `npm run contract:races` script.

**What `navigator.locks` was doing that the condition table did not cover.** `localTransport`
gets atomicity for free; concurrent Lambda invocations do not. Ported rule-for-rule, the table
missed four things. Each is fixed in `rooms.ts` (its header has the full account) and each has a
probe that fails without the fix:

- **The token-collision guard** (probe A). A client-supplied token already owned by someone else
  must be refused, and that check is a read of the roster. DynamoDB cannot condition on "no map
  entry holds this hash". Two joins presenting one token for two names would both commit. Fixed
  with a `TOKEN#<hash>` claim item put with `attribute_not_exists`, plus a mirror check against
  `VIEW#`.
- **Losing a condition to yourself** (probe B). A join retried after a lost response can read
  before its own first attempt commits, then lose `NAME#` to it. Fixed: a failed join condition
  re-reads and decides again, which lands on the rejoin path.
- **The unconditioned `CREATE#` put** (probe C). Two same-token creates in flight both made a
  room. Without the condition, 15 of 15 concurrent pairs got two codes for one request.
- **The response snapshot** (probe I). Under the lock, a mutation's `roomView` is exactly the state
  its write produced. Here it is a follow-up read, and it must read **header first, items second,
  never in parallel**. The reverse order can pair old items with a new `rev`, which is the
  lost-update bug in its fourth form.

**The advance readback order (probe D).** A retry that succeeds is checked before
`GAME_COMPLETE`, exactly as `localTransport.ts` orders the cases. ⚠ **`keys.ts`'s own readback
list was wrong here and is corrected.** It put "host hash mismatch" *third*, after the retry case,
which as written hands a success to a non-host whose expectation is one year behind. ⚠ **The 144
do not exercise the trap.** The completion block advances past the end once and never retries the
advance that completed the game, so swapping cases 2 and 3 left all 144 green. The probe runs the
completing retry against both `LocalSessionTransport` and `DynamoSessionTransport`.

**Decided provisionally, flagged for a real decision:**
- **Retention:** `ROOM_RETENTION_SEC`, default seven days (`dynamo.ts`). `keys.ts` says retention is
  undecided; this is a placeholder.
- **Year ceiling:** a room may have at most 998 years, because three-digit year keys are what
  `padYear` allows.
- **Team order:** the roster is a map with no order, so teams sort on a `joinedAt` stamp, with
  `teamId` breaking ties.
- **Viewer joins no longer bump `rev`,** per `keys.ts`; `localTransport` bumps it. No assertion
  depends on it.

---

## Where this came from

Mike (AWS setup) sent a developer guide — `ripple-environments-developer-guide.md` — describing
two environments, **review** and **prod**, in one AWS account (`168288133197`, `us-west-2`), both
backed by a Lambda behind API Gateway with DynamoDB underneath. Get a copy from Tige or Mike if you
need the full thing; the parts that matter for each piece of work are summarized inline below where
relevant, so you shouldn't need it to get started on the handler.

**Checked against the repo, before writing this:** none of it exists yet. *(⚠ Stale: the handler
now exists — see Status above. The rest of this list still holds.)*
- `src/session/server/` holds only `keys.ts` — a key *design*, not a handler. Its own header says
  "NOTHING IMPORTS IT YET... no handler exists."
- `scripts/tools/session-stub-server.ts` is a throwaway in-memory stub for local dev; its header
  says plainly that nothing in it survives the real implementation.
- No `.github/workflows/`, no `build:handler` script, no `/infra/`, no `release` branch, no
  CODEOWNERS.
So **nothing in the guide's pipeline can be wired up until the handler exists** — a workflow that
deploys nothing is not useful to build first. Start here.

---

## Priority 1 — build the real Lambda handler

### What already fully specifies this (read these, in this order)

1. `src/session/contract.ts` — the five-endpoint interface (`createRoom`, `join`, `submit`,
   `advance`, `read`), every request/response shape, every `SessionErrorCode`. This is the thing
   being implemented a third time (after `localStorage` and the HTTP stub).
2. `src/session/localTransport.ts` — the reference implementation of every *rule*: redaction
   (who sees what), idempotency (client-minted tokens, retry-safe `createRoom`/`join`/`advance`),
   carry-forward, the four-case `advance` compare-and-swap (comment block around line 594-632 —
   read this one carefully, the ordering of the four cases is load-bearing). The Lambda must behave
   identically to this class, against DynamoDB instead of `localStorage`.
3. `src/session/server/keys.ts` — **authoritative** DynamoDB key design: item shapes, attribute
   names/formats, and a table (around line 177-221) of exactly which write is conditioned on which
   attribute. Build every key through this module's exported functions (`roomPk`, `nameSk`,
   `decisionSk`, `resultSk`, `viewerSk`, `padYear`) — do not hand-roll a key anywhere else.
   *(⚠ Correction 5: it now also exports `createPk`, `CREATE_SK` and `tokenSk`, and its line numbers
   have moved.)*
4. `docs/SESSION_DYNAMODB.md` — a summary of (3) for whoever provisions the table (console field
   values, sizes, capacity estimates). If it and `keys.ts` disagree, `keys.ts` is right.
5. `src/session/httpTransport.ts` — what the wire format must look like: status→code mapping,
   `Authorization: Bearer <token>` (the token also stays in the request body), and a numbered list
   of "what a deployment still needs" (CORS is API Gateway's job, not the handler's; HTTPS; token
   lifecycle; the idempotency and locking points already closed on this branch).
6. `scripts/tools/session-contract-check.ts` — **144 assertions, run today against both existing
   implementations.** `docs/SESSION_DYNAMODB.md` says it outright: *"A Lambda that satisfies it
   satisfies the contract... run it against a Lambda, not this header."* Do not write new tests for
   this — add the Lambda as a third pass of these same, unmodified assertions.
   *(⚠ The 144 were not modified. But they are sequential and cannot see the races the
   conditions exist for; `session-race-probe.ts` is separate from them for that reason.)*

### Files to create

| File | Purpose |
|---|---|
| `src/session/server/dynamo.ts` | DynamoDB Document Client factory, reading `TABLE_NAME` from the environment (never hard-coded — see `keys.ts`). `hashToken` (SHA-256 hex via `node:crypto` — hosted tokens must be hashed before they touch the table, never stored raw; `keys.ts` is explicit about this for the `CREATE#` index and it applies to every token-bearing item). `newTeamId`. `newRoomCode` — same alphabet/length as `localTransport.ts` uses, duplicated rather than imported (importing would drag a browser-oriented module into the Lambda bundle for one constant). |
| `src/session/server/views.ts` | `buildRoomView`, `buildTeamView`, `buildCallerView`, `statusOf`, `highestPlayedYear` — the same projections `localTransport.ts` does (compare its `roomView`/`teamView`/`callerView`/`statusOf` functions), rewritten over the DynamoDB header's `roster` map plus queried `D#`/`R#` items instead of an in-memory record. |
| `src/session/server/rooms.ts` | `export class DynamoSessionTransport implements SessionTransport` — the five endpoints, against DynamoDB. Semantics below. |
| `src/session/server/handler.ts` | `export const handler` — the actual Lambda entry point. API Gateway **v2 HTTP API** proxy integration (`APIGatewayProxyEventV2` / `...ResultV2` from `@types/aws-lambda`, since the guide's environment is an HTTP API, not a REST API). Routes `POST /<endpoint>` (`createRoom`/`join`/`submit`/`advance`/`read`) to `DynamoSessionTransport`, JSON (de)serializes, maps a thrown `SessionError` to an HTTP status + `{error:{code,message,retryable}}` body matching what `httpTransport.ts`'s `codeForStatus`/`ErrorBody` parsing expects. **No CORS headers** — the guide (section 10) is explicit that API Gateway owns CORS and the handler must not add any. |
| `scripts/tools/build-handler.ts` | Bundles `handler.ts` with `esbuild` (new devDependency) into a single CJS file — `platform:'node'`, `target:'node22'`, everything bundled (no externals) for an arm64-safe single artifact per the guide's pipeline spec (section 6). Zips it with `fflate` (already a dependency, no new dep needed) to `dist-lambda/handler.zip` with `index.js` at the zip root exporting `handler`. Run via `npx tsx scripts/tools/build-handler.ts`, matching how every other script in `scripts/tools/` and `scripts/diagnostics/` runs. Wire as `npm run build:handler` in `package.json` — the guide's pipeline (section 6) expects exactly that script name. |

*(⚠ Correction 5: see Status for what else had to change. The build also unzips its own output,
loads `index.js` and calls `handler` once, and the zip is byte-identical across rebuilds of the
same source.)*

**Modify** `scripts/tools/session-contract-check.ts`: add two more passes behind a `--dynamo` CLI
flag, so the default (no-flag) run stays exactly as fast and Docker-free as it is today:
1. In-process against `DynamoSessionTransport` directly.
2. Over HTTP, via a tiny local shim that turns `handler.ts`'s dispatch into a real HTTP server
   (the same role `session-stub-server.ts` plays for the local pass today) — this is what actually
   proves the HTTP/JSON/status-code plumbing works, not just the DynamoDB logic underneath it.
Both new passes share one `amazon/dynamodb-local` Docker container (start with `docker run`, create
the table with the schema `docs/SESSION_DYNAMODB.md` describes, tear down after). This needs Docker,
**not live AWS credentials** — useful, since AWS creds are not currently configured in at least one
dev's environment (`aws sts get-caller-identity` failed with `InvalidClientTokenId` when this was
checked). Docker was confirmed present (`docker --version` → 29.8.0).

**`package.json` changes:**
- Add dependencies: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (bundled into the handler).
- Add devDependencies: `esbuild`, `@types/aws-lambda`.
- Add scripts: `"build:handler"`, and something like `"contract:dynamo": "npx tsx scripts/tools/session-contract-check.ts --dynamo"`.
- **No tsconfig changes needed.** `tsconfig.app.json` already includes all of `src/**` with
  `strict: true`, and Node globals (`process`, `node:crypto`, etc.) already typecheck there via the
  existing `@types/node` devDependency (not restricted by a `"types"` array in that config) — the
  same arrangement `tsconfig.scripts.json`'s own header comment documents for other shared files
  that need to compile under both a DOM-ish and a Node-ish config. New files under
  `src/session/server/` land in the same situation; just don't reach for browser-only globals
  (`document`, `window`, `navigator.locks`, `localStorage`) in them, same as `keys.ts` already
  doesn't.

### Per-endpoint DynamoDB semantics (condensed from `keys.ts` — that file is authoritative, this is a summary to build against)

- **createRoom** — `GetItem CREATE#hash(hostToken)` first; if found, return that room with
  `reused: true`, write nothing. Else `PutItem` the header with `ConditionExpression
  attribute_not_exists(pk)` (retry on collision — ~6-char code space, see `localTransport.ts`'s
  collision-retry loop for the exact alphabet/count), **then** `PutItem CREATE#hash(hostToken)`
  (strictly after, never before — an interrupted create must not strand a token that resolves to
  nothing). `expiresAtSec` is set once here; every later write on this room copies it verbatim —
  never recomputed from "now". *(⚠ Correction 2: also refuse a code whose partition has any item.
  And the `CREATE#` put is itself conditioned on `attribute_not_exists` — see the lock findings.)*
- **join** — resolve by name lookup in the header's `roster` (one `ConsistentRead` `GetItem`). New
  team: `TransactWriteItems` [`Put NAME#<name>` condition `attribute_not_exists(sk)`, `Update`
  roster + `ADD rev`] — a `TransactionCanceledException` on the `NAME#` item is `TEAM_TAKEN`, the
  real concurrent-join race, caught natively by the transaction rather than by a lock. Rejoin:
  token-hash match against the roster entry; `LINES_LOCKED` if the requested lines differ from what
  the team already holds. Viewer: existing-token lookup is a rejoin; otherwise a plain `Put VIEW#`
  — no condition, no `rev` bump (viewers are never in `RoomView`). *(⚠ Corrections 3 and 4, and
  the token claim: the transaction also puts `TOKEN#<hash>` and checks `VIEW#<hash>` is absent; the
  viewer's `Put VIEW#` is conditioned and checks `TOKEN#<hash>`; a failed condition re-reads and
  decides again rather than answering `TEAM_TAKEN`.)*
- **submit, decisions** — `TransactWriteItems` [`Update` roster (`lockedYear`, `ADD rev`) condition
  `currentYear = :y`, `Put D#<teamId>#<yyy>` unconditional]. A failed condition is `WRONG_YEAR` —
  this is the real race a concurrent `advance` creates between this request's read and its write,
  and DynamoDB's condition is what catches it for real (the local transport gets this for free from
  its lock; Lambda does not).
- **submit, result** — same transaction shape, condition `currentYear >= :y AND :y >= 0` (though
  `y < 0` and `y > currentYear` are cheap to reject in application code before ever touching
  DynamoDB, using the `currentYear` already in hand from the role-resolution read).
- **advance** — resolve role *first* (host-hash match → roster token-hash match → `VIEW#` lookup →
  `BAD_TOKEN` if none match anything), mirroring `localTransport.ts`'s "authority first" ordering —
  a non-host must learn nothing about the room's year from the shape of the refusal. Then **one**
  conditional `Update` on the header: condition `currentYear = :expected AND currentYear <= yearCount
  AND hostTokenHash = :h`. On `ConditionalCheckFailedException`, re-read
  (`ReturnValuesOnConditionCheckFailure: ALL_OLD`) and branch the same **four cases, in the same
  order**, that `localTransport.ts` spells out around line 612-632 — retry-success must be checked
  *before* `GAME_COMPLETE`, or the last advance of every game breaks (both look identical —
  `currentYear > yearCount` — and only the caller's `expectedYear` tells them apart).
- **read** — `BatchGetItem [header, VIEW#hash(token)]` resolves every role in one round trip, then a
  role-keyed `Query`: host → `begins_with R#` (every team's results), player/viewer → `begins_with
  D#<teamId>#` (its own team's decisions), anonymous → header alone. **Every read uses
  `ConsistentRead: true`** — `keys.ts` explains why at length: a stale query behind a freshly-bumped
  `rev` would make a poller believe it has already seen an item it hasn't, permanently.
  *(⚠ A player/viewer also needs `begins_with R#<teamId>#`, its own results: `lastResult` is that
  payload. And header first, items second, never in parallel.)*
- **Every mutating endpoint's response also needs a full `RoomView`** (every team's
  `resultsByYear`), not just the acting team's — the contract check asserts this directly off a
  `submit` response, not only off a subsequent `read` (see `session-contract-check.ts` around line
  397-422, "the opening position" block). So every endpoint's response-building step pays for the
  same `begins_with R#` query that `read`'s host branch already pays for. No endpoint becomes more
  expensive than `read`'s existing worst case — it's just paid uniformly now.
  *(⚠ Correction 1: wrong. That block reads the player's OWN team. Responses are role-keyed
  exactly as `read` is.)*
No GSI anywhere — `keys.ts` is explicit that the handlers must not read through one (a GSI cannot be
read strongly consistently, and the whole design leans on strong consistency).

### Verification, in order

1. `npm run typecheck` — new files should type-check under the existing config unchanged.
2. `npx tsx scripts/tools/session-contract-check.ts` — unchanged, still however many/however many
   assertions pass against `localStorage` and the HTTP stub. Confirms nothing regressed in files
   this work doesn't touch.
3. `npx tsx scripts/tools/session-contract-check.ts --dynamo` (or `npm run contract:dynamo`) — the
   same assertions, unmodified, now also run in-process against `DynamoSessionTransport` and over
   HTTP through `handler.ts`, against DynamoDB Local in Docker. **This is the real acceptance test**
   — if this passes, the Lambda satisfies the contract.
4. `npm run build:handler` — confirms the esbuild+zip step produces a loadable
   `dist-lambda/handler.zip` (`index.js` exporting `handler`) before anyone wires it into a deploy
   pipeline.
None of this needs live AWS credentials or touches real AWS resources — it's all local
(DynamoDB Local via Docker).

*(⚠ Add, between 3 and 4: `npm run contract:races`. Step 3 passing does not prove the conditions
— the 144 stayed green with each of them removed. And use `npm run contract:built` for step 4, so
the zip itself runs the 144.)*

---

## Next steps (after the handler passes its own contract check)

Everything below is from the guide's own "what we need back" checklist (section 11) and is
**blocked on the handler above existing** — don't start these first.

- [ ] **The CI/CD pipeline** (`.github/workflows/handler.yml`) — build-once-promote: build the zip
  on a commit to `aws`, store it as a `build-<sha>` GitHub pre-release (not a workflow artifact —
  those expire), deploy it to `ripple-session` via OIDC role `ripple-deploy-review` in a job
  declaring `environment: review`. A second job, gated on a `v*` tag push and `environment: prod`,
  promotes the *same* stored zip (never a rebuild) to `ripple-session-prod` via
  `ripple-deploy-prod`. The guide has a full skeleton workflow to adapt (don't hand-roll from
  scratch) — get it from Mike/Tige. **Have the "run tests, typecheck and the contract harness" PR
  job invoke `npm run contract:dynamo`, not just the no-flag pass** — that's the one that actually
  exercises DynamoDB semantics. *(⚠ And `npm run contract:races`, for the reason above.)*
- [ ] **`.github/CODEOWNERS`** — routes `/.github/workflows/` and `/infra/` to the project lead
  (and Mike, for `/infra/`). Needs real GitHub usernames — ask Tige.
- [ ] **Tell Mike which CI checks to require** on `aws`/`release`, once the workflow above exists,
  so he can wire them into the branch-protection rulesets (`protect-aws`, `protect-release`,
  `protect-tags` — all admin-side, his to create).
- [ ] **`/infra/ripple-backend.yaml`** — once Mike sends a generated CloudFormation template from
  the existing review resources, turn it into a reusable one: an `Env` parameter
  (`review`/`prod`/`test`) used in every resource name, parameterized CORS/throttling/tags,
  `AWS::AccountId`/ARN references instead of hard-coded account IDs, `DeletionPolicy: Retain` +
  deletion protection on the table, the Lambda's code left as a placeholder (the pipeline deploys
  the real code, not CloudFormation). CDK/Terraform instead of CloudFormation is fine if preferred
  — use the review resources as the spec either way.
- [ ] **The `release` branch** — doesn't exist yet (checked: not on the remote). Needed before any
  prod front-end deploy can happen (Amplify builds `release` for the `Ripple-Prod` app).
- [ ] **A decision on runtime API config for the front end** (guide section 9, optional) — today
  `VITE_SESSION_API` is baked in at build time, so the front end can't be build-once-promoted like
  the handler; `release` must only ever receive commits already tested on `review` until/unless this
  changes. Not required to ship review+prod, just worth a conscious yes/no rather than drifting into
  it.
- [ ] *(added)* **The function's environment:** `TABLE_NAME` (required; the handler answers a
  retryable 500 without it rather than crashing) and `ROOM_RETENTION_SEC` (optional; placeholder
  default seven days). Handler setting `index.handler`, runtime Node 22, either architecture.
- [ ] *(added)* **keys.ts HARD 1 before the planned event.** 25–45 teams posting results in the
  burst after each advance is between "occasional" and "sustained" header contention. The
  handler retries `TransactionConflict` with jitter, which absorbs the occasional case. Nothing has
  measured the sustained one.

Rules that apply throughout (guide section 10, worth restating since they bite easily): no AWS keys
in GitHub, ever — OIDC roles only. No hard-coded table names/URLs/account IDs in the handler — read
`TABLE_NAME` from the environment, same rule `keys.ts` already states. Don't add `amplify.yml`
without telling Mike first (overrides his console build settings). Never deploy to prod during a
rehearsal or a real session — a mid-game change puts teams on different builds and the same seed
then gives different numbers.
