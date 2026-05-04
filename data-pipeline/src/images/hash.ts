// Tiny SHA-256 wrapper extracted into its own file so both
// `dedup.ts` and `processor.ts` can share one implementation
// without a circular import.

import { createHash } from 'node:crypto';

export function sha256OfBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
