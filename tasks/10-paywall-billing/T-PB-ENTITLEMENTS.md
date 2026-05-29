# T-PB-ENTITLEMENTS — Unified entitlement service (RC as source of truth)

**Stage:** 10-paywall-billing
**Agent role:** backend
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-PB-REVENUECAT (merged iter 32 — mobile RC SDK + `PRO_ENTITLEMENT_ID`
  + the 8-entry `PaidFeature` union in `apps/mobile/src/billing/`)
- T-PB-PADDLE (merged iter 32 — web Paddle checkout + HMAC webhook →
  `forwardEntitlement` RC REST write path in `apps/web/lib/paddle/`)

## Soft dependencies

- _(none)_

## Required reading

- `PROJECT.md` § 16 (Freemium plan — the canonical free/pro matrix)
- `PROJECT.md` § 3 (tech-stack: RevenueCat + Paddle) and the
  `subscription` model note (~line 188)
- `rules/10-paywall-billing.md`
- `apps/mobile/src/billing/entitlements.ts` + `types.ts` (existing
  client-side RC read + the mobile `PaidFeature` union we reconcile)
- `apps/web/lib/paddle/revenuecat.ts` (the RC REST **write** path) +
  `entitlements.ts` + `plans.ts`
- `packages/api-contracts/src/auth.ts` (`subscriptionTierSchema`) +
  `packages/api-client/src/resources/profile.ts` (typed resource pattern)
- `infra/supabase/functions/` (`_shared/` dispatch/auth/routes-table +
  `deno.jsonc` import-map + the standalone vitest harness)

## Goal

RevenueCat is the unified entitlement store (Paddle webhooks feed it on
web; the mobile SDK reads it directly). T-PB-REVENUECAT and T-PB-PADDLE
both **write** to RC; this task ships the canonical **read** path so the
question "is this user free or pro, and what can they do?" has one
answer shared by web, mobile, and the server. It delivers a shared
`@binderly/entitlements` package (canonical feature model + pure gate
helpers + a resilient RC REST read client) and a `GET /v1/me/entitlements`
Edge endpoint, surfaced through the typed api-client. This unblocks
T-PB-GATING (UI enforcement), T-SH-THEMES (pro-gated themes), and
T-GR-COMMUNITY-FLYWHEEL (pro grading).

## Deliverables

- `packages/entitlements/` — new shared package:
  - `src/model.ts` — `Tier`, the canonical `PaidFeature` union (from
    § 16), `ALL_PAID_FEATURES`, `FREE_LIMITS`, `PRO_ENTITLEMENT_ID`.
  - `src/can.ts` — pure `canUseFeature(tier, feature)` +
    `withinFreeLimit(tier, resource, currentCount)`.
  - `src/revenuecat-client.ts` — typed wrapper over RC REST
    `GET /v1/subscribers/{app_user_id}`; parses `entitlements.pro`;
    fail-closed `{ tier: 'free', source: 'fallback', error }` on any
    network/parse/non-200 error (never throws).
  - `src/index.ts` barrel, `package.json`, `tsconfig.json`,
    `eslint.config.js`, `vitest.config.ts`, `.prettierignore`,
    `README.md`.
  - `src/*.test.ts` — 40+ vitest cases.
- `packages/api-contracts/src/entitlements.ts` — `entitlementsDto`
  (`{ tier, activeFeatures, source, checkedAt }`) + barrel export.
- `packages/api-client/src/resources/entitlements.ts` —
  `getMyEntitlements()` resource + wired into `createClient`.
- `infra/supabase/functions/_shared/handlers/entitlements.ts` +
  route in `routes-table.ts` + optional RC env in `db.ts`/`dispatch.ts`
  — `GET /v1/me/entitlements` (env-missing → free fallback, 200, never
  500) + co-located test.

## Acceptance criteria

- [ ] `@binderly/entitlements` builds, exports the canonical model +
  pure helpers + RC read client; 40+ vitest tests pass under
  `pnpm --filter @binderly/entitlements test`.
- [ ] `GET /v1/me/entitlements` returns `entitlementsDto`; env-missing
  → `{ tier: 'free', source: 'fallback' }` with 200 (never 500);
  RC-active → pro; RC-error → free fallback. Tested in the Edge-fn suite.
- [ ] `entitlements` resource + DTO added to api-client + api-contracts
  (typed `getMyEntitlements()`), tested.
- [ ] `pnpm lint` / `typecheck` / `build` / package test / edge-fn test
  all green locally.
- [ ] No changes outside `owns_paths` except the additive api-client +
  api-contracts surface and the Edge `_shared/` integration (the merged
  Edge functions are a single `v1` mux, not per-name dirs — path
  divergence from the stub is documented in the PR).

## Out of scope

- Refactoring `apps/mobile/src/billing/` to import the hoisted union
  (that is T-PB-GATING).
- UI gate enforcement, `packages/feature-flags`, paywall screens.
- Writing to RC (owned by T-PB-REVENUECAT / T-PB-PADDLE).
- The web `subscription`-table read path (`apps/web/lib/paddle/`).

## Branch & PR

- Branch: `agent/T-PB-ENTITLEMENTS`
- PR title: `feat(billing): T-PB-ENTITLEMENTS — unified entitlement service (RevenueCat source of truth)`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to the orchestrator (append a Q to `open-questions.md`)
if:
- The merged mobile/web models can't be reconciled into one canonical
  `PaidFeature` union without breaking a shipped surface.
- `rules/10-paywall-billing.md` and PROJECT.md § 16 specify materially
  different entitlement ids / gating models.
- RC REST requires a subscriber-creation step before a read succeeds
  (brand-new user) and treat-as-free vs lazy-create is a product call.

## Notes from execution
_(appended by the sub-agent — see bottom of file)_
