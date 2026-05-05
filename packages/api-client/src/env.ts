// Typed env loader for `@binderly/api-client`.
//
// The client targets browser / RN / Edge / Node runtimes
// uniformly. Browser-side reads via `process.env` (Next.js inlines
// `NEXT_PUBLIC_*` at build), mobile-side reads via Expo's
// `process.env` shim, Edge functions read via `Deno.env.toObject()`,
// and Node test code reads via the real `process.env`. This loader
// accepts any of those shapes via {@link EnvSource} and returns a
// typed {@link ClientEnv}.
//
// Required keys mirror `@binderly/auth`'s posture (the unscoped
// Supabase triple) PLUS a separate `API_BASE_URL` for the cases
// where the API host differs from the Supabase URL (e.g. a
// Cloudflare worker reverse-proxy in front of Edge Functions).
// When `API_BASE_URL` is absent, `SUPABASE_URL` is used directly.

/**
 * Minimal shape of an env-bag we can read from. `process.env` and
 * `Deno.env.toObject()` both satisfy this, as does any plain
 * `Record<string, string>`. Values may be undefined when the var
 * isn't set; the loader fails fast on missing required keys.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Typed view of the env vars the api-client consumes at runtime.
 */
export interface ClientEnv {
  /**
   * Base URL for the Binderly backend (e.g. `https://abc.supabase.co`
   * or `https://api.binderly.app`). Trailing slash stripped on
   * load so resource paths can concatenate without double-slashes.
   */
  readonly baseUrl: string;
  /**
   * Supabase anon key — public-by-design value safe to ship to
   * clients. Sent as the `apikey` header on every request (Supabase
   * requires it even for anonymous PostgREST reads).
   */
  readonly apiKey: string;
}

/**
 * Required env-var keys. The base URL falls back to `SUPABASE_URL`
 * when `API_BASE_URL` isn't set; one of the two MUST be present.
 * `SUPABASE_ANON_KEY` is always required.
 */
export const REQUIRED_ENV_KEYS = ['SUPABASE_ANON_KEY'] as const;

/**
 * Load + validate {@link ClientEnv} from the supplied env source
 * (defaults to `process.env` on Node-like runtimes, empty otherwise).
 *
 * Throws an `Error` listing every missing key so a misconfigured
 * deploy fails loudly at boot time.
 */
export function loadClientEnv(source: EnvSource = readDefaultEnv()): ClientEnv {
  const baseUrlRaw = source['API_BASE_URL'] ?? source['SUPABASE_URL'];
  const apiKeyRaw = source['SUPABASE_ANON_KEY'];

  const missing: string[] = [];
  if (typeof baseUrlRaw !== 'string' || baseUrlRaw.length === 0) {
    missing.push('API_BASE_URL or SUPABASE_URL');
  }
  if (typeof apiKeyRaw !== 'string' || apiKeyRaw.length === 0) {
    missing.push('SUPABASE_ANON_KEY');
  }
  if (missing.length > 0) {
    throw new Error(
      `@binderly/api-client: missing required env vars: ${missing.join(', ')}. ` +
        'Copy `.env.example` to `.env.local` (or set them in your runtime — ' +
        'Vercel / EAS / Edge Function env) and retry.',
    );
  }

  // The checks above guarantee these are non-empty strings.
  return {
    baseUrl: stripTrailingSlash(baseUrlRaw as string),
    apiKey: apiKeyRaw as string,
  };
}

/**
 * Read env from `process.env` if available (Node / Next.js / Vitest /
 * Expo), or fall back to an empty object so the missing-key path
 * produces a clean error instead of a `ReferenceError` on Edge
 * runtimes that lack `process`.
 */
function readDefaultEnv(): EnvSource {
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
