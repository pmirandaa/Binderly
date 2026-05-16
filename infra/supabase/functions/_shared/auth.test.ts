import { describe, expect, it } from 'vitest';

import { decodeAuthHeader, decodeClaims, extractBearerToken, isExpired } from './auth.ts';
import { ApiError } from './errors.ts';
import { makeFakeJwt } from './test-helpers.ts';

describe('extractBearerToken', () => {
  it('returns the token from a well-formed header', () => {
    const headers = new Headers({ authorization: 'Bearer abc.def.ghi' });
    expect(extractBearerToken(headers)).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme prefix', () => {
    const headers = new Headers({ authorization: 'bearer abc.def.ghi' });
    expect(extractBearerToken(headers)).toBe('abc.def.ghi');
  });

  it('throws AUTH error when the header is missing', () => {
    const headers = new Headers();
    expect(() => extractBearerToken(headers)).toThrow(ApiError);
  });

  it('throws AUTH error when the scheme is wrong', () => {
    const headers = new Headers({ authorization: 'Basic abc' });
    expect(() => extractBearerToken(headers)).toThrow(/Bearer/);
  });

  it('throws AUTH error when the token is empty after the prefix', () => {
    const headers = new Headers({ authorization: 'Bearer ' });
    expect(() => extractBearerToken(headers)).toThrow(ApiError);
  });
});

describe('decodeClaims', () => {
  it('decodes a well-formed JWT payload', () => {
    const token = makeFakeJwt({ sub: 'sub-1', email: 'a@b.test' });
    const claims = decodeClaims(token);
    expect(claims.sub).toBe('sub-1');
    expect(claims.email).toBe('a@b.test');
    expect(claims.role).toBe('authenticated');
  });

  it('throws AUTH error when the token has too few segments', () => {
    expect(() => decodeClaims('abc.def')).toThrow(/three dot/);
  });

  it('throws AUTH error when the payload segment is empty', () => {
    expect(() => decodeClaims('abc..ghi')).toThrow(ApiError);
  });

  it('throws AUTH error when the payload is not base64url JSON', () => {
    expect(() => decodeClaims('abc.!!!.ghi')).toThrow(/base64url/);
  });

  it('throws AUTH error when the payload is missing `sub`', () => {
    const noSub = makeFakeJwt({ sub: undefined });
    expect(() => decodeClaims(noSub)).toThrow(/sub/);
  });

  it('throws AUTH error when the role is unrecognized', () => {
    const wrongRole = makeFakeJwt({ role: 'admin' });
    expect(() => decodeClaims(wrongRole)).toThrow(/role/);
  });

  it('throws AUTH error when the exp claim is not a number', () => {
    const badExp = makeFakeJwt({ exp: 'soon' });
    expect(() => decodeClaims(badExp)).toThrow(/exp/);
  });

  it('throws AUTH error when the iat claim is not a number', () => {
    const badIat = makeFakeJwt({ iat: 'now' });
    expect(() => decodeClaims(badIat)).toThrow(/iat/);
  });

  it('omits email when it is not a string', () => {
    const noEmail = makeFakeJwt({ email: 123 });
    const claims = decodeClaims(noEmail);
    expect(claims.email).toBeUndefined();
  });
});

describe('isExpired', () => {
  it('returns false for a fresh exp', () => {
    const claims = decodeClaims(makeFakeJwt());
    expect(isExpired(claims)).toBe(false);
  });

  it('returns true for an exp in the distant past', () => {
    const claims = decodeClaims(makeFakeJwt({ exp: 0, iat: 0 }));
    expect(isExpired(claims)).toBe(true);
  });

  it('returns true exactly at exp boundary', () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = decodeClaims(makeFakeJwt({ exp: now - 60, iat: now - 3660 }));
    expect(isExpired(claims, now)).toBe(true);
  });

  it('honors the 30-second skew for nearly-expired tokens', () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = decodeClaims(makeFakeJwt({ exp: now - 5, iat: now - 3605 }));
    expect(isExpired(claims, now)).toBe(false);
  });
});

describe('decodeAuthHeader', () => {
  it('returns token + claims for a valid header', () => {
    const headers = new Headers({ authorization: `Bearer ${makeFakeJwt()}` });
    const result = decodeAuthHeader(headers);
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.claims.role).toBe('authenticated');
  });

  it('rejects anon tokens', () => {
    const headers = new Headers({
      authorization: `Bearer ${makeFakeJwt({ role: 'anon' })}`,
    });
    expect(() => decodeAuthHeader(headers)).toThrow(/authenticated/);
  });

  it('rejects expired tokens', () => {
    const headers = new Headers({
      authorization: `Bearer ${makeFakeJwt({ exp: 1, iat: 0 })}`,
    });
    expect(() => decodeAuthHeader(headers)).toThrow(/exp/);
  });

  it('rejects requests with no Authorization header', () => {
    expect(() => decodeAuthHeader(new Headers())).toThrow(ApiError);
  });
});
