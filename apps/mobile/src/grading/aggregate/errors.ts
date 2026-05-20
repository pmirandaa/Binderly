// Re-exports for explicit-error-import callsites.
//
// Mirrors the surface / corners / edges patterns: the type guard and the
// error type both live in `types.ts`; this file just re-exports them so
// downstream callsites that only care about errors can `import { ... }
// from '.../errors.js'` without pulling in the rest of the type surface.

export { isAggregateError } from './types.js';
export type {
  AggregateServiceError,
  AggregateServiceErrorReason,
} from './types.js';
