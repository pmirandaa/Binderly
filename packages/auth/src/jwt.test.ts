// Unit tests for the JWT extraction + decode helpers.
//
// We synthesize JWTs by hand-encoding the header and payload
// segments (signature is irrelevant — `decodeClaims` does NOT
// verify, only parses; trust comes from `supabase.auth.getUser`).

import { describe, expect, it } from 'vitest';

import { AuthError } from './errors.js';
import { decodeClaims, extractBearerToken, isExpired } from './jwt.js';

import type { AuthClaims } from './types.js';

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature-not-verified-here`;
}

const VALID_PAYLOAD = {
  sub: '11111111-1111-1111-1111-111111111111',
  role: 'authenticated' as const,
  email: 'verify@example.com',
  iat: 1_700_000_000,
  exp: 9_999_999_999,
  aal: 'aal1',
};

describe('extractBearerToken', () => {
  it('returns the token from a Web Headers object', () => {
    const token = makeJwt(VALID_PAYLOAD);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    expect(extractBearerToken(headers)).toBe(token);
  });

  it('returns the token from a plain object (case-insensitive header name)', () => {
    const token = makeJwt(VALID_PAYLOAD);
    expect(extractBearerToken({ Authorization: `Bearer ${token}` })).toBe(token);
    expect(extractBearerToken({ authorization: `Bearer ${token}` })).toBe(token);
    expect(extractBearerToken({ AUTHORIZATION: `Bearer ${token}` })).toBe(token);
  });

  it('throws AuthError(missing_token) when the header is absent', () => {
    expect.assertions(2);
    try {
      extractBearerToken(new Headers());
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('missing_token');
    }
  });

  it('throws AuthError(invalid_token) when the scheme is not Bearer', () => {
    expect.assertions(2);
    try {
      extractBearerToken(new Headers({ Authorization: 'Basic abc=' }));
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('throws AuthError(invalid_token) when the Bearer prefix is present but the token is empty', () => {
    expect.assertions(2);
    try {
      extractBearerToken(new Headers({ Authorization: 'Bearer ' }));
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('respects a custom header name override', () => {
    const token = makeJwt(VALID_PAYLOAD);
    const headers = new Headers({ 'x-binderly-auth': `Bearer ${token}` });
    expect(extractBearerToken(headers, 'x-binderly-auth')).toBe(token);
  });
});

describe('decodeClaims', () => {
  it('decodes a well-formed JWT into AuthClaims', () => {
    const token = makeJwt(VALID_PAYLOAD);
    const claims: AuthClaims = decodeClaims(token);
    expect(claims.sub).toBe(VALID_PAYLOAD.sub);
    expect(claims.role).toBe('authenticated');
    expect(claims.email).toBe(VALID_PAYLOAD.email);
    expect(claims.exp).toBe(VALID_PAYLOAD.exp);
    expect(claims.iat).toBe(VALID_PAYLOAD.iat);
    expect(claims.aal).toBe('aal1');
    expect(claims.raw).toMatchObject(VALID_PAYLOAD);
  });

  it('rejects a JWT with the wrong segment count', () => {
    expect.assertions(2);
    try {
      decodeClaims('not.enough');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('rejects a JWT whose payload is not valid base64url JSON', () => {
    expect.assertions(2);
    try {
      decodeClaims('aaa.!!!notbase64.bbb');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('rejects a JWT missing the `sub` claim', () => {
    expect.assertions(2);
    const token = makeJwt({ ...VALID_PAYLOAD, sub: '' });
    try {
      decodeClaims(token);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('rejects a JWT with an unexpected `role` claim', () => {
    expect.assertions(2);
    const token = makeJwt({ ...VALID_PAYLOAD, role: 'admin' });
    try {
      decodeClaims(token);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });

  it('rejects a JWT missing the `exp` claim', () => {
    expect.assertions(2);
    const { exp: _exp, ...rest } = VALID_PAYLOAD;
    const token = makeJwt(rest);
    try {
      decodeClaims(token);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_token');
    }
  });
});

describe('isExpired', () => {
  it('returns true when exp is in the past beyond the skew window', () => {
    const claims = decodeClaims(makeJwt({ ...VALID_PAYLOAD, exp: 1_000 }));
    expect(isExpired(claims, 1_000_000)).toBe(true);
  });

  it('returns false when exp is comfortably in the future', () => {
    const claims = decodeClaims(makeJwt({ ...VALID_PAYLOAD, exp: 9_999_999_999 }));
    expect(isExpired(claims, 1_000_000)).toBe(false);
  });

  it('respects the 30-second clock skew (exp 20s in the past still counts as fresh)', () => {
    const now = 2_000_000;
    const claims = decodeClaims(makeJwt({ ...VALID_PAYLOAD, exp: now - 20 }));
    expect(isExpired(claims, now)).toBe(false);
  });

  it('marks tokens 60 seconds in the past as expired (beyond skew)', () => {
    const now = 2_000_000;
    const claims = decodeClaims(makeJwt({ ...VALID_PAYLOAD, exp: now - 60 }));
    expect(isExpired(claims, now)).toBe(true);
  });
});
