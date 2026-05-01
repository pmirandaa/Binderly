# Stage 10 — Paywall / Billing rules

RevenueCat + Paddle, unified by RC entitlements. Server-side enforcement.

## Required reading

- `PROJECT.md` § 16 (Freemium plan)
- `context/data-model.md` (`subscription`)
- `context/secrets-and-env.md`

## Hard rules

- **Server is the source of truth.** Client UI gates are UX; the
  api-client and Edge Functions verify entitlements on every gated
  mutation.
- **RevenueCat is the unified entitlement store.** Paddle webhooks feed
  RC (via the official Paddle-RevenueCat integration); RC webhooks
  feed our `subscription` table. Mobile reads RC
  directly; web reads `subscription` via api-client.
- **Restore Purchases on mobile.** iOS requires it. Visible in settings
  + post-paywall screens.
- **No price strings hardcoded.** Pricing comes from RC and Paddle
  product configurations. Display formatting via `Intl.NumberFormat`.
- **Apple/Google IAP only on mobile, Paddle only on web.** Don't try to
  link a web Paddle sub to an iOS user without going through RC's
  cross-platform features. RC's Paddle integration handles this when
  set up correctly.
- **Free tier limits enforced server-side.**
  - 3 manual custom collections max
  - Saved smart collections: 0
  - Shareables: 1
  - Stack scanner: blocked
  - Grading prediction: blocked
  - Pricing graphs: blocked (when pricing is on)
  - Export: blocked

## Conventions specific to this stage

- `packages/entitlements` exposes `hasEntitlement(userId, key)` and a
  `requireEntitlement` helper that throws our typed error.
- `packages/feature-flags` is for environment-flag-style flags
  (PRICING_ENABLED, etc.), not per-user gating.
- Webhook handlers verify signatures (Paddle + RC) before any mutation.

## Common pitfalls

- Sandbox vs production keys: Apple Sandbox auto-renews way faster;
  test entitlement expiry handling.
- RC's "entitlement" abstraction covers what we want — use RC keys
  ("pro") rather than product IDs.
- Web checkout success → user expects pro immediately; webhook may
  arrive seconds later. Optimistic gate via Paddle transaction
  metadata, reconciled by webhook.

## Done when

- A user can subscribe on iOS, Android, and web.
- Pro gate unlocks within 10 seconds of purchase.
- Free user hitting a Pro feature sees a clear, non-shaming upgrade
  flow.
- Cancellation propagates and downgrades the user at the period end
  (not immediately, per typical SaaS norms).
