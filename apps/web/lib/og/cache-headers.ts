// Cache-Control header values for the OG image route.
//
// These strings are pinned by tests so a future renderer change
// can't quietly relax the caching contract. Two cases:
//
//   - Successful render of a real share payload: the underlying
//     collection state changes at most once a day in the common
//     case (a Pokémon collector adds a few cards per day, not per
//     hour). Stale-while-revalidate keeps a week of post-expiry
//     bytes hot at the CDN so a viral X / Bluesky thread doesn't
//     thunder the route every hour.
//
//   - Fallback (unknown handle / private / failure): cached for
//     an hour so a legitimate share that goes live a minute after
//     a misfire doesn't get pinned to a fallback for a day. We
//     deliberately do NOT serve a 404 — social platforms cache
//     them aggressively and a brand-new handle would otherwise
//     stay un-unfurlable for hours after going public.
//
// `s-maxage` targets shared CDN caches (Vercel / Cloudflare);
// `max-age` is the browser/private-cache lifetime. Both numbers
// are in seconds.

/** Cache header for a successful render of a real shareable. */
export const SUCCESS_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

/** Cache header for the fallback / not-found render. */
export const FALLBACK_CACHE_CONTROL = 'public, max-age=3600';

/**
 * Numeric breakdown — exposed for tests so the contract above is
 * pinned even if the spelling of the header string drifts.
 */
export const CACHE_SECONDS = {
  successMaxAge: 3600,
  successSMaxAge: 86_400,
  successStaleWhileRevalidate: 604_800,
  fallbackMaxAge: 3600,
} as const;
