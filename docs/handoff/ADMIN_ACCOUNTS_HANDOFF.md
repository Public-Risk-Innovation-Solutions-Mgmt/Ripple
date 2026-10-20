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

Everything buildable on our side is built and verified locally. The pipeline
(`.github/workflows/admin.yml`) will deploy nothing until these exist — same as how
`ripple-deploy-prod` sat unused until it was created for the session handler.

1. **`ripple-admins` / `ripple-admins-prod`** — a new DynamoDB table per environment. `pk`
   only (no sort key), string. Enable TTL on `expiresAtSec` after creation, same console
   step as `ripple-sessions`. No TTL is needed at the account level — only login sessions
   expire — but the table-level TTL setting applies to whichever items carry that attribute,
   so it's one setting either way.
2. **`ripple-admin-lambda-role` / `-prod`** — scoped *only* to the new table (`GetItem`,
   `PutItem`, `UpdateItem`, `DeleteItem`, `Scan`) — never `ripple-sessions`.
3. **`ripple-admin` / `ripple-admin-prod`** — new Lambda functions, Node 22, handler
   `index.handler`, same placeholder-code trick the session Lambda used before its first
   real deploy.
4. **`ripple-deploy-admin-review` / `ripple-deploy-admin-prod`** — new OIDC roles, same
   trust-policy pattern as `ripple-deploy-review`/`-prod` (the one that hit the repo-name
   mismatch earlier — check the org/repo name carefully this time too), scoped to
   `UpdateFunctionCode`/`GetFunction`/`GetFunctionConfiguration`/`PublishVersion` on the new
   functions only.
5. **Eight new routes on the existing `ripple-session-api`** (not a new API Gateway — same
   domain, same CORS config): `/adminLogin`, `/adminLogout`, `/currentAdmin`,
   `/createAdminAccount`, `/listAdminAccounts`, `/setAdminDisabled`, `/deleteAdminAccount`,
   `/resetAdminPassword`, each `AWS_PROXY` to the new Lambda.

**`infra/ripple-admin-backend.yaml` does all five**, parameterized by `Env`
(`review`/`prod`/`test`) and `ExistingApiId` (the session API's id) — same `Env=test`
throwaway-stack proof you already do for `ripple-backend.yaml`. It is a separate template
from that one on purpose, matching Option B's own boundary.

**Then, once per environment:** run `scripts/tools/seed-default-admin.ts` against the real
table (`ADMIN_TABLE_NAME=ripple-admins npx tsx scripts/tools/seed-default-admin.ts`) to
create the one bootstrap account — it prints a generated password exactly once. There is no
API that creates the first admin account without already holding one, on purpose.

**Also needed on the Amplify side:** a new `VITE_ADMIN_API` environment variable (the same
API's invoke URL `VITE_SESSION_API` already points at — these routes live on it too), once
the routes exist.
