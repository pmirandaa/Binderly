import { describe, expect, it } from 'vitest';

import {
  MAX_BIO_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  SOCIAL_LINK_LABEL_MAX,
  SOCIAL_LINK_URL_MAX,
  validateBio,
  validateDisplayName,
  validateHandle,
  validateSlug,
  validateSocialLinkLabel,
  validateSocialLinkUrl,
} from './validation';

describe('validateHandle', () => {
  it('accepts a 3-char lowercase handle', () => {
    expect(validateHandle('abc')).toEqual({ kind: 'ok', message: null });
  });

  it('accepts hyphens inside the handle', () => {
    expect(validateHandle('pablo-test').kind).toBe('ok');
  });

  it('rejects empty input as too-short', () => {
    expect(validateHandle('').kind).toBe('too-short');
  });

  it('rejects 2-char input as too-short', () => {
    expect(validateHandle('pa').kind).toBe('too-short');
  });

  it('rejects 31-char input as too-long', () => {
    expect(validateHandle('a'.repeat(31)).kind).toBe('too-long');
  });

  it('rejects uppercase characters as invalid-chars', () => {
    expect(validateHandle('Pablo').kind).toBe('invalid-chars');
  });

  it('rejects a leading hyphen with its own message', () => {
    expect(validateHandle('-pablo').kind).toBe('leading-hyphen');
  });

  it('rejects whitespace inside the handle', () => {
    expect(validateHandle('pablo here').kind).toBe('invalid-chars');
  });

  it('rejects underscores (picker pattern is hyphen-only)', () => {
    expect(validateHandle('pablo_test').kind).toBe('invalid-chars');
  });

  it('trims trailing whitespace before validating', () => {
    expect(validateHandle('  pablo  ').kind).toBe('ok');
  });
});

describe('validateSlug', () => {
  it('accepts a typical slug', () => {
    expect(validateSlug('my-binder').kind).toBe('ok');
  });

  it('accepts a slug at the upper bound', () => {
    expect(validateSlug('a'.repeat(MAX_SLUG_LENGTH)).kind).toBe('ok');
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

  it('rejects a leading hyphen', () => {
    expect(validateSlug('-my-binder').kind).toBe('invalid-chars');
  });
});

describe('validateBio', () => {
  it('accepts an empty bio', () => {
    expect(validateBio('')).toEqual({ kind: 'ok', message: null });
  });

  it('accepts a bio at the upper bound', () => {
    expect(validateBio('x'.repeat(MAX_BIO_LENGTH)).kind).toBe('ok');
  });

  it('rejects a bio one char past the upper bound', () => {
    const v = validateBio('x'.repeat(MAX_BIO_LENGTH + 1));
    expect(v.kind).toBe('too-long');
    expect(v.message).toMatch(/currently/);
  });
});

describe('validateDisplayName', () => {
  it('accepts an empty display name', () => {
    expect(validateDisplayName('').kind).toBe('ok');
  });

  it('accepts a display name at the upper bound', () => {
    expect(validateDisplayName('x'.repeat(MAX_DISPLAY_NAME_LENGTH)).kind).toBe('ok');
  });

  it('rejects a display name one char past the upper bound', () => {
    expect(validateDisplayName('x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)).kind).toBe('too-long');
  });
});

describe('validateSocialLinkUrl (#FU-51)', () => {
  it('treats empty input as an incomplete row, not an error', () => {
    expect(validateSocialLinkUrl('   ').kind).toBe('empty');
  });

  it('accepts an https URL', () => {
    expect(validateSocialLinkUrl('https://example.com/path').kind).toBe('ok');
  });

  it('accepts an http URL', () => {
    expect(validateSocialLinkUrl('http://example.com').kind).toBe('ok');
  });

  it('rejects a bare word', () => {
    expect(validateSocialLinkUrl('notaurl').kind).toBe('invalid');
  });

  it('rejects a non-http(s) scheme', () => {
    expect(validateSocialLinkUrl('javascript:alert(1)').kind).toBe('invalid');
  });

  it('rejects a URL past the length cap', () => {
    expect(
      validateSocialLinkUrl(`https://example.com/${'a'.repeat(SOCIAL_LINK_URL_MAX)}`).kind,
    ).toBe('too-long');
  });
});

describe('validateSocialLinkLabel (#FU-51)', () => {
  it('treats empty input as incomplete', () => {
    expect(validateSocialLinkLabel('').kind).toBe('empty');
  });

  it('accepts a label at the upper bound', () => {
    expect(validateSocialLinkLabel('x'.repeat(SOCIAL_LINK_LABEL_MAX)).kind).toBe('ok');
  });

  it('rejects a label past the upper bound', () => {
    expect(validateSocialLinkLabel('x'.repeat(SOCIAL_LINK_LABEL_MAX + 1)).kind).toBe('too-long');
  });
});
