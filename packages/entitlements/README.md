# `@binderly/entitlements`

The **single canonical answer** to "is this user free or pro, and what
can they do?" — shared by web, mobile, and the Supabase edge runtime.

RevenueCat (RC) is the unified entitlement **store**: Paddle webhooks
feed it on web (T-PB-PADDLE), and the mobile RC SDK feeds/reads it on
device (T-PB-REVENUECAT). This package is the canonical **read path**
that sits on top of RC, plus the shared feature model both billing
surfaces should converge on.

Owned by [`T-PB-ENTITLEMENTS`](../../tasks/10-paywall-billing/T-PB-ENTITLEMENTS.md).

## What's in the box

| Module | Exports | I/O? |
| ------ | ------- | ---- |
| `model.ts` | `Tier`, `PaidFeature`, `ALL_PAID_FEATURES`, `FREE_LIMITS`, `PRO_ENTITLEMENT_ID`, `EntitlementSource` | none (pure data + types) |
| `can.ts` | `canUseFeature(tier, feature)`, `withinFreeLimit(tier, resource, count)` | none (pure) |
| `revenuecat-client.ts` | `readEntitlement(opts)`, `featuresForTier(tier)`, `isProEntitlementActive(payload, nowMs)` | one `fetch` (RC REST) |

Import everything from the barrel: `import { ... } from '@binderly/entitlements'`.

## The canonical feature model (PROJECT.md § 16)

`Tier` is `'free' | 'pro'`. There is **no per-feature SKU** — a single
RevenueCat entitlement, `'pro'` (`PRO_ENTITLEMENT_ID`), unlocks every
paid feature. `PaidFeature` is the pro-only capability surface drawn
directly from the PROJECT.md § 16 matrix:

```
stack_scanner                 grading_prediction
unlimited_custom_collections  save_smart_collections
unlimited_shareables          shareable_themes
pricing_history               export_data
cloud_ai_scan
```

Count-based free allowances live in `FREE_LIMITS`:

```ts
FREE_LIMITS = { customCollections: 3, shareables: 1 }
```

`withinFreeLimit('free', 'customCollections', 2)` → `true` (2/3, may
create one more); at `3` → `false`. Pro is always `true`.

### Reconciliation with the merged mobile union

`apps/mobile/src/billing/types.ts` (T-PB-REVENUECAT) shipped an 8-entry
`PaidFeature` union with slightly different names. **This list (from the
spec matrix) is canonical and wins.** The rename map:

| mobile (`apps/mobile/src/billing/types.ts`) | canonical (here) |
| ------------------------------------------- | ---------------- |
| `unlimited_custom_collections` | `unlimited_custom_collections` ✅ |
| `unlimited_shareables` | `unlimited_shareables` ✅ |
| `stack_scanner` | `stack_scanner` ✅ |
| `grading_prediction` | `grading_prediction` ✅ |
| `pricing_graphs` | `pricing_history` |
| `export_csv` | `export_data` |
| `remove_branding` | `shareable_themes` |
| `cloud_ai_scan_fallback` | `cloud_ai_scan` |
| _(absent)_ | `save_smart_collections` (added — § 16 "Smart collections (saved)" is pro-only) |

Migrating `apps/mobile/src/billing/` to re-import this union (instead of
redefining it) is **T-PB-GATING's** job, not this task's — this package
ships first so GATING can wire it.

## Intended consumption

- **Edge function** (`GET /v1/me/entitlements`): calls `readEntitlement`
  server-side with the `REVENUECAT_SECRET_API_KEY` and the authed user
  id as the RC `app_user_id`, then returns `{ tier, activeFeatures,
  source, checkedAt }`. The production Deno bundle cannot import this
  workspace package (supabase deploys bundle only the function source +
  the `deno.jsonc` import-map), so the handler **mirrors** the small RC
  parse logic — exactly like `_shared/contracts.ts` mirrors
  `@binderly/api-contracts`. The drift is covered by a mirror test.
- **Web + mobile gating** (T-PB-GATING): import `canUseFeature` /
  `withinFreeLimit` and call them at every gate site. Reads come through
  the typed api-client (`client.entitlements.getMyEntitlements()`).
- **Both billing surfaces**: should eventually import `PRO_ENTITLEMENT_ID`
  + `PaidFeature` from here so there is one definition.

## Fail-closed by design

`readEntitlement` **never throws**. Any failure — missing/empty secret
key, network error, non-200 status, malformed body, unexpected shape —
resolves to:

```ts
{ tier: 'free', source: 'fallback', activeFeatures: [], checkedAt, error }
```

Why fail to **free** rather than throw or fail to pro:

- An RC outage must not 500 the whole app. Returning a value keeps every
  caller alive.
- Withholding paid features for a few seconds during an RC blip is
  strictly safer than accidentally granting pro to everyone (revenue +
  abuse) — paid features are the safe thing to withhold.
- `source: 'fallback'` lets callers log/annotate "degraded" without
  changing control flow; `error` carries the reason for logs only (never
  surfaced to end users).

### New users

RevenueCat's `GET /v1/subscribers/{app_user_id}` lazily returns an empty
subscriber for an id it has never seen (HTTP 200, empty `entitlements`).
So a brand-new user with no purchase reads as **free** with
`source: 'revenuecat'` — no explicit subscriber-creation step is
required, and no product decision is pending. (If RC ever changes that
contract, the fail-closed path already covers the error case as free.)

## Tests

```bash
pnpm --filter @binderly/entitlements test
```

Covers `canUseFeature` (every feature × both tiers), `withinFreeLimit`
(boundaries 2/3, 3/3, 0/1, 1/1, pro-unbounded, defensive counts), and
the RC client (active/expired/absent pro, malformed payload, non-200,
network error → fallback, request shape, `isProEntitlementActive`
parse unit cases). `fetch` is injected — no live RC calls.
