# T-PB-PADDLE — Paddle MoR checkout + webhook → RevenueCat entitlements (web)

**Stage:** 10-paywall-billing
**Agent role:** frontend-web
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-W-AUTH (merged) — web sign-in / sign-out / session provider; `/billing`
  reuses `<AuthProvider>` + `<ProtectedRoute>`.

## Soft dependencies

- T-PB-REVENUECAT — sibling mobile worker; coordinate the entitlement-id
  string (`'pro'`) so a Paddle web purchase grants the same RC entitlement
  iOS/Android purchases grant. Disjoint paths.
- T-PB-ENTITLEMENTS (next iter) — server-side unified entitlement read
  endpoint backed by RevenueCat's REST API. This task ships a
  graceful-fallback adapter that defaults to `'free'` until that endpoint
  exists, with a TODO marker pointing at T-PB-ENTITLEMENTS.

## Required reading

- `PROJECT.md` § 3 (Tech stack — Paddle MoR rationale), § 16 (Freemium
  matrix), § 9 (3-custom-collection cap).
- `rules/10-paywall-billing.md` (server-is-source-of-truth, RC unified
  entitlement key, no hardcoded prices).
- `apps/web/components/providers/AuthProvider.tsx` (deferred-init Supabase
  pattern that prevents `next build` static-prerender crashes).
- `apps/web/lib/auth/protected-route.tsx` (declarative auth gate).
- `apps/web/lib/api-client.ts` (typed api-client singleton).
- `apps/web/lib/env.ts` (typed env loader; degrade-don't-crash on missing
  optional keys).
- `packages/api-contracts/src/auth.ts` (`subscriptionDto`,
  `subscriptionTierSchema`, `subscriptionSourceSchema`).
- Paddle Billing v2 docs (`developer.paddle.com`) — webhook signature
  verification (HMAC-SHA256 over `ts:body`), `customData` field on
  `Paddle.Checkout.open()`.
- RevenueCat Paddle integration guide (rev.cat/docs/web/integrations/paddle):
  Paddle is the billing engine + MoR, RC tracks/grants entitlements. The
  REST `POST /v1/subscribers/{app_user_id}/entitlements/{ent_id}/promotional`
  endpoint is the server-side grant path.

## Goal

Pablo lives in Chile, where Stripe doesn't onboard sellers. Paddle is the
chosen Merchant of Record (handles global tax compliance) and has a
first-class RevenueCat integration. This task ships the **web side** of
the unified billing surface: a `/billing` page that reads the user's
current tier, opens a Paddle overlay checkout for the offered plans, and
a server webhook that validates Paddle's HMAC-SHA256 signatures and
forwards entitlement grants to RevenueCat — which is the unified
entitlement source of truth for both web (this task) and mobile
(T-PB-REVENUECAT). Every code path degrades gracefully when env vars are
missing so `next build` never fails on a partially-configured CI env.

## Deliverables

### Billing page (`apps/web/app/billing/`)

- `apps/web/app/billing/page.tsx` — server entry, `force-dynamic`.
- `apps/web/app/billing/BillingRoute.tsx` — auth gate + lazy api wiring,
  mirrors `CollectionRoute.tsx`.
- `apps/web/app/billing/BillingView.tsx` — main UI. Renders current tier,
  plan list, "Subscribe" button per plan, success/error toasts.
- `apps/web/app/billing/BillingPlanCard.tsx` — single-plan card.
- `apps/web/app/billing/SignInPrompt.tsx` — local sign-in prompt
  (sister to collection's; nextPath = `/billing`).
- `apps/web/app/billing/__tests__/` — view, plan card, route tests.

### Paddle library (`apps/web/lib/paddle/`)

- `apps/web/lib/paddle/env.ts` — `loadPaddleEnv()` returning a discriminated
  `PaddleEnv | { kind: 'unconfigured', missing: string[] }`. Never throws.
- `apps/web/lib/paddle/plans.ts` — typed plan catalog. Maps Paddle price
  ids → plan name → RevenueCat entitlement id (`'pro'`). Documented as
  the single source of truth shared with T-PB-REVENUECAT's
  `entitlements.ts`.
- `apps/web/lib/paddle/signature.ts` — `verifyPaddleSignature(rawBody,
  header, secret, opts?)`. Uses `node:crypto` + `timingSafeEqual`.
  Returns `{ ok: true, ts } | { ok: false, reason }`.
- `apps/web/lib/paddle/events.ts` — `mapPaddleEvent(event)`: takes the
  parsed webhook payload, returns `{ kind: 'grant' | 'revoke' |
  'ignore', userId, entitlementId, expiresAt }`.
- `apps/web/lib/paddle/revenuecat.ts` — `forwardEntitlement(action, deps)`:
  thin REST wrapper around RevenueCat's
  `POST /v1/subscribers/{userId}/entitlements/{entId}/promotional`
  (grant) and `POST .../revoke_promotionals` (revoke). Injectable
  `fetch` for tests.
- `apps/web/lib/paddle/log.ts` — `recordWebhookLog(deps, row)`: wraps the
  Supabase service-role client `INSERT` into `paddle_webhook_log`.
  Failures here never throw (audit log isn't worth re-running the
  webhook).
- `apps/web/lib/paddle/client.ts` — `loadPaddle()` + `openCheckout()`
  thin wrappers around `@paddle/paddle-js`'s `initializePaddle` /
  `paddle.Checkout.open()`. Lazy-imports the SDK so SSR doesn't bundle
  the browser-only library.

### Webhook (`apps/web/app/api/paddle/webhook/route.ts`)

- POST handler.
- Reads raw body (App Router `request.text()`) so signature verification
  sees the bytes Paddle signed, not a JSON-roundtripped reconstruction.
- 503 + clear log when `PADDLE_WEBHOOK_SECRET` is unset.
- 401 on missing / invalid signature. 401 on parse failure of the
  signed body.
- 200 + `processed: false` audit log entry on unrecognised events
  (so Paddle stops retrying).
- For grant / revoke events: calls `forwardEntitlement` against
  RevenueCat. RC failure → still returns 200, logs `processed: false`
  with `error` + `retry: true` so a future reconciliation job can
  pick it up.

### Database (`packages/db/src/migrations/`)

- `0023_paddle_webhook_log.sql` — `paddle_webhook_log` table. (At merge
  time, if T-SH-CONFIG-MODEL has already shipped its own `0023_*.sql`,
  rebase to `0024_*.sql` per `dependencies.yaml` migration-coordination
  protocol.)
- `0024_paddle_webhook_log_rls.sql` (or `0025_*` depending on rebase) —
  service-role-only RLS posture, mirrors the `data_conflict` posture.
- `packages/db/src/schema/paddle_webhook_log.ts` — Drizzle schema.
- `packages/db/src/schema/index.ts` — barrel export added in the
  T-PB-PADDLE section.
- `packages/db/scripts/verify-rls/inventory.ts` — append
  `paddle_webhook_log` to `EXPECTED_TABLES` and
  `NO_PERMISSIVE_POLICY_TABLES`.

### Env config

- `apps/web/.env.example` — append documented (commented-out) entries
  for the four Paddle keys, the two public price ids, and the
  RevenueCat secret API key.

## Acceptance criteria

- [ ] `/billing` renders for an authenticated user. Renders sign-in
      prompt for an unauthenticated visitor (no crash).
- [ ] Billing page renders a friendly "Billing isn't configured in this
      environment" placeholder when public Paddle env vars are missing.
- [ ] Plan list comes from `lib/paddle/plans.ts` config; nothing
      hardcoded inside the view.
- [ ] Clicking "Subscribe to Pro" calls the Paddle SDK's
      `openCheckout({ items, customData })` with the correct price id
      and `customData.userId = supabase user id`.
- [ ] After Paddle's overlay closes successfully, the entitlements
      TanStack-Query is invalidated so the UI flips to "Pro" without
      waiting for the webhook.
- [ ] Webhook returns 401 on missing signature.
- [ ] Webhook returns 401 on invalid signature (wrong secret + tampered
      body + replay outside tolerance window all rejected).
- [ ] Webhook returns 503 when `PADDLE_WEBHOOK_SECRET` is unset.
- [ ] Webhook returns 200 + recognised event mapped to a RevenueCat
      grant for `subscription.created`, `subscription.activated`,
      `transaction.completed`.
- [ ] Webhook returns 200 + RevenueCat revoke for
      `subscription.canceled`, `subscription.past_due`,
      `subscription.paused`. `subscription.resumed` re-grants.
- [ ] Webhook returns 200 + `retry: true` audit row on RevenueCat
      downstream failure.
- [ ] Migration `0023_paddle_webhook_log.sql` (or rebased) lands and
      `pnpm --filter @binderly/db verify-rls` is green for the new
      table (RLS enabled, no permissive policy).
- [ ] 35+ vitest tests pass in `apps/web`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm --filter
      @binderly/web test`, `pnpm --filter @binderly/db verify-rls`
      all green locally.
- [ ] No changes outside `owns_paths` except: the migration files and
      schema barrel under `packages/db/`, the verify-rls inventory, and
      `apps/web/.env.example` — all explicitly authorized by the brief.

## Out of scope

- Mobile billing surface (`apps/mobile/src/billing/` is T-PB-REVENUECAT).
- Unified entitlement read endpoint (RC REST proxy) — that's
  T-PB-ENTITLEMENTS. We ship a `useEntitlements()` hook against the
  api-client's `subscription.get()` (existing) with a TODO marker.
- Free vs paid feature gating across surfaces — T-PB-GATING.
- Themed shareables (T-SH-THEMES).
- Paddle subscription management portal embed — Paddle ships its own
  customer portal URL; we surface a "Manage subscription" link only.
- Plan price strings — Paddle is the source of truth at checkout time;
  `plans.ts` only stores price IDs + display names.

## Branch & PR

- Branch: `agent/T-PB-PADDLE`
- PR title: `feat(web): T-PB-PADDLE — Paddle MoR checkout + webhook → RevenueCat entitlements`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:

- Paddle's webhook signature scheme has changed since the docs we read
  (today: `ts=...;h1=...` HMAC-SHA256 over `ts:body`).
- RevenueCat's promotional-grant REST endpoint is deprecated or
  fundamentally refactored.
- Pablo's Paddle account isn't on Paddle Billing v2 (Paddle Classic
  uses a different signature scheme — RSA, not HMAC).
- A change is needed outside `owns_paths` not already authorized
  by this elaborated brief (migrations, schema barrel, verify-rls
  inventory, `.env.example`).

## Notes from execution

_(Sub-agent appends here at end. Empty until then.)_
