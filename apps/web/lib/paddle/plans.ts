// Plan catalog — the single source of truth for the subscription
// plans Binderly offers on the web (Paddle MoR) side, and the
// mapping from Paddle price ids → RevenueCat entitlement ids.
//
// IMPORTANT: this file is **paired** with mobile's
// `apps/mobile/src/billing/entitlements.ts` (T-PB-REVENUECAT). Both
// must agree on the entitlement key. Per the task brief:
//
//   "Coordinate on the string used to identify the active 'pro'
//    entitlement. Default convention: 'pro'."
//
// If the entitlement key ever changes, update both files in lockstep
// and bump the migration / RC dashboard config.
//
// Pricing display: Paddle is the source of truth at checkout time;
// `displayPrice` here is a marketing-page label only, not the actual
// charge amount. Localised + currency-converted prices come from
// `Paddle.PricePreview()` (out of scope for v1 — we hardcode USD
// labels and document this in the README).

/**
 * RevenueCat entitlement id granted by the Pro plan. The "pro"
 * convention matches the RC default (most apps have a single
 * entitlement that unlocks everything).
 *
 * If this string ever changes, update `apps/mobile/src/billing/`
 * (T-PB-REVENUECAT) AND the RC dashboard's entitlement
 * configuration in lockstep.
 */
export const PRO_ENTITLEMENT_ID = 'pro';

export type PlanId = 'pro_monthly' | 'pro_annual';
export type BillingInterval = 'monthly' | 'annual';

export interface Plan {
  /** Stable internal id; used in URL fragments + analytics events. */
  readonly id: PlanId;
  /** Human-facing label rendered on the plan card. */
  readonly displayName: string;
  /**
   * Marketing-only price label. Paddle is the source of truth at
   * checkout — the customer sees the localised + tax-included amount
   * in the overlay. Avoid scary mismatches by keeping this label
   * conservative ("from $X/mo") rather than a precise wire number.
   */
  readonly displayPrice: string;
  /** One-line value-prop copy shown under the price. */
  readonly tagline: string;
  /** Bullet-list features rendered on the plan card. */
  readonly features: readonly string[];
  readonly interval: BillingInterval;
  /**
   * RevenueCat entitlement granted on successful purchase. v1 only
   * has `'pro'`, but the type stays general so adding a "platinum"
   * tier later is additive.
   */
  readonly entitlementId: string;
}

/**
 * Plan registry. Keep ordering deterministic: monthly first, annual
 * second (annual usually has a larger "save 20%" callout, so it sits
 * to the right and gets the recommended badge).
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'pro_monthly',
    displayName: 'Pro — Monthly',
    displayPrice: '$5.99 / month',
    tagline: 'Unlock the full Binderly toolkit, billed monthly.',
    features: [
      'Unlimited custom collections',
      'Unlimited saved smart collections',
      'Unlimited shareables (themed)',
      'Stack scanner + grading prediction',
      'Pricing graphs + CSV export',
    ],
    interval: 'monthly',
    entitlementId: PRO_ENTITLEMENT_ID,
  },
  {
    id: 'pro_annual',
    displayName: 'Pro — Annual',
    displayPrice: '$49 / year',
    tagline: 'Two months free vs monthly. Best value.',
    features: [
      'Everything in Pro Monthly',
      'Save ~32% vs monthly billing',
      'Annual receipt for collectors',
    ],
    interval: 'annual',
    entitlementId: PRO_ENTITLEMENT_ID,
  },
] as const;

/**
 * Resolve a plan to its current Paddle price id at runtime. Price
 * ids live in env (`NEXT_PUBLIC_PADDLE_PRICE_*`) so sandbox vs
 * production deploys don't share the same wire ids — and so a
 * marketing-side price change (e.g. swapping a $7.99 product for a
 * $5.99 one) doesn't require a code redeploy.
 *
 * Returns `null` when the env var is unset or empty.
 */
export interface PaddlePriceIds {
  readonly monthly: string | null;
  readonly annual: string | null;
}

export function resolvePriceId(plan: Plan, prices: PaddlePriceIds): string | null {
  switch (plan.interval) {
    case 'monthly':
      return prices.monthly;
    case 'annual':
      return prices.annual;
  }
}

/**
 * Inverse of {@link resolvePriceId} — given a Paddle price id seen
 * on a webhook, find the entitlement we should grant. The webhook
 * route uses this to map `event.items[0].price.id` to a RevenueCat
 * `entitlementId`. Returns `null` for unknown price ids; the caller
 * persists the row with `action='ignore'` and processed=false.
 *
 * Implementation note: this is a **server-side** helper too, even
 * though `plans.ts` is browser-safe — the server reads the same
 * file because the entitlement key is identical on both sides.
 */
export function resolveEntitlementForPriceId(
  priceId: string,
  prices: PaddlePriceIds,
): { plan: Plan; entitlementId: string } | null {
  const candidates: Array<[string | null, Plan]> = [];
  for (const plan of PLANS) {
    candidates.push([resolvePriceId(plan, prices), plan]);
  }
  for (const [candidatePriceId, plan] of candidates) {
    if (candidatePriceId !== null && candidatePriceId === priceId) {
      return { plan, entitlementId: plan.entitlementId };
    }
  }
  return null;
}
