# T-PB-REVENUECAT — RevenueCat SDK integration (mobile)

**Stage:** 10-paywall-billing
**Agent role:** frontend-mobile
**Effort:** M
**Status:** in_progress

---

## Hard dependencies

- T-M-AUTH (merged) — supplies the Supabase user id we hand to RevenueCat
  as `appUserID`, plus the `useAuth()` context the lazy initializer
  hooks into.

## Soft dependencies

- T-PB-PADDLE (parallel iter 32) — paired billing surface on web.
  Both sides must agree on the entitlement-id string (`'pro'`).
  Documented inline in `entitlements.ts`.
- T-PB-ENTITLEMENTS (next iter) — reads the RC entitlements API as
  the unified source of truth across web + mobile. The hook surface
  shipped here is its initial mobile-side consumer contract.
- T-PB-GATING (next iter) — swaps the existing free-tier gates in
  the 4 feature screens onto `usePaidFeature(...)`. **Out of scope
  for this task.**

## Required reading

- `PROJECT.md` § 3 (Tech stack table — RevenueCat + Paddle rationale)
- `PROJECT.md` § 9 (Custom & Smart Collections — free/paid gating)
- `PROJECT.md` § 16 (Freemium plan)
- `rules/10-paywall-billing.md` (stage rules)
- `apps/mobile/src/components/providers/AuthProvider.tsx` (the
  `useAuth()` contract the lazy initializer hooks into)
- `apps/mobile/src/lib/env.ts` (Expo `EXPO_PUBLIC_*` env loader
  pattern)
- `apps/mobile/src/test-utils/setup.ts` (vitest mock posture this
  module's tests reuse)

## Goal

Wire RevenueCat's mobile SDK (`react-native-purchases`) into the
Expo app as the mobile billing surface. Ship a lazy initializer
that defers `Purchases.configure(...)` until auth is ready, four
typed TanStack-Query-based hook surfaces (offerings, purchase,
entitlements, restore), and a graceful no-key dev-mode degradation
so the codebase keeps running for contributors without RevenueCat
credentials. The output of this task is what T-PB-ENTITLEMENTS
will read from to derive the unified `tier` across web + mobile,
and what T-PB-GATING will plug the 4 feature screens into.

## Deliverables

- `apps/mobile/src/billing/init.ts` — lazy `Purchases.configure(...)`
  driven by the auth-ready event; in-memory stub fallback when env
  keys are missing. Logs a single warning, never crashes.
- `apps/mobile/src/billing/offerings.ts` — `useOfferings()` TanStack
  Query hook over `Purchases.getOfferings()`; 5-minute cache; clear
  typed sentinel when SDK isn't configured.
- `apps/mobile/src/billing/purchase.ts` — `purchasePackage(pkg)`
  with typed result discriminated union (`success` /
  `cancelled` / `pending` / `payment_invalid` / `network_error` /
  `error`). Optimistically updates the entitlements query cache on
  success.
- `apps/mobile/src/billing/entitlements.ts` — `useEntitlementsQuery()`
  + `usePaidFeature(feature)` hook returning the derived
  `'free' | 'pro'` tier and a strongly-typed paid-feature flag.
- `apps/mobile/src/billing/restore.ts` — `restorePurchases()` for
  App Store compliance.
- `apps/mobile/src/billing/types.ts` — strict types for offerings,
  packages, entitlements, customer info, purchase result variants,
  and the dev-mode sentinel.
- `apps/mobile/src/billing/sdk.ts` — thin adapter over
  `react-native-purchases` so the rest of the module talks to a
  stable, mockable shape (`PurchasesAdapter`).
- `apps/mobile/src/billing/index.ts` — barrel export.
- `apps/mobile/src/billing/__tests__/*` — at least 40 vitest tests
  covering: lazy init, idempotency, sign-out logout, offerings
  fetch + cache + sentinel, purchase success/cancel/error variants,
  entitlement derivation (free/pro/expired/multiple-active),
  restore flow, and the `usePaidFeature` mapping.
- `apps/mobile/package.json` — add `react-native-purchases`
  dependency (current stable major). Lockfile dirty by design;
  orchestrator handles the parallel-merge dance per task brief.
- `apps/mobile/.env.example` — document
  `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and
  `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (commented; absence is the
  documented dev-mode default).
- `apps/mobile/README.md` — append the two RC env keys to the env
  table; document the dev-mode graceful-degrade behaviour.
- `apps/mobile/app.json` — no changes expected; `react-native-purchases`
  autolinks via Expo's Continuous Native Generation. If the native
  build later turns out to need an `expo-build-properties` shim or
  config plugin, raise Q-020 (next free Q number) instead of
  guessing.

## Acceptance criteria

- [ ] `apps/mobile/src/billing/` ships exactly the seven source
      modules + `__tests__/` listed under Deliverables.
- [ ] `Purchases.configure(...)` is invoked **lazily** — never at
      module import time — and only after the mobile auth state
      resolves with a non-null `user.id`. Anonymous sessions
      configure with no `appUserID`.
- [ ] When `EXPO_PUBLIC_REVENUECAT_IOS_KEY` /
      `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` are both unset, the
      module logs a single `console.warn` and returns the dev-mode
      stub adapter: all queries resolve to "free tier, no
      entitlements"; offerings resolve to `null` (sentinel).
- [ ] `useOfferings()` returns the current offering with strict
      `PurchasesOffering`-shaped types, caches for 5 minutes
      (TanStack `staleTime`), refetches on focus.
- [ ] `purchasePackage(pkg)` returns a discriminated union covering
      `success` (with `entitlementId`), `cancelled`,
      `payment_pending` (Google Play), `payment_invalid`,
      `network_error`, and `error` (with message). Type guards
      ship for each variant.
- [ ] `useEntitlementsQuery()` returns
      `{ activeEntitlements, tier }` where `tier === 'pro'` iff
      `activeEntitlements['pro']` exists and is not expired (per
      RC's `EntitlementInfo.isActive` + `expirationDate` semantics).
      Otherwise `tier === 'free'`.
- [ ] `usePaidFeature(feature)` returns `true` iff `tier === 'pro'`,
      for `feature ∈ { 'unlimited_custom_collections',
      'unlimited_shareables', 'stack_scanner', 'grading_prediction',
      'pricing_graphs', 'export_csv', 'remove_branding',
      'cloud_ai_scan_fallback' }` (full v1 surface per
      `PROJECT.md § 16`).
- [ ] On successful purchase the entitlements query cache is
      optimistically populated so the rest of the app sees the new
      entitlement immediately (no server round-trip required).
- [ ] `restorePurchases()` calls `Purchases.restorePurchases()` and
      surfaces a typed result.
- [ ] On sign-out, `Purchases.logOut()` runs and the module resets
      to anonymous mode.
- [ ] At least **40 vitest tests** pass under
      `pnpm --filter @binderly/mobile test`. `react-native-purchases`
      is mocked via `vi.mock` at module level inside `__tests__/`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`,
      `pnpm --filter @binderly/mobile test` all pass locally.
- [ ] No diff outside `apps/mobile/src/billing/`,
      `apps/mobile/package.json`, `apps/mobile/.env.example`,
      `apps/mobile/README.md` (env table only),
      `apps/mobile/app.json` (if a minimal additive plugin entry
      proves necessary), `pnpm-lock.yaml`, this task file, and
      `dependencies.yaml` + `status.md` (orchestrator post-merge).
- [ ] The entitlement-id string contract (`'pro'`) is documented
      inline in `entitlements.ts` for T-PB-PADDLE to read at merge.

## Out of scope

- Modifying the existing free-tier gates in `apps/mobile/src/screens/`
  (T-PB-GATING owns that).
- Web-side billing surface (T-PB-PADDLE owns Paddle).
- The unified entitlement service / server-side enforcement
  (T-PB-ENTITLEMENTS owns the next-iter cross-platform layer plus
  the api-client `entitlements` resource).
- Native build configuration (App Store Connect product ids,
  Google Play Billing setup, EAS Dev Client rebuild). The SDK is
  added to the JS bundle; native re-linking happens on the next
  EAS Dev Client build.
- Paywall UI screens, upgrade prompts, settings tab integration —
  those are downstream T-PB-GATING / future paywall-UI tasks.
- API-client `entitlements.ts` resource shim — only ship if the
  parallel T-PB-PADDLE worker discovers it's needed at merge time;
  current scope keeps the mobile hooks self-contained.

## Branch & PR

- Branch: `agent/T-PB-REVENUECAT`
- PR title (Conventional Commits per task brief):
  `feat(mobile): T-PB-REVENUECAT — RevenueCat SDK integration + entitlements hooks`
- Worktree: `/Users/pmiranda/Stuff/binderly-wt-T-PB-REVENUECAT`
- Merge: `gh pr merge --auto --squash --delete-branch`

## Escalation triggers

Stop and surface to orchestrator if:

- The free/paid feature matrix in `PROJECT.md § 16` is found to
  diverge meaningfully from the in-code consumers — log Q-020
  (next free Q; coordinate at merge with parallel workers).
- `react-native-purchases` turns out to require an Expo config
  plugin or `expo-build-properties` block that conflicts with the
  current Expo Router shell — log Q-021.
- A required dependency turns out to be wrong/missing.
- A change is needed outside the declared `owns_paths` list above.
- An acceptance criterion conflicts with `PROJECT.md`.

## Notes from execution

_(empty until the sub-agent runs)_
