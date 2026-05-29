// Mobile gating barrel. Screens (and sibling tasks self-wiring their own
// gates, e.g. T-GR-COMMUNITY-FLYWHEEL) import from here.

export { useEntitlement, type EntitlementState } from './entitlement.js';
export { useGate, useLimitGate, type GateState } from './useGate.js';
export {
  Gate,
  GateSkeleton,
  UpgradePrompt,
  MOBILE_UPGRADE_ROUTE,
  type GateProps,
  type UpgradePromptProps,
} from './Gate.js';
export { describeGate, FEATURE_LABELS, type UpgradeCopy } from './copy.js';
