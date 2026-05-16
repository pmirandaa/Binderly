// Pure URL builder for TCGplayer affiliate links.
//
// Both the web `<BuyCta>` and the mobile `<BuyCta>` import
// `buildTcgplayerUrl()` from this module. The function is
// intentionally side-effect free + framework-free: it takes a
// card identifier plus an affiliate-program id and returns either
// a `https://tcgplayer.com/...` URL or `null` (when the
// affiliate id is missing — caller is expected to render the
// "Coming soon" degraded state).
//
// TCGplayer affiliate URL format (per the T-W-AFFILIATE-LINKS
// brief): a `search/pokemon/product` query with `productLineName`
// pinned to `pokemon`, a free-text `q` of "<name> <number>
// <set name>", and the program id passed as `utm_id`. The
// `utm_source` / `utm_medium` / `utm_campaign` triple is fixed at
// `binderly` so we can attribute clicks back to our integration in
// Impact's dashboards. The exact wire format TCGplayer expects from
// Impact-tracked affiliates is **not authoritatively documented**
// publicly; the brief explicitly told us to use this as a documented
// placeholder.
//
// TODO(#FU-24): confirm exact TCGplayer affiliate URL format with
// @pablo once we have an Impact account + the partner portal docs.
// Two specific things to verify:
//   1. Is `utm_id` the right Impact tracker param, or do they
//      expect `partner=<id>` / `clickref=<id>` instead?
//   2. Should the path stay `search/pokemon/product` or move to
//      `search/all/product?productLineName=pokemon` (TCGplayer has
//      both spellings live in the wild).
// Until that lands, the public surface (function signature, return
// shape, env-missing degradation) is final — only the URL template
// changes.

/**
 * Minimum-viable card identifier the URL builder needs to make a
 * useful TCGplayer search. The shape is intentionally narrow so
 * both the web `PrintingWithContextDto` and the mobile
 * `CardWithPrintingsDto` can adapt to it without leaking
 * api-contracts into the affiliate package.
 */
export interface TcgplayerCardIdentifier {
  /** Card name (e.g. `"Charizard"`). Required. */
  readonly cardName: string;
  /** Set name (e.g. `"Base Set"`). Optional — improves match precision. */
  readonly setName?: string | null;
  /**
   * Card number within the set (e.g. `"4"` or `"4/102"`). Optional
   * — included in the `q` parameter when present.
   */
  readonly number?: string | null;
}

export interface BuildTcgplayerUrlOptions {
  /**
   * TCGplayer affiliate / partner id, read from env by the caller.
   * When `undefined` / empty, {@link buildTcgplayerUrl} returns
   * `null` so the UI can render its degraded "Coming soon" state.
   */
  readonly affiliateId: string | null | undefined;
}

/** Base host for every TCGplayer affiliate URL we emit. */
export const TCGPLAYER_AFFILIATE_BASE_URL = 'https://tcgplayer.com/search/pokemon/product';

/** Fixed UTM triple — see module docstring. */
export const TCGPLAYER_UTM_SOURCE = 'binderly';
export const TCGPLAYER_UTM_MEDIUM = 'affiliate';
export const TCGPLAYER_UTM_CAMPAIGN = 'binderly-buy-cta';

/**
 * Build a TCGplayer affiliate URL for the given card. Returns
 * `null` when:
 *
 *   - `affiliateId` is missing / empty (degraded "Coming soon"
 *     state on the UI side), or
 *   - `cardName` is missing / empty after trimming (no usable
 *     search query — same degraded state).
 *
 * Otherwise returns a fully-encoded `https://tcgplayer.com/...`
 * URL that callers should open in a new tab (web) or via
 * `expo-web-browser` (mobile).
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

  // `URLSearchParams` handles every URL-encoding edge case
  // (apostrophes, accented characters, spaces). Building the
  // query string by hand is exactly the kind of bug surface
  // we don't want to own.
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

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
