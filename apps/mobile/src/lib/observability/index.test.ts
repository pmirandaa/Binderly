import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_POSTHOG_HOST, loadMobileObservabilityConfig } from './config.js';
import { initMobileObservability } from './index.js';

describe('loadMobileObservabilityConfig', () => {
  it('disables both providers when no env vars are present', () => {
    const config = loadMobileObservabilityConfig({});
    expect(config.sentry).toEqual({ enabled: false, dsn: undefined });
    expect(config.posthog).toEqual({
      enabled: false,
      key: undefined,
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  it('treats empty-string env vars as absent', () => {
    const config = loadMobileObservabilityConfig({
      EXPO_PUBLIC_SENTRY_DSN: '',
      EXPO_PUBLIC_POSTHOG_KEY: '',
    });
    expect(config.sentry.enabled).toBe(false);
    expect(config.posthog.enabled).toBe(false);
  });

  it('enables Sentry when a DSN is present', () => {
    const config = loadMobileObservabilityConfig({
      EXPO_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
    });
    expect(config.sentry).toEqual({
      enabled: true,
      dsn: 'https://abc@o1.ingest.sentry.io/1',
    });
  });

  it('enables PostHog and honours a custom host', () => {
    const config = loadMobileObservabilityConfig({
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
      EXPO_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
    });
    expect(config.posthog).toEqual({
      enabled: true,
      key: 'phc_test',
      host: 'https://eu.i.posthog.com',
    });
  });
});

describe('initMobileObservability', () => {
  it('is a no-op and reports disabled when nothing is configured', () => {
    const initSentry = vi.fn();
    const initPostHog = vi.fn();
    const result = initMobileObservability(loadMobileObservabilityConfig({}), {
      initSentry,
      initPostHog,
    });
    expect(result).toEqual({ sentry: 'disabled', posthog: 'disabled' });
    expect(initSentry).not.toHaveBeenCalled();
    expect(initPostHog).not.toHaveBeenCalled();
  });

  it('invokes the injected initializers only for enabled providers', () => {
    const initSentry = vi.fn();
    const initPostHog = vi.fn();
    const config = loadMobileObservabilityConfig({
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    });
    const result = initMobileObservability(config, { initSentry, initPostHog });
    expect(result).toEqual({ sentry: 'disabled', posthog: 'enabled' });
    expect(initPostHog).toHaveBeenCalledTimes(1);
    expect(initPostHog).toHaveBeenCalledWith(config.posthog);
    expect(initSentry).not.toHaveBeenCalled();
  });

  it('does not throw when enabled but no hooks are supplied (scaffolding default)', () => {
    const config = loadMobileObservabilityConfig({
      EXPO_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    });
    expect(() => initMobileObservability(config)).not.toThrow();
    expect(initMobileObservability(config)).toEqual({
      sentry: 'enabled',
      posthog: 'enabled',
    });
  });
});
