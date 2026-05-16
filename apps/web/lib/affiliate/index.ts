// Barrel for the affiliate lib. Both the web `<BuyCta>` and the
// mobile `<BuyCta>` import from this entry point, which keeps the
// URL-building surface in a single place even though the mobile
// package re-imports through a relative path (no path-alias on
// the mobile side).

export {
  TCGPLAYER_AFFILIATE_BASE_URL,
  TCGPLAYER_UTM_CAMPAIGN,
  TCGPLAYER_UTM_MEDIUM,
  TCGPLAYER_UTM_SOURCE,
  buildTcgplayerUrl,
} from './tcgplayer';
export type { BuildTcgplayerUrlOptions, TcgplayerCardIdentifier } from './tcgplayer';

import { buildTcgplayerUrl, type TcgplayerCardIdentifier } from './tcgplayer';

/**
 * The TCGplayer affiliate id env var name used by the web app.
 * Co-located here so both the env-loader and the test fixtures
 * agree on the canonical spelling.
 */
export const WEB_TCGPLAYER_AFFILIATE_ID_ENV = 'NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID';

/**
 * The TCGplayer affiliate id env var name used by the mobile app.
 * Expo's bundler inlines `EXPO_PUBLIC_*` vars at build time, hence
 * the prefix divergence.
 */
export const MOBILE_TCGPLAYER_AFFILIATE_ID_ENV = 'EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID';

/**
 * Helper that reads the affiliate id from a `Record`-shaped env
 * source. Returns `undefined` (not `null`) when missing/empty so
 * the call-site doesn't have to special-case the typing.
 */
export function readAffiliateIdFromEnv(
  envVar: string,
  source: Readonly<Record<string, string | undefined>> = readDefaultEnv(),
): string | undefined {
  const value = source[envVar];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Convenience wrapper for the web app: build a TCGplayer URL using
 * the web env var. Returns `null` when the env var is missing
 * — the `<BuyCta>` consumes that null and renders the degraded
 * "Coming soon" state.
 */
export function buildWebTcgplayerUrl(
  card: TcgplayerCardIdentifier,
  source?: Readonly<Record<string, string | undefined>>,
): string | null {
  const affiliateId = readAffiliateIdFromEnv(WEB_TCGPLAYER_AFFILIATE_ID_ENV, source);
  return buildTcgplayerUrl(card, { affiliateId });
}

/**
 * Convenience wrapper for the mobile app. Same shape as
 * {@link buildWebTcgplayerUrl} but reads the Expo-prefixed env var.
 */
export function buildMobileTcgplayerUrl(
  card: TcgplayerCardIdentifier,
  source?: Readonly<Record<string, string | undefined>>,
): string | null {
  const affiliateId = readAffiliateIdFromEnv(MOBILE_TCGPLAYER_AFFILIATE_ID_ENV, source);
  return buildTcgplayerUrl(card, { affiliateId });
}

function readDefaultEnv(): Readonly<Record<string, string | undefined>> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? {};
}
