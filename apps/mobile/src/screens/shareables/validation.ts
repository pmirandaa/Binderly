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
