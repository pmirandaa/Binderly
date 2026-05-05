// Typed env loader for @binderly/auth.
//
// Edge Functions run on Deno and read env via `Deno.env.get`. Node and
// Next.js Route Handlers read from `process.env`. This loader accepts
// both shapes and returns the typed {@link AuthEnv} record the rest of
// the package consumes. Callers can also pass a plain object literal
// for tests.

import type { AuthEnv } from './types.js';

/**
 * Minimal shape of an env-bag we can read from. `process.env` and
 * `Deno.env.toObject()` both satisfy this, as does any plain
 * `Record<string, string>`. Values may be undefined when the var
 * isn't set; the loader fails fast on missing required keys.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Required env vars. Names follow the project's
 * `<SCOPE>_<SERVICE>_<NAME>` convention, but server-side Supabase
 * helpers in particular consume the unscoped Supabase names because
 * the same triple is used by every server scope (web SSR, Edge
 * Functions, scripts). Apps that want to multiplex (e.g. talking to
 * a staging project from a prod runtime) construct {@link AuthEnv}
 * directly and bypass this loader.
 */
export const REQUIRED_ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const satisfies readonly string[];

/**
 * Read {@link AuthEnv} from the supplied env source (defaults to
 * `process.env`). Throws if any required key is missing or empty —
 * server-side auth without these isn't a graceful-degradation path,
 * it's a misconfigured deploy.
 */
export function loadAuthEnv(source: EnvSource = readDefaultEnv()): AuthEnv {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || value.length === 0) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `@binderly/auth: missing required env vars: ${missing.join(', ')}. ` +
        'Copy `.env.example` to `.env.local` (or set them in your runtime — ' +
        'Vercel / Fly / Supabase Edge Function env) and retry.',
    );
  }
  // The loop above proves these are non-empty strings; the cast keeps
  // the public type clean while preserving the runtime guarantee.
  return {
    supabaseUrl: source['SUPABASE_URL'] as string,
    supabaseAnonKey: source['SUPABASE_ANON_KEY'] as string,
    supabaseServiceRoleKey: source['SUPABASE_SERVICE_ROLE_KEY'] as string,
  };
}

/**
 * Read env from `process.env` if available (Node / Next.js / Vitest)
 * or fall back to an empty object so the missing-key path produces a
 * clean error instead of a `ReferenceError` on Edge runtimes that
 * lack `process`.
 */
function readDefaultEnv(): EnvSource {
  // `process` is `globalThis.process` on Node; reading via globalThis
  // keeps us portable to Edge runtimes that polyfill or omit it.
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
}
