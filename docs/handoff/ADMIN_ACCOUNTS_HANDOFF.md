# Admin accounts — AWS options for Mike

## Status

**Built: Option B, the separate table and Lambda.** The client-side placeholder
(`localStorage`, per browser) is gone — `src/admin/` now holds a real, server-verified
admin-accounts backend: `ripple-admins` (a new DynamoDB table, pk-only, two item shapes —
accounts and login sessions), `ripple-admin` (a new Lambda, `src/admin/server/handler.ts`),
real password hashing (`node:crypto` `scrypt`, salted, no new dependency), and a real
revocable bearer token with a 30-day expiry (`ADMIN_SESSION_TTL_SEC`, placeholder figure).
Self-protection (you cannot disable or delete your own account) is now enforced
server-side, not just hidden in the UI.

`src/session/client/adminAuth.ts` moved to `src/admin/client/adminAuth.ts` — same seven
function signatures, now calling the real backend instead of `localStorage`. No screen that
calls it (`AdminLoginModal`, `AdminScreen`, `LobbyScreen`, `HostScreen`) needed any change
beyond its import path, which was the whole point of having made those functions `async`
ahead of time.

Verified locally against DynamoDB Local (`npm run contract:admin`, no AWS credentials
needed) and the build (`npm run build:admin-handler`). **Nothing is deployed yet** — that's
what's below.

---

## The message to Mike

> We're adding real (server-verified) admin accounts, replacing a client-side placeholder.
> Two ways to build it; this is what each costs you specifically, not just us.
>
> **Option A — extend what already exists**
>
> Admin data lives in `ripple-sessions`, admin endpoints live in `ripple-session`, same
> API Gateway, same everything.
>
> What you'd need to do: **almost nothing.** The existing Lambda role already has full
> access to `ripple-sessions` — no IAM change. The infra template already collapsed the
> five session routes into one integration and one wildcard Lambda permission
> (`.../*/*/*`), so new routes like `/adminLogin` don't need a new permission either —
> just new `AWS::ApiGatewayV2::Route` entries, which we'd add to `infra/ripple-backend.yaml`
> and you'd apply the same way you already do (review, then your throwaway `Env=test`
> proof, then prod). No new table, no new Lambda, no new deploy role.
>
> Trade-off worth knowing about: admin account data and game-room data end up in one
> table and one function. If `ripple-session` ever needs tighter blast-radius limits (e.g.
> a security review asking "what can this function touch"), the answer gets broader.
>
> **Option B — separate Lambda, separate table**
>
> A new table (e.g. `ripple-admins`) and a new Lambda (e.g. `ripple-admin`), kept on the
> *same* API Gateway as today (no reason to stand up a second one — same domain, same CORS
> config) but with their own routes, their own integration, and their own Lambda
> permission.
>
> What you'd need to do:
> 1. Create the new DynamoDB table — same process as `ripple-sessions`, but **no TTL**:
>    admin accounts aren't ephemeral game data, they shouldn't expire.
> 2. Create a new IAM role (`ripple-admin-lambda-role`) scoped only to that table —
>    `ripple-session`'s role never touches it and vice versa.
> 3. Create `ripple-deploy-review`/`ripple-deploy-prod`-equivalent OIDC roles for the new
>    Lambda — same trust-policy setup you already did for `ripple-session` (the one that
>    hit the repo-name mismatch earlier — same pattern, so you've done this exact thing
>    once already).
> 4. Add the new routes + a new integration + a new Lambda permission to the API Gateway.
> 5. A new CloudWatch log group, same 30-day retention as today's.
>
> Trade-off: more to stand up and maintain (a second table, function, role, and deploy
> pipeline target), but a real, cleaner security boundary — nobody who can touch game
> sessions can touch admin accounts, and nobody who can touch admin accounts can touch
> game sessions.
>
> **Our ask:** which one do you want to provision? Either way, the actual endpoint code
> and the CI/CD wiring is on us — this is specifically about what lands on your side.

---

## What Mike needs to do now

Mike asked five things before settling on an approach; answers below, then his own proposal
(a single template, `infra/ripple-admin.yaml`) — which is what got built.

1. **The admin table's key design.** `pk` only, no sort key, two flat item shapes (see
   `src/admin/server/dynamo.ts`): `ADMIN#<username, lowercased>` for an account (username,
   salted/hashed password, disabled, createdAt), `SESSION#<sha256(token)>` for a login
   (username, `expiresAtSec`).
   ⚠ **Correction to "no TTL this time":** TTL should be **on**, on `expiresAtSec` — same
   attribute name as `ripple-sessions`. Accounts never carry that attribute, so they're
   never swept and effectively don't expire, exactly as asked — but login *sessions* do
   carry it (a 30-day default, `ADMIN_SESSION_TTL_SEC`), and that's exactly the ephemeral
   thing TTL exists for. Leaving TTL off wouldn't be a security hole (the handler checks
   the expiry itself regardless of whether DynamoDB's sweep is on), it would just mean
   expired sessions pile up in the table forever instead of being cleaned up.
2. **The admin routes** — eight, all `POST`, all `AWS_PROXY` to the one Lambda: `/adminLogin`,
   `/adminLogout`, `/currentAdmin`, `/createAdminAccount`, `/listAdminAccounts`,
   `/setAdminDisabled`, `/deleteAdminAccount`, `/resetAdminPassword`.
3. **Lambda settings** — Node.js 22, arm64, 512 MB, 10-second timeout, same as
   `ripple-session`. One required environment variable, `ADMIN_TABLE_NAME`; one optional,
   `ADMIN_SESSION_TTL_SEC` (defaults to 30 days in code — not set by the template; change it
   by setting the variable, not by editing CloudFormation).
4. **No secret needed.** Admin tokens are opaque random strings looked up by their SHA-256
   hash as a DynamoDB item — the same pattern the game backend already uses for host/player/
   viewer tokens — not a signed token (JWT or similar). There's nothing to sign and nothing
   secret to provision; no Secrets Manager, no extra permission.
5. **The first admin account** — `scripts/tools/seed-default-admin.ts`, run once per
   environment with real AWS credentials: `ADMIN_TABLE_NAME=ripple-admins-review npx tsx
   scripts/tools/seed-default-admin.ts`. Writes directly to the table (conditioned on the
   username not already existing) and prints a generated password exactly once. There's no
   API that creates the first account without already holding one, on purpose.

**His own proposal, built as asked:** one template, `infra/ripple-admin.yaml`, two
parameters — `Env` (`review`/`prod`, used in every name: `ripple-admins-review`,
`ripple-admin-prod`, etc. — every name suffixed, review included, since nothing here
pre-exists the way review's session resources did) and `ApiId` (the session API to add
routes to — `l1g9kw9swc` for review, `slb9jb7bt0` for prod). Per environment it creates the
table (deletion protection on, no TTL *at the account level* — see the correction above —
point-in-time recovery in prod only), a role scoped to only that table, the Lambda with
placeholder code, a 30-day log group, and the eight routes with their own integration and
permission on the given API. Both environments can be built from it — nothing here needs
creating by hand on either side.

**Also needed on the Amplify side:** a new `VITE_ADMIN_API` environment variable (the same
API's invoke URL `VITE_SESSION_API` already points at — these routes live on it too), once
the routes exist.
