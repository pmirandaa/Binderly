# `@binderly/feature-flags`

The **framework-agnostic free/pro gating decision core**. Given a resolved
entitlement and a paid feature (or a count-limited resource + current count),
it returns a `GateResult` the UI renders as either "let the action through"
or "show the upgrade prompt, with this reason".

Built on `@binderly/entitlements`' pure helpers (`canUseFeature`,
`withinFreeLimit`) so the client-side verdict is **identical** to the
server's authoritative enforcement — same inputs, same pure functions.

Owned by [`T-PB-GATING`](../../tasks/10-paywall-billing/T-PB-GATING.md).

## What's in the box

| Export | Purpose |
| ------ | ------- |
| `evaluateGate(entitlement, feature)` | On/off pro gate → `GateResult`. |
| `evaluateLimitGate(entitlement, resource, count)` | Count-aware gate (custom collections, shareables) → `GateResult`. |
| `resourceToFeature(resource)` | Map a `CountLimitedResource` to its `unlimited_*` `PaidFeature`. |
| `isAllowed(result)` | Boolean narrowing for `disabled={!isAllowed(r)}` call sites. |
| `GateResult`, `GateAllowed`, `GateBlocked`, `GateBlockReason`, `GateEntitlement` | The verdict types. |

`Tier`, `PaidFeature`, `CountLimitedResource`, and `FREE_LIMITS` still come
from `@binderly/entitlements` — this package re-exports the *verdict* types
only.

## `GateResult`

```ts
type GateResult =
  | { allowed: true }
  | { allowed: false; reason: 'requires_pro' | 'free_limit_reached';
      feature: PaidFeature; limit?: number };
```

- `requires_pro` — an on/off pro feature on the free tier. No `limit`.
- `free_limit_reached` — a count-limited resource at/over its free cap.
  `feature` is the matching `unlimited_*` capability; `limit` is the free
  allowance (`FREE_LIMITS[resource]`).

## Fail-closed is the caller's job

This core is a **total pure function** of its inputs — there is no
loading/error/unknown state in here. "Unknown / loading / error → treat as
free (gates closed)" is enforced in the platform glue: the hooks coerce a
missing or degraded entitlement read to `{ tier: 'free' }` before calling
`evaluateGate`. That keeps the decision logic deterministic and trivially
testable while still satisfying the rule that a flash never over-grants.

## Consumption (web + mobile)

Both platforms wrap this with TanStack-Query-backed hooks reading
`client.entitlements.getMyEntitlements()`:

- **Web** — `apps/web/lib/gating/`: `useGate(feature)`,
  `useLimitGate(resource, count)`, `<Gate>`, `<UpgradePrompt>` (CTA →
  `/billing`).
- **Mobile** — `apps/mobile/src/lib/gating/`: same hook surface + Tamagui
  `<Gate>` / `<UpgradePrompt>` (CTA → the billing/paywall surface).

### Integration for sibling tasks (self-wiring gates)

Sibling tasks that own their own gate sites import the **platform hook**
(not this package directly) and branch on the result. For example, a web
feature gating on `shareable_themes`:

```tsx
import { useGate } from '@/lib/gating';

function ThemePicker() {
  const gate = useGate('shareable_themes');
  if (!gate.allowed) return <UpgradePrompt reason={gate.reason} feature={gate.feature} />;
  return <RealThemePicker />;
}
```

- **T-SH-THEMES** (`apps/web/app/c/themes/`): gate on `shareable_themes` via
  the web `useGate`.
- **T-GR-COMMUNITY-FLYWHEEL** (`apps/mobile/src/grading/community/`): gate on
  `grading_prediction` (or a dedicated flywheel feature if added to the
  canonical union) via the mobile `useGate`.

T-PB-GATING deliberately does **not** wire gates inside sibling owns_paths;
it ships the clean hook + this doc so they self-wire and we reconcile at
merge.

## Tests

```bash
pnpm --filter @binderly/feature-flags test
```

Covers `evaluateGate` (every feature × both tiers, result shape),
`evaluateLimitGate` (boundaries 0/1/2/3/4 for custom collections, 0/1/2 for
shareables, pro-unbounded, defensive negative/NaN counts), `resourceToFeature`
mapping, and the `isAllowed` narrowing helper.
