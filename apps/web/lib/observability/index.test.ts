import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_POSTHOG_HOST, loadWebObservabilityConfig } from './config';
import { initWebObservability } from './index';

describe('loadWebObservabilityConfig', () => {
  it('disables both providers when no env vars are present', () => {
    const config = loadWebObservabilityConfig({});
    expect(config.sentry).toEqual({ enabled: false, dsn: undefined });
    expect(config.posthog).toEqual({
      enabled: false,
      key: undefined,
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  it('treats empty-string env vars as absent', () => {
    const config = loadWebObservabilityConfig({
      NEXT_PUBLIC_SENTRY_DSN: '',
      NEXT_PUBLIC_POSTHOG_KEY: '',
    });
    expect(config.sentry.enabled).toBe(false);
    expect(config.posthog.enabled).toBe(false);
  });

  it('enables Sentry when a DSN is present', () => {
    const config = loadWebObservabilityConfig({
      NEXT_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
    });
    expect(config.sentry).toEqual({
      enabled: true,
      dsn: 'https://abc@o1.ingest.sentry.io/1',
    });
  });

  it('enables PostHog and honours a custom host', () => {
    const config = loadWebObservabilityConfig({
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_test',
      NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
    });
    expect(config.posthog).toEqual({
      enabled: true,
      key: 'phc_test',
      host: 'https://eu.i.posthog.com',
    });
  });
});

describe('initWebObservability', () => {
  it('is a no-op and reports disabled when nothing is configured', () => {
    const initSentry = vi.fn();
    const initPostHog = vi.fn();
    const result = initWebObservability(loadWebObservabilityConfig({}), {
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
    const config = loadWebObservabilityConfig({
      NEXT_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
    });
    const result = initWebObservability(config, { initSentry, initPostHog });
    expect(result).toEqual({ sentry: 'enabled', posthog: 'disabled' });
    expect(initSentry).toHaveBeenCalledTimes(1);
    expect(initSentry).toHaveBeenCalledWith(config.sentry);
    expect(initPostHog).not.toHaveBeenCalled();
  });

  it('does not throw when enabled but no hooks are supplied (scaffolding default)', () => {
    const config = loadWebObservabilityConfig({
      NEXT_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_test',
    });
    expect(() => initWebObservability(config)).not.toThrow();
    expect(initWebObservability(config)).toEqual({
      sentry: 'enabled',
      posthog: 'enabled',
    });
  });
});
