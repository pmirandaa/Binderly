// Shared fixture shape for master-set engine round-trip tests.
//
// Every fixture exports:
//   - `set`     — a minimal `DecideMasterSetSetInput` (canonicalKey + masterSetRules)
//   - `printings` — the per-printing engine inputs
//   - `expected` — the master-set decision for each printing's variant_key
//
// The engine's output for `printings` MUST equal `expected` under the
// fixture's `set.masterSetRules` for the test to pass.

import type { DecideMasterSetSetInput, MasterSetDecisionInput } from '../decide.js';

export interface MasterSetFixture {
  /** Human-readable label for test names. */
  readonly label: string;
  readonly set: DecideMasterSetSetInput;
  readonly printings: ReadonlyArray<MasterSetDecisionInput>;
  /** `variant_key → expected include_in_master_set`. */
  readonly expected: ReadonlyMap<string, boolean>;
}
