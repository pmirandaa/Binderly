import { describe, expect, it } from 'vitest';

import {
  CACHE_SECONDS,
  FALLBACK_CACHE_CONTROL,
  SUCCESS_CACHE_CONTROL,
} from '../cache-headers';

describe('OG cache-headers', () => {
  it('SUCCESS_CACHE_CONTROL matches the brief verbatim', () => {
    expect(SUCCESS_CACHE_CONTROL).toBe(
      'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    );
  });

  it('FALLBACK_CACHE_CONTROL is the documented 1 h public cache', () => {
    expect(FALLBACK_CACHE_CONTROL).toBe('public, max-age=3600');
  });

  it('exposes numeric breakdown for cross-checking the success header', () => {
    expect(CACHE_SECONDS.successMaxAge).toBe(3600);
    expect(CACHE_SECONDS.successSMaxAge).toBe(86_400);
    expect(CACHE_SECONDS.successStaleWhileRevalidate).toBe(604_800);
    expect(CACHE_SECONDS.fallbackMaxAge).toBe(3600);
  });

  it('s-maxage is exactly 24× max-age (per the design rationale)', () => {
    expect(CACHE_SECONDS.successSMaxAge / CACHE_SECONDS.successMaxAge).toBe(24);
  });

  it('stale-while-revalidate is exactly 7× s-maxage (a week of stale-OK)', () => {
    expect(CACHE_SECONDS.successStaleWhileRevalidate / CACHE_SECONDS.successSMaxAge).toBe(7);
  });
});
