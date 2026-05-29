// Observability config loader for the Binderly mobile app (Sentry
// errors + PostHog analytics — the providers chosen in
// `context/tech-stack.md`).
//
// SCAFFOLDING MODE (Stage 11, T-DP-MONITORING): reads the public,
// Expo-inlined env vars and reports whether each provider is *enabled*.
// A provider is enabled only when its key/DSN is present, so every code
// path is a guaranteed no-op until Pablo provisions the secret (set in
// EAS Secrets for production builds). The provider SDKs
// (`@sentry/react-native`, `posthog-react-native`) are intentionally NOT
// yet dependencies — see `infra/monitoring/README.md` for the go-live
// wiring.
//
// Naming: like the rest of the mobile shell, this reads `EXPO_PUBLIC_*`
// keys (Expo's bundler only inlines that prefix). The repo-canonical
// `MOBILE_SENTRY_DSN` / `MOBILE_POSTHOG_KEY` pair in
// `context/secrets-and-env.md` is the deploy-time source these mirror.

/** Default PostHog ingestion host (PostHog Cloud US). */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export interface SentryConfig {
  /** True only when a DSN is present — gates every Sentry side effect. */
  readonly enabled: boolean;
  /** Sentry DSN (`EXPO_PUBLIC_SENTRY_DSN`), or undefined when unset. */
  readonly dsn: string | undefined;
}

export interface PostHogConfig {
  /** True only when a project key is present — gates every PostHog call. */
  readonly enabled: boolean;
  /** PostHog project key (`EXPO_PUBLIC_POSTHOG_KEY`), or undefined. */
  readonly key: string | undefined;
  /** Ingestion host; defaults to {@link DEFAULT_POSTHOG_HOST}. */
  readonly host: string;
}

export interface MobileObservabilityConfig {
  readonly sentry: SentryConfig;
  readonly posthog: PostHogConfig;
}

export type ObservabilityEnvSource = Readonly<Record<string, string | undefined>>;

export function loadMobileObservabilityConfig(
  source: ObservabilityEnvSource = readDefaultEnv(),
): MobileObservabilityConfig {
  const dsn = nonEmpty(source['EXPO_PUBLIC_SENTRY_DSN']);
  const key = nonEmpty(source['EXPO_PUBLIC_POSTHOG_KEY']);
  const host = nonEmpty(source['EXPO_PUBLIC_POSTHOG_HOST']) ?? DEFAULT_POSTHOG_HOST;
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
