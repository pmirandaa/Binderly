// Pure validators for the shareables settings screen.
//
// Functionally identical to `apps/web/app/settings/shareables/validation.ts` —
// kept duplicated here (rather than imported across the app
// boundary) so both vitest configs can resolve the file under
// their own `include` glob without cross-app path acrobatics.
// The shared regex constants both files use live in
// `@binderly/api-contracts/src/auth.ts`
// (`SHAREABLE_HANDLE_PATTERN`, `shareableHandleSchema`), which is
// the single source of truth for the handle shape.

import { SHAREABLE_HANDLE_PATTERN, shareableHandleSchema } from '@binderly/api-contracts';

export const MAX_BIO_LENGTH = 280;
export const MAX_DISPLAY_NAME_LENGTH = 80;
export const SHAREABLE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,49}$/;
export const MAX_SLUG_LENGTH = 50;

export type HandleValidationKind =
  | 'ok'
  | 'too-short'
  | 'too-long'
  | 'invalid-chars'
  | 'leading-hyphen';

export interface HandleValidation {
  readonly kind: HandleValidationKind;
  readonly message: string | null;
}

export function validateHandle(input: string): HandleValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: 'too-short', message: 'Pick a handle (3\u201330 characters).' };
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
 * `http`/`https` URLs — the same shape `socialLinkSchema.url` enforces
 * server-side. Empty is `'empty'` (incomplete row, not an error).
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

export { shareableHandleSchema };
