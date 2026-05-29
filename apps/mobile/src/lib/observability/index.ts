// Mobile observability init — the single wiring seam for Sentry +
// PostHog in the Expo app.
//
// SCAFFOLDING MODE (Stage 11, T-DP-MONITORING): `initMobileObservability`
// is inert until both (1) the provider secret is set (so
// `config.*.enabled` is true) and (2) the real SDK initializer is passed
// via `hooks`. Until go-live we ship no `hooks`, so the call is a
// guaranteed no-op even if a DSN/key is present.
//
// Why dependency injection over importing `@sentry/react-native` /
// `posthog-react-native` here: native SDKs add config-plugin + pod
// install weight and the Sentry RN SDK needs Metro/EAS wiring. Per the
// task's "dependency-light; document the dep to add at go-live"
// guidance we scaffold the seam + env wiring now. See
// `infra/monitoring/README.md` for the go-live diff.

import { loadMobileObservabilityConfig } from './config.js';

import type {
  MobileObservabilityConfig,
  PostHogConfig,
  SentryConfig,
} from './config.js';

export type ProviderStatus = 'enabled' | 'disabled';

export interface ObservabilityInitResult {
  readonly sentry: ProviderStatus;
  readonly posthog: ProviderStatus;
}

/**
 * Real-SDK initializers, injected at go-live. Each runs at most once and
 * only when its provider is enabled. Absent hooks => no-op.
 */
export interface ObservabilityHooks {
  readonly initSentry?: (config: SentryConfig) => void;
  readonly initPostHog?: (config: PostHogConfig) => void;
}

export function initMobileObservability(
  config: MobileObservabilityConfig = loadMobileObservabilityConfig(),
  hooks: ObservabilityHooks = {},
): ObservabilityInitResult {
  let sentry: ProviderStatus = 'disabled';
  if (config.sentry.enabled) {
    hooks.initSentry?.(config.sentry);
    sentry = 'enabled';
  }

  let posthog: ProviderStatus = 'disabled';
  if (config.posthog.enabled) {
    hooks.initPostHog?.(config.posthog);
    posthog = 'enabled';
  }

  return { sentry, posthog };
}

export {
  DEFAULT_POSTHOG_HOST,
  loadMobileObservabilityConfig,
  type MobileObservabilityConfig,
  type ObservabilityEnvSource,
  type PostHogConfig,
  type SentryConfig,
} from './config.js';
