// Pure validators for the shareables settings UI.
//
// Shared between the web and mobile screens — the mobile screen
// re-exports the same functions from `@binderly/api-contracts` +
// these helpers so both platforms enforce the same rules without
// a separate fork. Keeping the validators pure (no Tamagui, no
// React, no fetch) is what makes them safe to import from both
// the web `app/` tree and the mobile `src/` tree.
//
// The schemas these functions wrap are owned by
// `packages/api-contracts/src/auth.ts` +
// `packages/api-contracts/src/shareables.ts`; the helpers add
// friendly error copy on top.

import { SHAREABLE_HANDLE_PATTERN, shareableHandleSchema } from '@binderly/api-contracts';

/** Max bio length (chars). Matches `updateProfileRequest.bio`. */
export const MAX_BIO_LENGTH = 280;

/** Max display name length (chars). Matches `updateProfileRequest.displayName`. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/** Slug picker pattern. Same shape as the handle but slug-local. */
export const SHAREABLE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,49}$/;
export const MAX_SLUG_LENGTH = 50;

/**
 * Result of a sync handle validation. `'unknown'` is not a kind
 * here — that's only emitted by the *availability* hook (network
 * round-trip).
 */
export type HandleValidationKind = 'ok' | 'too-short' | 'too-long' | 'invalid-chars' | 'leading-hyphen';

export interface HandleValidation {
  readonly kind: HandleValidationKind;
  /** User-facing copy ready to render in an `<ErrorText>` slot. */
  readonly message: string | null;
}

/**
 * Validate a handle's shape. Whitespace is trimmed before
 * checking length; the regex check then runs against the
 * trimmed value. Empty strings short-circuit to `'too-short'`
 * with friendly copy.
 */
export function validateHandle(input: string): HandleValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: 'too-short', message: 'Pick a handle (3–30 characters).' };
  }
  if (trimmed.length < 3) {
    return { kind: 'too-short', message: 'Handle needs at least 3 characters.' };
  }
  if (trimmed.length > 30) {
    return { kind: 'too-long', message: 'Handle is limited to 30 characters.' };
  }
  if (trimmed.startsWith('-')) {
    return {
      kind: 'leading-hyphen',
      message: 'Handle can\u2019t start with a hyphen.',
    };
  }
  if (!SHAREABLE_HANDLE_PATTERN.test(trimmed)) {
    return {
      kind: 'invalid-chars',
      message: 'Use lowercase letters, numbers, and hyphens only.',
    };
  }
  return { kind: 'ok', message: null };
}

/**
 * Same shape but for the public-page slug. The slug is owned
 * per-(user, shareable); duplicate-per-user is a server-side
 * 409 the UI surfaces as "slug already used in another of your
 * shareables."
 */
export type SlugValidationKind = 'ok' | 'too-short' | 'too-long' | 'invalid-chars';

export interface SlugValidation {
  readonly kind: SlugValidationKind;
  readonly message: string | null;
}

export function validateSlug(input: string): SlugValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: 'too-short', message: 'Pick a slug for your URL.' };
  }
  if (trimmed.length < 3) {
    return { kind: 'too-short', message: 'Slug needs at least 3 characters.' };
  }
  if (trimmed.length > MAX_SLUG_LENGTH) {
    return { kind: 'too-long', message: `Slug is limited to ${MAX_SLUG_LENGTH} characters.` };
  }
  if (!SHAREABLE_SLUG_PATTERN.test(trimmed)) {
    return {
      kind: 'invalid-chars',
      message: 'Use lowercase letters, numbers, and hyphens; start with a letter or number.',
    };
  }
  return { kind: 'ok', message: null };
}

export interface BioValidation {
  readonly kind: 'ok' | 'too-long';
  readonly message: string | null;
}

/**
 * Validate the bio length. Bios are optional — an empty bio is
 * the "no bio" sentinel and is reported as `'ok'`.
 */
export function validateBio(input: string): BioValidation {
  if (input.length > MAX_BIO_LENGTH) {
    return {
      kind: 'too-long',
      message: `Bio is limited to ${MAX_BIO_LENGTH} characters (currently ${input.length}).`,
    };
  }
  return { kind: 'ok', message: null };
}

/** Max length of a social-link caption (matches `socialLinkSchema.label`). */
export const SOCIAL_LINK_LABEL_MAX = 30;
/** Max length of a social-link URL (matches `socialLinkSchema.url`). */
export const SOCIAL_LINK_URL_MAX = 2048;

export type SocialLinkUrlValidationKind = 'ok' | 'empty' | 'invalid' | 'too-long';

export interface SocialLinkUrlValidation {
  readonly kind: SocialLinkUrlValidationKind;
  readonly message: string | null;
}

/**
 * Validate a single social-link URL (#FU-51). Accepts only absolute
 * `http`/`https` URLs — the same shape `socialLinkSchema.url`
 * (`z.string().url()`) enforces server-side, with friendlier copy.
 * Empty is reported as `'empty'` (the row is incomplete, not invalid)
 * so the editor can disable "add" without showing a scary error.
 */
export function validateSocialLinkUrl(input: string): SocialLinkUrlValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: 'empty', message: null };
  }
  if (trimmed.length > SOCIAL_LINK_URL_MAX) {
    return { kind: 'too-long', message: `URL is limited to ${SOCIAL_LINK_URL_MAX} characters.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: 'invalid', message: 'Enter a full URL, e.g. https://example.com.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'invalid', message: 'Links must start with http:// or https://.' };
  }
  return { kind: 'ok', message: null };
}

/**
 * Validate a social-link label. Empty is `'empty'` (incomplete row);
 * over-length is `'too-long'`.
 */
export type SocialLinkLabelValidationKind = 'ok' | 'empty' | 'too-long';

export interface SocialLinkLabelValidation {
  readonly kind: SocialLinkLabelValidationKind;
  readonly message: string | null;
}

export function validateSocialLinkLabel(input: string): SocialLinkLabelValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: 'empty', message: null };
  }
  if (trimmed.length > SOCIAL_LINK_LABEL_MAX) {
    return {
      kind: 'too-long',
      message: `Label is limited to ${SOCIAL_LINK_LABEL_MAX} characters.`,
    };
  }
  return { kind: 'ok', message: null };
}

export interface DisplayNameValidation {
  readonly kind: 'ok' | 'too-long';
  readonly message: string | null;
}

export function validateDisplayName(input: string): DisplayNameValidation {
  if (input.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      kind: 'too-long',
      message: `Display name is limited to ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    };
  }
  return { kind: 'ok', message: null };
}

/**
 * The full picker schema (for callers that want to drive a
 * `safeParse` directly — used by the api-client's
 * `checkHandleAvailability` short-circuit and by the contract
 * tests).
 */
export { shareableHandleSchema };
