// Pure URL builder for TCGplayer affiliate links — mobile copy.
//
// This is intentionally a near-line-for-line duplicate of the web
// version at `apps/web/lib/affiliate/tcgplayer.ts`. Mobile lives in
// a separate workspace package (`@binderly/mobile`) that does not
// depend on `@binderly/web`, so importing the web module directly
// is not an option. The pure logic is ~30 lines; cross-package code
// movement to a shared `packages/affiliate-urls` lib would cost more
// than the duplication does at this scope. If we later add a third
// caller, lift the function into a real shared package.
//
// Both files must stay in lockstep. The `buy-cta/BuyCta.test.tsx`
// tests on each side cover the format independently; if you update
// the URL template, update both modules **and** both test suites.
//
// TODO(#FU-24): confirm exact TCGplayer affiliate URL format with
// @pablo (see `apps/web/lib/affiliate/tcgplayer.ts` for the full
// list of params we need to verify against Impact's docs).

export interface TcgplayerCardIdentifier {
  readonly cardName: string;
  readonly setName?: string | null;
  readonly number?: string | null;
}

export interface BuildTcgplayerUrlOptions {
  readonly affiliateId: string | null | undefined;
}

export const TCGPLAYER_AFFILIATE_BASE_URL = 'https://tcgplayer.com/search/pokemon/product';
export const TCGPLAYER_UTM_SOURCE = 'binderly';
export const TCGPLAYER_UTM_MEDIUM = 'affiliate';
export const TCGPLAYER_UTM_CAMPAIGN = 'binderly-buy-cta';

/**
 * Build a TCGplayer affiliate URL for the given card. Returns
 * `null` when the affiliate id or the card name is missing — the
 * caller renders a disabled "Coming soon" state instead.
 */
export function buildTcgplayerUrl(
  card: TcgplayerCardIdentifier,
  options: BuildTcgplayerUrlOptions,
): string | null {
  const affiliateId = normalize(options.affiliateId);
  if (affiliateId === null) return null;

  const cardName = normalize(card.cardName);
  if (cardName === null) return null;

  const queryParts: string[] = [cardName];
  const number = normalize(card.number);
  if (number !== null) queryParts.push(number);
  const setName = normalize(card.setName);
  if (setName !== null) queryParts.push(setName);

  const params = new URLSearchParams({
    productLineName: 'pokemon',
    q: queryParts.join(' '),
    utm_source: TCGPLAYER_UTM_SOURCE,
    utm_medium: TCGPLAYER_UTM_MEDIUM,
    utm_campaign: TCGPLAYER_UTM_CAMPAIGN,
    utm_id: affiliateId,
  });

  return `${TCGPLAYER_AFFILIATE_BASE_URL}?${params.toString()}`;
}

/** Env var Expo inlines at build time. Public-by-design. */
export const MOBILE_TCGPLAYER_AFFILIATE_ID_ENV = 'EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID';

export function readMobileAffiliateId(
  source: Readonly<Record<string, string | undefined>> = readDefaultEnv(),
): string | undefined {
  const value = source[MOBILE_TCGPLAYER_AFFILIATE_ID_ENV];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readDefaultEnv(): Readonly<Record<string, string | undefined>> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? {};
}
