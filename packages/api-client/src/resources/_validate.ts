// Internal helper: validate an outbound request body via the
// matching `@binderly/api-contracts` write schema before encoding
// to JSON. On failure, throw {@link ApiValidationError} so the
// caller fails fast at the call site instead of round-tripping
// through the server.
//
// Resource modules import this and wrap their write inputs:
//
//   await http.request({ ... body: validateRequest(addCollectionItemRequest, input) ... });

import { ApiValidationError } from '../error.js';

import type { z } from 'zod';

/**
 * Run `schema.safeParse(input)`. On success return the parsed
 * value (so default-applied / coerced / `.strict()`-stripped
 * versions land on the wire); on failure throw an
 * {@link ApiValidationError} carrying the zod issues.
 *
 * The `label` is used in the thrown error message so the caller
 * can see which schema rejected the input ("addCollectionItemRequest"
 * vs "updateProfileRequest").
 */
export function validateRequest<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  label: string,
): z.infer<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiValidationError(
      `Invalid request body for ${label}: ${formatZodIssues(parsed.error.issues)}`,
      {
        zodIssues: parsed.error.issues,
        details: parsed.error.issues,
      },
    );
  }
  return parsed.data;
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  if (issues.length === 0) return '(no issues)';
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
