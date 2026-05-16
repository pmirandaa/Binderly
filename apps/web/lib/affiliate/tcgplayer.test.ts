import { describe, expect, it } from 'vitest';

import {
  TCGPLAYER_AFFILIATE_BASE_URL,
  TCGPLAYER_UTM_CAMPAIGN,
  TCGPLAYER_UTM_MEDIUM,
  TCGPLAYER_UTM_SOURCE,
  buildTcgplayerUrl,
} from './tcgplayer';

describe('buildTcgplayerUrl', () => {
  it('builds a URL with the canonical base + UTM triple + affiliate id', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Charizard', setName: 'Base Set', number: '4' },
      { affiliateId: 'aff-123' },
    );
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(TCGPLAYER_AFFILIATE_BASE_URL);
    expect(parsed.searchParams.get('productLineName')).toBe('pokemon');
    expect(parsed.searchParams.get('utm_source')).toBe(TCGPLAYER_UTM_SOURCE);
    expect(parsed.searchParams.get('utm_medium')).toBe(TCGPLAYER_UTM_MEDIUM);
    expect(parsed.searchParams.get('utm_campaign')).toBe(TCGPLAYER_UTM_CAMPAIGN);
    expect(parsed.searchParams.get('utm_id')).toBe('aff-123');
  });

  it('joins name + number + set name into the `q` search query', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Charizard', setName: 'Base Set', number: '4' },
      { affiliateId: 'aff-123' },
    );
    const q = new URL(url as string).searchParams.get('q');
    expect(q).toBe('Charizard 4 Base Set');
  });

  it('omits the number from `q` when the card has no number', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Charizard', setName: 'Base Set' },
      { affiliateId: 'aff-123' },
    );
    const q = new URL(url as string).searchParams.get('q');
    expect(q).toBe('Charizard Base Set');
  });

  it('omits the set name from `q` when the card has no set context', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Charizard', number: '4' },
      { affiliateId: 'aff-123' },
    );
    const q = new URL(url as string).searchParams.get('q');
    expect(q).toBe('Charizard 4');
  });

  it('encodes apostrophes in card names', () => {
    const url = buildTcgplayerUrl(
      { cardName: "Farfetch'd", setName: 'Jungle' },
      { affiliateId: 'aff-123' },
    );
    expect(url).not.toBeNull();
    // The raw URL must keep the apostrophe percent-encoded so
    // browsers don't truncate the query at a stray quote.
    expect(url).toContain('Farfetch%27d');
    const q = new URL(url as string).searchParams.get('q');
    expect(q).toBe("Farfetch'd Jungle");
  });

  it('encodes accented characters in card names', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Pokémon Center Lady', setName: 'Astral Radiance' },
      { affiliateId: 'aff-123' },
    );
    expect(url).not.toBeNull();
    expect(url).toContain('Pok%C3%A9mon');
    const q = new URL(url as string).searchParams.get('q');
    expect(q).toBe('Pokémon Center Lady Astral Radiance');
  });

  it('encodes spaces using URLSearchParams (plus signs)', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Mewtwo VStar', setName: 'Pokémon GO' },
      { affiliateId: 'aff-123' },
    );
    // URLSearchParams.toString() emits "+" for spaces, never raw spaces.
    expect(url).not.toContain(' ');
  });

  it('returns null when the affiliate id is undefined', () => {
    const url = buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: undefined });
    expect(url).toBeNull();
  });

  it('returns null when the affiliate id is null', () => {
    const url = buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: null });
    expect(url).toBeNull();
  });

  it('returns null when the affiliate id is an empty string', () => {
    const url = buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: '' });
    expect(url).toBeNull();
  });

  it('returns null when the affiliate id is only whitespace', () => {
    const url = buildTcgplayerUrl({ cardName: 'Charizard' }, { affiliateId: '   ' });
    expect(url).toBeNull();
  });

  it('returns null when the card name is empty', () => {
    const url = buildTcgplayerUrl({ cardName: '' }, { affiliateId: 'aff-123' });
    expect(url).toBeNull();
  });

  it('returns null when the card name is only whitespace', () => {
    const url = buildTcgplayerUrl({ cardName: '   ' }, { affiliateId: 'aff-123' });
    expect(url).toBeNull();
  });

  it('treats empty set name as omitted', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Charizard', setName: '', number: '4' },
      { affiliateId: 'aff-123' },
    );
    const q = new URL(url as string).searchParams.get('q');
    expect(q).toBe('Charizard 4');
  });

  it('treats null number as omitted', () => {
    const url = buildTcgplayerUrl(
      { cardName: 'Charizard', setName: 'Base Set', number: null },
      { affiliateId: 'aff-123' },
    );
    const q = new URL(url as string).searchParams.get('q');
    expect(q).toBe('Charizard Base Set');
  });

  it('trims surrounding whitespace from inputs', () => {
    const url = buildTcgplayerUrl(
      { cardName: '  Charizard  ', setName: ' Base Set ', number: ' 4 ' },
      { affiliateId: ' aff-123 ' },
    );
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('q')).toBe('Charizard 4 Base Set');
    expect(parsed.searchParams.get('utm_id')).toBe('aff-123');
  });
});
