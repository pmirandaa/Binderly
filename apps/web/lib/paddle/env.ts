// Typed env loader for Paddle + RevenueCat integration.
//
// The `lib/env.ts` loader fails fast on missing Supabase keys
// because they're hard requirements for the app to render.
// Paddle/RevenueCat keys are different — they're optional in CI and
// dev, and the brief mandates the billing surface degrades into a
// "Billing isn't configured in this environment" placeholder when
// they're missing rather than crashing the build. Returning a
// discriminated union lets every caller branch on configured /
// unconfigured at the same call site that does the read.
//
// Two distinct env shapes:
//
//   - Public (browser-safe): client token, environment, price ids.
//     These ship to the client bundle. Must be `NEXT_PUBLIC_*`.
//
//   - Server (never bundled): API key, webhook secret, RevenueCat
//     secret. Read only from server code (route handlers).
//     `loadServerPaddleEnv()` enforces this with a runtime check.
//
// The split mirrors the Supabase posture in `lib/env.ts`: the anon
// key is `NEXT_PUBLIC_*` because it's public-by-design, but the
// service-role key only ever exists on the server.

export type PaddleEnvironment = 'sandbox' | 'production';

export interface PublicPaddleEnv {
  readonly kind: 'configured';
  readonly clientToken: string;
  readonly environment: PaddleEnvironment;
  readonly priceMonthly: string | null;
  readonly priceAnnual: string | null;
}

export interface UnconfiguredPaddleEnv {
  readonly kind: 'unconfigured';
  readonly missing: readonly string[];
}

export type PublicPaddleEnvResult = PublicPaddleEnv | UnconfiguredPaddleEnv;

export interface ServerPaddleEnv {
  readonly kind: 'configured';
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly environment: PaddleEnvironment;
  readonly revenueCatApiKey: string | null;
  readonly revenueCatBaseUrl: string;
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string | null;
}

export type ServerPaddleEnvResult = ServerPaddleEnv | UnconfiguredPaddleEnv;

export type EnvSource = Readonly<Record<string, string | undefined>>;

const REQUIRED_PUBLIC_KEYS = ['NEXT_PUBLIC_PADDLE_CLIENT_TOKEN'] as const;

const REQUIRED_SERVER_KEYS = ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET'] as const;

const DEFAULT_REVENUECAT_BASE_URL = 'https://api.revenuecat.com';

/**
 * Read the public (client-safe) Paddle env. Returns `unconfigured`
 * when required keys are missing rather than throwing — the
 * billing UI handles the degraded state gracefully.
 */
export function loadPublicPaddleEnv(source: EnvSource = readDefaultEnv()): PublicPaddleEnvResult {
  const missing: string[] = [];
  for (const key of REQUIRED_PUBLIC_KEYS) {
    if (!isNonEmpty(source[key])) missing.push(key);
  }
  if (missing.length > 0) return { kind: 'unconfigured', missing };

  const environment = parseEnvironment(source['NEXT_PUBLIC_PADDLE_ENVIRONMENT']);
  const priceMonthly = optionalString(source['NEXT_PUBLIC_PADDLE_PRICE_MONTHLY']);
  const priceAnnual = optionalString(source['NEXT_PUBLIC_PADDLE_PRICE_ANNUAL']);

  return {
    kind: 'configured',
    clientToken: source['NEXT_PUBLIC_PADDLE_CLIENT_TOKEN'] as string,
    environment,
    priceMonthly,
    priceAnnual,
  };
}

/**
 * Read the server-side Paddle + RevenueCat env. Throws *only* if
 * called from a non-server context (the `NEXT_PUBLIC_*`-prefixed
 * keys are bundled, but `PADDLE_API_KEY` etc. are not — reading
 * them from the browser is always undefined and a programming
 * error). Returns `unconfigured` when required keys are missing.
 */
export function loadServerPaddleEnv(source: EnvSource = readDefaultEnv()): ServerPaddleEnvResult {
  const missing: string[] = [];
  for (const key of REQUIRED_SERVER_KEYS) {
    if (!isNonEmpty(source[key])) missing.push(key);
  }
  if (missing.length > 0) return { kind: 'unconfigured', missing };

  const environment = parseEnvironment(source['NEXT_PUBLIC_PADDLE_ENVIRONMENT']);
  const revenueCatApiKey = optionalString(source['REVENUECAT_API_KEY']);
  const revenueCatBaseUrl = stripTrailingSlash(
    optionalString(source['REVENUECAT_API_BASE_URL']) ?? DEFAULT_REVENUECAT_BASE_URL,
  );
  const supabaseUrl =
    optionalString(source['SUPABASE_URL']) ??
    optionalString(source['NEXT_PUBLIC_SUPABASE_URL']) ??
    '';
  const supabaseServiceRoleKey = optionalString(source['SUPABASE_SERVICE_ROLE_KEY']);

  return {
    kind: 'configured',
    apiKey: source['PADDLE_API_KEY'] as string,
    webhookSecret: source['PADDLE_WEBHOOK_SECRET'] as string,
    environment,
    revenueCatApiKey,
    revenueCatBaseUrl,
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}

function readDefaultEnv(): EnvSource {
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
}

function parseEnvironment(value: string | undefined): PaddleEnvironment {
  return value === 'production' ? 'production' : 'sandbox';
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

function optionalString(value: string | undefined): string | null {
  return isNonEmpty(value) ? (value as string) : null;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export const REQUIRED_PUBLIC_PADDLE_ENV_KEYS = REQUIRED_PUBLIC_KEYS;
export const REQUIRED_SERVER_PADDLE_ENV_KEYS = REQUIRED_SERVER_KEYS;
export const DEFAULT_REVENUECAT_API_BASE_URL = DEFAULT_REVENUECAT_BASE_URL;
