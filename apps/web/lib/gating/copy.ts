// Upgrade-prompt copy. Pure (no React) so it's unit-testable and shared by
// the web `<UpgradePrompt>`. Mirrored conceptually on mobile.
//
// Tone follows `rules/10-paywall-billing.md`: "a clear, non-shaming upgrade
// flow". No dark patterns, no guilt — just name the feature and the value.

import type { PaidFeature } from '@binderly/entitlements';
import type { GateBlockReason } from '@binderly/feature-flags';

/** Human label for each pro feature (title-case, UI-facing). */
export const FEATURE_LABELS: Readonly<Record<PaidFeature, string>> = {
  stack_scanner: 'Stack scanning',
  grading_prediction: 'Grading prediction',
  unlimited_custom_collections: 'Unlimited custom collections',
  save_smart_collections: 'Saved smart collections',
  unlimited_shareables: 'Unlimited shareables',
  shareable_themes: 'Shareable themes',
  pricing_history: 'Price history & graphs',
  export_data: 'Export (CSV / JSON)',
  cloud_ai_scan: 'Cloud-AI scan fallback',
};

export interface UpgradeCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * Build the upgrade-prompt copy for a blocked gate. `free_limit_reached`
 * leans on the numeric `limit`; `requires_pro` is a flat on/off message.
 */
export function describeGate(
  feature: PaidFeature,
  reason: GateBlockReason,
  limit?: number,
): UpgradeCopy {
  const label = FEATURE_LABELS[feature];
  if (reason === 'free_limit_reached') {
    const capText =
      typeof limit === 'number'
        ? `Your free plan includes up to ${limit}.`
        : 'Your free plan has a limit here.';
    return {
      title: 'Upgrade to Pro',
      body: `${capText} Upgrade to Pro for ${label.toLowerCase()}.`,
    };
  }
  return {
    title: 'Upgrade to Pro',
    body: `${label} is a Pro feature. Upgrade to unlock it.`,
  };
}
