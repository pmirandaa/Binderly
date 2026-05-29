// Web gating barrel. Feature screens (and sibling tasks self-wiring their
// own gates) import from `@/lib/gating`.

export {
  GATING_ENTITLEMENT_QUERY_KEY,
  readGatingEntitlement,
  useEntitlement,
  type EntitlementState,
} from './entitlement';

export { useGate, useLimitGate, type GateState } from './useGate';

export {
  BILLING_HREF,
  Gate,
  GateSkeleton,
  UpgradePrompt,
  type GateProps,
  type GateResult,
  type UpgradePromptProps,
} from './Gate';

export { describeGate, FEATURE_LABELS, type UpgradeCopy } from './copy';
