import { describe, expect, it } from 'vitest';

import {
  MAX_BIO_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  validateBio,
  validateDisplayName,
  validateHandle,
  validateSlug,
} from './validation';

describe('validateHandle (mobile)', () => {
  it('accepts a 3-char lowercase handle', () => {
    expect(validateHandle('abc').kind).toBe('ok');
  });

  it('accepts internal hyphens', () => {
    expect(validateHandle('pablo-test').kind).toBe('ok');
  });

  it('rejects empty input', () => {
    expect(validateHandle('').kind).toBe('too-short');
  });

  it('rejects 2-char input', () => {
    expect(validateHandle('pa').kind).toBe('too-short');
  });

  it('rejects 31-char input', () => {
    expect(validateHandle('a'.repeat(31)).kind).toBe('too-long');
  });

  it('rejects uppercase characters', () => {
    expect(validateHandle('Pablo').kind).toBe('invalid-chars');
  });

  it('rejects a leading hyphen', () => {
    expect(validateHandle('-pablo').kind).toBe('leading-hyphen');
  });

  it('rejects whitespace inside the handle', () => {
    expect(validateHandle('pablo here').kind).toBe('invalid-chars');
  });

  it('rejects underscores', () => {
    expect(validateHandle('pablo_test').kind).toBe('invalid-chars');
  });

  it('trims trailing whitespace before validating', () => {
    expect(validateHandle('  pablo  ').kind).toBe('ok');
  });
});

describe('validateSlug (mobile)', () => {
  it('accepts a typical slug', () => {
    expect(validateSlug('my-binder').kind).toBe('ok');
  });

  it('rejects an empty slug', () => {
    expect(validateSlug('').kind).toBe('too-short');
  });

  it('rejects a slug just past the upper bound', () => {
    expect(validateSlug('a'.repeat(MAX_SLUG_LENGTH + 1)).kind).toBe('too-long');
  });

  it('rejects whitespace inside the slug', () => {
    expect(validateSlug('my binder').kind).toBe('invalid-chars');
  });
});

describe('validateBio (mobile)', () => {
  it('accepts an empty bio', () => {
    expect(validateBio('').kind).toBe('ok');
  });

  it('accepts a bio at the upper bound', () => {
    expect(validateBio('x'.repeat(MAX_BIO_LENGTH)).kind).toBe('ok');
  });

  it('rejects a bio one char past the upper bound', () => {
    expect(validateBio('x'.repeat(MAX_BIO_LENGTH + 1)).kind).toBe('too-long');
  });
});

describe('validateDisplayName (mobile)', () => {
  it('accepts an empty display name', () => {
    expect(validateDisplayName('').kind).toBe('ok');
  });

  it('rejects a display name one char past the upper bound', () => {
    expect(validateDisplayName('x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)).kind).toBe('too-long');
  });
});
