// Web observability init — the single wiring seam for Sentry + PostHog.
//
// SCAFFOLDING MODE (Stage 11, T-DP-MONITORING): `initWebObservability`
// is inert until two things are true: (1) the provider secret is set
// (so `config.*.enabled` is true) and (2) the real SDK initializer is
// passed in via `hooks`. Until go-live we ship no `hooks`, so the
// function is a guaranteed no-op even if a DSN/key is present locally.
//
// Why dependency injection instead of importing `@sentry/nextjs` /
// `posthog-js` here: those SDKs are heavyweight (the Sentry Next.js
// plugin also rewrites `next.config`/source-map upload). Per the task's
// "dependency-light; document the dep to add at go-live" guidance we
// scaffold the seam + env wiring now and add the SDKs when Pablo
// provisions the projects. See `infra/monitoring/README.md` for the
// exact go-live diff (install the SDK, pass real `hooks`).

import { loadWebObservabilityConfig } from './config';

import type { PostHogConfig, SentryConfig, WebObservabilityConfig } from './config';

export type ProviderStatus = 'enabled' | 'disabled';

export interface ObservabilityInitResult {
  readonly sentry: ProviderStatus;
  readonly posthog: ProviderStatus;
}

/**
 * Real-SDK initializers, injected at go-live. Each is invoked at most
 * once and only when its provider is enabled. Absent hooks => no-op.
 */
export interface ObservabilityHooks {
  readonly initSentry?: (config: SentryConfig) => void;
  readonly initPostHog?: (config: PostHogConfig) => void;
}

export function initWebObservability(
  config: WebObservabilityConfig = loadWebObservabilityConfig(),
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
  loadWebObservabilityConfig,
  type ObservabilityEnvSource,
  type PostHogConfig,
  type SentryConfig,
  type WebObservabilityConfig,
} from './config';
