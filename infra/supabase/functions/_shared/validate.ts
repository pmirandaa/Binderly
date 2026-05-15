// Zod-backed body validation for the Edge Function dispatcher.
//
// `parseJsonBody(request, schema)` reads the request body, parses it
// as JSON, then validates against the supplied zod schema. Any failure
// is translated into an `ApiError({ code: 'VALIDATION' })` with the
// zod issues echoed in `details`. The dispatcher catches those and
// emits the canonical envelope.
//
// Two reasons we do this here instead of inside each handler:
//
//   1. The error envelope shape is uniform — handlers don't repeat
//      the "build a 400 with the zod issues" boilerplate.
//   2. The `details` field is constrained to a stable shape (`{
//      issues: [{ path, message, code }] }`), so consumers can render
//      a per-field error UI without inspecting raw zod internals.

import { ApiError } from './errors.ts';

import type { ZodIssue, ZodTypeAny, infer as zInfer } from 'zod';

/**
 * Validation `details` payload. Shape is intentionally narrow so the
 * web/mobile UI can render a "field X: error Y" list without
 * inspecting raw zod internals.
 */
export interface ValidationIssueDetails {
  readonly issues: readonly {
    readonly path: readonly (string | number)[];
    readonly message: string;
    readonly code: string;
  }[];
}

/**
 * Parse the JSON body of a `Request` and validate it against the
 * supplied schema. Throws `ApiError({ code: 'VALIDATION' })` on any
 * failure (no body, malformed JSON, schema mismatch).
 */
export async function parseJsonBody<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<zInfer<TSchema>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new ApiError('VALIDATION', 'Failed to read request body.');
  }
  if (raw.length === 0) {
    throw new ApiError('VALIDATION', 'Request body is empty.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ApiError('VALIDATION', `Request body is not valid JSON: ${stringifyCause(cause)}`);
  }
  return validateBody(parsed, schema);
}

/**
 * Validate an in-memory value against a schema. Useful when the body
 * has already been parsed (e.g. multi-step validation, or tests that
 * synthesize the input).
 */
export function validateBody<TSchema extends ZodTypeAny>(
  value: unknown,
  schema: TSchema,
): zInfer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details: ValidationIssueDetails = {
      issues: result.error.issues.map((issue: ZodIssue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    };
    throw new ApiError('VALIDATION', formatTopMessage(result.error.issues), { details });
  }
  return result.data;
}

function formatTopMessage(issues: readonly ZodIssue[]): string {
  if (issues.length === 0) return 'Validation failed.';
  const first = issues[0];
  if (first === undefined) return 'Validation failed.';
  const path = first.path.length > 0 ? `at ${first.path.join('.')}` : 'at request body';
  return `Validation failed ${path}: ${first.message}.`;
}

function stringifyCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'unknown';
}
