# T-BE-AUTH — Supabase Auth (Google / Apple / Discord / magic link) + profile provisioning

**Stage:** 02-backend
**Agent role:** backend
**Effort:** M (~half day)
**Status:** in_review

---

## Hard dependencies

- `T-DL-RLS-POLICIES` (merged) — provides the `profile` + `subscription`
  tables, their RLS posture, the `auth.users(id)` cross-schema FKs, and the
  `verify-rls` harness this task extends.

## Soft dependencies

- `T-BE-API-CONTRACTS` (parallel sibling, in flight) — defines wire
  shapes. We do **not** import `@binderly/api-contracts` from
  `@binderly/auth`; auth-internal types (`AuthClaims`,
  `AuthenticatedSession`, `ProvisionedProfile`) live in this package's
  `src/types.ts`. The downstream `T-BE-API-CLIENT` task (later in
  Phase 2) is what stitches the two together.

## Required reading

- `PROJECT.md` § 5 (Auth & Accounts), § 6 (Data Model), § 16 (Freemium)
- `rules/02-backend.md` (this stage's hard rules)
- `context/data-model.md` § "User tables → profile / subscription"
- `context/secrets-and-env.md` § "Auth providers"
- `context/conventions.md` (TS strict, error shape, file layout)
- `infra/supabase/config.toml` (already ships Google/Apple/Discord
  blocks via `T-FN-SUPABASE-LOCAL` — this task does **not** modify it)
- `packages/db/src/schema/profile.ts` + `subscription.ts` (the tables
  this task auto-provisions)
- `packages/db/src/migrations/0001_users_rls.sql` +
  `0012_profile_grants_fix.sql` (the existing RLS + GRANT posture)
- `packages/db/scripts/verify-rls/{assertions,inventory}.ts` (this task
  extends the behavioral matrix with trigger-driven provisioning
  assertions)

## Goal

Ship the **server-side** auth surface for Binderly: a typed
`@binderly/auth` package that wraps `@supabase/supabase-js` with the
project's discriminated-union error shape and ergonomic helpers
(`requireUser`, `getSessionFromRequest`, `createUserScopedClient`,
`createServiceRoleClient`, `provisionProfile`), plus a
Postgres-trigger-driven auto-provisioning of the application-level
`profile` + `subscription` rows so that by the time any signup
transaction commits, the app-side row state is already consistent.
Local dev for all four providers (Google, Apple, Discord, magic link)
is documented end-to-end against the Supabase CLI stack
(`pnpm db:start`) and Inbucket. Real OAuth credentials are Pablo-only
and stay out of the repo.

This task is a server-side cap; the **client-side** login surfaces
(web form, mobile screen, post-redirect callback handling) are owned
by `T-W-AUTH` and `T-M-AUTH` and are explicitly **out of scope** here
(see § Out of scope).

## Deliverables

### `packages/auth/` (new workspace package — `@binderly/auth`)

- `packages/auth/package.json` — workspace package; `main` / `types` /
  `exports` set per Q-004 (mirrored from `@binderly/db`).
- `packages/auth/tsconfig.json` — extends `@binderly/tsconfig/library`,
  emits to `dist/` (composite + declarations on, matches `@binderly/db`
  shape).
- `packages/auth/eslint.config.js` — extends
  `@binderly/eslint-config/node`, ignores `dist/`, `coverage/`,
  `__test__/`. Test files relax `@typescript-eslint/no-explicit-any` +
  `no-console` (mirrors `data-pipeline`'s posture).
- `packages/auth/vitest.config.ts` — node env, `src/**/*.test.ts`,
  v8 coverage.
- `packages/auth/README.md` — what the package is, what it isn't,
  paste-able usage examples for Edge Functions and server-side
  callers.
- `packages/auth/src/index.ts` — public barrel; the only file
  external consumers may import from.
- `packages/auth/src/types.ts` — internal types (`AuthClaims`,
  `AuthenticatedSession`, `AuthError`, `ProvisionedProfile`,
  `RequireUserOptions`).
- `packages/auth/src/errors.ts` — typed `AuthError` discriminated
  union (`{ code: 'missing_token' | 'invalid_token' | 'expired_token' | 'no_profile' | 'service_unavailable', message: string, cause?: unknown }`)
  matching `context/conventions.md` § "Error handling".
- `packages/auth/src/jwt.ts` — token extraction (`extractBearerToken`)
  from a `Headers` / `Request` object plus a typed wrapper around
  `supabase.auth.getUser(jwt)`.
- `packages/auth/src/clients.ts` — `createUserScopedClient(jwt, env)`
  (anon-key + Authorization header pass-through, RLS-honoring) and
  `createServiceRoleClient(env)` (BYPASSRLS, service-role key,
  used **only** for elevated paths like profile back-fill).
- `packages/auth/src/session.ts` — `getSessionFromRequest(request, env)`
  and `requireUser(request, env, options?)` — the canonical server-side
  authentication primitives. `requireUser` returns
  `{ user, claims, supabase }` on success and throws a typed `AuthError`
  on failure.
- `packages/auth/src/profile.ts` — `provisionProfile(serviceClient, userId)`:
  the application-level safety net behind the DB-trigger primary path.
  Idempotent; only inserts if the row is missing. Used by code that
  wants belt-and-braces guarantees (e.g. after-the-fact backfills,
  manual admin tooling). Returns `ProvisionedProfile`.
- `packages/auth/src/env.ts` — typed loader of the four env vars this
  package consumes (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, optional `SUPABASE_JWT_SECRET` for
  symmetric-secret validation paths).
- `packages/auth/src/jwt.test.ts` — token-extraction + `getUser` mock
  scenarios.
- `packages/auth/src/session.test.ts` — happy-path, missing-token,
  expired-token, malformed-token, missing-profile.
- `packages/auth/src/profile.test.ts` — provisioning idempotency:
  insert-when-missing, no-op-when-present.
- `packages/auth/src/clients.test.ts` — header pass-through assertion;
  service-role-vs-user separation.

### `infra/supabase/auth/` (new directory — provider-config docs)

- `infra/supabase/auth/README.md` — index of the four sub-docs.
- `infra/supabase/auth/redirect-urls.md` — the canonical allow-list of
  OAuth redirect URLs per environment (dev / staging / prod) and how
  to plug them into Supabase Studio + `config.toml`.
- `infra/supabase/auth/google.md` — paste-able recipe for creating a
  Google OAuth client + scopes (`email`, `profile`, `openid`) +
  redirect URL wiring.
- `infra/supabase/auth/apple.md` — Sign-In-with-Apple specifics:
  Services ID, key ID, team ID, the per-key signed-JWT secret, the
  six-month rotation note, scopes (`email`, `name`).
- `infra/supabase/auth/discord.md` — Discord OAuth client + the
  required `email` + `identify` scopes.
- `infra/supabase/auth/magic-link.md` — local Inbucket workflow + the
  prod SMTP swap-in points (`[auth.email.smtp]` block in
  `config.toml`).
- `infra/supabase/auth/local-dev.md` — paste-able workflow for Pablo:
  start the stack, sign in via magic link against Inbucket, sign in
  via Google with localhost callback, expected env-var posture.

### Repo-shared additions

- `.env.example` — append a new `# ===== AUTH PROVIDERS — REDIRECT
  URLS / CLIENT IDS =====` section (provider client IDs as REQUIRED
  blanks; redirect URLs documented). Touches the existing
  `# ===== AUTH PROVIDERS =====` block additively (sectioned-barrel
  discipline; no edits to lines owned by other tasks).
- `pnpm-workspace.yaml` — **no edit needed**: the `packages/*` glob
  already auto-includes `packages/auth/`.

### Database (additive migration)

- `packages/db/src/migrations/0017_profile_provisioning_trigger.sql` —
  `AFTER INSERT ON auth.users` trigger that creates the matching
  `profile` + `subscription` rows. Owns the trigger function
  `public.handle_new_user()` (`SECURITY DEFINER`, pinned `search_path`,
  fully-qualified table names). Idempotent (`ON CONFLICT DO NOTHING`).
- `packages/db/src/migrations/meta/_journal.json` — append `0017`
  entry.
- `packages/db/scripts/verify-rls/assertions.ts` — extend the
  behavioral matrix with two new assertions:
    - `behavior:trigger created profile row for new auth.users`
    - `behavior:trigger created subscription row with tier=free for new auth.users`
  Also remove the now-redundant manual `INSERT INTO public.profile`
  fixture (the trigger does it for us; manual insert would conflict
  on PK). Existing assertions about `profile` visibility still pass
  unchanged.

> Touching `packages/db/` is outside this task's `owns_paths`. The
> orchestrator authorized this in the dispatch prompt (the migration +
> verify-rls extension are explicitly listed as in-scope work) and the
> sibling `T-BE-API-CONTRACTS` task does not write to these files. The
> "Notes from execution" appendix below records this for the review
> trail.

### `dependencies.yaml`

- Flip `T-BE-AUTH.status` from `in_progress` to `review`.

## Acceptance criteria

- [ ] `@binderly/auth` ships with `main` / `types` / `exports`
      pointing into `dist/` — Q-004 posture mirrored.
- [ ] `extractBearerToken` handles all of: present + valid, present +
      malformed (no `Bearer ` prefix), absent — typed via
      `AuthError`.
- [ ] `requireUser` returns `{ user, claims, supabase }` for a valid
      token and throws `AuthError` (`code: 'missing_token' | 'invalid_token' | 'expired_token'`)
      otherwise. The returned `supabase` client is the **user-scoped**
      one (RLS-honoring), never the service-role client.
- [ ] `createUserScopedClient(jwt, env)` produces a Supabase client
      whose `Authorization: Bearer <jwt>` header is forwarded on
      every PostgREST call (verified in `clients.test.ts` against a
      mocked `fetch`).
- [ ] `createServiceRoleClient(env)` produces a Supabase client keyed
      with the service-role key — separate code path, no accidental
      user-token leakage.
- [ ] `provisionProfile` is idempotent: calling it twice for the same
      `userId` does not error and does not duplicate rows.
- [ ] Migration `0017` creates `public.handle_new_user()` and the
      `on_auth_user_created` AFTER INSERT trigger on `auth.users`.
- [ ] Inserting a row into `auth.users` (via the verify-rls behavioral
      transaction) results in exactly one `public.profile` row and
      one `public.subscription` row (`tier='free'`) for that
      `user_id` — covered by the two new behavioral assertions.
- [ ] Existing verify-rls assertions still pass (no regression in the
      structural / policy-inventory / behavioral suite). Run gated on
      a live Supabase connection — Phase 1 convention is that the
      verifier is "skipped" (exit 2) when no DB is available, which
      is the default in CI.
- [ ] Vitest suite has at least: 1 happy-path, 1 missing-token, 1
      expired-token, 1 malformed-token, 1 missing-profile,
      1 idempotent-provision case. ≥ 8 tests total across the four
      `*.test.ts` files.
- [ ] `pnpm --filter @binderly/auth format:check / lint / typecheck /
      test / build` all exit 0.
- [ ] `pnpm --filter @binderly/db format:check / lint / typecheck`
      all exit 0 (db package edits validate clean).
- [ ] Repo-wide `pnpm format:check` and `pnpm lint` are clean.
- [ ] `.env.example` contains the new auth section with **no real
      secrets** — only documented blanks tagged `# REQUIRED` for
      production wiring.
- [ ] `infra/supabase/auth/local-dev.md` contains a paste-able recipe
      that gets a magic-link sign-in working against Inbucket and
      documents the Google-via-localhost callback path.

## Out of scope

Explicitly **not** shipped here; tracked elsewhere:

- Client-side auth UI (login forms, callback pages, session listeners)
  — `T-W-AUTH` (web), `T-M-AUTH` (mobile).
- The typed API client that wires `@binderly/auth` into web + mobile
  — `T-BE-API-CLIENT`.
- Edge Functions for auth-elevated server flows (e.g. completion
  view recompute) — `T-BE-EDGE-FUNCTIONS`.
- Real OAuth client IDs / secrets (Google, Apple, Discord) — Pablo
  ships these in `.env.local`; this task only wires the **shapes**.
- Apple's per-key signed-JWT secret rotation tooling — documented but
  not automated (six-month manual rotation is the v1 posture).
- Captcha (`hcaptcha` / `turnstile`) — defer to a later abuse-mit
  task; magic-link rate-limit posture is handled by Supabase's
  `[auth.rate_limit]` defaults today.
- MFA / TOTP — out of scope for v1 per `PROJECT.md` § 5.
- Anonymous sign-ins, third-party providers (Firebase, Auth0, Cognito)
  — disabled in `config.toml`.

## Branch & PR

- Branch: `agent/T-BE-AUTH`
- PR title: `T-BE-AUTH: Supabase Auth wiring (Google / Apple / Discord / magic link) + profile provisioning`
- Commit format: Conventional Commits (`feat(auth):`, `feat(db):`,
  `docs(infra):`, etc.). Phase 1 elaboration commits separately as
  `docs(tasks): elaborate T-BE-AUTH`.

## Escalation triggers

Stop and surface to orchestrator if:

- Real OAuth credentials are required to satisfy an acceptance
  criterion (the task is explicitly designed to ship without them).
- The DB-trigger profile-provisioning approach proves infeasible on
  Supabase CLI 2.98.1 / PG17 (e.g. `auth.users` triggers are blocked
  by an unexpected privilege check) — fall back to **Option 3**
  (application-level lazy creation in `provisionProfile`) and
  document. This is the deliberate fallback path.
- A change is needed in `apps/` (the app workspaces don't exist yet
  in Phase 2 — they're created by Phase 4 / Phase 5 tasks).
- A change is needed in `packages/shared-types/` (owned by the
  parallel sibling `T-BE-API-CONTRACTS` — coordinate via the
  orchestrator, do not import from it).

## Phase-1 elaboration decisions (recorded for the PR body)

1. **Module structure:** the project uses `packages/auth/` per
   `rules/02-backend.md` line 43-44 ("Auth helpers in `packages/auth/`
   — wrap supabase-js with our error shape and small ergonomic
   helpers"). No `apps/api/` server is planned — Supabase + Edge
   Functions cover the backend surface. Confirmed against
   `PROJECT.md` § 3 (Tech Stack) which lists Supabase as the managed
   backend and Python on Fly.io for heavy services only.
2. **Server vs. client scope split:** this task ships the
   **server-side** auth surface only. Client-side flows (login form
   UX, redirect callback rendering, session listeners, biometric
   re-auth on mobile) live in `T-W-AUTH` / `T-M-AUTH`. The
   `@binderly/auth` package is consumed by:
   (a) Edge Functions (`T-BE-EDGE-FUNCTIONS`) for `requireUser`-style
       server-side gating; (b) future Next.js Route Handlers and
       Server Actions in `apps/web/`; (c) the typed API client
       (`T-BE-API-CLIENT`) which threads tokens through to the user-
       scoped Supabase client this package builds.
3. **Profile-provisioning approach:** **Option 1 (Postgres trigger
   on `auth.users` INSERT)** — the most robust of the three options
   the orchestrator surfaced. Trigger fires inside the signup
   transaction, so the profile + subscription rows are guaranteed to
   exist by the time any client first authenticates. Application-
   level `provisionProfile` ships as a belt-and-braces safety net
   that's idempotent (`ON CONFLICT DO NOTHING` mirrored in the SQL
   path). Rejected: webhook-via-Edge-Function (extra latency, network
   fragility); pure application-level lazy creation (race window
   where a fresh sign-in can find no profile, particularly in mobile
   sync flows).
4. **Handle generation:** `'u_' || substr(replace(NEW.id::text, '-',
   ''), 1, 12)`. 12-hex-char suffix yields ~2.8 trillion combos —
   collision-free at our scale and never leaks PII (UUIDs are
   opaque). Users edit their handle later via the app UI (not in
   this task's scope).
5. **Subscription provisioning:** trigger creates a row with
   `tier='free'`. Webhook tasks (`T-BE-EDGE-FUNCTIONS` for RC /
   Paddle) flip `tier='pro'` and populate `source` /
   `external_customer_id` later. The free row is the always-on
   ground state.
6. **JWT validation pattern:** `Authorization: Bearer <token>` →
   `extractBearerToken` → `supabase.auth.getUser(token)`. We rely on
   Supabase's JWT verification rather than re-implementing JWKS
   fetch / signature checking. This is the canonical Supabase
   server-side pattern and matches Edge Function templates.
7. **Magic-link config:** Supabase OTP under `[auth.email]` already
   ships in `config.toml` with `enable_signup = true` and Inbucket
   as the local SMTP backend. Production swaps in real SMTP via
   `[auth.email.smtp]` (documented, not automated). Cooldown +
   rate-limit posture inherits Supabase defaults
   (`[auth.rate_limit] email_sent = 2/h`, `token_verifications =
   30/5min`); we do not change them.
8. **Apple Sign-In:** the per-key signed-JWT secret
   (`SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`) is generated by Pablo from
   the Services ID + key ID + team ID + p8 private key. The recipe
   is in `infra/supabase/auth/apple.md`; the secret rotates every
   six months (Apple constraint). No real keys, p8 files, team IDs,
   or service IDs ship in this PR.
9. **Sign-out + token refresh:** the SDK handles both client-side.
   Server-side helpers respect expired tokens by returning
   `AuthError({ code: 'expired_token' })` — no rotation logic
   server-side. Documented in the README.
10. **Tests:** Vitest unit tests with mocked `@supabase/supabase-js`
    clients + synthetic JWTs. We don't spin up a live Supabase per
    test — the integration coverage lives in the verify-rls
    behavioral suite (which DOES touch a real Postgres) and in the
    future E2E layer.
11. **Local-dev story:** `pnpm db:start` → magic-link via Inbucket
    (port 54324) just works; Google requires a real OAuth client ID
    + secret in `.env.local` and the localhost callback URL
    `http://localhost:54321/auth/v1/callback` allow-listed in the
    Google Cloud Console. Apple requires a real Services ID +
    signed-JWT secret. Discord requires a real OAuth client ID +
    secret. All three documented in `infra/supabase/auth/*.md`.

## Notes from execution

- **Out-of-`owns_paths` edits (authorized in dispatch prompt):** the
  task touches three files outside `packages/auth/` and
  `infra/supabase/auth/`:
  1. `packages/db/src/migrations/0017_profile_provisioning_trigger.sql`
     — the new auto-provisioning migration (Phase 1 elaboration
     decision § 3).
  2. `packages/db/src/migrations/meta/_journal.json` — the
     drizzle-kit metadata appendix for the new migration.
  3. `packages/db/scripts/verify-rls/assertions.ts` — extends the
     behavioral suite with the two trigger-coverage assertions
     and removes the now-redundant manual `INSERT INTO public.profile`
     fixture (the trigger does it for us).
  4. `.env.example` — adds three forward-compat `*_CLIENT_ID` env
     vars and expands the auth section's documentation block.
  5. `dependencies.yaml` — flips this task's status from
     `in_progress` to `review` and clears the `stub: true` flag.
     No conflict with the parallel sibling `T-BE-API-CONTRACTS`
     (which owns `packages/shared-types/`).
- **Final test counts:** `@binderly/auth` ships **43 tests** across
  five `*.test.ts` files (env / errors / jwt / clients / session /
  profile). Verify-rls grows by **2 assertions**; not exercised in
  CI without a live Supabase, gated as "skipped" with exit 2 per
  the existing convention.
- **`drizzle-kit generate` was NOT used** for migration 0017 — the
  hand-authored SQL is safer than letting drizzle-kit emit a
  trigger-and-function pair (drizzle has no model for these).
  Pattern matches the other hand-authored RLS migrations
  (`0001_users_rls.sql`, `0007_grading_rls.sql`, etc.).
- **`tsx` IPC pipe EPERM under sandbox** still blocks
  `pnpm --filter @binderly/db db:migrate` in this environment;
  the migration was validated by hand-reading + by structurally
  matching the existing migration shape. Pablo runs the verify-rls
  suite post-merge to confirm end-to-end.
- **`@supabase/supabase-js` pinned at `2.105.3`** (the latest stable
  at PR open). Engines field `>= node 20` is satisfied by the
  repo's pinned Node 22.
