// Tests for `common.ts`. Each schema has at least one positive
// case (valid input parses cleanly) and one negative case
// (invalid input is rejected) per the elaborated spec.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  apiErrorSchema,
  apiResultSchema,
  cardConditionSchema,
  currencyCodeSchema,
  decodeCursor,
  encodeCursor,
  gradeTierSchema,
  isoDateSchema,
  isoDateTimeSchema,
  languageSchema,
  marketCodeSchema,
  numericString2dpSchema,
  numericString6dpSchema,
  paginatedResponseSchema,
  uuidSchema,
} from './common.js';

describe('uuidSchema', () => {
  it('accepts a v4 UUID', () => {
    expect(uuidSchema.parse('11111111-2222-4333-8444-555555555555')).toBe(
      '11111111-2222-4333-8444-555555555555',
    );
  });

  it('rejects a non-UUID string', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('isoDateTimeSchema', () => {
  it('accepts an ISO datetime with `Z` offset', () => {
    expect(isoDateTimeSchema.parse('2026-05-05T12:34:56Z')).toBe('2026-05-05T12:34:56Z');
  });

  it('accepts an ISO datetime with explicit numeric offset', () => {
    expect(isoDateTimeSchema.parse('2026-05-05T12:34:56-04:00')).toBe('2026-05-05T12:34:56-04:00');
  });

  it('rejects a bare local datetime (no offset)', () => {
    expect(isoDateTimeSchema.safeParse('2026-05-05T12:34:56').success).toBe(false);
  });
});

describe('isoDateSchema', () => {
  it('accepts a calendar date', () => {
    expect(isoDateSchema.parse('2026-05-05')).toBe('2026-05-05');
  });

  it('rejects a datetime', () => {
    expect(isoDateSchema.safeParse('2026-05-05T12:34:56Z').success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(isoDateSchema.safeParse('2026/05/05').success).toBe(false);
  });
});

describe('numericString2dpSchema', () => {
  it('accepts integer strings', () => {
    expect(numericString2dpSchema.parse('100')).toBe('100');
  });

  it('accepts strings with up to 2 fractional digits', () => {
    expect(numericString2dpSchema.parse('1234.56')).toBe('1234.56');
    expect(numericString2dpSchema.parse('0.05')).toBe('0.05');
  });

  it('accepts negative values', () => {
    expect(numericString2dpSchema.parse('-12.34')).toBe('-12.34');
  });

  it('rejects 3+ fractional digits', () => {
    expect(numericString2dpSchema.safeParse('1.234').success).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(numericString2dpSchema.safeParse('abc').success).toBe(false);
  });
});

describe('numericString6dpSchema', () => {
  it('accepts up to 6 fractional digits', () => {
    expect(numericString6dpSchema.parse('1.234567')).toBe('1.234567');
  });

  it('rejects 7+ fractional digits', () => {
    expect(numericString6dpSchema.safeParse('1.2345678').success).toBe(false);
  });
});

describe('currencyCodeSchema', () => {
  it('accepts a 3-letter uppercase ISO-4217 code', () => {
    expect(currencyCodeSchema.parse('USD')).toBe('USD');
    expect(currencyCodeSchema.parse('JPY')).toBe('JPY');
  });

  it('rejects lowercase', () => {
    expect(currencyCodeSchema.safeParse('usd').success).toBe(false);
  });

  it('rejects non-3-letter codes', () => {
    expect(currencyCodeSchema.safeParse('USDD').success).toBe(false);
  });
});

describe('languageSchema', () => {
  it('accepts en and jp', () => {
    expect(languageSchema.parse('en')).toBe('en');
    expect(languageSchema.parse('jp')).toBe('jp');
  });

  it('rejects unsupported languages', () => {
    expect(languageSchema.safeParse('fr').success).toBe(false);
  });
});

describe('marketCodeSchema', () => {
  it('accepts the canonical EBAY_US market', () => {
    expect(marketCodeSchema.parse('EBAY_US')).toBe('EBAY_US');
  });

  it('rejects unknown markets', () => {
    expect(marketCodeSchema.safeParse('EBAY_FR').success).toBe(false);
  });
});

describe('gradeTierSchema', () => {
  it('accepts PSA_10', () => {
    expect(gradeTierSchema.parse('PSA_10')).toBe('PSA_10');
  });

  it('rejects an unknown tier', () => {
    expect(gradeTierSchema.safeParse('PSA_11').success).toBe(false);
  });
});

describe('cardConditionSchema', () => {
  it('accepts NEAR_MINT', () => {
    expect(cardConditionSchema.parse('NEAR_MINT')).toBe('NEAR_MINT');
  });

  it('rejects unknown conditions', () => {
    expect(cardConditionSchema.safeParse('PRISTINE').success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts a well-formed error envelope', () => {
    const result = apiErrorSchema.parse({
      code: 'NOT_FOUND',
      message: 'card 11111111-2222-4333-8444-555555555555 was not found',
    });
    expect(result.code).toBe('NOT_FOUND');
  });

  it('accepts an envelope with details', () => {
    expect(
      apiErrorSchema.parse({
        code: 'VALIDATION',
        message: 'invalid request',
        details: { issues: [{ path: ['quantity'], message: 'must be >= 1' }] },
      }).details,
    ).toBeDefined();
  });

  it('rejects an unknown code', () => {
    expect(apiErrorSchema.safeParse({ code: 'TEAPOT', message: 'i am a teapot' }).success).toBe(
      false,
    );
  });

  it('rejects an empty message', () => {
    expect(apiErrorSchema.safeParse({ code: 'INTERNAL', message: '' }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      apiErrorSchema.safeParse({
        code: 'INTERNAL',
        message: 'oops',
        unexpected: 'extra',
      }).success,
    ).toBe(false);
  });
});

describe('apiResultSchema', () => {
  const cardResult = apiResultSchema(z.object({ id: uuidSchema }).strict());

  it('parses a success branch', () => {
    const parsed = cardResult.parse({
      ok: true,
      data: { id: '11111111-2222-4333-8444-555555555555' },
    });
    expect(parsed.ok).toBe(true);
  });

  it('parses an error branch', () => {
    const parsed = cardResult.parse({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'not found' },
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a payload with both data and error', () => {
    expect(
      cardResult.safeParse({
        ok: true,
        data: { id: '11111111-2222-4333-8444-555555555555' },
        error: { code: 'INTERNAL', message: 'oops' },
      }).success,
    ).toBe(false);
  });

  it('rejects an envelope with the wrong data shape', () => {
    expect(cardResult.safeParse({ ok: true, data: { id: 'not-a-uuid' } }).success).toBe(false);
  });
});

describe('paginatedResponseSchema', () => {
  const cardsPage = paginatedResponseSchema(z.object({ id: uuidSchema }).strict());

  it('parses a populated page', () => {
    const page = cardsPage.parse({
      items: [{ id: '11111111-2222-4333-8444-555555555555' }],
      nextCursor: 'eyJsYXN0SWQiOiJ4In0',
      total: 1,
    });
    expect(page.items.length).toBe(1);
    expect(page.total).toBe(1);
  });

  it('parses a last-page response (nextCursor null, no total)', () => {
    expect(
      cardsPage.parse({
        items: [],
        nextCursor: null,
      }).nextCursor,
    ).toBeNull();
  });

  it('rejects a negative total', () => {
    expect(cardsPage.safeParse({ items: [], nextCursor: null, total: -1 }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      cardsPage.safeParse({
        items: [],
        nextCursor: null,
        unexpected: 'extra',
      }).success,
    ).toBe(false);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a JSON-object payload', () => {
    const payload = { lastId: '11111111-2222-4333-8444-555555555555', tier: 'PSA_10' };
    const encoded = encodeCursor(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(payload);
  });

  it('produces URL-safe base64 (no `+` `/` `=`)', () => {
    const encoded = encodeCursor({ k: 'a value with / and + and special bytes ÿ' });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('rejects malformed cursors', () => {
    expect(() => decodeCursor('not-base64!!!')).toThrow();
  });

  it('rejects cursors that decode to a JSON array, not an object', () => {
    const arrayCursor = Buffer.from('[1,2,3]', 'utf-8').toString('base64url');
    expect(() => decodeCursor(arrayCursor)).toThrow(/must be a JSON object/);
  });
});
