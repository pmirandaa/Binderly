import { describe, expect, it } from 'vitest';

import {
  MOBILE_TCGPLAYER_AFFILIATE_ID_ENV,
  TCGPLAYER_AFFILIATE_BASE_URL,
  TCGPLAYER_UTM_CAMPAIGN,
  TCGPLAYER_UTM_MEDIUM,
  TCGPLAYER_UTM_SOURCE,
  buildTcgplayerUrl,
  readMobileAffiliateId,
} from './tcgplayer.js';

describe('buildTcgplayerUrl — mobile copy', () => {
  it('builds a URL with the canonical base + UTM triple + affiliate id', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Charizard', setName: 'Base Set', number: '4' },
      { affiliateId: 'aff-mobile' },
    );
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(TCGPLAYER_AFFILIATE_BASE_URL);
    expect(parsed.searchParams.get('productLineName')).toBe('pokemon');
    expect(parsed.searchParams.get('utm_source')).toBe(TCGPLAYER_UTM_SOURCE);
    expect(parsed.searchParams.get('utm_medium')).toBe(TCGPLAYER_UTM_MEDIUM);
    expect(parsed.searchParams.get('utm_campaign')).toBe(TCGPLAYER_UTM_CAMPAIGN);
    expect(parsed.searchParams.get('utm_id')).toBe('aff-mobile');
    expect(parsed.searchParams.get('q')).toBe('Charizard 4 Base Set');
  });

  it('encodes apostrophes and accented characters', () => {
    const url = buildTcgplayerUrl(
      { cardName: "Farfetch'd", setName: 'Pokémon Jungle' },
      { affiliateId: 'aff-mobile' },
    );
    expect(url).not.toBeNull();
    expect(url).toContain('Farfetch%27d');
    expect(url).toContain('Pok%C3%A9mon');
  });

  it('returns null when affiliate id is missing or empty', () => {
    expect(buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: undefined })).toBeNull();
    expect(buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: null })).toBeNull();
    expect(buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: '' })).toBeNull();
    expect(buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: '   ' })).toBeNull();
  });

  it('returns null when card name is missing', () => {
    expect(buildTcgplayerUrl({ cardName: '' }, { affiliateId: 'aff-mobile' })).toBeNull();
    expect(buildTcgplayerUrl({ cardName: '   ' }, { affiliateId: 'aff-mobile' })).toBeNull();
  });
});

describe('readMobileAffiliateId', () => {
  it('reads the Expo-prefixed env var', () => {
    expect(readMobileAffiliateId({ [MOBILE_TCGPLAYER_AFFILIATE_ID_ENV]: ' aff-mobile ' })).toBe(
      'aff-mobile',
    );
  });

  it('returns undefined when missing', () => {
    expect(readMobileAffiliateId({})).toBeUndefined();
  });

  it('returns undefined when whitespace', () => {
    expect(readMobileAffiliateId({ [MOBILE_TCGPLAYER_AFFILIATE_ID_ENV]: '   ' })).toBeUndefined();
  });
});
