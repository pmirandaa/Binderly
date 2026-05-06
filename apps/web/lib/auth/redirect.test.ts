import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POST_AUTH_PATH,
  SIGN_IN_PATH,
  buildSignInUrl,
  extractNext,
  safeNext,
} from './redirect';

describe('safeNext', () => {
  it('returns home for missing / empty / non-string input', () => {
    expect(safeNext(undefined)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext(null)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext('')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext(42 as unknown as string)).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it('accepts in-app absolute paths', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/collection')).toBe('/collection');
    expect(safeNext('/collection/abc?tab=1')).toBe('/collection/abc?tab=1');
  });

  it('rejects external absolute URLs (open-redirect guard)', () => {
    expect(safeNext('http://evil.com')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext('https://evil.com/x')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext('javascript:alert(1)')).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeNext('//evil.com')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext('//evil.com/path')).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it('rejects relative paths without a leading slash', () => {
    expect(safeNext('collection')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext('../etc')).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it('rejects values containing newlines, tabs, or backslashes', () => {
    expect(safeNext('/foo\nbar')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext('/foo\rbar')).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext('/foo\\bar')).toBe(DEFAULT_POST_AUTH_PATH);
  });
});

describe('extractNext', () => {
  it('returns home when search params are missing or empty', () => {
    expect(extractNext(null)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(extractNext(undefined)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(extractNext(new URLSearchParams(''))).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it('reads ?next= and runs it through safeNext', () => {
    expect(extractNext(new URLSearchParams('next=%2Fcollection'))).toBe('/collection');
    expect(extractNext(new URLSearchParams('next=%2F'))).toBe('/');
  });

  it('rejects unsafe ?next= values via safeNext', () => {
    expect(extractNext(new URLSearchParams('next=https%3A%2F%2Fevil.com'))).toBe(
      DEFAULT_POST_AUTH_PATH,
    );
    expect(extractNext(new URLSearchParams('next=%2F%2Fevil.com'))).toBe(DEFAULT_POST_AUTH_PATH);
  });
});

describe('buildSignInUrl', () => {
  it('returns the bare sign-in path when next is missing or unsafe', () => {
    expect(buildSignInUrl(null)).toBe(SIGN_IN_PATH);
    expect(buildSignInUrl(undefined)).toBe(SIGN_IN_PATH);
    expect(buildSignInUrl('')).toBe(SIGN_IN_PATH);
    expect(buildSignInUrl('https://evil.com')).toBe(SIGN_IN_PATH);
  });

  it('returns the bare sign-in path when next === "/" (no query needed)', () => {
    expect(buildSignInUrl('/')).toBe(SIGN_IN_PATH);
  });

  it('encodes the next param when present', () => {
    expect(buildSignInUrl('/collection')).toBe('/auth/sign-in?next=%2Fcollection');
    expect(buildSignInUrl('/collection/abc?tab=1')).toBe(
      '/auth/sign-in?next=%2Fcollection%2Fabc%3Ftab%3D1',
    );
  });
});
