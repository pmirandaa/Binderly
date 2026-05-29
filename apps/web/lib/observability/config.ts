// Observability config loader for `apps/web` (Sentry errors + PostHog
// analytics — the providers chosen in `context/tech-stack.md`).
//
// SCAFFOLDING MODE (Stage 11, T-DP-MONITORING): this reads the public,
// bundler-inlined env vars and reports whether each provider is
// *enabled*. A provider is enabled only when its key/DSN is present, so
// every code path is a guaranteed no-op in dev and in any environment
// where Pablo has not yet provisioned the secret. The provider SDKs
// (`@sentry/nextjs`, `posthog-js`) are intentionally NOT yet a
// dependency — see `infra/monitoring/README.md` for the go-live wiring.
//
// Naming: like the rest of `apps/web`, the browser-visible config reads
// `NEXT_PUBLIC_*` keys (Next.js only inlines that prefix into the client
// bundle). The repo-canonical `WEB_SENTRY_DSN` / `WEB_POSTHOG_KEY` triple
// in `context/secrets-and-env.md` is the deploy-time source these mirror.

/** Default PostHog ingestion host (PostHog Cloud US). */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export interface SentryConfig {
  /** True only when a DSN is present — gates every Sentry side effect. */
  readonly enabled: boolean;
  /** Sentry DSN (`NEXT_PUBLIC_SENTRY_DSN`), or undefined when unset. */
  readonly dsn: string | undefined;
}

export interface PostHogConfig {
  /** True only when a project key is present — gates every PostHog call. */
  readonly enabled: boolean;
  /** PostHog project key (`NEXT_PUBLIC_POSTHOG_KEY`), or undefined. */
  readonly key: string | undefined;
  /** Ingestion host; defaults to {@link DEFAULT_POSTHOG_HOST}. */
  readonly host: string;
}

export interface WebObservabilityConfig {
  readonly sentry: SentryConfig;
  readonly posthog: PostHogConfig;
}

export type ObservabilityEnvSource = Readonly<Record<string, string | undefined>>;

export function loadWebObservabilityConfig(
  source: ObservabilityEnvSource = readDefaultEnv(),
): WebObservabilityConfig {
  const dsn = nonEmpty(source['NEXT_PUBLIC_SENTRY_DSN']);
  const key = nonEmpty(source['NEXT_PUBLIC_POSTHOG_KEY']);
  const host = nonEmpty(source['NEXT_PUBLIC_POSTHOG_HOST']) ?? DEFAULT_POSTHOG_HOST;
  return {
    sentry: { enabled: dsn !== undefined, dsn },
    posthog: { enabled: key !== undefined, key, host },
  };
}

function readDefaultEnv(): ObservabilityEnvSource {
  const proc = (globalThis as { process?: { env?: ObservabilityEnvSource } }).process;
  return proc?.env ?? {};
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
