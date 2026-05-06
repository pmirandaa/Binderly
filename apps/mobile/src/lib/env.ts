// Typed env loader for the Binderly mobile app.
//
// Expo's bundler ONLY inlines vars prefixed with `EXPO_PUBLIC_*` into
// the JS bundle at build time. Every other env var is unavailable
// at runtime in the native binary, so the shell standardises on the
// `EXPO_PUBLIC_*` prefix even though the cross-repo convention
// (`context/secrets-and-env.md`) uses `<SCOPE>_<SERVICE>_<NAME>`
// elsewhere. This is the documented deviation.
//
// We deliberately do NOT consume `loadClientEnv()` from
// `@binderly/api-client`: that loader keys on `SUPABASE_URL` /
// `SUPABASE_ANON_KEY` (no `EXPO_PUBLIC_` prefix), which Expo's
// bundler will not inline. The mobile env loader is a thin
// Expo-specific wrapper that emits the same `{ baseUrl, apiKey }`
// shape `createClient(...)` accepts.

/** Required keys (omitting any one fails fast at boot). */
export const REQUIRED_ENV_KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
] as const;

/** Optional keys (loader applies a sensible default when absent). */
export const OPTIONAL_ENV_KEYS = ['EXPO_PUBLIC_API_URL'] as const;

/**
 * The env-source shape we read from. `process.env` (Expo / Node /
 * Vitest) satisfies this; tests pass a plain object.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Typed view of every env value the mobile shell needs at runtime.
 */
export interface MobileEnv {
  /** Supabase project URL — `https://<ref>.supabase.co` or local CLI. */
  readonly supabaseUrl: string;
  /** Supabase anon key — public-by-design. */
  readonly supabaseAnonKey: string;
  /**
   * Base URL for the Binderly backend. When `EXPO_PUBLIC_API_URL`
   * is set we use that (e.g. a Cloudflare Worker reverse-proxy
   * fronting Edge Functions); otherwise it falls back to
   * {@link supabaseUrl}.
   */
  readonly apiBaseUrl: string;
}

/** Strongly-typed boot error for missing-env paths. */
export class MobileEnvError extends Error {
  public override readonly name = 'MobileEnvError';
  public readonly missing: ReadonlyArray<string>;

  public constructor(missing: ReadonlyArray<string>) {
    super(
      `@binderly/mobile: missing required env vars: ${missing.join(', ')}. ` +
        'Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` (or set them ' +
        'in your Expo / EAS env) and restart the bundler.',
    );
    this.missing = missing;
  }
}

/**
 * Load + validate {@link MobileEnv} from the supplied env source
 * (defaults to `process.env`). Throws {@link MobileEnvError} listing
 * every missing required key so a misconfigured build fails loudly
 * on first import.
 */
export function loadMobileEnv(source: EnvSource = readDefaultEnv()): MobileEnv {
  const supabaseUrl = source['EXPO_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = source['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
  const apiBaseUrlRaw = source['EXPO_PUBLIC_API_URL'];

  const missing: string[] = [];
  if (!isNonEmptyString(supabaseUrl)) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!isNonEmptyString(supabaseAnonKey)) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    throw new MobileEnvError(missing);
  }

  // Narrowed by the `missing` checks above.
  const supabaseUrlSafe = stripTrailingSlash(supabaseUrl as string);
  const apiBaseUrlSafe = isNonEmptyString(apiBaseUrlRaw)
    ? stripTrailingSlash(apiBaseUrlRaw)
    : supabaseUrlSafe;
  return {
    supabaseUrl: supabaseUrlSafe,
    supabaseAnonKey: supabaseAnonKey as string,
    apiBaseUrl: apiBaseUrlSafe,
  };
}

/**
 * Try-version of {@link loadMobileEnv} for surfaces that prefer a
 * discriminated result (e.g. the boot-time `<EnvGate>` component).
 */
export function tryLoadMobileEnv(
  source: EnvSource = readDefaultEnv(),
): { ok: true; env: MobileEnv } | { ok: false; error: MobileEnvError } {
  try {
    return { ok: true, env: loadMobileEnv(source) };
  } catch (cause) {
    if (cause instanceof MobileEnvError) {
      return { ok: false, error: cause };
    }
    throw cause;
  }
}

function readDefaultEnv(): EnvSource {
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
