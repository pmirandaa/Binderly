// Mobile gating hooks. Mirror the web surface (`apps/web/lib/gating/`):
// thin wrappers feeding the resolved entitlement state into
// `@binderly/feature-flags`' pure decision core.
//
// Fail-closed: `useEntitlement()` resolves to free while loading/errored,
// so the returned `GateResult` is always defined. `isLoading` lets the UI
// hold a skeleton instead of flashing the prompt.

import type { CountLimitedResource, PaidFeature } from '@binderly/entitlements';
import { evaluateGate, evaluateLimitGate, type GateResult } from '@binderly/feature-flags';

import { useEntitlement } from './entitlement.js';

/** A resolved gate verdict plus the loading flag for skeleton handling. */
export interface GateState {
  readonly result: GateResult;
  readonly isLoading: boolean;
}

/** On/off pro gate for `feature`. */
export function useGate(feature: PaidFeature): GateState {
  const { tier, isLoading } = useEntitlement();
  return { result: evaluateGate({ tier }, feature), isLoading };
}

/**
 * Count-aware gate: "may this user create one more of `resource`, given
 * `currentCount` already exist?" Pro is unbounded; free is capped at
 * `FREE_LIMITS[resource]`.
 */
export function useLimitGate(resource: CountLimitedResource, currentCount: number): GateState {
  const { tier, isLoading } = useEntitlement();
  return { result: evaluateLimitGate({ tier }, resource, currentCount), isLoading };
}
