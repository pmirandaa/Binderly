// Typed env loader for `apps/web`.
//
// Next.js inlines `NEXT_PUBLIC_*` env vars at build time, so the
// loader pulls from `process.env` directly and fails fast at
// module load if any required key is missing. Server-side code
// reads the same keys; for non-public keys that surface later
// (Paddle webhook secret, etc.), add a separate loader so the
// bundler doesn't accidentally inline them client-side.

export interface WebEnv {
  /** Backend API base URL (Supabase project URL by default). */
  readonly supabaseUrl: string;
  /** Supabase anon key (public-by-design). */
  readonly supabaseAnonKey: string;
  /** R2 public base URL for catalog images. May be undefined in early dev. */
  readonly r2PublicBaseUrl: string | undefined;
  /** App's own URL — used for OG / auth redirects. */
  readonly appUrl: string | undefined;
}

export type WebEnvSource = Readonly<Record<string, string | undefined>>;

const REQUIRED_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

export function loadWebEnv(source: WebEnvSource = readDefaultEnv()): WebEnv {
  const missing: string[] = [];
  for (const key of REQUIRED_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || value.length === 0) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `@binderly/web: missing required env vars: ${missing.join(', ')}. ` +
        'Copy `apps/web/.env.example` to `apps/web/.env.local` (or set them ' +
        'in your runtime — Vercel project env) and retry.',
    );
  }
  const supabaseUrl = stripTrailingSlash(source['NEXT_PUBLIC_SUPABASE_URL'] as string);
  const r2 = source['NEXT_PUBLIC_R2_PUBLIC_BASE_URL'];
  const appUrl = source['NEXT_PUBLIC_APP_URL'];
  return {
    supabaseUrl,
    supabaseAnonKey: source['NEXT_PUBLIC_SUPABASE_ANON_KEY'] as string,
    r2PublicBaseUrl: typeof r2 === 'string' && r2.length > 0 ? stripTrailingSlash(r2) : undefined,
    appUrl:
      typeof appUrl === 'string' && appUrl.length > 0 ? stripTrailingSlash(appUrl) : undefined,
  };
}

function readDefaultEnv(): WebEnvSource {
  const proc = (globalThis as { process?: { env?: WebEnvSource } }).process;
  return proc?.env ?? {};
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export { REQUIRED_KEYS as REQUIRED_ENV_KEYS };
