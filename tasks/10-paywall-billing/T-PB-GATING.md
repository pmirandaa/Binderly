# T-PB-GATING — Free vs paid feature gating across web and mobile

**Stage:** 10-paywall-billing
**Agent role:** frontend-web
**Effort:** M

## Hard dependencies

- T-PB-ENTITLEMENTS (merged) — `@binderly/entitlements` (canonical `Tier`,
  9-entry `PaidFeature`, `FREE_LIMITS`, `canUseFeature`, `withinFreeLimit`),
  `GET /v1/me/entitlements` edge function, `entitlementsDto`, and the typed
  api-client resource `client.entitlements.getMyEntitlements()`.

## Soft dependencies / parallel-safe coordination

- **T-SH-THEMES** (iter 34, owns `apps/web/app/c/themes/`) and
  **T-GR-COMMUNITY-FLYWHEEL** (iter 34, owns `apps/mobile/src/grading/community/`
  + `apps/api-python/grading/flywheel/`) both consume the `@binderly/feature-flags`
  gate hook. This task **exports a clean, documented hook** and does **not**
  wire gates inside their owns_paths. They self-wire on their side.

## Required reading

- PROJECT.md § 16 (Freemium plan — the free/pro matrix)
- rules/10-paywall-billing.md (gating semantics; server is source of truth,
  client gates are UX, fail-closed)
- packages/entitlements/README.md + src (the foundation to import, not redefine)
- apps/mobile/src/billing/ (RC SDK hooks + 8-entry union to reconcile)
- apps/web/lib/paddle/ + apps/web/app/billing/ (web upgrade-prompt destination)

## Goal

Ship enforced free-vs-paid feature gating across web and mobile, consuming the
unified entitlement service. Every pro-only capability in the § 16 freemium
matrix gets an enforced client gate with a consistent upgrade-prompt UX.
RevenueCat is the source of truth; tier is read via
`GET /v1/me/entitlements` and gating is **fail-closed** (unknown/loading/error
→ treat as free, gates closed). This closes the functional side of Stage 10.

## Deliverables

- `packages/feature-flags/` — new shared package `@binderly/feature-flags`.
  Framework-agnostic pure decision core built on `@binderly/entitlements`:
  - `evaluateGate(entitlement, feature): GateResult` where
    `GateResult = { allowed: true } | { allowed: false, reason:
    'requires_pro' | 'free_limit_reached', feature, limit? }`.
  - `evaluateLimitGate(entitlement, resource, currentCount): GateResult` for
    count-aware gates (custom collections, shareables).
  - No React/RN dependency. Pure + fully unit-tested.
- `apps/web/lib/gating/` — web glue:
  - `useGate(feature)` + `useLimitGate(resource, currentCount)` hooks
    (TanStack Query reads `getMyEntitlements()`, fail-closed on loading/error).
  - `<Gate feature={...}>` + `<UpgradePrompt>` (consistent CTA → `/billing`).
- `apps/mobile/src/lib/gating/` — mobile glue:
  - Equivalent `useGate` / `useLimitGate` + native `<Gate>` / `<UpgradePrompt>`
    (Tamagui), routing the upgrade CTA to the mobile billing/paywall surface.
  - Migrate `apps/mobile/src/billing/`'s 8-entry `PaidFeature` union to
    re-export from `@binderly/entitlements` (9-entry canonical); fix renamed
    call sites.
- Gate wiring at the enumerated web + mobile pro-feature sites NOT owned by
  siblings.

## Acceptance criteria

- [ ] `@binderly/feature-flags` pure gating core; tests cover every feature ×
      tier + every limit boundary (2/3, 3/3, pro-unbounded; 0/1, 1/1). 35+ tests.
- [ ] Web glue hooks + `<Gate>` / `<UpgradePrompt>`, fail-closed; 25+ tests.
- [ ] Mobile glue hooks + components, fail-closed; 25+ tests.
- [ ] Gates wired at the enumerated pro-feature sites (those not owned by
      siblings). Gate-presence regression tests where practical.
- [ ] Mobile billing union migrated to the canonical 9-entry
      `@binderly/entitlements` union; broken call sites fixed.
- [ ] All suites + lint + typecheck + build green locally.
- [ ] No changes outside `owns_paths` except gate-check wiring at the existing
      feature screens (documented in the PR).

## Out of scope

- Server-side enforcement (already shipped in T-PB-ENTITLEMENTS + edge fns).
- The shareable-themes gate wiring (T-SH-THEMES self-wires with the exported hook).
- The grading-community flywheel gate wiring (T-GR-COMMUNITY-FLYWHEEL self-wires).
- Cloud-AI scan fallback feature itself (not built; just reserve the gate).
- Building a net-new mobile paywall screen (route the CTA to the existing surface).

## Branch & PR

- Branch: `agent/T-PB-GATING`
- PR title: `feat(billing): T-PB-GATING — free/pro feature gating across web + mobile`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:
- Gate-site wiring requires editing screens owned by a live sibling.
- A gating decision is genuinely a product call (e.g. retroactive downgrade of
  over-limit resources on cancellation).

## Notes from execution
_(empty until the sub-agent runs)_
