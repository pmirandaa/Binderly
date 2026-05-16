import { describe, expect, it } from 'vitest';

import {
  MOBILE_TCGPLAYER_AFFILIATE_ID_ENV,
  WEB_TCGPLAYER_AFFILIATE_ID_ENV,
  buildMobileTcgplayerUrl,
  buildWebTcgplayerUrl,
  readAffiliateIdFromEnv,
} from './index';

describe('readAffiliateIdFromEnv', () => {
  it('reads a trimmed affiliate id from the given source', () => {
    const id = readAffiliateIdFromEnv(WEB_TCGPLAYER_AFFILIATE_ID_ENV, {
      [WEB_TCGPLAYER_AFFILIATE_ID_ENV]: '  aff-123  ',
    });
    expect(id).toBe('aff-123');
  });

  it('returns undefined when the env var is missing', () => {
    expect(readAffiliateIdFromEnv(WEB_TCGPLAYER_AFFILIATE_ID_ENV, {})).toBeUndefined();
  });

  it('returns undefined when the env var is empty', () => {
    expect(
      readAffiliateIdFromEnv(WEB_TCGPLAYER_AFFILIATE_ID_ENV, {
        [WEB_TCGPLAYER_AFFILIATE_ID_ENV]: '',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the env var is only whitespace', () => {
    expect(
      readAffiliateIdFromEnv(WEB_TCGPLAYER_AFFILIATE_ID_ENV, {
        [WEB_TCGPLAYER_AFFILIATE_ID_ENV]: '   ',
      }),
    ).toBeUndefined();
  });
});

describe('buildWebTcgplayerUrl', () => {
  it('builds a URL when the web-prefixed env var is set', () => {
    const url = buildWebTcgplayerUrl(
      { cardName: 'Charizard', number: '4', setName: 'Base Set' },
      { [WEB_TCGPLAYER_AFFILIATE_ID_ENV]: 'aff-web' },
    );
    expect(url).not.toBeNull();
    expect(new URL(url as string).searchParams.get('utm_id')).toBe('aff-web');
  });

  it('returns null when the web-prefixed env var is missing', () => {
    expect(buildWebTcgplayerUrl({ cardName: 'Charizard' }, {})).toBeNull();
  });

  it('ignores the mobile env var on the web side', () => {
    expect(
      buildWebTcgplayerUrl(
        { cardName: 'Charizard' },
        { [MOBILE_TCGPLAYER_AFFILIATE_ID_ENV]: 'aff-mobile' },
      ),
    ).toBeNull();
  });
});

describe('buildMobileTcgplayerUrl', () => {
  it('builds a URL when the Expo-prefixed env var is set', () => {
    const url = buildMobileTcgplayerUrl(
      { cardName: 'Charizard', number: '4', setName: 'Base Set' },
      { [MOBILE_TCGPLAYER_AFFILIATE_ID_ENV]: 'aff-mobile' },
    );
    expect(url).not.toBeNull();
    expect(new URL(url as string).searchParams.get('utm_id')).toBe('aff-mobile');
  });

  it('returns null when the Expo-prefixed env var is missing', () => {
    expect(buildMobileTcgplayerUrl({ cardName: 'Charizard' }, {})).toBeNull();
  });
});
